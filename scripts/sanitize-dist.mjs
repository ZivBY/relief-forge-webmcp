import { readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptsDirectory, '..')
const distributionDirectory = resolve(repositoryRoot, 'dist')

function isInsideDistribution(filePath) {
  const pathFromDistribution = relative(distributionDirectory, filePath)
  return pathFromDistribution !== '' && !pathFromDistribution.startsWith('..')
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const entryPath = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...await collectFiles(entryPath))
    else if (entry.isFile()) files.push(entryPath)
  }
  return files
}

const files = await collectFiles(distributionDirectory)
for (const filePath of files) {
  const name = basename(filePath)
  const isEnvironmentFile = name === '.dev.vars'
    || name.startsWith('.dev.vars.')
    || name === '.env'
    || name.startsWith('.env.')
  if (!isEnvironmentFile) continue
  if (!isInsideDistribution(filePath)) throw new Error(`Refusing to remove file outside build output: ${filePath}`)
  await rm(filePath, { force: true })
}

const generatedWranglerPath = resolve(distributionDirectory, 'server/wrangler.json')
if (!isInsideDistribution(generatedWranglerPath)) throw new Error('Generated Wrangler path escaped build output.')
const generatedWrangler = JSON.parse(await readFile(generatedWranglerPath, 'utf8'))
delete generatedWrangler.configPath
delete generatedWrangler.userConfigPath
if (
  generatedWrangler.main !== 'index.js'
  || generatedWrangler.assets?.directory !== '../client'
  || !generatedWrangler.compatibility_flags?.includes('nodejs_compat')
) throw new Error('Hosted build is not using the expected Vinext server entry point.')
if ((generatedWrangler.d1_databases?.length ?? 0) > 0 || (generatedWrangler.r2_buckets?.length ?? 0) > 0) {
  throw new Error('Challenge build must not contain D1 or R2 bindings.')
}
await writeFile(generatedWranglerPath, `${JSON.stringify(generatedWrangler)}\n`, 'utf8')

const generatedServerEntryPath = resolve(distributionDirectory, 'server/index.js')
const generatedServerEntry = await readFile(generatedServerEntryPath, 'utf8')
const proxyPath = resolve(repositoryRoot, 'proxy.ts')
const proxyPathRepresentations = [
  proxyPath,
  proxyPath.replaceAll('\\', '/'),
  JSON.stringify(proxyPath).slice(1, -1),
]
let sanitizedServerEntry = generatedServerEntry
for (const representation of new Set(proxyPathRepresentations)) {
  sanitizedServerEntry = sanitizedServerEntry.replaceAll(representation, '/workspace/proxy.ts')
}
if (sanitizedServerEntry === generatedServerEntry) {
  throw new Error('Hosted server bundle is missing the expected Vinext proxy source label.')
}
await writeFile(generatedServerEntryPath, sanitizedServerEntry, 'utf8')

const personalPathRepresentations = [
  repositoryRoot,
  repositoryRoot.replaceAll('\\', '/'),
  JSON.stringify(repositoryRoot).slice(1, -1),
].map((value) => Buffer.from(value.toLowerCase(), 'utf8'))
for (const filePath of await collectFiles(distributionDirectory)) {
  const contents = await readFile(filePath)
  const lowerCaseContents = Buffer.from(contents.toString('utf8').toLowerCase(), 'utf8')
  if (personalPathRepresentations.some((pathValue) => lowerCaseContents.includes(pathValue))) {
    throw new Error(`Hosted build contains a personal machine path: ${filePath}`)
  }
}

for (const requiredPath of ['client/_headers', 'server/index.js', 'server/wrangler.json', '.openai/hosting.json']) {
  const filePath = resolve(distributionDirectory, requiredPath)
  if (!isInsideDistribution(filePath) || !(await stat(filePath)).isFile()) {
    throw new Error(`Missing required hosted build file: dist/${requiredPath}`)
  }
}

const generatedHeaders = await readFile(resolve(distributionDirectory, 'client/_headers'), 'utf8')
if (!generatedHeaders.includes('/_next/static/*') || /^\s*\/(?:\*?)\s*$/m.test(generatedHeaders)) {
  throw new Error('Hosted cache rules must target hashed framework assets, not the root route.')
}
const forbiddenStaticEntry = resolve(distributionDirectory, 'client/index.html')
try {
  if ((await stat(forbiddenStaticEntry)).isFile()) {
    throw new Error('Hosted build must not expose a static dist/client/index.html entry point.')
  }
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

const serverFiles = (await collectFiles(resolve(distributionDirectory, 'server')))
  .filter((filePath) => filePath.endsWith('.js'))
const serverContents = (await Promise.all(serverFiles.map((filePath) => readFile(filePath, 'utf8')))).join('\n')
for (const requiredToken of ['oai-authenticated-user-id', 'oai-authenticated-user-email', 'signin-with-chatgpt', 'vinext-auth-v1']) {
  if (!serverContents.includes(requiredToken)) throw new Error(`Hosted server bundle is missing access-gate token: ${requiredToken}`)
}
for (const forbiddenToken of [
  'FRIEND_EMAIL_ALLOWLIST',
  'feedback_submissions',
  'relief-forge-feedback-id:',
]) {
  if (serverContents.includes(forbiddenToken)) {
    throw new Error(`Hosted server bundle contains forbidden private token: ${forbiddenToken}`)
  }
}
