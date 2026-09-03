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
  promptOpen?: boolean
  onPromptOpenChange?: (open: boolean) => void
}

interface QuickStartStep {
  title: string
  detail: string
}

interface PromptDestinationCopy {
  title: string
  detail: string
}

interface CopyActionCopy {
  idle: string
  copied: string
  success: string
  failure: string
  disabled?: boolean
}

const AGENT_STATUS_COPY: Record<AgentToolsState, string> = {
  checking: 'Checking whether this browser can register all four agent tools…',
  ready: 'All four agent tools are registered and ready.',
  unavailable: 'This browser is in manual editor mode—the editor still works. For the easiest agent test, open this page in ChatGPT’s built-in browser. A WebMCP-enabled Chrome tab also works.',
  error: 'Agent tools could not register. Enable Site tools permissions for this page, then reload. The manual editor still works.',
}

const INTRO_COPY: Record<AgentToolsState, string> = {
  checking: 'Relief Forge is the shared workspace, not a chat. Wait for 4 AGENT TOOLS READY before you copy and send the prompt from Codex or ChatGPT outside this page.',
  ready: 'There is no prompt box inside Relief Forge. Copy below, then paste into the Codex or ChatGPT message box that opened this page.',
  unavailable: 'There is no prompt box inside Relief Forge, and this tab cannot receive agent calls. You may copy the prompt for later, but reopen the app from a supported AI conversation before you send it.',
  error: 'There is no prompt box inside Relief Forge. Restore all four agent tools before you paste and send the prompt from Codex or ChatGPT outside this page.',
}

const PROMPT_DESTINATION_COPY: Record<AgentToolsState, PromptDestinationCopy> = {
  checking: {
    title: 'Use the Codex or ChatGPT message box outside this webpage.',
    detail: 'Keep Relief Forge open, but wait for the ready message before you paste and send the prompt.',
  },
  ready: {
    title: 'Use the Codex or ChatGPT message box outside this webpage.',
    detail: 'Return to the conversation that opened this tab, paste the copied prompt, and press Send. Keep Relief Forge open while the agent works.',
  },
  unavailable: {
    title: 'Reopen Relief Forge from a supported AI conversation first.',
    detail: 'This tab cannot receive agent tool calls. Open this URL in ChatGPT’s built-in browser or a WebMCP-enabled Chrome tab, then paste the prompt into that conversation.',
  },
  error: {
    title: 'Restore agent tools before sending the prompt.',
    detail: 'Enable Site tools for this page and reload. When all four tools are ready, paste the prompt into the Codex or ChatGPT conversation outside this webpage.',
  },
}

const COPY_ACTION_COPY: Record<AgentToolsState, CopyActionCopy> = {
  checking: {
    idle: 'Wait for agent tools',
    copied: 'Wait for agent tools',
    success: '',
    failure: '',
    disabled: true,
  },
  ready: {
    idle: 'Copy prompt for AI chat',
    copied: 'Prompt ready — go to your AI chat',
    success: 'Copy requested. Now switch to Codex or ChatGPT, paste into its message box, and press Send. Keep this Relief Forge page open. If paste is empty, return here and copy from the open prompt below.',
    failure: 'Copy was blocked. Use the open prompt below to copy it manually, then paste it into the Codex or ChatGPT message box.',
  },
  unavailable: {
    idle: 'Copy prompt for supported AI chat',
    copied: 'Prompt ready — reopen in an AI browser',
    success: 'Prompt ready. Reopen Relief Forge from ChatGPT’s built-in browser or a WebMCP-enabled Chrome tab before you paste and send. If paste is empty, use the open prompt below.',
    failure: 'Copy was blocked. Use the open prompt below to copy it manually, but reopen Relief Forge in a supported AI browser before sending it.',
  },
  error: {
    idle: 'Copy prompt for after recovery',
    copied: 'Prompt ready — restore agent tools first',
    success: 'Prompt ready. Restore all four agent tools and reload before you paste and send. If paste is empty, use the open prompt below.',
    failure: 'Copy was blocked. Use the open prompt below to copy it manually, but restore all four agent tools before sending it.',
  },
}

const READY_STEPS: readonly QuickStartStep[] = [
  { title: 'Copy the ready-made prompt', detail: 'Use the button above. The exact prompt is also available below for manual copying.' },
  { title: 'Return to your AI conversation', detail: 'Switch back to the Codex or ChatGPT chat that opened this page. Do not look for a prompt box inside Relief Forge.' },
  { title: 'Paste and press Send', detail: 'Keep this page open. The agent will call four tools and update this same visible project.' },
  { title: 'Review and save', detail: 'Check the design and packing results here, then click Save file now after preparation finishes.' },
]

