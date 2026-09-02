import type { PhotoFieldAsset } from "../core/types";

/** Serializes photo-source mutations even if UI events arrive in the same frame. */
export class PhotoMutationGate {
  private active = false;

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active) {
      throw new Error("Another photo source change is still finishing. Wait a moment and try again.");
    }
    this.active = true;
    try {
      return await operation();
    } finally {
      this.active = false;
    }
  }
}

export interface PhotoRemovalOutcome {
  proceduralActive: boolean;
  removedFromDevice: boolean;
  status: string;
}

interface RemovePhotoAssetWithRecipeSafetyOptions {
  sha256: string;
  persistProceduralRecipe(): void;
  activateProceduralRecipe(): void;
  remove(sha256: string): Promise<void>;
}

/** Persist the non-photo recipe before deleting bytes that it no longer needs. */
export async function removePhotoAssetWithRecipeSafety({
  sha256,
  persistProceduralRecipe,
  activateProceduralRecipe,
  remove,
}: RemovePhotoAssetWithRecipeSafetyOptions): Promise<PhotoRemovalOutcome> {
  try {
    persistProceduralRecipe();
  } catch {
    return {
      proceduralActive: false,
      removedFromDevice: false,
      status: "Browser storage is unavailable, so Relief Forge did not delete the photo and risk restoring a broken recipe. Clear this Site's stored data to remove it manually.",
    };
  }

  activateProceduralRecipe();
  try {
    await remove(sha256);
    return {
      proceduralActive: true,
      removedFromDevice: true,
      status: "The canonical photo field was removed from this device. Procedural composition is active.",
    };
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : "";
    return {
      proceduralActive: true,
      removedFromDevice: false,
      status: `Procedural composition is active, but the canonical photo field could not be deleted and remains in this Site's local storage.${detail} Clear this Site's stored data to remove it manually.`,
    };
  }
}

interface PersistPhotoAssetForApplyOptions {
  asset: PhotoFieldAsset;
  previousSha256?: string;
  startingConfigRevision: number;
  currentConfigRevision(): number;
  save(asset: PhotoFieldAsset): Promise<void>;
  remove(sha256: string): Promise<void>;
}

/**
 * Commit the canonical bytes before their recipe, but remove a newly written
 * unreferenced asset if another design edit makes the pending recipe stale.
 */
export async function persistPhotoAssetForApply({
  asset,
  previousSha256,
  startingConfigRevision,
  currentConfigRevision,
  save,
  remove,
}: PersistPhotoAssetForApplyOptions): Promise<void> {
  await save(asset);
  if (currentConfigRevision() === startingConfigRevision) return;

  let cleanupDetail = "";
  if (previousSha256 !== asset.sha256) {
    try {
      await remove(asset.sha256);
    } catch {
      cleanupDetail = " The unused canonical field could not be removed; clear this Site's local storage to delete it.";
    }
  }
  throw new Error(
    `The design changed while the photo was being saved, so it was not applied.${cleanupDetail} ` +
    "Analyze and apply it again without changing other controls during Save.",
  );
}
