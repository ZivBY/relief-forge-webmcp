import { describe, expect, it } from "vitest";
import { sampleQuantizedLiquidField } from "./composition-fields";
import { createWallArtConfig } from "./config";
import {
  clearPatternFieldCaches,
  getPatternFieldCacheStats,
  samplePattern,
} from "./patterns";
import type { PatternKind, WallArtConfig } from "./types";

const NEW_PATTERN_KINDS = ["interference", "liquid", "fracture"] as const;

function makeConfig(
  kind: PatternKind,
  seed = `pattern-contract-${kind}`,
): WallArtConfig {
  return createWallArtConfig({
    seed,
    tile: { baseHeightMm: 2.4, reliefHeightMm: 12 },
    pattern: {
      kind,
      frequency: 1.35,
      amplitude: 1,
      angleDeg: 27,
      phaseDeg: 18,
      centerX: 0.08,
      centerY: -0.06,
      arms: 7,
      noiseScale: 1.7,
      octaves: 4,
      lacunarity: 2,
      gain: 0.5,
    },
    palette: {
      colors: ["#111111", "#333333", "#555555", "#777777", "#999999", "#bbbbbb", "#dddddd"],
    },
  });
}

function sampleGrid(config: WallArtConfig): ReturnType<typeof samplePattern>[] {
  return Array.from({ length: 13 * 11 }, (_, index) => {
    const column = index % 13;
    const row = Math.floor(index / 13);
    return samplePattern(config, (column / 12) * 2 - 1, (row / 10) * 2 - 1);
  });
}

describe.each(NEW_PATTERN_KINDS)("%s pattern contract", (kind) => {
  it("is deterministic, finite, bounded, directional, and seed-sensitive", () => {
    const config = makeConfig(kind);
    const first = sampleGrid(config);
    const second = sampleGrid(config);
    const alternate = sampleGrid(makeConfig(kind, `alternate-${kind}`));

    expect(second).toEqual(first);
    expect(alternate).not.toEqual(first);
    for (const sample of first) {
      expect(Number.isFinite(sample.value)).toBe(true);
      expect(Number.isFinite(sample.angleRad)).toBe(true);
      expect(sample.value).toBeGreaterThanOrEqual(-1);
      expect(sample.value).toBeLessThanOrEqual(1);
    }
    expect(Math.max(...first.map((sample) => sample.value))).toBeGreaterThan(0.15);
    expect(Math.min(...first.map((sample) => sample.value))).toBeLessThan(-0.15);
    expect(
      new Set(first.map((sample) => sample.angleRad.toFixed(3))).size,
    ).toBeGreaterThan(6);
  });

  it("honors amplitude while retaining the inclusive output bound", () => {
    const config = makeConfig(kind);
    const amplified = {
      ...config,
      pattern: { ...config.pattern, amplitude: 3.5 },
    };
    for (const sample of sampleGrid(amplified)) {
      expect(sample.value).toBeGreaterThanOrEqual(-1);
      expect(sample.value).toBeLessThanOrEqual(1);
    }
  });
});

describe("interference pattern", () => {
  it("forms a materially different beat field when source direction changes", () => {
    const first = makeConfig("interference");
    const rotated = {
      ...first,
      pattern: { ...first.pattern, angleDeg: first.pattern.angleDeg + 35 },
    };
    const firstValues = sampleGrid(first).map((sample) => sample.value);
    const rotatedValues = sampleGrid(rotated).map((sample) => sample.value);
    const meanDelta = firstValues.reduce(
      (sum, value, index) => sum + Math.abs(value - rotatedValues[index]),
      0,
    ) / firstValues.length;
    expect(meanDelta).toBeGreaterThan(0.2);
  });
});

describe("liquid pattern", () => {
  it("uses the layer-quantized liquid sampler and preserves continuous flow angles", () => {
    const config = makeConfig("liquid");
    const point = { x: 0.22, y: -0.31 };
    const centered = {
      x: point.x - config.pattern.centerX,
      y: point.y - config.pattern.centerY,
    };
    const direction = (config.pattern.angleDeg * Math.PI) / 180;
    const sampleX =
      (centered.x * Math.cos(direction) + centered.y * Math.sin(direction)) /
      Math.SQRT2;
    const sampleY =
      (-centered.x * Math.sin(direction) + centered.y * Math.cos(direction)) /
      Math.SQRT2;
    const direct = sampleQuantizedLiquidField(
      { x: sampleX, y: sampleY },
      {
        seed: `${String(config.seed)}:liquid-pattern:${config.pattern.phaseDeg}`,
        frequency:
          config.pattern.frequency *
          Math.max(0.55, Math.min(2.4, config.pattern.noiseScale * 0.62)),
        octaves: config.pattern.octaves,
        bandCount: 7,
        minHeightMm: config.tile.baseHeightMm,
        maxHeightMm: config.tile.baseHeightMm + config.tile.reliefHeightMm,
        layerHeightMm: 0.2,
      },
    );
    const throughPattern = samplePattern(config, point.x, point.y);
    expect(throughPattern.value).toBeCloseTo(direct.quantizedValue * 2 - 1, 12);
    expect(Number.isFinite(throughPattern.angleRad)).toBe(true);

    const grid = sampleGrid(config);
    expect(new Set(grid.map((sample) => sample.value)).size).toBeLessThanOrEqual(7);
    for (const sample of grid) {
      const bandPosition = ((sample.value + 1) / 2) * 6;
      expect(bandPosition).toBeCloseTo(Math.round(bandPosition), 10);
    }
    expect(new Set(grid.map((sample) => sample.angleRad.toFixed(3))).size).toBeGreaterThan(20);
  });
});

describe("fracture pattern graph cache", () => {
  it("reuses one graph across dense vertex sampling and invalidates on graph settings", () => {
    clearPatternFieldCaches();
    const config = makeConfig("fracture");
    sampleGrid(config);
    expect(getPatternFieldCacheStats()).toEqual({ fractureGraphCount: 1 });
    sampleGrid(config);
    expect(getPatternFieldCacheStats()).toEqual({ fractureGraphCount: 1 });

    const changedArms = {
      ...config,
      pattern: { ...config.pattern, arms: config.pattern.arms + 1 },
    };
    sampleGrid(changedArms);
    expect(getPatternFieldCacheStats()).toEqual({ fractureGraphCount: 2 });

    const rotationOnly = {
      ...config,
      pattern: { ...config.pattern, angleDeg: config.pattern.angleDeg + 15 },
    };
    sampleGrid(rotationOnly);
    // Rotation transforms the query/tangent and does not need a second graph.
    expect(getPatternFieldCacheStats()).toEqual({ fractureGraphCount: 2 });
  });

  it("bounds the cache during repeated interactive seed changes", () => {
    clearPatternFieldCaches();
    for (let index = 0; index < 40; index += 1) {
      samplePattern(makeConfig("fracture", `cache-seed-${index}`), 0.2, -0.1);
    }
    expect(getPatternFieldCacheStats()).toEqual({ fractureGraphCount: 32 });
  });
});
