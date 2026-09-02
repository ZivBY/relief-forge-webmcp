'use client'

import { useEffect, useRef, useState, type Ref } from 'react'
import {
  MOBILE_PREVIEW_STATES,
  MOBILE_WORKFLOW_SECTIONS,
  getMobileWorkflowLocation,
  getMobileWorkflowProgress,
  type MobilePreviewState,
  type MobileWorkflowLocation,
} from '../mobile-workflow'

export const MOBILE_EDITOR_MEDIA_QUERY =
  '(max-width: 720px), (max-width: 1020px) and (max-height: 600px) and (pointer: coarse)'

export interface MobileWorkflowNavigatorProps {
  readonly location: MobileWorkflowLocation
  readonly onNavigate: (location: MobileWorkflowLocation) => void
  readonly idPrefix?: string
  readonly headingRef?: Ref<HTMLParagraphElement>
}

export interface MobileWorkflowFooterProps {
  readonly location: MobileWorkflowLocation
  readonly onNavigate: (location: MobileWorkflowLocation) => void
  readonly onFinish?: () => void
  readonly finishLabel?: string
}

export interface MobilePreviewSizeControlProps {
  readonly state: MobilePreviewState
  readonly onStateChange: (state: MobilePreviewState) => void
}

const PREVIEW_STATE_LABELS: Record<MobilePreviewState, string> = {
  collapsed: 'Collapse',
  compact: 'Compact',
  expanded: 'Expand',
}

export function useMobileEditorViewport(): boolean {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_EDITOR_MEDIA_QUERY)
    const updateMatch = () => setMatches(mediaQuery.matches)

    updateMatch()
    mediaQuery.addEventListener('change', updateMatch)
    return () => mediaQuery.removeEventListener('change', updateMatch)
  }, [])

  return matches
}

export function MobileWorkflowNavigator({
  location,
  onNavigate,
  idPrefix = 'mobile-workflow',
  headingRef,
}: MobileWorkflowNavigatorProps) {
  const progress = getMobileWorkflowProgress(location)
  const progressLabelId = `${idPrefix}-progress-label`
  const indexRef = useRef<HTMLDetailsElement | null>(null)

  return (
    <nav className="mobile-workflow-navigator" aria-label="Editor sections">
      <div className="mobile-workflow-navigator__progress" aria-live="polite" aria-atomic="true">
        <p id={progressLabelId}>
          <strong>{progress.section.label}</strong>
          <span>Section {progress.sectionIndex} of {progress.sectionTotal}</span>
        </p>
        <p ref={headingRef} role="heading" aria-level={2} tabIndex={-1}>
          <strong>{progress.subsection.label}</strong>
          <span>{progress.subsectionIndex} of {progress.subsectionTotal}</span>
        </p>
        <progress
          aria-labelledby={progressLabelId}
          max={progress.overallTotal}
          value={progress.overallIndex}
        />
      </div>

      <details ref={indexRef} className="mobile-workflow-navigator__index">
        <summary>Jump to a section</summary>
        <ol>
          {MOBILE_WORKFLOW_SECTIONS.map((section) => (
            <li key={section.id}>
              <strong>{section.label}</strong>
              <ol>
                {section.subsections.map((subsection) => {
                  const isCurrent = subsection.id === location.subsectionId
                  const target = getMobileWorkflowLocation(subsection.id)

                  return (
                    <li key={subsection.id}>
                      <button
                        type="button"
                        className={isCurrent ? 'is-active' : undefined}
                        aria-current={isCurrent ? 'step' : undefined}
                        aria-label={`${section.label}: ${subsection.label}`}
                        onClick={() => {
                          indexRef.current?.removeAttribute('open')
                          onNavigate(target)
                        }}
                      >
                        {subsection.label}
                      </button>
                    </li>
                  )
                })}
              </ol>
            </li>
          ))}
        </ol>
      </details>
    </nav>
  )
}

export function MobileWorkflowFooter({
  location,
  onNavigate,
  onFinish,
  finishLabel = 'Finish',
}: MobileWorkflowFooterProps) {
  const progress = getMobileWorkflowProgress(location)
  const nextProgress = progress.next
    ? getMobileWorkflowProgress(progress.next)
    : undefined
  const continueTarget = nextProgress
    ? nextProgress.section.id === progress.section.id
      ? nextProgress.subsection.label
      : nextProgress.section.label
    : undefined

  return (
    <footer className="mobile-workflow-footer" aria-label="Section navigation">
      <button
        type="button"
        className="mobile-workflow-footer__back"
        disabled={!progress.previous}
        onClick={() => {
          if (progress.previous) onNavigate(progress.previous)
        }}
      >
        <span aria-hidden="true">←</span> Back
      </button>

      <span className="mobile-workflow-footer__position">
        {progress.subsectionIndex} / {progress.subsectionTotal}
      </span>

      {progress.next ? (
        <button
          type="button"
          className="mobile-workflow-footer__continue"
          onClick={() => onNavigate(progress.next!)}
        >
          Continue to {continueTarget} <span aria-hidden="true">→</span>
        </button>
      ) : onFinish ? (
        <button
          type="button"
          className="mobile-workflow-footer__continue"
          onClick={onFinish}
        >
          {finishLabel}
        </button>
      ) : (
        <span className="mobile-workflow-footer__complete">Final section</span>
      )}
    </footer>
  )
}

export function MobilePreviewSizeControl({
  state,
  onStateChange,
}: MobilePreviewSizeControlProps) {
  return (
    <div className="mobile-preview-size-control" role="group" aria-label="Preview size">
      {MOBILE_PREVIEW_STATES.map((candidate) => (
        <button
          key={candidate}
          type="button"
          className={candidate === state ? 'is-active' : undefined}
          aria-label={`${PREVIEW_STATE_LABELS[candidate]} preview`}
          aria-pressed={candidate === state}
          onClick={() => onStateChange(candidate)}
        >
          {PREVIEW_STATE_LABELS[candidate]}
        </button>
      ))}
    </div>
  )
}
