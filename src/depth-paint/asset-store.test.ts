import { describe, expect, it } from "vitest";

import {
  DEPTH_PAINT_DATABASE_NAME,
  DEPTH_PAINT_STORE_NAME,
  clearDepthPaintFieldAssets,
  deleteDepthPaintFieldAsset,
  loadDepthPaintFieldAsset,
  saveDepthPaintFieldAsset,
} from "./asset-store";
import { createDepthPaintField } from "./field";

describe("depth-paint IndexedDB boundary", () => {
  it("uses a dedicated explicitly versioned database and object store", () => {
    expect(DEPTH_PAINT_DATABASE_NAME).toBe("relief-forge-depth-paint-assets-v1");
    expect(DEPTH_PAINT_STORE_NAME).toBe("depth-paint-fields");
  });

  it("fails recoverably when browser storage is unavailable", async () => {
    const asset = createDepthPaintField(512);
    await expect(saveDepthPaintFieldAsset(asset)).rejects.toThrow(/unavailable/);
    await expect(loadDepthPaintFieldAsset(asset.sha256)).rejects.toThrow(/unavailable/);
    await expect(deleteDepthPaintFieldAsset(asset.sha256)).rejects.toThrow(/unavailable/);
    await expect(clearDepthPaintFieldAssets()).rejects.toThrow(/unavailable/);
    await expect(loadDepthPaintFieldAsset("not-a-hash")).rejects.toThrow(/SHA-256/);
  });
});
