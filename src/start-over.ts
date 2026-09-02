import { createWallArtConfig } from './core/config'
import type { WallArtConfig } from './core/types'

export const START_OVER_DESCRIPTION =
  "Replace this project with Relief Forge's default design and remove its locally stored photo and depth-paint data? Downloaded files won't be affected. This can't be undone."

export const PROJECT_STORAGE_KEY = 'relief-forge-project-v3'
export const LEGACY_PROJECT_STORAGE_KEY = 'relief-forge-project-v2'

interface ProjectRecipeStorage {
  removeItem(key: string): void
  setItem(key: string, value: string): void
}

/** Write the current schema first so failure cannot erase a legacy-only recipe. */
export function persistFreshProjectConfig(
  storage: ProjectRecipeStorage,
  config: WallArtConfig,
): void {
  storage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(config))
  try {
    storage.removeItem(LEGACY_PROJECT_STORAGE_KEY)
  } catch {
    // The current key now contains the fresh valid recipe and takes precedence.
    // A storage policy may still prevent best-effort legacy-key cleanup.
  }
}

export type StartOverCleanupArea = 'photo fields' | 'depth-paint fields'

export interface StartOverOptions {
  persistFreshConfig(config: WallArtConfig): void
  activateFreshConfig(config: WallArtConfig): void
  clearPhotoFields(): Promise<void>
  clearDepthPaintFields(): Promise<void>
}

export interface StartOverResult {
  config: WallArtConfig
  cleanupFailures: StartOverCleanupArea[]
}

/**
 * Persist a valid fresh recipe before activating it or deleting local assets.
 * A storage failure therefore leaves the current project and its required
 * canonical bytes intact instead of creating a broken saved recipe.
 */
export async function startOverProject({
  persistFreshConfig,
  activateFreshConfig,
  clearPhotoFields,
  clearDepthPaintFields,
}: StartOverOptions): Promise<StartOverResult> {
  const config = createWallArtConfig()
  persistFreshConfig(config)
  activateFreshConfig(config)

  const cleanup = await Promise.allSettled([
    clearPhotoFields(),
    clearDepthPaintFields(),
  ])
  const areas: StartOverCleanupArea[] = ['photo fields', 'depth-paint fields']

  return {
    config,
    cleanupFailures: cleanup.flatMap((result, index) => (
      result.status === 'rejected' ? [areas[index]] : []
    )),
  }
}
