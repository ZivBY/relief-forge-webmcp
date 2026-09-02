import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptsDirectory, '..')
const commit = process.env.VITE_RELIEF_FORGE_COMMIT?.trim()

if (!/^[0-9a-f]{40}$/i.test(commit ?? '')) {
  throw new Error('Hosted builds require VITE_RELIEF_FORGE_COMMIT to be a full Git commit SHA.')
}

const git = (...argumentsForGit) => execFileSync('git', argumentsForGit, {
  cwd: repositoryRoot,
  encoding: 'utf8',
}).trim()

const headCommit = git('rev-parse', 'HEAD')
if (commit?.toLowerCase() !== headCommit.toLowerCase()) {
  throw new Error(`Hosted build commit ${commit} does not match HEAD ${headCommit}.`)
}

const worktreeStatus = git('status', '--porcelain', '--untracked-files=all')
if (worktreeStatus) {
  throw new Error('Hosted builds require a clean worktree. Commit the exact source before packaging.')
}
