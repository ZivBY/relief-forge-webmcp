import { describe, expect, it, vi } from "vitest";

import type { PhotoFieldAsset } from "../core/types";
import {
  PhotoMutationGate,
  persistPhotoAssetForApply,
  removePhotoAssetWithRecipeSafety,
} from "./asset-lifecycle";

const asset: PhotoFieldAsset = {
  version: 1,
  width: 1,
  height: 1,
  colorSpace: "srgb",
  rgba8: new Uint8Array([1, 2, 3, 255]),
  sha256: "a".repeat(64),
};

describe("photo asset mutation lifecycle", () => {
  it("removes a newly saved asset when the design changes before Apply commits", async () => {
    let releaseSave!: () => void;
    const save = vi.fn(() => new Promise<void>((resolve) => { releaseSave = resolve; }));
    const remove = vi.fn(async () => undefined);
    let revision = 7;
    const pending = persistPhotoAssetForApply({
      asset,
      previousSha256: "b".repeat(64),
      startingConfigRevision: revision,
      currentConfigRevision: () => revision,
      save,
      remove,
    });

    revision += 1;
    releaseSave();
    await expect(pending).rejects.toThrow(/was not applied/i);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(asset.sha256);
  });

  it("does not delete an already active asset when a same-photo Apply becomes stale", async () => {
    const remove = vi.fn(async () => undefined);
    await expect(persistPhotoAssetForApply({
      asset,
      previousSha256: asset.sha256,
      startingConfigRevision: 2,
      currentConfigRevision: () => 3,
      save: async () => undefined,
      remove,
    })).rejects.toThrow(/was not applied/i);
    expect(remove).not.toHaveBeenCalled();
  });

  it("serializes Apply and Remove mutations and releases the gate after failure", async () => {
    const gate = new PhotoMutationGate();
    let release!: () => void;
    const first = gate.run(() => new Promise<void>((resolve) => { release = resolve; }));

    await expect(gate.run(async () => undefined)).rejects.toThrow(/still finishing/i);
    release();
    await first;
    await expect(gate.run(async () => { throw new Error("expected"); })).rejects.toThrow("expected");
    await expect(gate.run(async () => "ready")).resolves.toBe("ready");
  });

  it("does not claim deletion when the procedural recipe cannot be persisted", async () => {
    const activate = vi.fn();
    const remove = vi.fn(async () => undefined);
    const outcome = await removePhotoAssetWithRecipeSafety({
      sha256: asset.sha256,
      persistProceduralRecipe: () => { throw new Error("quota"); },
      activateProceduralRecipe: activate,
      remove,
    });

    expect(outcome).toMatchObject({ proceduralActive: false, removedFromDevice: false });
    expect(outcome.status).toMatch(/did not delete/i);
    expect(activate).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("reports retained bytes when IndexedDB deletion fails after switching procedural", async () => {
    const activate = vi.fn();
    const outcome = await removePhotoAssetWithRecipeSafety({
      sha256: asset.sha256,
      persistProceduralRecipe: vi.fn(),
      activateProceduralRecipe: activate,
      remove: async () => { throw new Error("transaction aborted"); },
    });

    expect(outcome).toMatchObject({ proceduralActive: true, removedFromDevice: false });
    expect(outcome.status).toMatch(/could not be deleted.*remains/i);
    expect(activate).toHaveBeenCalledOnce();
  });

  it("reports success only after the canonical asset deletion commits", async () => {
    const remove = vi.fn(async () => undefined);
    const outcome = await removePhotoAssetWithRecipeSafety({
      sha256: asset.sha256,
      persistProceduralRecipe: vi.fn(),
      activateProceduralRecipe: vi.fn(),
      remove,
    });

    expect(outcome).toMatchObject({ proceduralActive: true, removedFromDevice: true });
    expect(outcome.status).toMatch(/removed from this device/i);
    expect(remove).toHaveBeenCalledWith(asset.sha256);
  });
});
