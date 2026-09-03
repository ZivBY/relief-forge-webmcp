export type AgentToolsState = 'checking' | 'ready' | 'unavailable' | 'error'

export const JUDGE_QUICK_START_STORAGE_KEY = 'relief-forge-judge-quick-start-v1'

export const JUDGE_DEMO_PROMPT = `Create a 48-inch Polar Bloom statement piece, 30 millimetres deep, using the fixed seed webmcp-polar-bloom-showcase-001 and the warm architectural palette. Fit it to a 256 by 256 millimetre printer bed with 5 millimetre margins and 4 millimetre spacing. Allow rotation and let colors share plates. Inspect the exact plan, then prepare the fabrication package only if every digital check passes.`

interface StorageReader {
  getItem(key: string): string | null
}

interface StorageWriter {
  setItem(key: string, value: string): void
}

interface StorageProvider {
  readonly localStorage: StorageReader & StorageWriter
}

interface ClipboardWriter {
  writeText(value: string): Promise<void>
}

export function getJudgeQuickStartStorage(provider: StorageProvider | undefined): (StorageReader & StorageWriter) | undefined {
  if (!provider) return undefined
  try {
    return provider.localStorage
  } catch {
    return undefined
  }
}

export function shouldAutoOpenJudgeQuickStart(storage: StorageReader | undefined): boolean {
  if (!storage) return true
  try {
    return storage.getItem(JUDGE_QUICK_START_STORAGE_KEY) !== 'dismissed'
  } catch {
    return true
  }
}

export function rememberJudgeQuickStartDismissed(storage: StorageWriter | undefined): void {
  if (!storage) return
  try {
    storage.setItem(JUDGE_QUICK_START_STORAGE_KEY, 'dismissed')
  } catch {
    // Storage can be blocked; the tutorial remains dismissible for this session.
  }
}

export async function copyJudgeDemoPrompt(clipboard: ClipboardWriter | undefined): Promise<boolean> {
  if (!clipboard) return false
  try {
    await clipboard.writeText(JUDGE_DEMO_PROMPT)
    return true
  } catch {
    return false
  }
}