const MANUAL_STEPS: readonly QuickStartStep[] = [
  { title: 'Reopen in a supported browser', detail: 'Open this same URL in ChatGPT’s built-in browser—the easiest path—or a WebMCP-enabled Chrome tab.' },
  { title: 'Confirm all four tools', detail: 'Open Run agent demo there and look for 4 AGENT TOOLS READY before sending the prompt.' },
  { title: 'Run the same demo', detail: 'Copy the prompt, return to the supported Codex or ChatGPT conversation, paste it into the message box, and press Send.' },
]

const ERROR_STEPS: readonly QuickStartStep[] = [
  { title: 'Enable Site tools', detail: 'Allow Site tools for this page in your browser permissions, then reload the app.' },
  { title: 'Confirm registration', detail: 'Open Run agent demo and look for 4 AGENT TOOLS READY before sending the prompt.' },
  { title: 'Send from your AI chat', detail: 'After recovery, paste the copied prompt into the Codex or ChatGPT message box outside this webpage—or continue safely with the manual editor.' },
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
  promptOpen = copyState !== 'idle',
  onPromptOpenChange,
}: JudgeQuickStartCardProps) {
  const promptDestination = PROMPT_DESTINATION_COPY[agentToolsState]
  const copyAction = COPY_ACTION_COPY[agentToolsState]
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
          <h2 id="judge-quick-start-title">Run the demo from your AI chat</h2>
        </div>
        <button
          data-help=""
          type="button"
          aria-label="Close judge quick start"
          onClick={onDismiss}
        >×</button>
      </div>

      <p className="judge-quick-start__intro">
        {INTRO_COPY[agentToolsState]}
      </p>

      <div className="judge-quick-start__actions">
        <button
          data-help=""
          className="button judge-quick-start__copy"
          type="button"
          onClick={onCopy}
          disabled={copyAction.disabled}
        >{copyState === 'copied' ? copyAction.copied : copyAction.idle}</button>
        <button
          data-help=""
          className="button button--ghost"
          type="button"
          onClick={onDismiss}
        >Dismiss</button>
      </div>

      <p className="judge-quick-start__copy-status" aria-live="polite">
        {copyState === 'copied'
          ? copyAction.success
          : copyState === 'failed'
            ? copyAction.failure
            : ''}
      </p>

      <aside
        className="judge-quick-start__handoff"
        data-state={agentToolsState}
        aria-labelledby="judge-prompt-destination"
      >
        <span id="judge-prompt-destination">WHERE TO SEND THE PROMPT</span>
        <strong>{promptDestination.title}</strong>
        <small>{promptDestination.detail}</small>
      </aside>

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

      <details
        className="judge-quick-start__prompt"
        open={promptOpen}
        onToggle={(event) => onPromptOpenChange?.(event.currentTarget.open)}
      >
        <summary data-help="">Read or manually copy prompt</summary>
        <textarea
          aria-label="Agent demo prompt for manual copying"
          readOnly
          rows={6}
          value={JUDGE_DEMO_PROMPT}
          onFocus={(event) => event.currentTarget.select()}
          onClick={(event) => event.currentTarget.select()}
        />
      </details>
    </section>
  )
}

export function JudgeQuickStart({ agentToolsState }: { agentToolsState: AgentToolsState }) {
  const [open, setOpen] = useState(false)
  const [copyState, setCopyState] = useState<QuickStartCopyState>('idle')
  const [promptOpen, setPromptOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    setOpen(shouldAutoOpenJudgeQuickStart(getJudgeQuickStartStorage(window)))
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (document.querySelector('[aria-modal="true"]')) return
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
    setPromptOpen(true)
    const copied = await copyJudgeDemoPrompt(window.navigator.clipboard, window.document)
    setCopyState(copied ? 'copied' : 'failed')
  }

  return (
    <div className="judge-quick-start">
      <span
        className="visually-hidden"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >Agent tool status: {TRIGGER_STATUS_COPY[agentToolsState]}.</span>
      <span className="local-badge" data-agent-tools={agentToolsState}>
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
        aria-label="Run agent demo"
        onClick={() => {
          setCopyState('idle')
          setPromptOpen(false)
          setOpen((current) => {
            if (current) rememberJudgeQuickStartDismissed(getJudgeQuickStartStorage(window))
            return !current
          })
        }}
      >
        <span className="judge-quick-start__trigger-icon" aria-hidden="true">?</span>
        <span className="judge-quick-start__trigger-label">Run agent demo</span>
        <span className="judge-quick-start__trigger-short" aria-hidden="true">Demo</span>
      </button>
      {open && (
        <JudgeQuickStartCard
          agentToolsState={agentToolsState}
          copyState={copyState}
          onCopy={() => { void copyPrompt() }}
          onDismiss={dismiss}
          promptOpen={promptOpen}
          onPromptOpenChange={setPromptOpen}
        />
      )}
    </div>
  )
}
