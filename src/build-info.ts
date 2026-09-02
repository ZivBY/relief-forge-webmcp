import packageInformation from '../package.json'

const commit = import.meta.env.VITE_RELIEF_FORGE_COMMIT?.trim()

export const APP_BUILD_LABEL = `v${packageInformation.version} · ${commit ? commit.slice(0, 7) : 'local'}`
