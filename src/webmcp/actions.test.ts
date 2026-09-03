import { describe, expect, it } from "vitest";

import { createWallArtConfig } from "../core/config";
import { canonicalPhotoSha256 } from "../core/photo-color";
import type { PhotoFieldAsset } from "../core/types";
import {
  assertEmptyToolInput,
  createWallArtAction,
  DEFAULT_TOPOGRAPHIC_SEED,
  DEFAULT_WALL_ART_HEIGHT_MM,
  inspectFabricationPlanAction,
  POLAR_BLOOM_PALETTE,
  POLAR_BLOOM_PRESET,
  setPrinterBedAction,
  shapeFabricationPackageResult,
  TOPOGRAPHIC_MOSAIC_PRESET,
} from "./actions";

const TOPOGRAPHIC_REQUEST = {
  preset: "topographic-terraces",
  width: 36,
  unit: "in",
  depthMm: 20,
} as const;

const TOPOGRAPHIC_MOSAIC_REQUEST = {
  preset: TOPOGRAPHIC_MOSAIC_PRESET,
  width: 48,
  height: 32,
  unit: "in",
  depthMm: 28,
  seed: "webmcp-showcase-073",
} as const;

const POLAR_BLOOM_REQUEST = {
  preset: POLAR_BLOOM_PRESET,
  width: 48,
  height: 48,
  unit: "in",
  depthMm: 30,
  seed: "webmcp-polar-bloom-showcase-001",
} as const;

const HEAVY_GEOMETRY_TIMEOUT_MS = 15_000;

