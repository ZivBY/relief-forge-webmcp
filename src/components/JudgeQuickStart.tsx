import { useEffect, useRef, useState } from 'react'
import { APP_BUILD_LABEL } from '../build-info'
import {
  JUDGE_DEMO_PROMPT,
  copyJudgeDemoPrompt,
  getJudgeQuickStartStorage,
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

interface QuickStartStep {
  title: string
  detail: string
}

const AGENT_STATUS_COPY: Record<AgentToolsState, string> = {
  checking: 'Checking whether this browser can register all four agent tools…',
  ready: 'All four agent tools are registered and ready.',
  unavailable: 'This browser is in manual editor mode—the editor still works. For the easiest agent test, open this page in ChatGPT’s built-in browser. A WebMCP-enabled Chrome tab also works.',
  error: 'Agent tools could not register. Enable Site tools permissions for this page, then reload. The manual editor still works.',
}

const READY_STEPS: readonly QuickStartStep[] = [
  { title: 'Ask your agent', detail: 'Copy the demo prompt, keep this page open, and paste it into the agent.' },
  { title: 'Watch the shared project', detail: 'Design, printer packing, and inspection results update here after each tool call.' },
  { title: 'Review and save', detail: 'Confirm the inspected plan, then click Save file now after preparation finishes.' },
]

const MANUAL_STEPS: readonly QuickStartStep[] = [
  { title: 'Reopen in a supported browser', detail: 'Open this same URL in ChatGPT’s built-in browser—the easiest path—or a WebMCP-enabled Chrome tab.' },
  { title: 'Confirm all four tools', detail: 'Open How it works there and look for 4 AGENT TOOLS READY before sending the prompt.' },
  { title: 'Run the same demo', detail: 'Copy the demo prompt, keep that supported page open, and paste it into the agent.' },
]

const ERROR_STEPS: readonly QuickStartStep[] = [
  { title: 'Enable Site tools', detail: 'Allow Site tools for this page in your browser permissions, then reload the app.' },
  { title: 'Confirm registration', detail: 'Open How it works and look for 4 AGENT TOOLS READY before sending the prompt.' },
  { title: 'Run—or keep editing', detail: 'Run the copied prompt after recovery, or continue safely with the manual editor controls.' },
]

const TRIGGER_STATUS_COPY: Record<AgentToolsState, string> = {
  checking: 'checking agent tools',
  ready: 'four agent tools ready',
  unavailable: 'manual editor, agent tools off',
  error: 'agent tool registration error',
}

export function JudgeQuickStartCard({
  agentToolsState,
  copyState,
  onCopy,
  onDismiss,
}: JudgeQuickStartCardProps) {
  const steps = agentToolsState === 'unavailable'
    ? MANUAL_STEPS
    : agentToolsState === 'error'
      ? ERROR_STEPS
      : READY_STEPS

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
        {steps.map((step, index) => (
          <li key={step.title}>
            <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
            <div><strong>{step.title}</strong><small>{step.detail}</small></div>
          </li>
        ))}
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
    setOpen(shouldAutoOpenJudgeQuickStart(getJudgeQuickStartStorage(window)))
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      rememberJudgeQuickStartDismissed(getJudgeQuickStartStorage(window))
      triggerRef.current?.focus()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open])

  const dismiss = () => {
    setOpen(false)
    rememberJudgeQuickStartDismissed(getJudgeQuickStartStorage(window))
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
              ? 'MANUAL EDITOR · AGENT TOOLS OFF'
              : agentToolsState === 'error'
                ? 'AGENT TOOLS NEED ATTENTION'
                : 'CONNECTING AGENT TOOLS'
        }<span className="judge-quick-start__build-label"> · {APP_BUILD_LABEL}</span>
      </span>
      <button
        ref={triggerRef}
        data-help=""
        data-agent-tools={agentToolsState}
        className="button button--ghost judge-quick-start__trigger"
        type="button"
        aria-controls="judge-quick-start-card"
        aria-expanded={open}
        aria-label={`${open ? 'Close' : 'Open'} judge quick start — ${TRIGGER_STATUS_COPY[agentToolsState]}`}
        onClick={() => {
          setCopyState('idle')
          setOpen((current) => {
            if (current) rememberJudgeQuickStartDismissed(getJudgeQuickStartStorage(window))
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
