import { describe, expect, it } from "vitest";

import type { NormalizedPoint } from "./guide-fields";
import {
  createGuidePresetGeometry,
  rebuildGuidePath,
  type GuidePresetKind,
} from "./guide-presets";

const PRESET_KINDS: GuidePresetKind[] = [
  "line",
  "arc",
  "circle",
  "ellipse",
  "square",
  "triangle",
  "diamond",
  "s-curve",
];

const CLOSED_KINDS = new Set<GuidePresetKind>([
  "circle",
  "ellipse",
  "square",
  "triangle",
  "diamond",
]);

function bounds(points: readonly NormalizedPoint[]) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    minimumX: Math.min(...xs),
    maximumX: Math.max(...xs),
    minimumY: Math.min(...ys),
    maximumY: Math.max(...ys),
  };
}

function maximumSegmentLength(points: readonly NormalizedPoint[], closed: boolean): number {
  const count = closed ? points.length : points.length - 1;
  return Math.max(...Array.from({ length: count }, (_, index) => {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    return Math.hypot(end.x - start.x, end.y - start.y);
  }));
}

function physicalBounds(
  points: readonly NormalizedPoint[],
  widthMm: number,
  depthMm: number,
) {
  const measured = bounds(points);
  return {
    widthMm: (measured.maximumX - measured.minimumX) * widthMm / 2,
    depthMm: (measured.maximumY - measured.minimumY) * depthMm / 2,
  };
}

describe("guide preset geometry", () => {
  it("creates every documented preset deterministically with valid metadata", () => {
    for (const kind of PRESET_KINDS) {
      const first = createGuidePresetGeometry(kind, { widthMm: 600, depthMm: 240 });
      const second = createGuidePresetGeometry(kind, { widthMm: 600, depthMm: 240 });
      expect(second).toEqual(first);
      expect(first.kind).toBe(kind);
      expect(first.label.length).toBeGreaterThan(0);
      expect(first.closed).toBe(CLOSED_KINDS.has(kind));
      expect(first.controlPoints.length).toBeGreaterThanOrEqual(first.closed ? 3 : 2);
      expect(first.points.length).toBeGreaterThan(first.controlPoints.length);
      expect(first.curve).toBe(
        kind === "arc" || kind === "circle" || kind === "ellipse" || kind === "s-curve"
          ? "smooth"
          : "linear",
      );
    }
  });

  it("keeps every preset comfortably inset, centered, and densely sampled", () => {
    for (const kind of PRESET_KINDS) {
      const geometry = createGuidePresetGeometry(kind, { widthMm: 420, depthMm: 260 });
      for (const point of [...geometry.controlPoints, ...geometry.points]) {
        expect(Number.isFinite(point.x)).toBe(true);
        expect(Number.isFinite(point.y)).toBe(true);
        expect(Math.abs(point.x)).toBeLessThanOrEqual(0.75);
        expect(Math.abs(point.y)).toBeLessThanOrEqual(0.75);
      }
      expect(maximumSegmentLength(geometry.points, geometry.closed)).toBeLessThanOrEqual(0.04);

      const controlCenter = geometry.controlPoints.reduce(
        (sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }),
        { x: 0, y: 0 },
      );
      // Open arc handles are symmetric in X and vertically centered by bounds;
      // the other presets are point-symmetric or centroid-centered.
      expect(controlCenter.x / geometry.controlPoints.length).toBeCloseTo(0, 12);
      const measured = bounds(geometry.controlPoints);
      expect(measured.minimumX + measured.maximumX).toBeCloseTo(0, 12);
      if (kind === "triangle") {
        // An equilateral triangle is centered on its centroid; its circumcircle
        // and axis-aligned Y bounds cannot both be centered simultaneously.
        expect(controlCenter.y / geometry.controlPoints.length).toBeCloseTo(0, 12);
      } else {
        expect(measured.minimumY + measured.maximumY).toBeCloseTo(0, 12);
      }
    }
  });

  it("represents closure without duplicating the first sampled point", () => {
    for (const kind of CLOSED_KINDS) {
      const geometry = createGuidePresetGeometry(kind, { widthMm: 400, depthMm: 250 });
      expect(geometry.points[geometry.points.length - 1]).not.toEqual(geometry.points[0]);
      const closingDistance = Math.hypot(
        geometry.points[0].x - geometry.points[geometry.points.length - 1].x,
        geometry.points[0].y - geometry.points[geometry.points.length - 1].y,
      );
      expect(closingDistance).toBeLessThanOrEqual(0.04);
    }
  });

  it("makes circle and square physically isotropic on non-square artwork", () => {
    const dimensions = { widthMm: 900, depthMm: 240 };
    const circle = createGuidePresetGeometry("circle", dimensions);
    const square = createGuidePresetGeometry("square", dimensions);
    const circleSize = physicalBounds(circle.points, dimensions.widthMm, dimensions.depthMm);
    const squareSize = physicalBounds(square.points, dimensions.widthMm, dimensions.depthMm);

    expect(circleSize.widthMm).toBeCloseTo(circleSize.depthMm, 6);
    expect(squareSize.widthMm).toBeCloseTo(squareSize.depthMm, 10);
    expect(bounds(circle.controlPoints).maximumX).toBeLessThan(0.2);
    expect(bounds(circle.controlPoints).maximumY).toBeCloseTo(0.68, 12);

    const physicalRadii = circle.points.map((point) => Math.hypot(
      point.x * dimensions.widthMm / 2,
      point.y * dimensions.depthMm / 2,
    ));
    const minimumRadius = Math.min(...physicalRadii);
    const maximumRadius = Math.max(...physicalRadii);
    expect((maximumRadius - minimumRadius) / maximumRadius).toBeLessThan(0.004);
  });

  it("retains normalized proportions for the general ellipse preset", () => {
    const wide = createGuidePresetGeometry("ellipse", { widthMm: 800, depthMm: 200 });
    const tall = createGuidePresetGeometry("ellipse", { widthMm: 200, depthMm: 800 });
    expect(wide.controlPoints).toEqual(tall.controlPoints);
    const measured = bounds(wide.controlPoints);
    expect(measured.maximumX).toBeCloseTo(0.68, 12);
    expect(measured.maximumY).toBeCloseTo(0.44, 12);
  });

  it("rejects unusable physical dimensions", () => {
    expect(() => createGuidePresetGeometry("circle", { widthMm: 0, depthMm: 200 })).toThrow(
      /widthMm/,
    );
    expect(() => createGuidePresetGeometry("circle", { widthMm: 200, depthMm: Infinity })).toThrow(
      /depthMm/,
    );
  });
});

