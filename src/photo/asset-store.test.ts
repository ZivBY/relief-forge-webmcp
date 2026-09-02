import { describe, expect, it } from 'vitest'
import { clearPhotoFieldAssets } from './asset-store'

describe('photo IndexedDB boundary', () => {
  it('fails recoverably when clearing browser storage is unavailable', async () => {
    await expect(clearPhotoFieldAssets()).rejects.toThrow(/unavailable/)
  })
})
