import { describe, expect, it } from "vitest";

import { canonicalPhotoSha256 } from "../core/photo-color";
import type { PhotoFieldAsset } from "../core/types";
import { analyzePhotoAsset, recommendPhotoGeometry } from "./analysis";

function asset(width: number, height: number, pixel: (x: number, y: number) => [number, number, number]): PhotoFieldAsset {
  const rgba8 = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      rgba8.set([...pixel(x, y), 255], (y * width + x) * 4);
    }
  }
  return { version: 1, width, height, colorSpace: "srgb", rgba8, sha256: canonicalPhotoSha256(width, height, rgba8) };
}

describe("photo analysis and form recommendation", () => {
  it("uses fidelity-first block geometry for a uniform image", () => {
    const source = asset(16, 12, () => [120, 130, 140]);
    const analysis = analyzePhotoAsset(source, 5);
    expect(analysis.palette).toHaveLength(1);
    expect(analysis.recommendation.family).toBe("sampled-blocks");
    expect(analysis.recommendation.shape).toBe("surface-column");
  });

  it("does not mistake a low-contrast smooth ramp for strong folded edges", () => {
    const source = asset(64, 64, (x) => {
      const value = 120 + Math.round((x / 63) * 20);
      return [value, value, value];
    });
    const analysis = analyzePhotoAsset(source, 5);
    expect(analysis.luminanceRange).toBeLessThan(0.1);
    expect(analysis.recommendation.family).toBe("sampled-blocks");
  });

  it("locks deterministic recommendations to measurable inputs", () => {
    const source = asset(32, 16, (x) => x % 4 < 2 ? [10, 10, 10] : [245, 245, 245]);
    const first = analyzePhotoAsset(source, 5);
    const second = analyzePhotoAsset(source, 5);
    expect(second).toEqual(first);
    expect(first.recommendation.columns).toBeGreaterThan(first.recommendation.rows);
    expect(first.quantizedRgba8).toHaveLength(source.rgba8.length);
    expect(first.sampledPreviewRgba8).toHaveLength(
      first.sampledPreviewWidth * first.sampledPreviewHeight * 4,
    );
  });

  it("selects one global compatible family and shape", () => {
    const source = asset(20, 20, () => [0, 0, 0]);
    expect(recommendPhotoGeometry(source, 0.5, 0.7, 0.8)).toMatchObject({ family: "folded-flow", shape: "folded-ridge" });
    expect(recommendPhotoGeometry(source, 0.5, 0.2, 0.8)).toMatchObject({ family: "triangular-current", shape: "triangle-plateau" });
  });

  it("uses the exact current-filament palette for preview pixels and metrics", () => {
    const source = asset(8, 4, (x) => x < 4 ? [240, 25, 30] : [25, 30, 235]);
    const palette = ["#ffff00", "#00ffff"];
    const analysis = analyzePhotoAsset(source, 10, palette);
    expect(analysis.palette).toEqual(palette);
    const previewColors = new Set<string>();
    for (let offset = 0; offset < analysis.quantizedRgba8.length; offset += 4) {
      previewColors.add(Array.from(analysis.quantizedRgba8.slice(offset, offset + 3)).join(","));
    }
    expect([...previewColors].every((color) => color === "255,255,0" || color === "0,255,255")).toBe(true);
    const sampledColors = new Set<string>();
    for (let offset = 0; offset < analysis.sampledPreviewRgba8.length; offset += 4) {
      sampledColors.add(Array.from(analysis.sampledPreviewRgba8.slice(offset, offset + 3)).join(","));
    }
    expect([...sampledColors].every((color) => color === "255,255,0" || color === "0,255,255")).toBe(true);
    expect(analysis.averageDeltaE).toBeGreaterThan(0);
  });
});
