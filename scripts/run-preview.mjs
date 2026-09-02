import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptsDirectory, '..')
const wranglerEntry = resolve(repositoryRoot, 'node_modules/wrangler/bin/wrangler.js')

const argumentsForWrangler = [
  wranglerEntry,
  'dev',
  '--config',
  'dist/server/wrangler.json',
  '--ip',
  '127.0.0.1',
  '--port',
  '8787',
]

const localEnvironmentPath = resolve(repositoryRoot, '.dev.vars')
if (existsSync(localEnvironmentPath)) {
  argumentsForWrangler.push('--env-file', localEnvironmentPath)
}

const child = spawn(process.execPath, argumentsForWrangler, {
  cwd: repositoryRoot,
  env: {
    ...process.env,
    WRANGLER_WRITE_LOGS: 'false',
    WRANGLER_LOG_PATH: resolve(repositoryRoot, '.wrangler/logs'),
    XDG_CONFIG_HOME: resolve(repositoryRoot, '.wrangler/xdg'),
  },
  stdio: 'inherit',
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exitCode = code ?? 1
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => child.kill(signal))
}
