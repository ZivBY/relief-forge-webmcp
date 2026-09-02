import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8')

describe('guided mobile workflow integration', () => {
  it('mounts every requested subsection and both shared depth editors', () => {
    const mountedSubsections = Array.from(
      appSource.matchAll(/data-mobile-subsection="([^"]+)"/g),
      (match) => match[1],
    )

    expect(new Set(mountedSubsections)).toEqual(new Set([
      'source',
      'form',
      'composition',
      'size-layout',
      'depth-profile',
      'local-depth',
      'guides',
      'palette',
      'mapping-review',
      'printer-bed',
      'geometry-plates',
      'preflight',
      'build-save',
    ]))
    expect(appSource).toContain('data-mobile-depth-mount="depth-profile"')
    expect(appSource).toContain('data-mobile-depth-mount="local-depth"')
    expect(appSource).toContain('<DepthControls')
    expect(appSource).toContain('<RegionalDepthEditor')
    expect(appSource).toContain('<DepthPaintEditor')
    expect(appSource).not.toContain('<b>Maximum depth</b>')
  })

  it('keeps responsive navigation as UI state and crosses top-level stages directly', () => {
    expect(appSource).toContain('useMobileEditorViewport()')
    expect(appSource).toContain('DEFAULT_MOBILE_PREVIEW_STATE')
    expect(appSource).toContain('requestedMobileLocation ?? getMobileWorkflowEntry(nextStep)')
    expect(appSource).toContain('selectWorkflowStep(location.sectionId, true, location)')
    expect(appSource).toContain("nextMobileLocation.subsectionId === 'guides'")
    expect(appSource).toContain("if (guidesActive) setPreviewMode('model')")
    expect(appSource).not.toMatch(/\b(?:pushState|replaceState)\s*\(/)
  })

  it('focuses and scrolls the new subsection without remounting the viewer', () => {
    expect(appSource).toContain('heading?.focus({ preventScroll: true })')
    expect(appSource).toContain("heading?.scrollIntoView({ block: 'start' })")
    expect(appSource.match(/<WallArtViewer\b/g)).toHaveLength(1)
    expect(appSource).toContain('data-mobile-preview-state={mobilePreviewState}')
    expect(appSource).toContain('<MobilePreviewSizeControl')
  })

  it('keeps mobile controls conditional while retaining desktop workflow footers', () => {
    expect(appSource).toContain("isMobileEditorViewport && workflowStep === 'shape'")
    expect(appSource).toContain("isMobileEditorViewport && workflowStep !== 'shape'")
    expect(appSource.match(/material-inspector__footer--desktop/g)).toHaveLength(2)
    expect(appSource.match(/<MobileWorkflowFooter\b/g)).toHaveLength(2)
  })
})
