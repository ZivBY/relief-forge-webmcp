import { describe, expect, it } from "vitest";
import {
  applyGuideHeightModulation,
  applyGuideReliefModulation,
  createGuidePolyline,
  guideFollowAngle,
  normalizePointerSamples,
  polylineLength,
  preparePointerGuide,
  resamplePolyline,
  sampleGuideField,
  simplifyPolyline,
  slopeSafeGuideAmplitudeMm,
} from "./guide-fields";

describe("pointer guide preparation", () => {
  it("normalizes browser coordinates into the art domain with Y pointing up", () => {
    const points = normalizePointerSamples(
      [
        { clientX: 100, clientY: 50 },
        { clientX: 200, clientY: 100 },
        { clientX: 300, clientY: 150 },
        { clientX: 500, clientY: 300 },
      ],
      { left: 100, top: 50, width: 200, height: 100 },
    );
    expect(points).toEqual([
      { x: -1, y: 1 },
      { x: 0, y: 0 },
      { x: 1, y: -1 },
    ]);
  });

  it("simplifies redundant samples while retaining meaningful corners", () => {
    expect(
      simplifyPolyline(
        [
          { x: -1, y: 0 },
          { x: -0.5, y: 0.001 },
          { x: 0, y: 0 },
          { x: 0.5, y: -0.001 },
          { x: 1, y: 0 },
        ],
        0.01,
      ),
    ).toEqual([
      { x: -1, y: 0 },
      { x: 1, y: 0 },
    ]);
    const corner = simplifyPolyline(
      [
        { x: -1, y: 0 },
        { x: -0.5, y: 0 },
        { x: 0, y: 0.7 },
        { x: 0.5, y: 0 },
        { x: 1, y: 0 },
      ],
      0.02,
    );
    expect(corner).toContainEqual({ x: 0, y: 0.7 });
    expect(corner[0]).toEqual({ x: -1, y: 0 });
    expect(corner[corner.length - 1]).toEqual({ x: 1, y: 0 });
  });

  it("resamples by arc length with stable exact open endpoints", () => {
    const points = resamplePolyline(
      [
        { x: -1, y: 0 },
        { x: 1, y: 0 },
      ],
      0.5,
    );
    expect(points).toEqual([
      { x: -1, y: 0 },
      { x: -0.5, y: 0 },
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 1, y: 0 },
    ]);
  });

  it("prepares the same compact guide for repeated pointer input", () => {
    const samples = Array.from({ length: 41 }, (_, index) => {
      const amount = index / 40;
      return {
        clientX: amount * 400,
        clientY: 100 + Math.sin(amount * Math.PI) * 70,
      };
    });
    const options = {
      id: "drawn-flow",
      simplifyTolerance: 0.006,
      resampleSpacing: 0.08,
    } as const;
    const first = preparePointerGuide(
      samples,
      { left: 0, top: 0, width: 400, height: 300 },
      options,
    );
    const second = preparePointerGuide(
      samples,
      { left: 0, top: 0, width: 400, height: 300 },
      options,
    );
    expect(second).toEqual(first);
    expect(first.points.length).toBeGreaterThan(10);
    expect(first.points.length).toBeLessThan(samples.length);
    expect(first.points.every((point) => Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1)).toBe(
      true,
    );
    expect(polylineLength(first)).toBeGreaterThan(2);
  });

  it("rejects non-manufacturable or malformed guide inputs", () => {
    expect(() => createGuidePolyline("", [{ x: 0, y: 0 }, { x: 1, y: 1 }])).toThrow(
      /non-empty id/,
    );
    expect(() => createGuidePolyline("short", [{ x: 0, y: 0 }])).toThrow(
      /at least 2/,
    );
    expect(() =>
      createGuidePolyline("outside", [
        { x: 0, y: 0 },
        { x: 1.01, y: 0 },
      ]),
    ).toThrow(/outside/);
    expect(() =>
      createGuidePolyline("nan", [
        { x: 0, y: 0 },
        { x: Number.NaN, y: 0 },
      ]),
    ).toThrow(/finite/);
  });
});

