import { useEffect, useRef, useState } from 'react'
import { APP_BUILD_LABEL } from '../build-info'
import {
  JUDGE_DEMO_PROMPT,
  copyJudgeDemoPrompt,
  rememberJudgeQuickStartDismissed,
  shouldAutoOpenJudgeQuickStart,
  type AgentToolsState,
} from '../judge-quick-start'

type QuickStartCopyState = 'idle' | 'copied' | 'failed'

interface JudgeQuickStartCardProps {
  agentToolsState: AgentToolsState
  copyState: QuickStartCopyState
  onCopy: () => void
  onDismiss: () => void
}

const AGENT_STATUS_COPY: Record<AgentToolsState, string> = {
  checking: 'Checking for the four agent tools…',
  ready: 'Connected — all four agent tools are ready.',
  unavailable: 'Manual mode. Open this page in ChatGPT’s in-app browser or WebMCP-enabled Chrome.',
  error: 'The agent tools need attention. Reload the page before running the demo.',
}

export function JudgeQuickStartCard({
  agentToolsState,
  copyState,
  onCopy,
  onDismiss,
}: JudgeQuickStartCardProps) {
  return (
    <section
      id="judge-quick-start-card"
      className="judge-quick-start__card"
      role="region"
      aria-labelledby="judge-quick-start-title"
    >
      <div className="judge-quick-start__header">
        <div>
          <span className="eyebrow">JUDGE QUICK START</span>
          <h2 id="judge-quick-start-title">Try the agent workflow</h2>
        </div>
        <button
          data-help=""
          type="button"
          aria-label="Close judge quick start"
          onClick={onDismiss}
        >×</button>
      </div>

      <p className="judge-quick-start__intro">
        One prompt lets your agent create, fit, inspect, and prepare the same project you can edit here.
      </p>

      <p
        className="judge-quick-start__agent-status"
        data-state={agentToolsState}
      >
        <i aria-hidden="true" />
        {AGENT_STATUS_COPY[agentToolsState]}
      </p>

      <ol className="judge-quick-start__steps">
        <li><span aria-hidden="true">01</span><div><strong>Ask your agent</strong><small>Copy the demo prompt, keep this page open, and paste it into the agent.</small></div></li>
        <li><span aria-hidden="true">02</span><div><strong>Watch the shared project</strong><small>Design, printer packing, and inspection results update here after each tool call.</small></div></li>
        <li><span aria-hidden="true">03</span><div><strong>Review and save</strong><small>Confirm the inspected plan, then click Save file now after preparation finishes.</small></div></li>
      </ol>

      <div className="judge-quick-start__actions">
        <button
          data-help=""
          className="button judge-quick-start__copy"
          type="button"
          onClick={onCopy}
        >{copyState === 'copied' ? 'Prompt copied' : 'Copy demo prompt'}</button>
        <button
          data-help=""
          className="button button--ghost"
          type="button"
          onClick={onDismiss}
        >Dismiss</button>
      </div>

      <p className="judge-quick-start__copy-status" aria-live="polite">
        {copyState === 'copied'
          ? 'Paste the prompt into your agent while this Relief Forge page stays open.'
          : copyState === 'failed'
            ? 'Copy was blocked. Open “Read demo prompt” below and copy it manually.'
            : ''}
      </p>

      <details className="judge-quick-start__prompt">
        <summary data-help="">Read demo prompt</summary>
        <p>{JUDGE_DEMO_PROMPT}</p>
      </details>
    </section>
  )
}

export function JudgeQuickStart({ agentToolsState }: { agentToolsState: AgentToolsState }) {
  const [open, setOpen] = useState(false)
  const [copyState, setCopyState] = useState<QuickStartCopyState>('idle')
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    setOpen(shouldAutoOpenJudgeQuickStart(window.localStorage))
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      rememberJudgeQuickStartDismissed(window.localStorage)
      triggerRef.current?.focus()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open])

  const dismiss = () => {
    setOpen(false)
    rememberJudgeQuickStartDismissed(window.localStorage)
    triggerRef.current?.focus()
  }

  const copyPrompt = async () => {
    const copied = await copyJudgeDemoPrompt(window.navigator.clipboard)
    setCopyState(copied ? 'copied' : 'failed')
  }

  return (
    <div className="judge-quick-start">
      <span className="local-badge" data-agent-tools={agentToolsState} aria-live="polite">
        <i />{
          agentToolsState === 'ready'
            ? '4 AGENT TOOLS READY'
            : agentToolsState === 'unavailable'
              ? 'WEBMCP UNAVAILABLE'
              : agentToolsState === 'error'
                ? 'AGENT TOOLS NEED ATTENTION'
                : 'CONNECTING AGENT TOOLS'
        }<span className="judge-quick-start__build-label"> · {APP_BUILD_LABEL}</span>
      </span>
      <button
        ref={triggerRef}
        data-help=""
        className="button button--ghost judge-quick-start__trigger"
        type="button"
        aria-controls="judge-quick-start-card"
        aria-expanded={open}
        aria-label={open ? 'Close judge quick start' : 'Open judge quick start'}
        onClick={() => {
          setCopyState('idle')
          setOpen((current) => {
            if (current) rememberJudgeQuickStartDismissed(window.localStorage)
            return !current
          })
        }}
      >
        <span className="judge-quick-start__trigger-icon" aria-hidden="true">?</span>
        <span className="judge-quick-start__trigger-label">How it works</span>
      </button>
      {open && (
        <JudgeQuickStartCard
          agentToolsState={agentToolsState}
          copyState={copyState}
          onCopy={() => { void copyPrompt() }}
          onDismiss={dismiss}
        />
      )}
    </div>
  )
}
