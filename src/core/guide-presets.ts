import type { NormalizedPoint } from "./guide-fields";
import { resamplePolyline } from "./guide-fields";

export type GuidePresetKind =
  | "line"
  | "arc"
  | "circle"
  | "ellipse"
  | "square"
  | "triangle"
  | "diamond"
  | "s-curve";

export type GuideCurveKind = "linear" | "smooth";

export interface GuidePresetGeometry {
  kind: GuidePresetKind;
  label: string;
  closed: boolean;
  curve: GuideCurveKind;
  controlPoints: NormalizedPoint[];
  points: NormalizedPoint[];
}

export interface GuidePresetDimensions {
  widthMm: number;
  depthMm: number;
}

interface GuidePresetDefinition {
  label: string;
  closed: boolean;
  curve: GuideCurveKind;
  controlPoints: (dimensions: GuidePresetDimensions) => NormalizedPoint[];
}

const DEFAULT_SPACING = 0.035;
const PRESET_INSET = 0.68;
const EPSILON = 1e-9;
const MAX_REBUILD_SEGMENTS = 8_192;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function distance(left: NormalizedPoint, right: NormalizedPoint): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function samePoint(left: NormalizedPoint, right: NormalizedPoint): boolean {
  return distance(left, right) <= EPSILON;
}

function assertFinitePositive(name: string, value: number): void {
  if (!Number.isFinite(value) || !(value > 0)) {
    throw new Error(`${name} must be a finite number greater than zero.`);
  }
}

function validateDimensions(dimensions: GuidePresetDimensions): void {
  assertFinitePositive("widthMm", dimensions.widthMm);
  assertFinitePositive("depthMm", dimensions.depthMm);
}

function normalizeControlPoints(
  input: readonly NormalizedPoint[],
  closed: boolean,
): NormalizedPoint[] {
  const result: NormalizedPoint[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const point = input[index];
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new Error(`controlPoints[${index}] must contain finite coordinates.`);
    }
    if (point.x < -1 || point.x > 1 || point.y < -1 || point.y > 1) {
      throw new Error(`controlPoints[${index}] is outside the normalized [-1, 1] art domain.`);
    }
    const copy = { x: point.x, y: point.y };
    if (result.length === 0 || !samePoint(result[result.length - 1], copy)) {
      result.push(copy);
    }
  }
  if (closed && result.length > 1 && samePoint(result[0], result[result.length - 1])) {
    result.pop();
  }
  const minimum = closed ? 3 : 2;
  if (result.length < minimum) {
    throw new Error(
      `A ${closed ? "closed" : "open"} guide path needs at least ${minimum} distinct control points.`,
    );
  }
  return result;
}

function assertSampleBudget(segmentCount: number): void {
  if (!Number.isFinite(segmentCount) || segmentCount > MAX_REBUILD_SEGMENTS) {
    throw new Error(
      `Guide path sampling would exceed the ${MAX_REBUILD_SEGMENTS.toLocaleString()} segment limit.`,
    );
  }
}

/**
 * Piecewise resampling for straight-edged presets. Each control point remains
 * an exact sampled corner instead of being skipped by whole-path resampling.
 */
function rebuildLinearPath(
  controlPoints: readonly NormalizedPoint[],
  closed: boolean,
  spacing: number,
): NormalizedPoint[] {
  const segmentCount = closed ? controlPoints.length : controlPoints.length - 1;
  const stepsPerSegment = Array.from({ length: segmentCount }, (_, index) => {
    const start = controlPoints[index];
    const end = controlPoints[(index + 1) % controlPoints.length];
    return Math.max(1, Math.ceil(distance(start, end) / spacing));
  });
  assertSampleBudget(stepsPerSegment.reduce((total, steps) => total + steps, 0));

  const result: NormalizedPoint[] = [];
  for (let index = 0; index < segmentCount; index += 1) {
    const start = controlPoints[index];
    const end = controlPoints[(index + 1) % controlPoints.length];
    const steps = stepsPerSegment[index];
    for (let step = 0; step < steps; step += 1) {
      const amount = step / steps;
      result.push({
        x: start.x + (end.x - start.x) * amount,
        y: start.y + (end.y - start.y) * amount,
      });
    }
  }
  if (!closed) result.push({ ...controlPoints[controlPoints.length - 1] });
  return result;
}

function catmullRomCoordinate(
  before: number,
  start: number,
  end: number,
  after: number,
  amount: number,
): number {
  const amountSquared = amount * amount;
  const amountCubed = amountSquared * amount;
  return 0.5 * (
    2 * start +
    (-before + end) * amount +
    (2 * before - 5 * start + 4 * end - after) * amountSquared +
    (-before + 3 * start - 3 * end + after) * amountCubed
  );
}

function smoothPoint(
  controlPoints: readonly NormalizedPoint[],
  segmentIndex: number,
  amount: number,
  closed: boolean,
): NormalizedPoint {
  const count = controlPoints.length;
  const index = (value: number) => {
    if (closed) return (value + count) % count;
    return clamp(value, 0, count - 1);
  };
  const before = controlPoints[index(segmentIndex - 1)];
  const start = controlPoints[index(segmentIndex)];
  const end = controlPoints[index(segmentIndex + 1)];
  const after = controlPoints[index(segmentIndex + 2)];
  return {
    // A handle may be dragged onto an art boundary. Catmull-Rom can overshoot
    // its handles, so the final editable path is clipped to the valid domain.
    x: clamp(
      catmullRomCoordinate(before.x, start.x, end.x, after.x, amount),
      -1,
      1,
    ),
    y: clamp(
      catmullRomCoordinate(before.y, start.y, end.y, after.y, amount),
      -1,
      1,
    ),
  };
}

