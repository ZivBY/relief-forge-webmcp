import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const mobilePreviewCss = readFileSync(
  new URL('./mobile-preview.css', import.meta.url),
  'utf8',
)
const rootLayout = readFileSync(
  new URL('../app/layout.tsx', import.meta.url),
  'utf8',
)

describe('guided mobile editor stylesheet', () => {
  it('keeps every override inside the established phone breakpoint', () => {
    const withoutComment = mobilePreviewCss.replace(/\/\*[\s\S]*?\*\//g, '').trim()

    expect(withoutComment.startsWith('@media (max-width: 720px),')).toBe(true)
    expect(withoutComment).toContain('(pointer: coarse)')
    expect(withoutComment.endsWith('}')).toBe(true)
    expect(withoutComment.match(/@media/g)).toHaveLength(1)
  })

  it('pins a compact preview by default and exposes collapsed and expanded states', () => {
    expect(mobilePreviewCss).toContain('position: sticky')
    expect(mobilePreviewCss).toContain('height: var(--mobile-preview-height)')
    expect(mobilePreviewCss).toContain('min-height: 0')
    expect(mobilePreviewCss).toContain('34svh')
    expect(mobilePreviewCss).toContain('70svh')
    expect(mobilePreviewCss).toContain('[data-mobile-preview-state="collapsed"]')
    expect(mobilePreviewCss).toContain('[data-mobile-preview-state="compact"]')
    expect(mobilePreviewCss).toContain('[data-mobile-preview-state="expanded"]')
    expect(mobilePreviewCss).toContain('scroll-margin-top: calc(var(--mobile-preview-height) + 12px)')
  })

  it('keeps the viewer mounted when its collapsed summary bar is active', () => {
    const collapsedRule = mobilePreviewCss.match(
      /\.preview-panel\[data-mobile-preview-state="collapsed"\] \.preview-stage,[\s\S]*?\}/,
    )?.[0]

    expect(collapsedRule).toContain('visibility: hidden')
    expect(collapsedRule).not.toContain('display: none')
  })

  it('provides one-active-subsection, touch-target, and safe-area contracts', () => {
    expect(mobilePreviewCss).toContain('[data-mobile-subsection]:not([data-mobile-active="true"])')
    expect(mobilePreviewCss).toContain('.material-inspector__footer--desktop')
    expect(mobilePreviewCss).toContain('.material-inspector__heading')
    expect(mobilePreviewCss).toContain('display: none')
    expect(mobilePreviewCss).toContain('min-height: 44px')
    expect(mobilePreviewCss).toContain('env(safe-area-inset-bottom)')
    expect(mobilePreviewCss).toContain('.mobile-workflow-footer')
    expect(mobilePreviewCss).toContain('.material-topbar .topbar-actions .button')
    expect(mobilePreviewCss).toContain('.material-studio .wall-art-viewer__view-button')
    expect(mobilePreviewCss).toContain('.material-studio .wall-art-viewer__parity-badge')
  })

  it('leaves every subsection visible under desktop CSS', () => {
    expect(mobilePreviewCss.indexOf('[data-mobile-subsection]')).toBeGreaterThan(
      mobilePreviewCss.indexOf('@media'),
    )
    expect(mobilePreviewCss).not.toContain('@media (min-width:')
  })

  it('loads after the existing desktop stylesheet', () => {
    expect(rootLayout.indexOf("import '../src/mobile-preview.css'")).toBeGreaterThan(
      rootLayout.indexOf("import '../src/styles.css'"),
    )
  })
})
