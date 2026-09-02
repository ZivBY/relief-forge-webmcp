import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StartOverDialog } from './StartOverDialog'

const handlers = {
  onCancel: () => undefined,
  onConfirm: () => undefined,
}

describe('StartOverDialog', () => {
  it('stays absent until the user asks to start over', () => {
    const markup = renderToStaticMarkup(
      <StartOverDialog {...handlers} busy={false} open={false} />,
    )

    expect(markup).toBe('')
  })

  it('presents a destructive alert with the safe action first', () => {
    const markup = renderToStaticMarkup(
      <StartOverDialog {...handlers} busy={false} open />,
    )

    expect(markup).toContain('role="alertdialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('Downloaded files won&#x27;t be affected')
    expect(markup.indexOf('Keep editing')).toBeLessThan(markup.indexOf('Start over</button>'))
  })

  it('locks both actions while cleanup runs and exposes failures as alerts', () => {
    const busyMarkup = renderToStaticMarkup(
      <StartOverDialog {...handlers} busy open />,
    )
    const errorMarkup = renderToStaticMarkup(
      <StartOverDialog {...handlers} busy={false} error="Storage is unavailable." open />,
    )

    expect(busyMarkup).toContain('aria-busy="true"')
    expect(busyMarkup).toContain('Starting over…')
    expect(busyMarkup.match(/disabled=""/g)).toHaveLength(2)
    expect(errorMarkup).toContain('role="alert"')
    expect(errorMarkup).toContain('Storage is unavailable.')
  })
})
