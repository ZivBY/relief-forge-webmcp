import { describe, expect, it } from "vitest";

import { createWallArtConfig } from "./config";
import { createCompositionSampler } from "./composition";
import { canonicalPhotoSha256 } from "./photo-color";
import {
  preparePhotoFieldAsset,
  resolvePhotoFieldAsset,
  samplePhotoField,
  validatePhotoFieldAsset,
} from "./photo-field";
import type { PhotoCompositionConfig, PhotoFieldAsset } from "./types";

const PHOTO_SETTINGS: PhotoCompositionConfig = {
  assetSha256: "0".repeat(64),
  canonicalWidth: 9,
  canonicalHeight: 9,
  toneMode: "light-raised",
  toneContrast: 1 / 3,
  geometryStrength: 1,
  directionMode: "gradient",
  directionStrength: 1,
  colorMode: "auto-palette",
  colorStrength: 1,
  requestedColorCount: 5,
};

function gradientAsset(axis: "x" | "y" = "x"): PhotoFieldAsset {
  const width = 9;
  const height = 9;
  const rgba8 = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = Math.round(((axis === "x" ? x : y) / 8) * 255);
      const offset = (y * width + x) * 4;
      rgba8.set([value, value, value, 255], offset);
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

describe("canonical photo field", () => {
  it("maps light tone monotonically and dark-raised as its inverse", () => {
    const asset = gradientAsset("x");
    const prepared = preparePhotoFieldAsset(asset);
    const settings = { ...PHOTO_SETTINGS, assetSha256: asset.sha256 };
    const dark = samplePhotoField(prepared, settings, -0.8, 0);
    const light = samplePhotoField(prepared, settings, 0.8, 0);
    expect(light.value).toBeGreaterThan(dark.value);
    const inverted = samplePhotoField(prepared, { ...settings, toneMode: "dark-raised" }, 0.8, 0);
    expect(inverted.value).toBeCloseTo(-light.value, 8);
  });

  it("uses the generator's +Y-down direction exactly once", () => {
    const asset = gradientAsset("y");
    const sample = samplePhotoField(
      preparePhotoFieldAsset(asset),
      { ...PHOTO_SETTINGS, assetSha256: asset.sha256 },
      0,
      0,
    );
    expect(sample.angleRad).toBeCloseTo(Math.PI / 2, 5);
    const contour = samplePhotoField(
      preparePhotoFieldAsset(asset),
      { ...PHOTO_SETTINGS, assetSha256: asset.sha256, directionMode: "contour" },
      0,
      0,
    );
    expect(contour.angleRad).toBeCloseTo(Math.PI, 5);
  });

  it("keeps procedural direction in a flat field", () => {
    const rgba8 = new Uint8Array(5 * 5 * 4);
    for (let offset = 0; offset < rgba8.length; offset += 4) rgba8.set([100, 100, 100, 255], offset);
    const asset: PhotoFieldAsset = {
      version: 1,
      width: 5,
      height: 5,
      colorSpace: "srgb",
      rgba8,
      sha256: canonicalPhotoSha256(5, 5, rgba8),
    };
    const config = createWallArtConfig({
      source: { kind: "photo", photo: { ...PHOTO_SETTINGS, assetSha256: asset.sha256, canonicalWidth: 5, canonicalHeight: 5 } },
      pattern: { kind: "wave", angleDeg: 30 },
    });
    const procedural = createWallArtConfig({ pattern: { kind: "wave", angleDeg: 30 } });
    const photoSample = createCompositionSampler(config, { photoFields: { [asset.sha256]: asset } })(0, 0);
    const proceduralSample = createCompositionSampler(procedural)(0, 0);
    expect(photoSample.angleRad).toBeCloseTo(proceduralSample.angleRad, 10);
    expect(photoSample.value).toBeCloseTo(0, 10);
  });

  it("blends across the angle wrap by the shortest signed arc", () => {
    const asset = gradientAsset("x");
    for (let offset = 0; offset < asset.rgba8.length; offset += 4) {
      const value = 255 - asset.rgba8[offset];
      asset.rgba8.set([value, value, value], offset);
    }
    asset.sha256 = canonicalPhotoSha256(asset.width, asset.height, asset.rgba8);
    const config = createWallArtConfig({
      source: {
        kind: "photo",
        photo: {
          ...PHOTO_SETTINGS,
          assetSha256: asset.sha256,
          directionStrength: 0.5,
          toneMode: "off",
        },
      },
      design: { family: "folded-flow" },
      pattern: { kind: "wave", angleDeg: -168.54, phaseDeg: 90 },
    });
    const sample = createCompositionSampler(config, {
      photoFields: { [asset.sha256]: asset },
    })(0, 0);
    const procedural = createCompositionSampler(createWallArtConfig({
      ...config,
      source: { kind: "procedural" },
    }))(0, 0);
    const photoSample = samplePhotoField(
      preparePhotoFieldAsset(asset),
      config.source.photo!,
      0,
      0,
      { x: 2 / config.grid.columns, y: 2 / config.grid.rows },
    );
    const amount = config.source.photo!.directionStrength * photoSample.directionConfidence;
    const delta = Math.atan2(
      Math.sin(photoSample.angleRad! - procedural.angleRad),
      Math.cos(photoSample.angleRad! - procedural.angleRad),
    );
    const expected = Math.atan2(
      Math.sin(procedural.angleRad + delta * amount),
      Math.cos(procedural.angleRad + delta * amount),
    );
    const naive = Math.atan2(
      Math.sin(procedural.angleRad * (1 - amount) + photoSample.angleRad! * amount),
      Math.cos(procedural.angleRad * (1 - amount) + photoSample.angleRad! * amount),
    );
    expect(sample.angleRad).toBeCloseTo(expected, 10);
    expect(Math.abs(Math.atan2(
      Math.sin(sample.angleRad - naive),
      Math.cos(sample.angleRad - naive),
    ))).toBeGreaterThan(1);
  });

  it("suppresses direction metadata for families without directional mesh geometry", () => {
    const asset = gradientAsset("y");
    const config = createWallArtConfig({
      source: {
        kind: "photo",
        photo: { ...PHOTO_SETTINGS, assetSha256: asset.sha256 },
      },
      design: { family: "sampled-blocks" },
      pattern: { kind: "flat", angleDeg: 0 },
    });
    const sample = createCompositionSampler(config, {
      photoFields: { [asset.sha256]: asset },
    })(0, 0);
    expect(sample.angleRad).toBeCloseTo(0, 10);
  });

  it("keeps a useful direction scale for sparse non-zero edges", () => {
    const width = 41;
    const height = 41;
    const rgba8 = new Uint8Array(width * height * 4);
    for (let offset = 0; offset < rgba8.length; offset += 4) {
      rgba8.set([20, 20, 20, 255], offset);
    }
    rgba8.set([245, 245, 245, 255], ((20 * width) + 20) * 4);
    const sparse: PhotoFieldAsset = {
      version: 1,
      width,
      height,
      colorSpace: "srgb",
      rgba8,
      sha256: canonicalPhotoSha256(width, height, rgba8),
    };
    const prepared = preparePhotoFieldAsset(sparse);
    expect(prepared.gradientP95).toBeGreaterThan(0);
    const sample = samplePhotoField(
      prepared,
      { ...PHOTO_SETTINGS, assetSha256: sparse.sha256, canonicalWidth: width, canonicalHeight: height },
      0.05,
      0,
    );
    expect(sample.directionConfidence).toBeGreaterThan(0);
  });

  it("does not amplify one-code-value image noise into strong direction", () => {
    const width = 17;
    const height = 17;
    const rgba8 = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const value = x < Math.floor(width / 2) ? 254 : 255;
        rgba8.set([value, value, value, 255], (y * width + x) * 4);
      }
    }
    const noisy: PhotoFieldAsset = {
      version: 1,
      width,
      height,
      colorSpace: "srgb",
      rgba8,
      sha256: canonicalPhotoSha256(width, height, rgba8),
    };
    const prepared = preparePhotoFieldAsset(noisy);
    expect(prepared.gradientP95).toBeGreaterThan(1e-8);
    const sample = samplePhotoField(
      prepared,
      { ...PHOTO_SETTINGS, assetSha256: noisy.sha256, canonicalWidth: width, canonicalHeight: height },
      0,
      0,
    );
    expect(sample.directionConfidence).toBe(0);
    expect(sample.angleRad).toBeUndefined();
  });

  it("does not amplify a one-code-value tone span into full relief", () => {
    const width = 17;
    const height = 9;
    const rgba8 = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const value = x < width / 2 ? 254 : 255;
        rgba8.set([value, value, value, 255], (y * width + x) * 4);
      }
    }
    const nearFlat: PhotoFieldAsset = {
      version: 1,
      width,
      height,
      colorSpace: "srgb",
      rgba8,
      sha256: canonicalPhotoSha256(width, height, rgba8),
    };
    const prepared = preparePhotoFieldAsset(nearFlat);
    expect(prepared.luminanceHigh - prepared.luminanceLow).toBeGreaterThan(1e-8);
    const settings = {
      ...PHOTO_SETTINGS,
      assetSha256: nearFlat.sha256,
      canonicalWidth: width,
      canonicalHeight: height,
      toneContrast: 1,
    };
    expect(samplePhotoField(prepared, settings, -0.8, 0).value).toBe(0);
    expect(samplePhotoField(prepared, settings, 0.8, 0).value).toBe(0);
  });

  it("rejects missing, mismatched, and byte-tampered assets", () => {
    const asset = gradientAsset();
    const config = createWallArtConfig({
      source: { kind: "photo", photo: { ...PHOTO_SETTINGS, assetSha256: asset.sha256 } },
    });
    expect(() => resolvePhotoFieldAsset(config)).toThrow(/not available/);
    const wrongDimensions = { ...asset, width: 8 };
    expect(() => resolvePhotoFieldAsset(config, { photoFields: { [asset.sha256]: wrongDimensions } })).toThrow();
    const tampered = { ...asset, rgba8: asset.rgba8.slice() };
    tampered.rgba8[0] ^= 1;
    expect(() => validatePhotoFieldAsset(tampered)).toThrow(/SHA-256/);
  });
});
