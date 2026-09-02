import { describe, expect, it } from "vitest";

import {
  MAX_DEPTH_PAINT_STROKE_POINTS,
  MIN_DEPTH_PAINT_BRUSH_STRENGTH_MM,
  MIN_DEPTH_PAINT_BRUSH_SIZE,
  applyDepthPaintBrush,
  applyDepthPaintStroke,
  validateDepthPaintBrush,
  validateDepthPaintStroke,
} from "./brush";
import type { DepthPaintBrush } from "./brush";
import {
  createDepthPaintField,
  createDepthPaintFieldAsset,
} from "./field";

const RAISE: DepthPaintBrush = {
  mode: "raise",
  size: 0.1,
  hardness: 1,
  strengthMm: 10,
};

function maximum(values: Int16Array): number {
  let result = Number.NEGATIVE_INFINITY;
  for (const value of values) result = Math.max(result, value);
  return result;
}

function minimum(values: Int16Array): number {
  let result = Number.POSITIVE_INFINITY;
  for (const value of values) result = Math.min(result, value);
  return result;
}

describe("depth-paint brushes", () => {
  it("rasterizes raise and cut strokes deterministically", () => {
    const field = createDepthPaintField(64);
    const points = [{ x: -0.4, y: -0.2 }, { x: 0.4, y: 0.2 }];
    const first = applyDepthPaintStroke(field, points, RAISE);
    const second = applyDepthPaintStroke(field, points, RAISE);
    expect(second.sha256).toBe(first.sha256);
    expect(second.values).toEqual(first.values);
    expect(maximum(first.values)).toBe(1_000);

    const restored = applyDepthPaintStroke(first, points, { ...RAISE, mode: "cut" });
    expect(restored.values).toEqual(field.values);
    expect(restored.sha256).toBe(field.sha256);
  });

  it("makes pointer sampling density irrelevant for the same collinear path", () => {
    const field = createDepthPaintField(64);
    const direct = applyDepthPaintStroke(
      field,
      [{ x: -0.7, y: 0 }, { x: 0.7, y: 0 }],
      RAISE,
    );
    const redundant = applyDepthPaintStroke(
      field,
      [{ x: -0.7, y: 0 }, { x: 0, y: 0 }, { x: 0.7, y: 0 }],
      RAISE,
    );
    expect(redundant.values).toEqual(direct.values);
    expect(redundant.sha256).toBe(direct.sha256);
  });

  it("maps negative Y to top rows and positive Y to bottom rows", () => {
    const field = createDepthPaintField(1 / 64);
    const painted = applyDepthPaintBrush(field, { x: 0, y: -0.8 }, RAISE);
    const rowMax = (row: number) => {
      let value = 0;
      for (let x = 0; x < painted.width; x += 1) {
        value = Math.max(value, painted.values[row * painted.width + x]);
      }
      return value;
    };
    expect(rowMax(0)).toBe(0);
    expect(rowMax(Math.round(0.1 * (painted.height - 1)))).toBe(1_000);
    expect(rowMax(painted.height - 1)).toBe(0);
  });

  it("uses hardness to distinguish a soft falloff from a hard brush", () => {
    const field = createDepthPaintField(64);
    const hard = applyDepthPaintBrush(field, { x: 0, y: 0 }, RAISE);
    const soft = applyDepthPaintBrush(
      field,
      { x: 0, y: 0 },
      { ...RAISE, hardness: 0 },
    );
    const hardValues = new Set(hard.values);
    const softValues = new Set(soft.values);
    expect(hardValues).toEqual(new Set([0, 1_000]));
    expect([...softValues].some((value) => value > 0 && value < 1_000)).toBe(true);
    expect(maximum(soft.values)).toBeLessThanOrEqual(maximum(hard.values));
  });

  it("smooths toward a stable neighborhood and erases toward zero", () => {
    const values = new Int16Array(512 * 8);
    const centerIndex = 4 * 512 + 256;
    values[centerIndex] = 10_000;
    const field = createDepthPaintFieldAsset(512, 8, values);
    const smoothed = applyDepthPaintBrush(field, { x: 0, y: 0 }, {
      mode: "smooth",
      size: 0.1,
      hardness: 1,
      strengthMm: 200,
    });
    expect(smoothed.values[centerIndex]).toBeLessThan(values[centerIndex]);
    expect(smoothed.values[centerIndex - 1]).toBeGreaterThan(0);

    const erased = applyDepthPaintBrush(smoothed, { x: 0, y: 0 }, {
      mode: "erase",
      size: 0.1,
      hardness: 1,
      strengthMm: 5,
    });
    expect(Math.abs(erased.values[centerIndex])).toBeLessThan(Math.abs(smoothed.values[centerIndex]));
  });

  it("saturates only the canonical paint field storage boundary", () => {
    const maximumField = createDepthPaintField(64, 200);
    const minimumField = createDepthPaintField(64, -200);
    const raised = applyDepthPaintBrush(maximumField, { x: 0, y: 0 }, RAISE);
    const cut = applyDepthPaintBrush(minimumField, { x: 0, y: 0 }, { ...RAISE, mode: "cut" });
    expect(maximum(raised.values)).toBe(20_000);
    expect(minimum(cut.values)).toBe(-20_000);
    expect(raised.sha256).toBe(maximumField.sha256);
    expect(cut.sha256).toBe(minimumField.sha256);
  });

  it("enforces brush and stroke workload boundaries", () => {
    expect(() => validateDepthPaintBrush({ ...RAISE, size: MIN_DEPTH_PAINT_BRUSH_SIZE })).not.toThrow();
    expect(() => validateDepthPaintBrush({ ...RAISE, size: MIN_DEPTH_PAINT_BRUSH_SIZE - 0.0001 })).toThrow(/brush.size/);
    expect(() => validateDepthPaintBrush({ ...RAISE, size: 2.001 })).toThrow(/brush.size/);
    expect(() => validateDepthPaintBrush({ ...RAISE, hardness: -0.01 })).toThrow(/hardness/);
    expect(() => validateDepthPaintBrush({
      ...RAISE,
      strengthMm: MIN_DEPTH_PAINT_BRUSH_STRENGTH_MM / 2,
    })).toThrow(/strengthMm/);
    expect(() => validateDepthPaintBrush({ ...RAISE, strengthMm: 200.01 })).toThrow(/strengthMm/);
    expect(() => validateDepthPaintStroke([])).toThrow(/at least one/);
    expect(() => validateDepthPaintStroke([{ x: 0, y: 1.001 }])).toThrow(/\[-1, 1\]/);
    expect(() => validateDepthPaintStroke(
      Array.from({ length: MAX_DEPTH_PAINT_STROKE_POINTS + 1 }, () => ({ x: 0, y: 0 })),
    )).toThrow(/at most 512/);

    const field = createDepthPaintField(512);
    expect(applyDepthPaintBrush(field, { x: 0, y: 0 }, { ...RAISE, strengthMm: 0 })).toBe(field);
  });
});
