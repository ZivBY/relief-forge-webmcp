import { describe, expect, it } from 'vitest'
import { formatBuildLabel } from './build-info'

describe('build information', () => {
  it('shows local for ordinary builds without a release commit', () => {
    expect(formatBuildLabel('0.1.0', '')).toBe('v0.1.0 · local')
  })

  it('shows the short commit for hosted releases', () => {
    expect(formatBuildLabel(
      '0.1.0',
      ' 18b78c1bf2d6ec6d8b77b5c428e5dc456a974a97 ',
    )).toBe('v0.1.0 · 18b78c1')
  })
})
