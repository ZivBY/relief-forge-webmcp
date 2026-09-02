import { useEffect, useRef } from 'react'
import { START_OVER_DESCRIPTION } from '../start-over'

interface StartOverDialogProps {
  busy: boolean
  error?: string
  onCancel: () => void
  onConfirm: () => void
  open: boolean
}

const FOCUSABLE_SELECTOR = 'button:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function StartOverDialog({
  busy,
  error,
  onCancel,
  onConfirm,
  open,
}: StartOverDialogProps) {
  const dialogRef = useRef<HTMLElement | null>(null)
  const cancelRef = useRef<HTMLButtonElement | null>(null)
  const onCancelRef = useRef(onCancel)
  const busyRef = useRef(busy)
  onCancelRef.current = onCancel
  busyRef.current = busy

  useEffect(() => {
    if (!open) return undefined
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (!busyRef.current) onCancelRef.current()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((element) => !element.hidden)
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!first || !last) {
        event.preventDefault()
        dialogRef.current.focus()
      } else if (event.shiftKey && (
        document.activeElement === first ||
        !dialogRef.current.contains(document.activeElement)
      )) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    const focusFrame = window.requestAnimationFrame(() => cancelRef.current?.focus())
    return () => {
      window.cancelAnimationFrame(focusFrame)
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className="feedback-overlay start-over-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busyRef.current) onCancelRef.current()
      }}
    >
      <section
        ref={dialogRef}
        className="start-over-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="start-over-title"
        aria-describedby="start-over-description"
        aria-busy={busy}
        tabIndex={-1}
      >
        <span className="eyebrow">RESET PROJECT</span>
        <h2 id="start-over-title">Start over?</h2>
        <p id="start-over-description">{START_OVER_DESCRIPTION}</p>
        {error && <p className="start-over-dialog__error" role="alert">{error}</p>}
        <footer>
          <button
            ref={cancelRef}
            data-help=""
            className="button button--ghost"
            type="button"
            onClick={onCancel}
            disabled={busy}
          >Keep editing</button>
          <button
            data-help=""
            className="button start-over-dialog__confirm"
            type="button"
            onClick={onConfirm}
            disabled={busy}
            aria-busy={busy}
          >{busy ? 'Starting over…' : 'Start over'}</button>
        </footer>
      </section>
    </div>
  )
}
