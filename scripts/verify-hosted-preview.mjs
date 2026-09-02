import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const scriptsDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptsDirectory, '..')
const wranglerEntry = resolve(repositoryRoot, 'node_modules/wrangler/bin/wrangler.js')
const wranglerConfig = resolve(repositoryRoot, 'dist/server/wrangler.json')
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'relief-forge-webmcp-smoke-'))
let child
let logs = ''

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function availablePort() {
  const server = createServer()
  await new Promise((resolveListening, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListening)
  })
  const address = server.address()
  assert(address && typeof address === 'object', 'Could not reserve a local smoke-test port.')
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()))
  return address.port
}

async function requestPath(baseUrl, path, headers = {}) {
  const response = await fetch(new URL(path, baseUrl), { headers, redirect: 'manual' })
  return {
    status: response.status,
    location: response.headers.get('location'),
    cacheControl: response.headers.get('cache-control') ?? '',
    cdnCacheControl: response.headers.get('cloudflare-cdn-cache-control') ?? '',
    gate: response.headers.get('x-relief-forge-gate'),
    authRecovery: response.headers.get('x-relief-forge-auth-recovery'),
    referrerPolicy: response.headers.get('referrer-policy'),
    contentSecurityPolicy: response.headers.get('content-security-policy'),
    contentTypeOptions: response.headers.get('x-content-type-options'),
    frameOptions: response.headers.get('x-frame-options'),
    body: await response.text(),
  }
}

function assertProtectedResponse(response, label) {
  assert(response.cacheControl.includes('no-store'), `${label} response is cacheable.`)
  assert(response.cdnCacheControl.includes('no-store'), `${label} CDN response is cacheable.`)
  assert(response.gate === 'vinext-auth-v1', `${label} response is missing the gate canary.`)
  assert(response.referrerPolicy === 'no-referrer', `${label} response has an unsafe referrer policy.`)
  assert(response.contentSecurityPolicy?.includes("frame-ancestors 'none'"), `${label} response allows framing.`)
  assert(response.contentTypeOptions === 'nosniff', `${label} response is missing nosniff.`)
  assert(response.frameOptions === 'DENY', `${label} response is missing frame denial.`)
}

async function waitUntilReady(baseUrl, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child?.exitCode !== null) throw new Error(`Hosted preview exited before becoming ready.\n${logs}`)
    try {
      return await requestPath(baseUrl, '/')
    } catch {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 200))
    }
  }
  throw new Error(`Timed out waiting for the hosted preview.\n${logs}`)
}

async function stopChild() {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise((resolveExit) => child.once('exit', resolveExit)),
    new Promise((resolveDelay) => setTimeout(resolveDelay, 3_000)),
  ])
  if (child.exitCode === null) child.kill('SIGKILL')
}

try {
  const port = await availablePort()
  const baseUrl = `http://127.0.0.1:${port}`
  child = spawn(process.execPath, [
    wranglerEntry,
    'dev', '--config', wranglerConfig,
    '--ip', '127.0.0.1', '--port', String(port),
    '--persist-to', resolve(temporaryDirectory, 'wrangler-state'),
  ], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      WRANGLER_WRITE_LOGS: 'false',
      WRANGLER_LOG_PATH: resolve(temporaryDirectory, 'wrangler-logs'),
      XDG_CONFIG_HOME: resolve(temporaryDirectory, 'wrangler-xdg'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding('utf8')
    stream.on('data', (chunk) => { logs = `${logs}${chunk}`.slice(-50_000) })
  }

  const anonymous = await waitUntilReady(baseUrl)
  const partialIdentity = await requestPath(baseUrl, '/', {
    'oai-authenticated-user-email': 'partial@example.test',
  })
  const signedIn = await requestPath(baseUrl, '/', {
    'oai-authenticated-user-id': 'judge-local-user',
    'oai-authenticated-user-email': 'judge@example.test',
  })
  const secondSignedIn = await requestPath(baseUrl, '/', {
    'oai-authenticated-user-id': 'second-local-user',
    'oai-authenticated-user-email': 'second@example.test',
  })
  const callbackRecovery = await requestPath(baseUrl, '/callback?code=opaque&state=opaque', {
    'oai-authenticated-user-id': 'judge-local-user',
    'oai-authenticated-user-email': 'judge@example.test',
  })
  const feedbackRoute = await requestPath(baseUrl, '/api/feedback')

  for (const [label, response] of [
    ['anonymous', anonymous],
    ['partial identity', partialIdentity],
    ['signed in', signedIn],
    ['second signed in', secondSignedIn],
    ['authenticated callback recovery', callbackRecovery],
  ]) assertProtectedResponse(response, label)

  for (const [label, response] of [['anonymous', anonymous], ['partial identity', partialIdentity]]) {
    assert(response.status === 302, `${label} request returned ${response.status}, not 302.`)
    assert(response.location === '/signin-with-chatgpt?return_to=%2F', `${label} did not use ChatGPT sign-in.`)
    assert(!response.body.includes('data-relief-forge-access='), `${label} exposed an app marker.`)
  }
  for (const [label, response] of [['signed in', signedIn], ['second signed in', secondSignedIn]]) {
    assert(response.status === 200, `${label} request returned ${response.status}, not 200.`)
    assert(response.body.includes('data-relief-forge-access="allowed"'), `${label} is missing the app marker.`)
  }
  assert(callbackRecovery.status === 302, `Authenticated callback returned ${callbackRecovery.status}, not 302.`)
  const callbackLocation = new URL(callbackRecovery.location, baseUrl)
  assert(callbackLocation.origin === baseUrl && callbackLocation.pathname === '/', 'Callback did not recover to root.')
  assert(callbackRecovery.authRecovery === 'callback', 'Callback response is missing its recovery marker.')
  assert(callbackRecovery.referrerPolicy === 'no-referrer', 'Callback response has an unsafe referrer policy.')
  assert(feedbackRoute.status === 404, `Removed feedback route returned ${feedbackRoute.status}, not 404.`)

  console.log(JSON.stringify({
    anonymous: anonymous.status,
    partialIdentity: partialIdentity.status,
    signedIn: signedIn.status,
    secondSignedIn: secondSignedIn.status,
    callbackRecovery: callbackRecovery.status,
    feedbackRoute: feedbackRoute.status,
    cachePolicy: 'no-store',
  }, null, 2))
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  throw new Error(`${message}\nHosted preview logs:\n${logs}`)
} finally {
  await stopChild()
  await rm(temporaryDirectory, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 250,
  })
}