function rebuildSmoothPath(
  controlPoints: readonly NormalizedPoint[],
  closed: boolean,
  spacing: number,
): NormalizedPoint[] {
  const segmentCount = closed ? controlPoints.length : controlPoints.length - 1;
  const subdivisions = Array.from({ length: segmentCount }, (_, index) => {
    const chord = distance(
      controlPoints[index],
      controlPoints[(index + 1) % controlPoints.length],
    );
    return Math.max(12, Math.ceil(chord / (spacing / 4)));
  });
  assertSampleBudget(subdivisions.reduce((total, count) => total + count, 0));

  const result: NormalizedPoint[] = [];
  for (let index = 0; index < segmentCount; index += 1) {
    const count = subdivisions[index];
    const denseSegment: NormalizedPoint[] = [];
    for (let step = 0; step <= count; step += 1) {
      denseSegment.push(smoothPoint(controlPoints, index, step / count, closed));
    }
    const sampledSegment = resamplePolyline(denseSegment, spacing, false);
    sampledSegment[0] = { ...controlPoints[index] };
    sampledSegment[sampledSegment.length - 1] = {
      ...controlPoints[(index + 1) % controlPoints.length],
    };
    result.push(...sampledSegment.slice(index === 0 ? 0 : 1));
  }
  if (closed && result.length > 1 && samePoint(result[0], result[result.length - 1])) {
    result.pop();
  }
  assertSampleBudget(result.length);
  return result;
}

/** Rebuild the dense guide path after one or more editable handles move. */
export function rebuildGuidePath(
  controlPoints: readonly NormalizedPoint[],
  closed: boolean,
  curve: GuideCurveKind,
  spacing = DEFAULT_SPACING,
): NormalizedPoint[] {
  assertFinitePositive("spacing", spacing);
  const normalized = normalizeControlPoints(controlPoints, closed);
  return curve === "linear"
    ? rebuildLinearPath(normalized, closed, spacing)
    : rebuildSmoothPath(normalized, closed, spacing);
}

function physicalRoundRadii({ widthMm, depthMm }: GuidePresetDimensions): NormalizedPoint {
  const shortestAxisMm = Math.min(widthMm, depthMm);
  return {
    x: PRESET_INSET * shortestAxisMm / widthMm,
    y: PRESET_INSET * shortestAxisMm / depthMm,
  };
}

function ringControls(radiusX: number, radiusY: number, count = 8): NormalizedPoint[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = index * Math.PI * 2 / count;
    return {
      x: radiusX * Math.cos(angle),
      y: radiusY * Math.sin(angle),
    };
  });
}

const PRESET_DEFINITIONS: Record<GuidePresetKind, GuidePresetDefinition> = {
  line: {
    label: "Line",
    closed: false,
    curve: "linear",
    controlPoints: () => [{ x: -0.68, y: 0 }, { x: 0.68, y: 0 }],
  },
  arc: {
    label: "Arc",
    closed: false,
    curve: "smooth",
    controlPoints: () => [
      { x: -0.68, y: -0.46 },
      { x: -0.42, y: 0.12 },
      { x: 0, y: 0.46 },
      { x: 0.42, y: 0.12 },
      { x: 0.68, y: -0.46 },
    ],
  },
  circle: {
    label: "Circle",
    closed: true,
    curve: "smooth",
    controlPoints: (dimensions) => {
      const radius = physicalRoundRadii(dimensions);
      return ringControls(radius.x, radius.y, 12);
    },
  },
  ellipse: {
    label: "Ellipse",
    closed: true,
    curve: "smooth",
    controlPoints: () => ringControls(0.68, 0.44),
  },
  square: {
    label: "Square",
    closed: true,
    curve: "linear",
    controlPoints: (dimensions) => {
      const halfSize = physicalRoundRadii(dimensions);
      return [
        { x: -halfSize.x, y: -halfSize.y },
        { x: halfSize.x, y: -halfSize.y },
        { x: halfSize.x, y: halfSize.y },
        { x: -halfSize.x, y: halfSize.y },
      ];
    },
  },
  triangle: {
    label: "Triangle",
    closed: true,
    curve: "linear",
    controlPoints: (dimensions) => {
      const radius = physicalRoundRadii(dimensions);
      return [Math.PI / 2, Math.PI * 7 / 6, Math.PI * 11 / 6].map((angle) => ({
        x: radius.x * Math.cos(angle),
        y: radius.y * Math.sin(angle),
      }));
    },
  },
  diamond: {
    label: "Diamond",
    closed: true,
    curve: "linear",
    controlPoints: (dimensions) => {
      const radius = physicalRoundRadii(dimensions);
      return [
        { x: 0, y: radius.y },
        { x: -radius.x, y: 0 },
        { x: 0, y: -radius.y },
        { x: radius.x, y: 0 },
      ];
    },
  },
  "s-curve": {
    label: "S-curve",
    closed: false,
    curve: "smooth",
    controlPoints: () => [
      { x: -0.7, y: -0.44 },
      { x: -0.5, y: -0.52 },
      { x: -0.2, y: -0.16 },
      { x: 0.2, y: 0.16 },
      { x: 0.5, y: 0.52 },
      { x: 0.7, y: 0.44 },
    ],
  },
};

/** Create one centered preset with sparse handles and a dense influence path. */
export function createGuidePresetGeometry(
  kind: GuidePresetKind,
  dimensions: GuidePresetDimensions,
): GuidePresetGeometry {
  validateDimensions(dimensions);
  const definition = PRESET_DEFINITIONS[kind];
  const controlPoints = definition.controlPoints(dimensions).map((point) => ({ ...point }));
  return {
    kind,
    label: definition.label,
    closed: definition.closed,
    curve: definition.curve,
    controlPoints,
    points: rebuildGuidePath(controlPoints, definition.closed, definition.curve),
  };
}
