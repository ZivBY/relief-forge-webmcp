import {
  DEPTH_PAINT_LONG_EDGE_PX,
  DEPTH_PAINT_MAX_ABS_MM,
  DEPTH_PAINT_UNITS_PER_MM,
  createDepthPaintFieldAsset,
  validateDepthPaintFieldAsset,
} from "./field";
import type { DepthPaintFieldAsset } from "./field";

export const MIN_DEPTH_PAINT_BRUSH_SIZE = 4 / DEPTH_PAINT_LONG_EDGE_PX;
export const MAX_DEPTH_PAINT_BRUSH_SIZE = 2;
export const MIN_DEPTH_PAINT_BRUSH_STRENGTH_MM = 1 / DEPTH_PAINT_UNITS_PER_MM;
export const MAX_DEPTH_PAINT_BRUSH_STRENGTH_MM = DEPTH_PAINT_MAX_ABS_MM;
export const MAX_DEPTH_PAINT_STROKE_POINTS = 512;

export type DepthPaintBrushMode = "raise" | "cut" | "smooth" | "erase";

export interface DepthPaintPoint {
  readonly x: number;
  readonly y: number;
}

export interface DepthPaintBrush {
  readonly mode: DepthPaintBrushMode;
  /** Brush diameter relative to the artwork's long edge. */
  readonly size: number;
  /** 0 gives a fully soft radial falloff; 1 gives a hard edge. */
  readonly hardness: number;
  /** Maximum signed change per stroke; mode selects the direction/operation. */
  readonly strengthMm: number;
}

