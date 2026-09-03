/** @vitest-environment happy-dom */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JUDGE_DEMO_PROMPT, JUDGE_QUICK_START_STORAGE_KEY } from '../judge-quick-start'
import { JudgeQuickStart } from './JudgeQuickStart'

function buttonWithText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button'))
    .find((candidate) => candidate.textContent?.includes(text))

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Expected a button containing: ${text}`)
  }

  return button
}

describe('JudgeQuickStart interactions', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    const reactTestEnvironment = globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean
    }
    reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true
    window.localStorage.clear()
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    window.localStorage.clear()
  })

  async function renderQuickStart() {
    await act(async () => {
      root.render(<JudgeQuickStart agentToolsState="ready" />)
    })
  }

  it('persists dismissal, can always reopen, and returns focus after Escape', async () => {
    await renderQuickStart()

    expect(container.querySelector('#judge-quick-start-card')).not.toBeNull()
    expect(buttonWithText(container, 'How it works').getAttribute('aria-expanded')).toBe('true')

    await act(async () => {
      buttonWithText(container, 'Dismiss').click()
    })

    expect(container.querySelector('#judge-quick-start-card')).toBeNull()
    expect(window.localStorage.getItem(JUDGE_QUICK_START_STORAGE_KEY)).toBe('dismissed')
    expect(document.activeElement).toBe(buttonWithText(container, 'How it works'))

    await act(async () => {
      root.unmount()
    })
    root = createRoot(container)
    await renderQuickStart()

    expect(container.querySelector('#judge-quick-start-card')).toBeNull()

    const trigger = buttonWithText(container, 'How it works')
    await act(async () => {
      trigger.click()
    })
    expect(container.querySelector('#judge-quick-start-card')).not.toBeNull()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })

    expect(container.querySelector('#judge-quick-start-card')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('shows useful feedback for both successful and blocked prompt copying', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    await renderQuickStart()

    await act(async () => {
      buttonWithText(container, 'Copy demo prompt').click()
      await Promise.resolve()
    })

    expect(writeText).toHaveBeenCalledWith(JUDGE_DEMO_PROMPT)
    expect(buttonWithText(container, 'Prompt copied')).toBeTruthy()
    expect(container.querySelector('.judge-quick-start__copy-status')?.textContent)
      .toContain('Paste the prompt into your agent')

    const trigger = buttonWithText(container, 'How it works')
    await act(async () => {
      trigger.click()
    })
    await act(async () => {
      trigger.click()
    })
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => { throw new Error('blocked') }) },
    })

    await act(async () => {
      buttonWithText(container, 'Copy demo prompt').click()
      await Promise.resolve()
    })

    expect(container.querySelector('.judge-quick-start__copy-status')?.textContent)
      .toContain('Copy was blocked')
    expect(container.querySelector('.judge-quick-start__prompt')?.textContent)
      .toContain(JUDGE_DEMO_PROMPT)
  })
})
