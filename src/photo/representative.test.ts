import { describe, expect, it } from "vitest";

import { createWallArtConfig } from "../core/config";
import { photoFamilyUsesDirection } from "../core/composition";
import { generateWallArt } from "../core/generate";
import { canonicalPhotoSha256 } from "../core/photo-color";
import type { PhotoFieldAsset } from "../core/types";
import { analyzePhotoAsset } from "./analysis";

type Pixel = [number, number, number];

function makeAsset(pixel: (x: number, y: number, width: number, height: number) => Pixel): PhotoFieldAsset {
  const width = 48;
  const height = 36;
  const rgba8 = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      rgba8.set([...pixel(x, y, width, height), 255], (y * width + x) * 4);
    }
  }
  return {
    version: 1,
    width,
    height,
    colorSpace: "srgb",
    rgba8,
    sha256: canonicalPhotoSha256(width, height, rgba8),
  };
}

const fixtures = {
  portrait: makeAsset((x, y, width, height) => {
    const nx = (x - width / 2) / (width / 2);
    const ny = (y - height / 2) / (height / 2);
    if (ny > 0.48 && Math.abs(nx) < 0.55) return [35, 75, 125];
    const face = (nx / 0.42) ** 2 + ((ny + 0.08) / 0.58) ** 2 < 1;
    if (!face) return [226, 218, 202];
    if (ny < -0.42 || (Math.abs(nx) > 0.33 && ny < 0.08)) return [45, 30, 28];
    if (Math.abs(ny + 0.12) < 0.045 && Math.abs(Math.abs(nx) - 0.16) < 0.07) return [35, 38, 42];
    if (Math.abs(ny - 0.22) < 0.04 && Math.abs(nx) < 0.18) return [135, 55, 55];
    return [218, 164, 126];
  }),
  landscape: makeAsset((x, y, width, height) => {
    if (y < height * 0.48) return [75 + Math.round(y * 2), 150 + Math.round(y), 220];
    const mountain = height * 0.76 - Math.abs(x - width * 0.48) * 0.48;
    if (y < mountain) return [70, 95, 88];
    return y > height * 0.82 ? [45, 92, 55] : [115, 135, 75];
  }),
  architecture: makeAsset((x, y) => {
    const facade = Math.floor(x / 4) % 2 === 0 ? 28 : 230;
    const windowBand = Math.floor(y / 9) % 2 === 1 && y % 9 < 3;
    return windowBand ? [55, 105, 145] : [facade, facade, facade];
  }),
  graphic: makeAsset((x, y) => {
    const dark = (Math.floor(x / 3) + Math.floor(y / 3)) % 2 === 0;
    return dark ? [15, 22, 35] : [245, 205, 40];
  }),
};

function correlation(left: readonly number[], right: readonly number[]): number {
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    covariance += leftDelta * rightDelta;
    leftVariance += leftDelta ** 2;
    rightVariance += rightDelta ** 2;
  }
  return covariance / Math.sqrt(leftVariance * rightVariance);
}

describe("representative photo composition fixtures", () => {
  it("retains deterministic key-color structure at 2, 5, and 10 colors", () => {
    for (const [name, asset] of Object.entries(fixtures)) {
      for (const count of [2, 5, 10]) {
        const first = analyzePhotoAsset(asset, count);
        const second = analyzePhotoAsset(asset, count);
        expect(second, `${name}/${count}`).toEqual(first);
        expect(first.palette.length, `${name}/${count}`).toBeGreaterThan(0);
        expect(first.palette.length, `${name}/${count}`).toBeLessThanOrEqual(count);
        expect(new Set(first.palette).size, `${name}/${count}`).toBe(first.palette.length);
        expect(first.sampledPreviewRgba8.length, `${name}/${count}`).toBe(
          first.sampledPreviewWidth * first.sampledPreviewHeight * 4,
        );
      }
    }
  });

  it("selects edge-appropriate forms for directional and dense graphic fixtures", () => {
    expect(analyzePhotoAsset(fixtures.architecture, 5).recommendation.family).toBe("folded-flow");
    expect(analyzePhotoAsset(fixtures.graphic, 5).recommendation.family).toBe("triangular-current");
  });

  it("turns each representative image into deterministic manifold geometry with meaningful heights", () => {
    for (const [name, asset] of Object.entries(fixtures)) {
      const analysis = analyzePhotoAsset(asset, 5);
      const directionEnabled = photoFamilyUsesDirection(analysis.recommendation.family);
      const config = createWallArtConfig({
        seed: `representative-${name}`,
        source: {
          kind: "photo",
          photo: {
            assetSha256: asset.sha256,
            canonicalWidth: asset.width,
            canonicalHeight: asset.height,
            toneMode: "light-raised",
            toneContrast: 0.55,
            geometryStrength: 1,
            directionMode: directionEnabled ? "gradient" : "off",
            directionStrength: directionEnabled ? 0.72 : 0,
            colorMode: "auto-palette",
            colorStrength: 1,
            requestedColorCount: 5,
          },
        },
        design: { family: analysis.recommendation.family, silhouette: "rectangle", variation: 0 },
        grid: { columns: 8, rows: 6, tileSizeMm: 22, gapMm: 1.5 },
        tile: { shape: analysis.recommendation.shape, baseHeightMm: 2, reliefHeightMm: 16 },
        pattern: { kind: "flat" },
        palette: { colors: analysis.palette, mode: "field-bands", offset: 0, reverse: false },
      });
      const assets = { photoFields: { [asset.sha256]: asset } };
      const first = generateWallArt(config, assets);
      const second = generateWallArt(config, assets);
      expect(second, name).toEqual(first);
      expect(first.diagnostics.allTilesClosedManifold, name).toBe(true);
      expect(new Set(first.tiles.map((tile) => tile.color)).size, name).toBeLessThanOrEqual(5);
      expect(
        correlation(
          first.tiles.map((tile) => tile.patternValue),
          first.tiles.map((tile) => tile.heightMm),
        ),
        name,
      ).toBeGreaterThan(0.55);
    }
  });
});
