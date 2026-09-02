import { describe, expect, it } from 'vitest'
import {
  INITIAL_CONTROL_HELP_INTERACTION_STATE,
  beginControlHelpTouch,
  canShowControlHelp,
  continueControlHelpWithPointer,
  resetControlHelpInteraction,
} from './control-help-interaction'

describe('control help touch interaction', () => {
  it('lets the first touch open help and makes the next touch dismiss it', () => {
    let state = INITIAL_CONTROL_HELP_INTERACTION_STATE

    const firstTouch = beginControlHelpTouch(false)
    state = firstTouch.state

    expect(firstTouch.dismiss).toBe(false)
    expect(canShowControlHelp(state)).toBe(true)

    const dismissingTouch = beginControlHelpTouch(true)
    state = dismissingTouch.state

    expect(dismissingTouch.dismiss).toBe(true)
    expect(canShowControlHelp(state)).toBe(false)
  })

  it('blocks compatibility hover and focus until the next independent touch', () => {
    let state = beginControlHelpTouch(true).state

    expect(canShowControlHelp(state)).toBe(false)
    expect(canShowControlHelp(state)).toBe(false)

    state = beginControlHelpTouch(false).state

    expect(canShowControlHelp(state)).toBe(true)
  })

  it('restores hover help when a real mouse follows a touch dismissal', () => {
    const suppressedState = beginControlHelpTouch(true).state

    expect(canShowControlHelp(suppressedState)).toBe(false)
    expect(canShowControlHelp(continueControlHelpWithPointer(suppressedState, 'touch'))).toBe(false)
    expect(canShowControlHelp(continueControlHelpWithPointer(suppressedState, 'mouse'))).toBe(true)
  })

  it('restores keyboard help after a touch dismissal', () => {
    const suppressedState = beginControlHelpTouch(true).state

    expect(canShowControlHelp(suppressedState)).toBe(false)
    expect(canShowControlHelp(resetControlHelpInteraction())).toBe(true)
  })
})