describe("editable guide path rebuilding", () => {
  it("densifies straight paths without rounding or dropping their corners", () => {
    const controls = [
      { x: -0.6, y: -0.4 },
      { x: 0.5, y: -0.4 },
      { x: 0.5, y: 0.6 },
      { x: -0.6, y: 0.6 },
    ];
    const path = rebuildGuidePath(controls, true, "linear", 0.08);
    for (const control of controls) expect(path).toContainEqual(control);
    expect(maximumSegmentLength(path, true)).toBeLessThanOrEqual(0.08 + 1e-12);

    for (const point of path) {
      const onVerticalEdge = point.x === -0.6 || point.x === 0.5;
      const onHorizontalEdge = point.y === -0.4 || point.y === 0.6;
      expect(onVerticalEdge || onHorizontalEdge).toBe(true);
    }
  });

  it("rebuilds a deterministic smooth path after an edit while preserving open endpoints", () => {
    const preset = createGuidePresetGeometry("arc", { widthMm: 400, depthMm: 300 });
    const moved = preset.controlPoints.map((point, index) =>
      index === 2 ? { x: point.x + 0.12, y: point.y + 0.2 } : { ...point },
    );
    const first = rebuildGuidePath(moved, false, "smooth", 0.03);
    const second = rebuildGuidePath(moved, false, "smooth", 0.03);

    expect(second).toEqual(first);
    expect(first).not.toEqual(preset.points);
    expect(first[0]).toEqual(moved[0]);
    expect(first[first.length - 1]).toEqual(moved[moved.length - 1]);
    expect(Math.max(...first.map((point) => point.y))).toBeGreaterThan(
      Math.max(...preset.points.map((point) => point.y)) + 0.15,
    );
    expect(maximumSegmentLength(first, false)).toBeLessThanOrEqual(0.031);
    expect(first.every((point) => Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1)).toBe(true);
  });

  it("clips smooth interpolation overshoot to the editable art domain", () => {
    const points = rebuildGuidePath(
      [
        { x: -1, y: -0.8 },
        { x: -0.9, y: 1 },
        { x: 0.9, y: 1 },
        { x: 1, y: -0.8 },
      ],
      false,
      "smooth",
      0.025,
    );
    expect(points.every((point) => point.x >= -1 && point.x <= 1)).toBe(true);
    expect(points.every((point) => point.y >= -1 && point.y <= 1)).toBe(true);
  });

  it("rejects malformed handles and invalid sampling", () => {
    expect(() => rebuildGuidePath([{ x: 0, y: 0 }], false, "linear")).toThrow(/at least 2/);
    expect(() => rebuildGuidePath([
      { x: 0, y: 0 },
      { x: 1.01, y: 0 },
    ], false, "linear")).toThrow(/outside/);
    expect(() => rebuildGuidePath([
      { x: 0, y: 0 },
      { x: 0.5, y: Number.NaN },
    ], false, "smooth")).toThrow(/finite/);
    expect(() => rebuildGuidePath([
      { x: -0.5, y: 0 },
      { x: 0.5, y: 0 },
    ], false, "linear", 0)).toThrow(/spacing/);
  });
});
