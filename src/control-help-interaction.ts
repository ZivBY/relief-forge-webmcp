export interface ControlHelpInteractionState {
  suppressSyntheticShow: boolean
}

export interface ControlHelpInteractionTransition {
  state: ControlHelpInteractionState
  dismiss: boolean
}

export const INITIAL_CONTROL_HELP_INTERACTION_STATE: ControlHelpInteractionState = {
  suppressSyntheticShow: false,
}

export function beginControlHelpTouch(
  helpVisible: boolean,
): ControlHelpInteractionTransition {
  return {
    state: { suppressSyntheticShow: helpVisible },
    dismiss: helpVisible,
  }
}

export function resetControlHelpInteraction(): ControlHelpInteractionState {
  return { suppressSyntheticShow: false }
}

export function continueControlHelpWithPointer(
  state: ControlHelpInteractionState,
  pointerType: string,
): ControlHelpInteractionState {
  return pointerType === 'mouse' ? resetControlHelpInteraction() : state
}

export function canShowControlHelp(state: ControlHelpInteractionState): boolean {
  return !state.suppressSyntheticShow
}
