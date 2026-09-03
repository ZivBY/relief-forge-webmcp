import packageInformation from '../package.json'

export function formatBuildLabel(version: string, commit: string): string {
  const normalizedCommit = commit.trim()
  return `v${version} · ${normalizedCommit ? normalizedCommit.slice(0, 7) : 'local'}`
}

export const APP_BUILD_LABEL = formatBuildLabel(
  packageInformation.version,
  __RELIEF_FORGE_COMMIT__,
)
