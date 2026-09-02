import type { DepthPaintFieldAsset } from "./field";
import { createDepthPaintSession, type DepthPaintSession } from "./history";

export type DepthPaintPersistenceResult =
  | { readonly status: "committed" }
  | {
      readonly status: "recovered";
      readonly session: DepthPaintSession | undefined;
      readonly error: unknown;
    };

/**
 * Persist an optimistic editor session and recover from the latest retained
 * asset if storage rejects. The getter is evaluated after the rejection so a
 * concurrent parent commit cannot make recovery fall back to stale bytes.
 */
export async function persistDepthPaintSession(
  next: DepthPaintSession,
  persist: (asset: DepthPaintFieldAsset) => void | Promise<void>,
  getRetainedAsset: () => DepthPaintFieldAsset | undefined,
): Promise<DepthPaintPersistenceResult> {
  try {
    await persist(next.present);
    return { status: "committed" };
  } catch (error) {
    const retainedAsset = getRetainedAsset();
    return {
      status: "recovered",
      session: retainedAsset
        ? createDepthPaintSession(retainedAsset)
        : undefined,
      error,
    };
  }
}
