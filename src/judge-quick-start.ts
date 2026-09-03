export type AgentToolsState = 'checking' | 'ready' | 'unavailable' | 'error'

export const JUDGE_QUICK_START_STORAGE_KEY = 'relief-forge-judge-quick-start-v1'

export const JUDGE_DEMO_PROMPT = `Use Relief Forge to create a 48-inch-wide by 32-inch-tall topographic-terraces wall piece, 28 mm deep, with deterministic seed webmcp-showcase-073. Fit it to a 256 × 256 mm full printer bed with a 5 mm edge margin and 4 mm part spacing, allow 90-degree rotation, and allow colors to share plates. Inspect the plan. If a broad panel is oversized, preserve the exact dimensions, depth, and seed but switch to the topographic-mosaic preset so the artwork has 96 smaller panels with richer contour sampling. Reinspect and prepare the package only if every part fits and the digital mesh checks pass.`

interface StorageReader {
  getItem(key: string): string | null
}

interface StorageWriter {
  setItem(key: string, value: string): void
}

interface ClipboardWriter {
  writeText(value: string): Promise<void>
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
