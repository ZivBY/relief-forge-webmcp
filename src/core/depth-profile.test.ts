import { describe, expect, it } from "vitest";

import {
  createDepthMapper,
  depthCurveExponent,
  mapDepthAmount,
} from "./depth-profile";
import { generateWallArt } from "./generate";
import type {
  DepthProfileConfig,
  DesignFamilyKind,
  TileShapeKind,
} from "./types";

const NEUTRAL_PROFILE: DepthProfileConfig = {
  invert: false,
  contrast: 1,
  curve: 0,
  levels: 0,
};

describe("deterministic depth profile", () => {
  it("keeps the neutral profile numerically identical at every sampled amount", () => {
    for (const amount of [0, 0.01, 0.125, 0.5, 0.875, 0.99, 1]) {
      expect(mapDepthAmount(amount, NEUTRAL_PROFILE)).toBe(amount);
    }
  });

  it("applies invert, midpoint contrast, bounded exponent curve, then levels", () => {
    expect(mapDepthAmount(0.2, { ...NEUTRAL_PROFILE, invert: true })).toBe(0.8);
    expect(mapDepthAmount(0.25, { ...NEUTRAL_PROFILE, contrast: 2 })).toBe(0);
    expect(mapDepthAmount(0.75, { ...NEUTRAL_PROFILE, contrast: 2 })).toBe(1);
    expect(mapDepthAmount(0.25, { ...NEUTRAL_PROFILE, contrast: 0 })).toBe(0.5);

    expect(depthCurveExponent(-1)).toBe(0.25);
    expect(depthCurveExponent(0)).toBe(1);
    expect(depthCurveExponent(1)).toBe(4);
    expect(mapDepthAmount(0.5, { ...NEUTRAL_PROFILE, curve: -1 }))
      .toBeCloseTo(Math.pow(0.5, 0.25), 14);
    expect(mapDepthAmount(0.5, { ...NEUTRAL_PROFILE, curve: 1 }))
      .toBe(0.0625);

    const fourLevels = { ...NEUTRAL_PROFILE, levels: 4 };
    expect([0, 0.18, 0.49, 0.51, 0.82, 1].map((amount) =>
      mapDepthAmount(amount, fourLevels)))
      .toEqual([0, 1 / 3, 1 / 3, 2 / 3, 2 / 3, 1]);
  });

  it("is deterministic, clamps normalized inputs, and clamps local millimetres once", () => {
    const profile: DepthProfileConfig = {
      invert: true,
      contrast: 1.8,
      curve: 0.42,
      levels: 9,
    };
    const first = Array.from({ length: 101 }, (_, index) =>
      mapDepthAmount(index / 100, profile));
    const second = Array.from({ length: 101 }, (_, index) =>
      mapDepthAmount(index / 100, profile));
    expect(second).toEqual(first);
    expect(mapDepthAmount(-50, NEUTRAL_PROFILE)).toBe(0);
    expect(mapDepthAmount(50, NEUTRAL_PROFILE)).toBe(1);

    const depth = createDepthMapper(NEUTRAL_PROFILE, 2.4, 17.6);
    expect(depth.minimumHeightMm).toBe(2.4);
    expect(depth.maximumHeightMm).toBe(20);
    expect(depth.heightMm(0.5, 3)).toBeCloseTo(14.2, 12);
    expect(depth.heightMm(0.9, 200)).toBe(20);
    expect(depth.heightMm(0.1, -200)).toBe(2.4);
  });

  it("preserves the exact pre-profile mesh when a schema-2 recipe migrates", () => {
    const migrated = generateWallArt({
      schemaVersion: 2,
      seed: "schema-2-neutral-mesh",
      source: { kind: "procedural" },
      design: { family: "folded-flow", variation: 0 },
      grid: { columns: 1, rows: 1, tileSizeMm: 20, gapMm: 1 },
      tile: {
        shape: "folded-ridge",
        baseHeightMm: 2,
        reliefHeightMm: 10,
      },
      pattern: { kind: "flat" },
    });
    const mesh = migrated.tiles[0].mesh;
    const shoulder = 7 * 0.28;

    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.config.depthProfile).toEqual(NEUTRAL_PROFILE);
    expect(mesh.vertices).toEqual([
      { x: -10, y: -10, z: 0 },
      { x: 10, y: -10, z: 0 },
      { x: 10, y: 10, z: 0 },
      { x: -10, y: 10, z: 0 },
      { x: -10, y: -10, z: shoulder },
      { x: 10, y: -10, z: shoulder },
      { x: 10, y: 10, z: shoulder },
      { x: -10, y: 10, z: shoulder },
      { x: -10, y: -0, z: 7 },
      { x: 10, y: 0, z: 7 },
    ]);
    expect(mesh.triangles).toEqual([
      [0, 2, 1], [0, 3, 2], [4, 5, 9], [4, 9, 8],
      [8, 9, 6], [8, 6, 7], [0, 1, 5], [0, 5, 4],
      [1, 2, 6], [1, 6, 9], [1, 9, 5], [2, 3, 7],
      [2, 7, 6], [3, 0, 4], [3, 4, 8], [3, 8, 7],
    ]);
  });

  it("keeps guide Raise positive and Cut negative after inversion and quantization", () => {
    const common = {
      seed: "depth-guide-order",
      design: { family: "folded-flow" as const, variation: 0 },
      grid: { columns: 1, rows: 1, tileSizeMm: 24, gapMm: 1 },
      tile: {
        shape: "folded-ridge" as const,
        baseHeightMm: 2,
        reliefHeightMm: 18,
      },
      pattern: { kind: "flat" as const },
      depthProfile: { invert: true, contrast: 1, curve: 0, levels: 4 },
    };
    const baseline = generateWallArt(common).tiles[0].heightMm;
    const withGuide = (heightDeltaMm: number) => generateWallArt({
      ...common,
      guides: {
        lines: [{
          id: "depth-line",
          closed: false,
          points: [{ x: -0.8, y: 0 }, { x: 0.8, y: 0 }],
          effects: { heightDeltaMm, followStrength: 0 },
        }],
        followStrength: 0,
      },
    }).tiles[0].heightMm;

    expect(withGuide(3) - baseline).toBeCloseTo(3, 12);
    expect(withGuide(-3) - baseline).toBeCloseTo(-3, 12);
  });
});