const BRUSH_MODES = new Set<DepthPaintBrushMode>(["raise", "cut", "smooth", "erase"]);
const MAX_STORED_UNITS = DEPTH_PAINT_MAX_ABS_MM * DEPTH_PAINT_UNITS_PER_MM;

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite; received ${String(value)}.`);
  }
}

function validatePoint(point: DepthPaintPoint, name: string): void {
  assertFinite(`${name}.x`, point.x);
  assertFinite(`${name}.y`, point.y);
  if (point.x < -1 || point.x > 1 || point.y < -1 || point.y > 1) {
    throw new Error(`${name} must stay inside the normalized [-1, 1] artwork domain.`);
  }
}

export function validateDepthPaintBrush(brush: DepthPaintBrush): void {
  if (!BRUSH_MODES.has(brush.mode)) {
    throw new Error("Depth-paint brush mode is not supported.");
  }
  assertFinite("brush.size", brush.size);
  if (brush.size < MIN_DEPTH_PAINT_BRUSH_SIZE || brush.size > MAX_DEPTH_PAINT_BRUSH_SIZE) {
    throw new Error(
      `brush.size must stay between ${MIN_DEPTH_PAINT_BRUSH_SIZE} and ${MAX_DEPTH_PAINT_BRUSH_SIZE}.`,
    );
  }
  assertFinite("brush.hardness", brush.hardness);
  if (brush.hardness < 0 || brush.hardness > 1) {
    throw new Error("brush.hardness must stay between 0 and 1.");
  }
  assertFinite("brush.strengthMm", brush.strengthMm);
  if (
    brush.strengthMm < 0 ||
    (brush.strengthMm > 0 && brush.strengthMm < MIN_DEPTH_PAINT_BRUSH_STRENGTH_MM) ||
    brush.strengthMm > MAX_DEPTH_PAINT_BRUSH_STRENGTH_MM
  ) {
    throw new Error(
      `brush.strengthMm must be zero or stay between ${MIN_DEPTH_PAINT_BRUSH_STRENGTH_MM} and ${MAX_DEPTH_PAINT_BRUSH_STRENGTH_MM} mm.`,
    );
  }
}

export function validateDepthPaintStroke(points: readonly DepthPaintPoint[]): void {
  if (!Array.isArray(points) || points.length === 0) {
    throw new Error("A depth-paint stroke needs at least one point.");
  }
  if (points.length > MAX_DEPTH_PAINT_STROKE_POINTS) {
    throw new Error(`A depth-paint stroke can contain at most ${MAX_DEPTH_PAINT_STROKE_POINTS} points.`);
  }
  points.forEach((point, index) => validatePoint(point, `points[${index}]`));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function smootherstep(value: number): number {
  const amount = clamp(value, 0, 1);
  return amount * amount * amount * (amount * (amount * 6 - 15) + 10);
}

function roundSymmetrically(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

function brushInfluence(normalizedDistance: number, hardness: number): number {
  if (normalizedDistance >= 1) return 0;
  if (hardness === 1 || normalizedDistance <= hardness) return 1;
  return 1 - smootherstep((normalizedDistance - hardness) / (1 - hardness));
}

interface RasterPoint {
  readonly x: number;
  readonly y: number;
}

function toRasterPoint(
  point: DepthPaintPoint,
  width: number,
  height: number,
): RasterPoint {
  return {
    x: (point.x + 1) / 2 * (width - 1),
    // +Y-down artwork coordinates intentionally map directly to raster rows.
    y: (point.y + 1) / 2 * (height - 1),
  };
}

function pointSegmentDistance(
  x: number,
  y: number,
  start: RasterPoint,
  end: RasterPoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(x - start.x, y - start.y);
  const amount = clamp(((x - start.x) * dx + (y - start.y) * dy) / lengthSquared, 0, 1);
  return Math.hypot(x - (start.x + dx * amount), y - (start.y + dy * amount));
}

function rasterizeStrokeCoverage(
  width: number,
  height: number,
  points: readonly DepthPaintPoint[],
  brush: DepthPaintBrush,
): Float32Array {
  const coverage = new Float32Array(width * height);
  const rasterPoints = points.map((point) => toRasterPoint(point, width, height));
  const longEdgeSpan = Math.max(width - 1, height - 1, 1);
  const radius = brush.size * longEdgeSpan / 4;
  const segmentCount = Math.max(1, rasterPoints.length - 1);

  for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
    const start = rasterPoints[segmentIndex] ?? rasterPoints[0];
    const end = rasterPoints[segmentIndex + 1] ?? start;
    const minX = Math.max(0, Math.floor(Math.min(start.x, end.x) - radius));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(start.x, end.x) + radius));
    const minY = Math.max(0, Math.floor(Math.min(start.y, end.y) - radius));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(start.y, end.y) + radius));

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const influence = brushInfluence(
          pointSegmentDistance(x, y, start, end) / radius,
          brush.hardness,
        );
        const index = y * width + x;
        if (influence > coverage[index]) coverage[index] = influence;
      }
    }
  }
  return coverage;
}

function neighborhoodAverage(
  values: Int16Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  let total = 0;
  let count = 0;
  for (let sampleY = Math.max(0, y - 1); sampleY <= Math.min(height - 1, y + 1); sampleY += 1) {
    for (let sampleX = Math.max(0, x - 1); sampleX <= Math.min(width - 1, x + 1); sampleX += 1) {
      total += values[sampleY * width + sampleX];
      count += 1;
    }
  }
  return total / count;
}

/**
 * Rasterize an entire polyline as one deterministic stroke. Coverage is the
 * maximum distance-field influence, so redundant pointer samples do not build
 * accidental extra strength and event frequency cannot change opacity.
 */
export function applyDepthPaintStroke(
  asset: DepthPaintFieldAsset,
  points: readonly DepthPaintPoint[],
  brush: DepthPaintBrush,
): DepthPaintFieldAsset {
  validateDepthPaintFieldAsset(asset);
  validateDepthPaintStroke(points);
  validateDepthPaintBrush(brush);
  if (brush.strengthMm === 0) return asset;

  const coverage = rasterizeStrokeCoverage(asset.width, asset.height, points, brush);
  const source = asset.values;
  const values = source.slice();
  const strengthUnits = Math.round(brush.strengthMm * DEPTH_PAINT_UNITS_PER_MM);
  let changed = false;

  for (let index = 0; index < coverage.length; index += 1) {
    const influence = coverage[index];
    if (influence === 0) continue;
    const current = source[index];
    let next = current;

    if (brush.mode === "raise" || brush.mode === "cut") {
      const direction = brush.mode === "raise" ? 1 : -1;
      next = current + direction * strengthUnits * influence;
    } else if (brush.mode === "erase") {
      const eraseAmount = Math.min(Math.abs(current), strengthUnits) * influence;
      next = current - Math.sign(current) * eraseAmount;
    } else {
      const x = index % asset.width;
      const y = Math.floor(index / asset.width);
      const target = neighborhoodAverage(source, asset.width, asset.height, x, y);
      const limitedDelta = clamp(target - current, -strengthUnits, strengthUnits);
      next = current + limitedDelta * influence;
    }

    const quantized = clamp(roundSymmetrically(next), -MAX_STORED_UNITS, MAX_STORED_UNITS);
    if (quantized !== current) {
      values[index] = quantized;
      changed = true;
    }
  }

  return changed ? createDepthPaintFieldAsset(asset.width, asset.height, values) : asset;
}

/** Convenience wrapper for a single deterministic brush dab. */
export function applyDepthPaintBrush(
  asset: DepthPaintFieldAsset,
  point: DepthPaintPoint,
  brush: DepthPaintBrush,
): DepthPaintFieldAsset {
  return applyDepthPaintStroke(asset, [point], brush);
}
