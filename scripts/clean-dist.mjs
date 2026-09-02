import { rm } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptsDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptsDirectory, '..')
const distributionDirectory = resolve(repositoryRoot, 'dist')

if (
  dirname(distributionDirectory) !== repositoryRoot ||
  basename(distributionDirectory) !== 'dist'
) {
  throw new Error(`Refusing to clean unexpected build directory: ${distributionDirectory}`)
}

await rm(distributionDirectory, { recursive: true, force: true })