const FAMILY_CASES: ReadonlyArray<{
  family: DesignFamilyKind;
  shape: TileShapeKind;
}> = [
  { family: "folded-flow", shape: "folded-ridge" },
  { family: "sampled-blocks", shape: "surface-column" },
  { family: "triangular-current", shape: "triangle-sail" },
  { family: "polar-bloom", shape: "polar-wedge" },
  { family: "cellular-crystal", shape: "cell-crystal" },
  { family: "hex-canopy", shape: "hex-folded-fan" },
  { family: "coral-cluster", shape: "ring-pod" },
  { family: "contour-relief", shape: "relief-panel" },
  { family: "silhouette-mosaic", shape: "mixed-block" },
];

describe.each(FAMILY_CASES)("$family depth-profile integration", ({ family, shape }) => {
  it("stays deterministic, finite, bounded, and closed at profile extremes", () => {
    const recipe = {
      seed: `depth-profile-${family}`,
      design: {
        family,
        silhouette: "rectangle" as const,
        variation: 0.7,
        symmetry: 4,
        surfaceResolution: 5,
      },
      grid: { columns: 2, rows: 2, tileSizeMm: 18, gapMm: 1.5 },
      tile: {
        shape,
        baseHeightMm: 2,
        reliefHeightMm: 12,
        topScale: 0.4,
        leanRatio: 0.1,
        twistDeg: 20,
      },
      pattern: { kind: "vortex" as const },
      depthProfile: { invert: true, contrast: 2, curve: 1, levels: 16 },
    };
    const first = generateWallArt(recipe);
    const second = generateWallArt(recipe);

    expect(second).toEqual(first);
    expect(first.tiles.length).toBeGreaterThan(0);
    expect(first.diagnostics.allTilesClosedManifold).toBe(true);
    for (const tile of first.tiles) {
      expect(tile.diagnostics.nonFiniteVertexCount).toBe(0);
      expect(tile.diagnostics.invalidTriangleIndexCount).toBe(0);
      expect(tile.diagnostics.boundaryEdgeCount).toBe(0);
      expect(tile.diagnostics.nonManifoldEdgeCount).toBe(0);
      expect(tile.diagnostics.outwardWinding).toBe(true);
      expect(tile.heightMm).toBeGreaterThanOrEqual(2 - 1e-10);
      expect(tile.heightMm).toBeLessThanOrEqual(14 + 1e-10);
    }
  });
});