describe("WebMCP wall-art actions", () => {
  it("creates the exact 36-inch topographic preset deterministically", () => {
    const first = createWallArtAction(TOPOGRAPHIC_REQUEST);
    const second = createWallArtAction(TOPOGRAPHIC_REQUEST);

    expect(first.config.finishedSize).toEqual({
      widthMm: 914.4,
      heightMm: DEFAULT_WALL_ART_HEIGHT_MM,
      lockAspect: false,
    });
    expect(first.config.seed).toBe(DEFAULT_TOPOGRAPHIC_SEED);
    expect(first.project.id).toBe("wall-art-g6-02471088");
    expect(first.project.widthMm).toBe(914.4);
    expect(first.project.depthMm).toBe(609.6);
    expect(first.config.design.family).toBe("contour-relief");
    expect(first.config.tile.shape).toBe("terraced-panel");
    expect(first.config.pattern.kind).toBe("noise");
    expect(first.config.depthProfile.levels).toBe(8);
    expect(first.summary.objectDepthMm).toMatchObject({
      configuredRange: {
        minimum: 2.4,
        maximum: 20,
        levelCount: 8,
      },
      actualPartThicknessRange: {
        minimum: 14.971428571428573,
        maximum: 20,
      },
      observedPositiveSurfaceLevels: {
        minimum: 7.428571428571429,
        maximum: 20,
        distinctCount: 5,
      },
    });
    expect(first.summary.partCount).toBe(12);
    expect(first.project.id).toBe(second.project.id);
    expect(first.packing).toEqual(second.packing);
    expect(first.summary.digitalFit).toMatchObject({
      status: "fits",
      everyPartPlaced: true,
      allPartsClosedManifold: true,
      fullMeshClosedManifold: true,
      fullMeshOutwardWinding: true,
    });
  });

  it("preserves the preset aspect ratio when height is omitted", () => {
    const result = createWallArtAction({
      ...TOPOGRAPHIC_REQUEST,
      width: 18,
    });

    expect(result.config.finishedSize).toEqual({
      widthMm: 457.2,
      heightMm: 304.8,
      lockAspect: false,
    });
  });

  it("creates the dense 96-panel topographic mosaic deterministically", () => {
    const first = createWallArtAction(TOPOGRAPHIC_MOSAIC_REQUEST);
    const second = createWallArtAction(TOPOGRAPHIC_MOSAIC_REQUEST);

    expect(first.config.finishedSize).toEqual({
      widthMm: 1219.2,
      heightMm: 812.8,
      lockAspect: false,
    });
    expect(first.config.grid).toEqual({
      columns: 12,
      rows: 8,
      tileSizeMm: 150,
      gapMm: 2,
    });
    expect(first.summary.preset).toBe(TOPOGRAPHIC_MOSAIC_PRESET);
    expect(first.summary.partCount).toBe(96);
    expect(first.project.id).toBe("wall-art-g6-c67b786a");
    expect(first.project.id).toBe(second.project.id);
    expect(first.packing).toEqual(second.packing);
    expect(first.summary.objectDepthMm).toMatchObject({
      configuredRange: {
        minimum: 2.4,
        maximum: 28,
        levelCount: 8,
      },
      actualPartThicknessRange: {
        minimum: 9.714285714285714,
        maximum: 28,
      },
      observedPositiveSurfaceLevels: {
        minimum: 2.4,
        maximum: 28,
        distinctCount: 7,
      },
    });
    expect(first.summary.digitalFit).toMatchObject({
      status: "fits",
      placedPartCount: 96,
      plateCount: 26,
      everyPartPlaced: true,
      allPartsClosedManifold: true,
      fullMeshClosedManifold: true,
      fullMeshOutwardWinding: true,
    });
  }, HEAVY_GEOMETRY_TIMEOUT_MS);

  it("creates the exact-size Polar Bloom showcase deterministically", () => {
    const current = createWallArtConfig({
      palette: {
        colors: ["#004488", "#ddaa33"],
        mode: "seeded-random",
        offset: 2,
        reverse: true,
      },
    });
    const first = createWallArtAction(POLAR_BLOOM_REQUEST, current);
    const second = createWallArtAction(POLAR_BLOOM_REQUEST, current);

    expect(first.config.finishedSize).toEqual({
      widthMm: 1219.2,
      heightMm: 1219.2,
      lockAspect: false,
    });
    expect(first.config.design).toMatchObject({
      family: "polar-bloom",
      silhouette: "ellipse",
      variation: 0.45,
      symmetry: 16,
    });
    expect(first.config.grid).toEqual({
      columns: 10,
      rows: 10,
      tileSizeMm: 32,
      gapMm: 2.4,
    });
    expect(first.config.tile).toMatchObject({
      shape: "polar-petal",
      baseHeightMm: 2.4,
      reliefHeightMm: 27.6,
      leanRatio: 0.18,
    });
    expect(first.config.pattern).toMatchObject({
      kind: "ripple",
      frequency: 1.2,
      centerX: 0,
      centerY: 0,
    });
    expect(first.config.palette).toEqual({
      colors: [...POLAR_BLOOM_PALETTE],
      mode: "field-bands",
      offset: 0,
      reverse: false,
    });
    expect(first.summary.preset).toBe(POLAR_BLOOM_PRESET);
    expect(first.summary.objectDepthMm.configuredRange).toEqual({
      minimum: 2.4,
      maximum: 30,
      levelCount: 0,
    });
    expect(first.project.id).toBe("wall-art-g6-68761ba2");
    expect(first.summary.partCount).toBe(81);
    expect(first.project.id).toBe(second.project.id);
    expect(first.packing).toEqual(second.packing);
    expect(first.summary.digitalFit).toMatchObject({
      status: "fits",
      placedPartCount: 81,
      plateCount: 62,
      everyPartPlaced: true,
      allPartsClosedManifold: true,
      fullMeshClosedManifold: true,
      fullMeshOutwardWinding: true,
    });
  });

  it("uses a square default aspect for Polar Bloom when height is omitted", () => {
    const result = createWallArtAction({
      ...POLAR_BLOOM_REQUEST,
      width: 36,
      height: undefined,
    });

    expect(result.config.finishedSize).toEqual({
      widthMm: 914.4,
      heightMm: 914.4,
      lockAspect: false,
    });
  });

  it("applies the filmed mixed-color printer settings to the Polar Bloom project", () => {
    const created = createWallArtAction(POLAR_BLOOM_REQUEST);
    const result = setPrinterBedAction({
      bedWidthMm: 256,
      bedDepthMm: 256,
      marginMm: 5,
      spacingMm: 4,
      allowRotate90: true,
      separateColors: false,
    }, created.config);

    expect(result.project.id).toBe("wall-art-g6-238bfdaa");
    expect(result.config.printer.separateColors).toBe(false);
    expect(result.summary.digitalFit).toMatchObject({
      status: "fits",
      placedPartCount: 81,
      plateCount: 62,
      everyPartPlaced: true,
    });
  });

  it("packs the dense showcase as 24 full mixed-color plates", () => {
    const created = createWallArtAction(TOPOGRAPHIC_MOSAIC_REQUEST);
    const packed = setPrinterBedAction({
      bedWidthMm: 256,
      bedDepthMm: 256,
      marginMm: 5,
      spacingMm: 4,
      allowRotate90: true,
      separateColors: false,
    }, created.config);

    expect(packed.project.id).toBe("wall-art-g6-94007cdc");
    expect(packed.summary.digitalFit).toMatchObject({
      status: "fits",
      placedPartCount: 96,
      plateCount: 24,
      everyPartPlaced: true,
    });
    expect(packed.packing?.plates).toHaveLength(24);
    expect(packed.packing?.plates.every((plate) => plate.placements.length === 4))
      .toBe(true);
  }, HEAVY_GEOMETRY_TIMEOUT_MS);

  it("lets the showcase preserve its size by replacing oversized broad panels", () => {
    const broad = createWallArtAction({
      ...TOPOGRAPHIC_MOSAIC_REQUEST,
      preset: "topographic-terraces",
    });

    expect(broad.project.id).toBe("wall-art-g6-490aa8d6");
    expect(broad.packing).toBeUndefined();
    expect(broad.packingError).toMatchObject({
      code: "part_exceeds_usable_bed",
      usableWidthMm: 246,
      usableDepthMm: 246,
    });
    expect(broad.packingError?.requiredWidthMm).toBeCloseTo(301.782, 3);
    expect(broad.packingError?.requiredDepthMm).toBeCloseTo(268.546, 3);

    const mosaic = setPrinterBedAction({
      bedWidthMm: 256,
      bedDepthMm: 256,
      marginMm: 5,
      spacingMm: 4,
      allowRotate90: true,
      separateColors: false,
    }, createWallArtAction(TOPOGRAPHIC_MOSAIC_REQUEST).config);

    expect(mosaic.summary.finishedSizeMm).toEqual(broad.summary.finishedSizeMm);
    expect(mosaic.summary.partCount).toBe(96);
    expect(mosaic.summary.digitalFit).toMatchObject({
      status: "fits",
      placedPartCount: 96,
      plateCount: 24,
    });
  }, HEAVY_GEOMETRY_TIMEOUT_MS);

  it("preserves palette and printer settings but clears prior composition state", () => {
    const current = createWallArtConfig({
      palette: {
        colors: ["#111111", "#eeeeee"],
        mode: "checker",
        reverse: true,
        offset: 1,
      },
      printer: {
        bedWidthMm: 300,
        bedDepthMm: 280,
        marginMm: 6,
        spacingMm: 3,
        allowRotate90: false,
        separateColors: false,
      },
      guides: {
        lines: [{
          id: "old-guide",
          points: [{ x: -1, y: 0 }, { x: 1, y: 0 }],
          closed: false,
        }],
      },
      localDepth: {
        masks: [{
          id: "old-mask",
          name: "Old mask",
          enabled: true,
          kind: "circle",
          strengthMm: 2,
          center: { x: 0, y: 0 },
          size: { x: 1, y: 1 },
          angleDeg: 0,
          feather: 0.2,
        }],
      },
    });

    const result = createWallArtAction(TOPOGRAPHIC_REQUEST, current);

    expect(result.config.palette).toEqual(current.palette);
    expect(result.config.printer).toEqual(current.printer);
    expect(result.config.source).toEqual({ kind: "procedural" });
    expect(result.config.guides.lines).toEqual([]);
    expect(result.config.localDepth).toEqual({ masks: [] });
  });

  it("does not label materially edited geometry as the named preset", () => {
    const created = createWallArtAction(TOPOGRAPHIC_REQUEST);
    const edited = inspectFabricationPlanAction(createWallArtConfig({
      ...created.config,
      design: { ...created.config.design, variation: 0.5 },
    }));

    expect(edited.summary.preset).toBe("custom");

    const polarBloom = createWallArtAction(POLAR_BLOOM_REQUEST);
    const editedBloom = inspectFabricationPlanAction(createWallArtConfig({
      ...polarBloom.config,
      design: { ...polarBloom.config.design, symmetry: 15 },
    }));

    expect(editedBloom.summary.preset).toBe("custom");
  });

  it("strictly rejects ambiguous, unsupported, and impractical create inputs", () => {
    expect(() => createWallArtAction({ ...TOPOGRAPHIC_REQUEST, width: "36" }))
      .toThrow(/width must be a finite number/);
    expect(() => createWallArtAction({ ...TOPOGRAPHIC_REQUEST, unit: "feet" }))
      .toThrow(/unit must be either/);
    expect(() => createWallArtAction({ ...TOPOGRAPHIC_REQUEST, preset: "unknown" }))
      .toThrow(/preset must be topographic-terraces, topographic-mosaic, or polar-bloom/);
    expect(() => createWallArtAction({ ...TOPOGRAPHIC_REQUEST, depthMm: 2.99 }))
      .toThrow(/depthMm must be at least 3/);
    expect(() => createWallArtAction({ ...TOPOGRAPHIC_REQUEST, depthMm: 80.01 }))
      .toThrow(/depthMm cannot exceed 80/);
    expect(() => createWallArtAction({ ...TOPOGRAPHIC_REQUEST, privatePath: "C:\\secret" }))
      .toThrow(/unsupported field: privatePath/);
    expect(() => createWallArtAction({ ...TOPOGRAPHIC_REQUEST, seed: "x".repeat(129) }))
      .toThrow(/at most 128 characters/);
  });

  it("updates exact printer dimensions without guessing from a model name", () => {
    const initial = createWallArtAction(TOPOGRAPHIC_REQUEST);
    const updated = setPrinterBedAction({
      bedWidthMm: 300,
      bedDepthMm: 280,
      marginMm: 8,
      spacingMm: 3,
      allowRotate90: false,
      separateColors: false,
    }, initial.config);

    expect(updated.config.printer).toEqual({
      bedWidthMm: 300,
      bedDepthMm: 280,
      marginMm: 8,
      spacingMm: 3,
      allowRotate90: false,
      separateColors: false,
    });
    expect(updated.project.id).not.toBe(initial.project.id);
    expect(updated.summary.printerBedMm).toMatchObject({
      width: 300,
      depth: 280,
      usableWidth: 284,
      usableDepth: 264,
    });
    expect(() => setPrinterBedAction({
      bedWidthMm: 256,
      bedDepthMm: 256,
      printerModel: "Bambu X1C",
    }, initial.config)).toThrow(/unsupported field: printerModel/);
    expect(() => setPrinterBedAction({
      bedWidthMm: 79,
      bedDepthMm: 256,
    }, initial.config)).toThrow(/bedWidthMm must be at least 80/);
  });

  it("retains required browser-local photo assets while changing printer settings", () => {
    const width = 4;
    const height = 4;
    const rgba8 = new Uint8Array(width * height * 4).fill(128);
    const asset: PhotoFieldAsset = {
      version: 1,
      width,
      height,
      colorSpace: "srgb",
      rgba8,
      sha256: canonicalPhotoSha256(width, height, rgba8),
    };
    const config = createWallArtConfig({
      seed: "photo-printer-tool",
      source: {
        kind: "photo",
        photo: {
          assetSha256: asset.sha256,
          canonicalWidth: width,
          canonicalHeight: height,
          toneMode: "light-raised",
          toneContrast: 0.5,
          geometryStrength: 1,
          directionMode: "off",
          directionStrength: 0,
          colorMode: "auto-palette",
          colorStrength: 1,
          requestedColorCount: 3,
        },
      },
      design: { family: "sampled-blocks", variation: 0 },
      grid: { columns: 2, rows: 2, tileSizeMm: 20, gapMm: 2 },
      tile: { shape: "surface-column", baseHeightMm: 2, reliefHeightMm: 8 },
      pattern: { kind: "flat" },
    });

    const result = setPrinterBedAction({
      bedWidthMm: 256,
      bedDepthMm: 256,
      marginMm: 5,
    }, config, { photoFields: { [asset.sha256]: asset } });

    expect(result.project.sourceAsset?.sha256).toBe(asset.sha256);
    expect(result.config.printer.marginMm).toBe(5);
  });

  it("returns an actionable digital-fit warning instead of hiding an oversized part", () => {
    const created = createWallArtAction({
      ...TOPOGRAPHIC_REQUEST,
      width: 36,
      height: 24,
    });
    const result = setPrinterBedAction({
      bedWidthMm: 80,
      bedDepthMm: 80,
      marginMm: 5,
    }, created.config);

    expect(result.packing).toBeUndefined();
    expect(result.packingError).toMatchObject({
      code: "part_exceeds_usable_bed",
      usableWidthMm: 70,
      usableDepthMm: 70,
    });
    expect(result.summary.digitalFit).toMatchObject({
      status: "needs_attention",
      everyPartPlaced: false,
      placedPartCount: 0,
      plateCount: 0,
    });
    expect(result.summary.warning).toMatch(/Digital geometry and bed-fit checks only/);
  });

  it("recomputes an inspection and shapes the post-build package result", () => {
    const created = createWallArtAction(TOPOGRAPHIC_REQUEST);
    const inspected = inspectFabricationPlanAction(created.config);
    expect(inspected.summary).toEqual(created.summary);

    const prepared = shapeFabricationPackageResult(inspected, {
      fileName: `${inspected.project.id}-fabrication-package.zip`,
      byteLength: 1_234_567,
      saveLinkReady: true,
    });
    expect(prepared).toMatchObject({
      projectId: inspected.project.id,
      status: "ready_to_save",
      byteLength: 1_234_567,
      saveLinkReady: true,
    });
    expect(prepared.nextStep).toMatch(/visible Save file now link/);
    expect(() => shapeFabricationPackageResult(inspected, {
      fileName: "invalid/name.zip",
      byteLength: 100,
      saveLinkReady: true,
    })).toThrow(/unsupported characters/);
    expect(() => shapeFabricationPackageResult(inspected, {
      fileName: `${inspected.project.id}-fabrication-package.zip`,
      byteLength: 0,
      saveLinkReady: true,
    })).toThrow(/cannot be true when byteLength is zero/);
  });

  it("rejects unexpected fields for nominally empty tools", () => {
    expect(() => assertEmptyToolInput({ unexpected: true })).toThrow(/unsupported field/);
    expect(() => assertEmptyToolInput(null)).toThrow(/must be an object/);
    expect(() => assertEmptyToolInput({})).not.toThrow();
  });
});
