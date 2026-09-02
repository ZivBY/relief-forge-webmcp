import { describe, expect, it } from "vitest";

import {
  copyDepthPaintFieldAsset,
  createDepthPaintField,
  createDepthPaintFieldDescriptor,
} from "../depth-paint/field";
import { canonicalPhotoSha256 } from "./photo-color";
import {
  assertWallArtProjectIdentity,
  generateWallArt,
  wallArtProjectId,
} from "./generate";
import type {
  PhotoFieldAsset,
  WallArtConfigInput,
  WallArtProject,
} from "./types";

function localRecipe(
  asset = createDepthPaintField(512, 2),
): { recipe: WallArtConfigInput; asset: typeof asset } {
  return {
    asset,
    recipe: {
      seed: "local-depth-order",
      design: { family: "folded-flow", variation: 0 },
      grid: { columns: 1, rows: 1, tileSizeMm: 24, gapMm: 1 },
      tile: {
        shape: "folded-ridge",
        baseHeightMm: 2,
        reliefHeightMm: 30,
      },
      pattern: { kind: "flat" },
      depthProfile: { invert: true, contrast: 1, curve: 0, levels: 4 },
      localDepth: {
        masks: [
          {
            id: "z-raise",
            name: "Raise",
            enabled: true,
            kind: "circle",
            strengthMm: 5,
            center: { x: 0, y: 0 },
            size: { x: 4, y: 4 },
            angleDeg: 0,
            feather: 0,
          },
          {
            id: "a-cut",
            name: "Cut",
            enabled: true,
            kind: "rectangle",
            strengthMm: -1,
            center: { x: 0, y: 0 },
            size: { x: 4, y: 4 },
            angleDeg: 0,
            feather: 0,
          },
        ],
        paint: {
          enabled: true,
          descriptor: createDepthPaintFieldDescriptor(asset),
        },
      },
      guides: {
        lines: [{
          id: "guide-raise",
          closed: false,
          points: [{ x: -0.8, y: 0 }, { x: 0.8, y: 0 }],
          effects: { followStrength: 0, heightDeltaMm: 3 },
        }],
        followStrength: 0,
      },
    },
  };
}

describe("local depth generation integration", () => {
  it("adds masks, paint, and guides after the global profile in exact millimetres", () => {
    const { recipe, asset } = localRecipe();
    const baseline = generateWallArt({
      ...recipe,
      localDepth: { masks: [] },
      guides: { lines: [], followStrength: 0 },
    }).tiles[0].heightMm;
    const assets = { depthPaintFields: { [asset.sha256]: asset } };
    const first = generateWallArt(recipe, assets);
    const second = generateWallArt(recipe, assets);

    expect(baseline).toBe(22);
    expect(first.tiles[0].heightMm - baseline).toBeCloseTo(9, 12);
    expect(second).toEqual(first);
    expect(first.depthPaintAsset).toBe(asset);
    expect(JSON.stringify(first.config)).not.toMatch(/"values"|Int16Array/);

    const reversed = generateWallArt({
      ...recipe,
      localDepth: {
        ...recipe.localDepth,
        masks: [...recipe.localDepth!.masks!].reverse(),
      },
    }, assets);
    expect(reversed.tiles[0].mesh).toEqual(first.tiles[0].mesh);
  });

  it("requires and verifies retained paint assets even while painting is disabled", () => {
    const { recipe, asset } = localRecipe();
    const disabled = {
      ...recipe,
      localDepth: {
        ...recipe.localDepth,
        paint: { ...recipe.localDepth!.paint!, enabled: false },
      },
    };
    expect(() => generateWallArt(disabled)).toThrow(/not available/);

    const tampered = copyDepthPaintFieldAsset(asset);
    tampered.values[0] += 1;
    expect(() => generateWallArt(disabled, {
      depthPaintFields: { [asset.sha256]: tampered },
    })).toThrow(/SHA-256/);

    const project = generateWallArt(disabled, {
      depthPaintFields: { [asset.sha256]: asset },
    });
    expect(project.depthPaintAsset).toBe(asset);
    expect(project.tiles[0].heightMm).toBe(29);
    expect(() => assertWallArtProjectIdentity({
      ...project,
      depthPaintAsset: tampered,
    })).toThrow(/SHA-256/);
    const staleRecipe: WallArtProject = {
      ...project,
      config: {
        ...project.config,
        localDepth: {
          ...project.config.localDepth,
          paint: {
            ...project.config.localDepth.paint!,
            enabled: true,
          },
        },
      },
    };
    expect(wallArtProjectId(staleRecipe.config)).not.toBe(staleRecipe.id);
    expect(() => assertWallArtProjectIdentity(staleRecipe)).toThrow(/identity mismatch/i);
  });

  it("carries independently verified photo and depth-paint assets together", () => {
    const width = 8;
    const height = 8;
    const rgba8 = new Uint8Array(width * height * 4);
    for (let index = 0; index < width * height; index += 1) {
      rgba8.set([index * 3, 255 - index * 3, 120, 255], index * 4);
    }
    const photo: PhotoFieldAsset = {
      version: 1,
      width,
      height,
      colorSpace: "srgb",
      rgba8,
      sha256: canonicalPhotoSha256(width, height, rgba8),
    };
    const { recipe, asset } = localRecipe(createDepthPaintField(512, -1.5));
    const photoRecipe: WallArtConfigInput = {
      ...recipe,
      source: {
        kind: "photo",
        photo: {
          assetSha256: photo.sha256,
          canonicalWidth: width,
          canonicalHeight: height,
          toneMode: "light-raised",
          toneContrast: 0.5,
          geometryStrength: 1,
          directionMode: "off",
          directionStrength: 0,
          colorMode: "current-palette",
          colorStrength: 0,
          requestedColorCount: 3,
        },
      },
    };
    const assets = {
      photoFields: { [photo.sha256]: photo },
      depthPaintFields: { [asset.sha256]: asset },
    };
    const project = generateWallArt(photoRecipe, assets);

    expect(project.sourceAsset).toBe(photo);
    expect(project.depthPaintAsset).toBe(asset);
    expect(assertWallArtProjectIdentity(project)).toBeUndefined();
    expect(generateWallArt(photoRecipe, assets)).toEqual(project);
  });
});
