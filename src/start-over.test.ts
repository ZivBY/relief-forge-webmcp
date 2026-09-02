import { describe, expect, it, vi } from 'vitest'
import { createWallArtConfig } from './core/config'
import {
  LEGACY_PROJECT_STORAGE_KEY,
  PROJECT_STORAGE_KEY,
  persistFreshProjectConfig,
  startOverProject,
} from './start-over'

describe('startOverProject', () => {
  it('persists and activates a fresh default before clearing local field assets', async () => {
    const events: string[] = []
    const persistFreshConfig = vi.fn((config) => {
      expect(config).toEqual(createWallArtConfig())
      events.push('persist')
    })
    const activateFreshConfig = vi.fn((config) => {
      expect(config).toEqual(createWallArtConfig())
      events.push('activate')
    })

    const result = await startOverProject({
      persistFreshConfig,
      activateFreshConfig,
      clearPhotoFields: async () => { events.push('clear-photo') },
      clearDepthPaintFields: async () => { events.push('clear-depth-paint') },
    })

    expect(result.config).toEqual(createWallArtConfig())
    expect(result.cleanupFailures).toEqual([])
    expect(events.slice(0, 2)).toEqual(['persist', 'activate'])
    expect(events.slice(2).sort()).toEqual(['clear-depth-paint', 'clear-photo'])
  })

  it('does not activate or delete assets when the fresh recipe cannot be saved', async () => {
    const activateFreshConfig = vi.fn()
    const clearPhotoFields = vi.fn(async () => undefined)
    const clearDepthPaintFields = vi.fn(async () => undefined)

    await expect(startOverProject({
      persistFreshConfig: () => { throw new Error('storage unavailable') },
      activateFreshConfig,
      clearPhotoFields,
      clearDepthPaintFields,
    })).rejects.toThrow('storage unavailable')

    expect(activateFreshConfig).not.toHaveBeenCalled()
    expect(clearPhotoFields).not.toHaveBeenCalled()
    expect(clearDepthPaintFields).not.toHaveBeenCalled()
  })

  it('keeps the fresh project active and reports asset cleanup failures', async () => {
    const result = await startOverProject({
      persistFreshConfig: () => undefined,
      activateFreshConfig: () => undefined,
      clearPhotoFields: async () => { throw new Error('photo database busy') },
      clearDepthPaintFields: async () => { throw new Error('paint database busy') },
    })

    expect(result.config).toEqual(createWallArtConfig())
    expect(result.cleanupFailures).toEqual(['photo fields', 'depth-paint fields'])
  })
})

describe('persistFreshProjectConfig', () => {
  it('writes the current recipe before removing the legacy fallback', () => {
    const events: string[] = []
    const config = createWallArtConfig()

    persistFreshProjectConfig({
      setItem: (key, value) => {
        events.push(`set:${key}`)
        expect(JSON.parse(value)).toEqual(config)
      },
      removeItem: (key) => { events.push(`remove:${key}`) },
    }, config)

    expect(events).toEqual([
      `set:${PROJECT_STORAGE_KEY}`,
      `remove:${LEGACY_PROJECT_STORAGE_KEY}`,
    ])
  })

  it('keeps the legacy recipe when writing the current recipe fails', () => {
    const removeItem = vi.fn()

    expect(() => persistFreshProjectConfig({
      setItem: () => { throw new Error('quota exceeded') },
      removeItem,
    }, createWallArtConfig())).toThrow('quota exceeded')

    expect(removeItem).not.toHaveBeenCalled()
  })

  it('keeps the valid fresh recipe when legacy cleanup is blocked', () => {
    expect(() => persistFreshProjectConfig({
      setItem: () => undefined,
      removeItem: () => { throw new Error('policy blocked cleanup') },
    }, createWallArtConfig())).not.toThrow()
  })
})
