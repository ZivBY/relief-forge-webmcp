import { describe, expect, it } from "vitest";

import { canonicalPhotoSha256 } from "./photo-color";
import { createWallArtConfig } from "./config";
import { generateWallArt } from "./generate";
import type {
  DesignFamilyKind,
  PhotoFieldAsset,
  TileShapeKind,
  WallArtConfigInput,
} from "./types";

function photoAsset(width = 24, height = 18): PhotoFieldAsset {
  const rgba8 = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const red = Math.round((x / Math.max(1, width - 1)) * 255);
      const green = Math.round((y / Math.max(1, height - 1)) * 255);
      rgba8.set([red, green, 255 - red, 255], (y * width + x) * 4);
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

function photoOverrides(asset: PhotoFieldAsset): WallArtConfigInput {
  return {
    seed: "photo-generation-fixture",
    source: {
      kind: "photo",
      photo: {
        assetSha256: asset.sha256,
        canonicalWidth: asset.width,
        canonicalHeight: asset.height,
        toneMode: "light-raised",
        toneContrast: 0.5,
        geometryStrength: 1,
        directionMode: "gradient",
        directionStrength: 1,
        colorMode: "auto-palette",
        colorStrength: 1,
        requestedColorCount: 3,
      },
    },
    design: { family: "sampled-blocks", silhouette: "rectangle", variation: 0 },
    grid: { columns: 4, rows: 3, tileSizeMm: 24, gapMm: 2 },
    tile: { shape: "surface-column", baseHeightMm: 2, reliefHeightMm: 20 },
    pattern: { kind: "flat" },
    palette: { colors: ["#101050", "#805080", "#f0f050"], mode: "field-bands", offset: 0, reverse: false },
  };
}

describe("photo-driven wall-art generation", () => {
  it("is byte-for-byte deterministic for the same canonical field and recipe", () => {
    const asset = photoAsset();
    const assets = { photoFields: { [asset.sha256]: asset } };
    const first = generateWallArt(photoOverrides(asset), assets);
    const second = generateWallArt(photoOverrides(asset), assets);
    expect(second).toEqual(first);
    expect(first.sourceAsset?.sha256).toBe(asset.sha256);
    expect(first.schemaVersion).toBe(3);
  });

  it("maps lighter source regions to taller pieces without seeded height noise", () => {
    const asset = photoAsset(24, 1);
    const project = generateWallArt({
      ...photoOverrides(asset),
      grid: { columns: 6, rows: 1, tileSizeMm: 20, gapMm: 1 },
    }, { photoFields: { [asset.sha256]: asset } });
    const ordered = [...project.tiles].sort((left, right) => left.centerXmm - right.centerXmm);
    expect(ordered.at(-1)!.heightMm).toBeGreaterThan(ordered[0].heightMm);
    expect(new Set(project.tiles.map((tile) => tile.color)).size).toBeLessThanOrEqual(3);
  });

  it("blocks missing and tampered photo fields instead of falling back", () => {
    const asset = photoAsset();
    expect(() => generateWallArt(photoOverrides(asset))).toThrow(/not available/);
    const tampered = { ...asset, rgba8: asset.rgba8.slice() };
    tampered.rgba8[8] ^= 1;
    expect(() => generateWallArt(photoOverrides(asset), {
      photoFields: { [asset.sha256]: tampered },
    })).toThrow(/SHA-256/);
  });

  it("changes identity when a photo mapping control changes", () => {
    const asset = photoAsset();
    const assets = { photoFields: { [asset.sha256]: asset } };
    const normalized = createWallArtConfig(photoOverrides(asset));
    const light = generateWallArt(normalized, assets);
    const dark = generateWallArt({
      ...normalized,
      source: {
        kind: "photo",
        photo: {
          ...normalized.source.photo!,
          toneMode: "dark-raised",
        },
      },
    }, assets);
    expect(dark.id).not.toBe(light.id);
  });

  it("preserves procedural geometry variation when photo tone relief is off", () => {
    const asset = photoAsset();
    const photoSettings = createWallArtConfig(photoOverrides(asset)).source.photo!;
    const common = {
      ...photoOverrides(asset),
      design: { family: "sampled-blocks" as const, silhouette: "rectangle" as const, variation: 0.67 },
      pattern: { kind: "noise" as const, frequency: 2.4 },
    };
    const procedural = generateWallArt({ ...common, source: { kind: "procedural" } });
    const photo = generateWallArt({
      ...common,
      source: {
        kind: "photo",
        photo: {
          ...photoSettings,
          toneMode: "off",
          directionMode: "off",
          colorMode: "current-palette",
          colorStrength: 0,
        },
      },
    }, { photoFields: { [asset.sha256]: asset } });
    expect(photo.tiles.map((tile) => tile.heightMm)).toEqual(
      procedural.tiles.map((tile) => tile.heightMm),
    );
    expect(photo.tiles.map((tile) => tile.mesh.vertices)).toEqual(
      procedural.tiles.map((tile) => tile.mesh.vertices),
    );
  });

  it("keeps the current palette mapping unchanged at zero photo color influence", () => {
    const asset = photoAsset();
    const photoSettings = createWallArtConfig(photoOverrides(asset)).source.photo!;
    const common = {
      ...photoOverrides(asset),
      palette: {
        colors: ["#101010", "#eeeeee", "#cc2244"],
        mode: "checker" as const,
        offset: 1,
        reverse: true,
      },
    };
    const procedural = generateWallArt({ ...common, source: { kind: "procedural" } });
    const photo = generateWallArt({
      ...common,
      source: {
        kind: "photo",
        photo: {
          ...photoSettings,
          colorMode: "current-palette",
          colorStrength: 0,
        },
      },
    }, { photoFields: { [asset.sha256]: asset } });
    expect(photo.tiles.map((tile) => tile.color)).toEqual(
      procedural.tiles.map((tile) => tile.color),
    );
  });

  it("updates orientation metadata after anisotropic finished-size scaling", () => {
    const asset = photoAsset();
    const assets = { photoFields: { [asset.sha256]: asset } };
    const common = {
      ...photoOverrides(asset),
      design: { family: "folded-flow" as const, silhouette: "rectangle" as const, variation: 0 },
      grid: { columns: 4, rows: 3, tileSizeMm: 28, gapMm: 1 },
      tile: { shape: "folded-ridge" as const, baseHeightMm: 2, reliefHeightMm: 14 },
      pattern: { kind: "flat" as const },
    };
    const natural = generateWallArt(common, assets);
    const stretched = generateWallArt({
      ...common,
      finishedSize: {
        widthMm: natural.widthMm * 2,
        heightMm: natural.depthMm,
        lockAspect: false,
      },
    }, assets);
    let changed = 0;
    for (let index = 0; index < natural.tiles.length; index += 1) {
      const before = natural.tiles[index].orientationRad;
      const expected = Math.atan2(Math.sin(before), Math.cos(before) * 2);
      expect(stretched.tiles[index].orientationRad).toBeCloseTo(expected, 9);
      if (Math.abs(expected - before) > 0.01) changed += 1;
    }
    expect(changed).toBeGreaterThan(0);
  });

  it("keeps every supported family finite and manifold under photo tone/color input", () => {
    const asset = photoAsset();
    const assets = { photoFields: { [asset.sha256]: asset } };
    const families: Array<[DesignFamilyKind, TileShapeKind]> = [
      ["folded-flow", "folded-ridge"],
      ["sampled-blocks", "surface-column"],
      ["triangular-current", "triangle-plateau"],
      ["polar-bloom", "polar-wedge"],
      ["cellular-crystal", "cell-plateau"],
      ["hex-canopy", "hex-petal"],
      ["coral-cluster", "solid-pod"],
      ["contour-relief", "relief-panel"],
      ["silhouette-mosaic", "twisted-prism"],
    ];
    for (const [family, shape] of families) {
      const project = generateWallArt({
        ...photoOverrides(asset),
        design: { family, silhouette: "rectangle", variation: 0.2, surfaceResolution: 5 },
        grid: { columns: family === "contour-relief" ? 2 : 3, rows: family === "contour-relief" ? 2 : 3, tileSizeMm: 24, gapMm: 2 },
        tile: { shape, baseHeightMm: 2, reliefHeightMm: 12, leanRatio: 0.12 },
      }, assets);
      expect(project.tiles.length, family).toBeGreaterThan(0);
      expect(project.diagnostics.allTilesClosedManifold, family).toBe(true);
      expect(project.diagnostics.fullMesh.nonFiniteVertexCount, family).toBe(0);
    }
  });
});
