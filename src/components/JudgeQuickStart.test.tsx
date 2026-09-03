import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  JudgeQuickStart,
  JudgeQuickStartCard,
} from './JudgeQuickStart'
import {
  JUDGE_DEMO_PROMPT,
  JUDGE_QUICK_START_STORAGE_KEY,
  copyJudgeDemoPrompt,
  rememberJudgeQuickStartDismissed,
  shouldAutoOpenJudgeQuickStart,
} from '../judge-quick-start'

describe('JudgeQuickStart', () => {
  it('keeps a permanent, accessible way to reopen the quick start', () => {
    const markup = renderToStaticMarkup(<JudgeQuickStart agentToolsState="ready" />)

    expect(markup).toContain('aria-controls="judge-quick-start-card"')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('aria-label="Open judge quick start"')
    expect(markup).toContain('How it works')
    expect(markup).toContain('4 AGENT TOOLS READY')
  })

  it('explains the complete human-agent handoff without blocking the editor', () => {
    const markup = renderToStaticMarkup(
      <JudgeQuickStartCard
        agentToolsState="ready"
        copyState="idle"
        onCopy={() => undefined}
        onDismiss={() => undefined}
      />,
    )

    expect(markup).toContain('role="region"')
    expect(markup).not.toContain('aria-modal="true"')
    expect(markup).toContain('Connected — all four agent tools are ready.')
    expect(markup.indexOf('Ask your agent')).toBeLessThan(markup.indexOf('Watch the shared project'))
    expect(markup.indexOf('Watch the shared project')).toBeLessThan(markup.indexOf('Review and save'))
    expect(markup).toContain('Copy demo prompt')
    expect(markup).toContain('Read demo prompt')
    expect(markup).toContain('Save file now')
  })

  it('gives actionable recovery text when WebMCP is unavailable', () => {
    const markup = renderToStaticMarkup(
      <JudgeQuickStartCard
        agentToolsState="unavailable"
        copyState="failed"
        onCopy={() => undefined}
        onDismiss={() => undefined}
      />,
    )

    expect(markup).toContain('ChatGPT’s in-app browser or WebMCP-enabled Chrome')
    expect(markup).toContain('copy it manually')
    expect(markup).toContain(JUDGE_DEMO_PROMPT)
  })

  it('opens automatically until dismissal has been remembered', () => {
    expect(shouldAutoOpenJudgeQuickStart({ getItem: () => null })).toBe(true)
    expect(shouldAutoOpenJudgeQuickStart({ getItem: () => 'dismissed' })).toBe(false)
    expect(shouldAutoOpenJudgeQuickStart({ getItem: () => { throw new Error('blocked') } })).toBe(true)

    const setItem = vi.fn()
    rememberJudgeQuickStartDismissed({ setItem })
    expect(setItem).toHaveBeenCalledWith(JUDGE_QUICK_START_STORAGE_KEY, 'dismissed')
    expect(() => rememberJudgeQuickStartDismissed({ setItem: () => { throw new Error('blocked') } })).not.toThrow()
  })

  it('copies only the published reproducible prompt and handles blocked clipboard access', async () => {
    const writeText = vi.fn(async () => undefined)

    await expect(copyJudgeDemoPrompt({ writeText })).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith(JUDGE_DEMO_PROMPT)
    await expect(copyJudgeDemoPrompt(undefined)).resolves.toBe(false)
    await expect(copyJudgeDemoPrompt({ writeText: async () => { throw new Error('blocked') } })).resolves.toBe(false)
  })
})
