import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MOBILE_PREVIEW_STATE,
  MOBILE_WORKFLOW_SECTIONS,
  getMobileWorkflowEntry,
  getMobileWorkflowLocation,
  getMobileWorkflowProgress,
  getNextMobilePreviewState,
  getNextMobileWorkflowLocation,
  getPreviousMobileWorkflowLocation,
  isMobileWorkflowLocation,
  type MobileWorkflowLocation,
} from './mobile-workflow'

describe('mobile workflow model', () => {
  it('defines the exact guided editor map in order', () => {
    expect(MOBILE_WORKFLOW_SECTIONS).toEqual([
      {
        id: 'shape',
        label: 'Shape',
        subsections: [
          { id: 'source', label: 'Source' },
          { id: 'form', label: 'Form' },
          { id: 'composition', label: 'Composition' },
          { id: 'size-layout', label: 'Size & Layout' },
          { id: 'depth-profile', label: 'Depth Profile' },
          { id: 'local-depth', label: 'Local Depth' },
          { id: 'guides', label: 'Guides' },
        ],
      },
      {
        id: 'color',
        label: 'Color',
        subsections: [
          { id: 'palette', label: 'Palette' },
          { id: 'mapping-review', label: 'Mapping & Review' },
        ],
      },
      {
        id: 'build',
        label: 'Build',
        subsections: [
          { id: 'printer-bed', label: 'Printer Bed' },
          { id: 'geometry-plates', label: 'Geometry & Plates' },
        ],
      },
      {
        id: 'export',
        label: 'Export',
        subsections: [
          { id: 'preflight', label: 'Preflight' },
          { id: 'build-save', label: 'Build & Save Files' },
        ],
      },
    ])
  })

  it('moves forward and backward across top-level section boundaries', () => {
    const guides = getMobileWorkflowLocation('guides')
    const palette = getMobileWorkflowLocation('palette')

    expect(getNextMobileWorkflowLocation(guides)).toEqual(palette)
    expect(getPreviousMobileWorkflowLocation(palette)).toEqual(guides)
    expect(getPreviousMobileWorkflowLocation(getMobileWorkflowEntry('shape'))).toBeUndefined()
    expect(getNextMobileWorkflowLocation(getMobileWorkflowLocation('build-save'))).toBeUndefined()
  })

  it('reports overall and within-section progress', () => {
    expect(getMobileWorkflowProgress(getMobileWorkflowLocation('local-depth'))).toMatchObject({
      sectionIndex: 1,
      sectionTotal: 4,
      subsectionIndex: 6,
      subsectionTotal: 7,
      overallIndex: 6,
      overallTotal: 13,
    })

    expect(getMobileWorkflowProgress(getMobileWorkflowLocation('printer-bed'))).toMatchObject({
      sectionIndex: 3,
      subsectionIndex: 1,
      subsectionTotal: 2,
      overallIndex: 10,
    })
  })

  it('validates direct jumps and rejects mismatched section pairs', () => {
    expect(isMobileWorkflowLocation({ sectionId: 'export', subsectionId: 'preflight' })).toBe(true)
    expect(isMobileWorkflowLocation({ sectionId: 'shape', subsectionId: 'preflight' })).toBe(false)
    expect(isMobileWorkflowLocation(null)).toBe(false)
    expect(() =>
      getMobileWorkflowProgress({
        sectionId: 'shape',
        subsectionId: 'preflight',
      } as unknown as MobileWorkflowLocation),
    ).toThrow(/does not belong/)
  })

  it('defaults the preview to compact and cycles every explicit size', () => {
    expect(DEFAULT_MOBILE_PREVIEW_STATE).toBe('compact')
    expect(getNextMobilePreviewState('collapsed')).toBe('compact')
    expect(getNextMobilePreviewState('compact')).toBe('expanded')
    expect(getNextMobilePreviewState('expanded')).toBe('collapsed')
  })
})