describe("guide distance and influence fields", () => {
  const horizontal = createGuidePolyline("horizontal", [
    { x: -1, y: 0 },
    { x: 1, y: 0 },
  ]);

  it("returns nearest distance, tangent, normal and smooth unsigned influence", () => {
    const sample = sampleGuideField([horizontal], { x: 0.2, y: 0.25 }, {
      radius: 0.5,
      mode: "unsigned",
    });
    expect(sample.closestPoint.x).toBeCloseTo(0.2, 12);
    expect(sample.closestPoint.y).toBeCloseTo(0, 12);
    expect(sample.distance).toBeCloseTo(0.25, 12);
    expect(sample.signedDistance).toBeCloseTo(0.25, 12);
    expect(sample.tangent).toEqual({ x: 1, y: 0 });
    expect(sample.normal.x).toBeCloseTo(0, 12);
    expect(sample.normal.y).toBeCloseTo(1, 12);
    expect(sample.influence).toBeCloseTo(0.5, 12);
    expect(sample.modulation).toBeCloseTo(0.5, 12);
    expect(sample.withinInfluence).toBe(true);

    const outside = sampleGuideField([horizontal], { x: 0, y: 0.6 }, { radius: 0.5 });
    expect(outside.influence).toBe(0);
    expect(outside.modulation).toBe(0);
    expect(outside.withinInfluence).toBe(false);
  });

  it("creates a continuous antisymmetric signed field across the guide", () => {
    const above = sampleGuideField([horizontal], { x: 0, y: 0.1 }, {
      radius: 0.3,
      mode: "signed",
    });
    const below = sampleGuideField([horizontal], { x: 0, y: -0.1 }, {
      radius: 0.3,
      mode: "signed",
    });
    const center = sampleGuideField([horizontal], { x: 0, y: 0 }, {
      radius: 0.3,
      mode: "signed",
    });
    expect(above.modulation).toBeCloseTo(1, 12);
    expect(below.modulation).toBeCloseTo(-1, 12);
    expect(center.modulation).toBe(0);
    expect(above.modulation).toBeCloseTo(-below.modulation, 12);
  });

  it("uses stable guide and segment ordering to break exact distance ties", () => {
    const vertical = createGuidePolyline("vertical", [
      { x: 0, y: -1 },
      { x: 0, y: 1 },
    ]);
    const sample = sampleGuideField(
      [horizontal, vertical],
      { x: 0.2, y: 0.2 },
      { radius: 0.5 },
    );
    expect(sample.guideIndex).toBe(0);
    expect(sample.segmentIndex).toBe(0);
  });

  it("supports a physical metric for rectangular art without distorting distance or angle", () => {
    const diagonal = createGuidePolyline("physical-diagonal", [
      { x: -1, y: -1 },
      { x: 1, y: 1 },
    ]);
    const diagonalSample = sampleGuideField([diagonal], { x: 0, y: 0 }, {
      radius: 20,
      coordinateScale: { x: 200, y: 100 },
    });
    expect(guideFollowAngle(diagonalSample)).toBeCloseTo(Math.atan2(1, 2), 12);

    const physicalDistance = sampleGuideField([horizontal], { x: 0, y: 0.1 }, {
      radius: 10,
      coordinateScale: { x: 200, y: 50 },
    });
    expect(physicalDistance.distance).toBeCloseTo(5, 12);
    expect(physicalDistance.influence).toBeCloseTo(0.5, 12);
  });

  it("applies height and depth locally under explicit Z safety bounds", () => {
    const ridge = sampleGuideField([horizontal], { x: 0, y: 0 }, {
      radius: 0.2,
      strength: 1,
    });
    const raised = applyGuideHeightModulation(3, ridge, {
      amplitudeMm: 5,
      minHeightMm: 2,
      maxHeightMm: 10,
      maxAbsoluteDeltaMm: 2,
    });
    expect(raised).toEqual({
      heightMm: 5,
      appliedDeltaMm: 2,
      requestedDeltaMm: 5,
      clamped: true,
    });

    const channel = sampleGuideField([horizontal], { x: 0, y: 0 }, {
      radius: 0.2,
      strength: -1,
    });
    const cut = applyGuideHeightModulation(3, channel, {
      amplitudeMm: 4,
      minHeightMm: 1.2,
      maxHeightMm: 8,
    });
    expect(cut.heightMm).toBe(1.2);
    expect(cut.appliedDeltaMm).toBeCloseTo(-1.8, 12);
    expect(cut.clamped).toBe(true);
    expect(applyGuideReliefModulation(0.6, channel, 0.25)).toBeCloseTo(0.35, 12);
  });

  it("exposes tangent-follow rotation and slope-derived amplitude ceilings", () => {
    const diagonal = createGuidePolyline("diagonal", [
      { x: -0.5, y: -0.5 },
      { x: 0.5, y: 0.5 },
    ]);
    const field = sampleGuideField([diagonal], { x: 0, y: 0 }, { radius: 0.2 });
    expect(guideFollowAngle(field)).toBeCloseTo(Math.PI / 4, 12);
    expect(guideFollowAngle(field, "normal")).toBeCloseTo((Math.PI * 3) / 4, 12);
    expect(slopeSafeGuideAmplitudeMm(10, 45, "unsigned")).toBeCloseTo(10 / 1.875, 12);
    expect(slopeSafeGuideAmplitudeMm(10, 45, "signed")).toBeCloseTo(10 / 6.75, 12);
  });
});
