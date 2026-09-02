import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { getMobileWorkflowLocation } from '../mobile-workflow'
import {
  MOBILE_EDITOR_MEDIA_QUERY,
  MobilePreviewSizeControl,
  MobileWorkflowFooter,
  MobileWorkflowNavigator,
} from './MobileWorkflowNavigator'

describe('MobileWorkflowNavigator', () => {
  it('renders labelled overall and subsection progress with an accessible direct index', () => {
    const markup = renderToStaticMarkup(
      <MobileWorkflowNavigator
        location={getMobileWorkflowLocation('depth-profile')}
        onNavigate={() => undefined}
      />,
    )

    expect(markup).toContain('aria-label="Editor sections"')
    expect(markup).toContain('<strong>Shape</strong>')
    expect(markup).toContain('Section 1 of 4')
    expect(markup).toContain('<strong>Depth Profile</strong>')
    expect(markup).toContain('role="heading" aria-level="2" tabindex="-1"')
    expect(markup).toContain('value="5"')
    expect(markup).toContain('max="13"')
    expect(markup).toContain('<summary>Jump to a section</summary>')
    expect(markup).toContain('aria-current="step"')
    expect(markup).toContain('aria-label="Shape: Depth Profile"')
  })

  it('uses Back and cross-section Continue semantics', () => {
    const firstMarkup = renderToStaticMarkup(
      <MobileWorkflowFooter
        location={getMobileWorkflowLocation('source')}
        onNavigate={() => undefined}
      />,
    )
    const boundaryMarkup = renderToStaticMarkup(
      <MobileWorkflowFooter
        location={getMobileWorkflowLocation('guides')}
        onNavigate={() => undefined}
      />,
    )

    expect(firstMarkup).toContain('disabled=""')
    expect(firstMarkup).toContain('Continue to Form')
    expect(boundaryMarkup).toContain('Back')
    expect(boundaryMarkup).toContain('Continue to Color')
  })

  it('offers explicit collapsed, compact, and expanded preview choices', () => {
    const markup = renderToStaticMarkup(
      <MobilePreviewSizeControl state="compact" onStateChange={() => undefined} />,
    )

    expect(markup).toContain('aria-label="Preview size"')
    expect(markup).toContain('aria-label="Collapse preview"')
    expect(markup).toContain('aria-label="Compact preview" aria-pressed="true"')
    expect(markup).toContain('aria-label="Expand preview"')
    expect(MOBILE_EDITOR_MEDIA_QUERY).toBe(
      '(max-width: 720px), (max-width: 1020px) and (max-height: 600px) and (pointer: coarse)',
    )
  })
})
