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
  getJudgeQuickStartStorage,
  rememberJudgeQuickStartDismissed,
  shouldAutoOpenJudgeQuickStart,
} from '../judge-quick-start'

describe('JudgeQuickStart', () => {
  it('keeps a permanent, accessible way to reopen the quick start', () => {
    const markup = renderToStaticMarkup(<JudgeQuickStart agentToolsState="ready" />)

    expect(markup).toContain('aria-controls="judge-quick-start-card"')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('aria-label="Run agent demo"')
    expect(markup).toContain('Run agent demo')
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
    expect(markup).toContain('Run the demo from your AI chat')
    expect(markup).toContain('There is no prompt box inside Relief Forge')
    expect(markup).toContain('WHERE TO SEND THE PROMPT')
    expect(markup).toContain('Use the Codex or ChatGPT message box outside this webpage.')
    expect(markup).toContain('Return to the conversation that opened this tab')
    expect(markup).toContain('All four agent tools are registered and ready.')
    expect(markup.indexOf('Copy prompt for AI chat')).toBeLessThan(markup.indexOf('Copy the ready-made prompt'))
    expect(markup.indexOf('Copy the ready-made prompt')).toBeLessThan(markup.indexOf('Return to your AI conversation'))
    expect(markup.indexOf('Return to your AI conversation')).toBeLessThan(markup.indexOf('Paste and press Send'))
    expect(markup.indexOf('Paste and press Send')).toBeLessThan(markup.indexOf('Review and save'))
    expect(markup).toContain('Read or manually copy prompt')
    expect(markup).toContain('Agent demo prompt for manual copying')
    expect(markup).toContain('Save file now')
  })

  it('gives actionable recovery text when WebMCP is unavailable', () => {
    const triggerMarkup = renderToStaticMarkup(<JudgeQuickStart agentToolsState="unavailable" />)
    const markup = renderToStaticMarkup(
      <JudgeQuickStartCard
        agentToolsState="unavailable"
        copyState="failed"
        onCopy={() => undefined}
        onDismiss={() => undefined}
      />,
    )

    expect(triggerMarkup).toContain('MANUAL EDITOR · AGENT TOOLS OFF')
    expect(triggerMarkup).not.toContain('WEBMCP UNAVAILABLE')
    expect(markup).toContain('This browser is in manual editor mode')
    expect(markup).toContain('the editor still works')
    expect(markup).toContain('ChatGPT’s built-in browser')
    expect(markup).toContain('WebMCP-enabled Chrome')
    expect(markup).toContain('Reopen in a supported browser')
    expect(markup).toContain('Reopen Relief Forge from a supported AI conversation first.')
    expect(markup).toContain('You may copy the prompt for later')
    expect(markup).toContain('before you send it')
    expect(markup).not.toContain('Copy below, then paste into the Codex or ChatGPT message box')
    expect(markup.indexOf('Reopen in a supported browser')).toBeLessThan(markup.indexOf('Run the same demo'))
    expect(markup).toContain('copy it manually')
    expect(markup).toContain('open=""')
    expect(markup).toContain(JUDGE_DEMO_PROMPT)

    const errorMarkup = renderToStaticMarkup(
      <JudgeQuickStartCard
        agentToolsState="error"
        copyState="idle"
        onCopy={() => undefined}
        onDismiss={() => undefined}
      />,
    )
    expect(errorMarkup).toContain('Enable Site tools permissions')
    expect(errorMarkup).toContain('Enable Site tools')
    expect(errorMarkup).toContain('The manual editor still works')
    expect(errorMarkup).toContain('Restore agent tools before sending the prompt.')
    expect(errorMarkup).toContain('Restore all four agent tools before you paste and send')
    expect(errorMarkup).not.toContain('Copy below, then paste into the Codex or ChatGPT message box')

    const checkingMarkup = renderToStaticMarkup(
      <JudgeQuickStartCard
        agentToolsState="checking"
        copyState="idle"
        onCopy={() => undefined}
        onDismiss={() => undefined}
      />,
    )
    expect(checkingMarkup).toContain('Wait for agent tools')
    expect(checkingMarkup).toContain('Wait for 4 AGENT TOOLS READY')
    expect(checkingMarkup).toContain('disabled=""')

    const unavailableCopiedMarkup = renderToStaticMarkup(
      <JudgeQuickStartCard
        agentToolsState="unavailable"
        copyState="copied"
        onCopy={() => undefined}
        onDismiss={() => undefined}
      />,
    )
    expect(unavailableCopiedMarkup).toContain('reopen in an AI browser')
    expect(unavailableCopiedMarkup).not.toContain('Now switch to Codex or ChatGPT')
  })

  it('opens automatically until dismissal has been remembered', () => {
    expect(JUDGE_QUICK_START_STORAGE_KEY).toBe('relief-forge-judge-quick-start-v2')
    expect(shouldAutoOpenJudgeQuickStart({ getItem: () => null })).toBe(true)
    expect(shouldAutoOpenJudgeQuickStart({ getItem: () => 'dismissed' })).toBe(false)
    expect(shouldAutoOpenJudgeQuickStart({
      getItem: (key) => key === 'relief-forge-judge-quick-start-v1' ? 'dismissed' : null,
    })).toBe(true)
    expect(shouldAutoOpenJudgeQuickStart({ getItem: () => { throw new Error('blocked') } })).toBe(true)

    const blockedProvider = {
      get localStorage(): never {
        throw new Error('SecurityError')
      },
    }
    expect(getJudgeQuickStartStorage(blockedProvider)).toBeUndefined()
    expect(shouldAutoOpenJudgeQuickStart(getJudgeQuickStartStorage(blockedProvider))).toBe(true)

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

    const legacyField = {
      value: '',
      readOnly: false,
      style: {},
      select: vi.fn(),
      setSelectionRange: vi.fn(),
      remove: vi.fn(),
    }
    const legacyDocument = {
      activeElement: null,
      body: { append: vi.fn() },
      createElement: vi.fn(() => legacyField),
      execCommand: vi.fn(() => true),
    } as unknown as Document
    await expect(copyJudgeDemoPrompt(undefined, legacyDocument)).resolves.toBe(true)
    expect(legacyDocument.execCommand).toHaveBeenCalledWith('copy')
    expect(legacyField.value).toBe(JUDGE_DEMO_PROMPT)
  })
})
