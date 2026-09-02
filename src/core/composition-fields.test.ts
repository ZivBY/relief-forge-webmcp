import { describe, expect, it } from "vitest";
import {
  CATALOG_GAP_SYSTEM_CANDIDATES,
  createRadialFractureGraph,
  sampleQuantizedLiquidField,
  sampleRadialFractureField,
} from "./composition-fields";
import { polylineLength } from "./guide-fields";

describe("catalog-gap geometry system candidates", () => {
  it("keeps four distinct clean-room systems with explicit manufacturing gates", () => {
    expect(CATALOG_GAP_SYSTEM_CANDIDATES).toHaveLength(4);
    expect(new Set(CATALOG_GAP_SYSTEM_CANDIDATES.map((candidate) => candidate.id)).size).toBe(4);
    expect(
      CATALOG_GAP_SYSTEM_CANDIDATES.filter((candidate) => candidate.readiness === "field-ready"),
    ).toHaveLength(2);
    expect(
      new Set(CATALOG_GAP_SYSTEM_CANDIDATES.map((candidate) => candidate.geometrySystem)),
    ).toHaveLength(4);
    for (const candidate of CATALOG_GAP_SYSTEM_CANDIDATES) {
      expect(candidate.catalogTaxon.length).toBeGreaterThan(0);
      expect(candidate.catalogCoverageSignal.length).toBeGreaterThan(0);
      expect(candidate.manufacturingGate.length).toBeGreaterThan(40);
    }
  });
});

describe("layer-quantized liquid field", () => {
  const options = {
    seed: "quantized-liquid-contract",
    frequency: 1.8,
    octaves: 4,
    bandCount: 7,
    minHeightMm: 2.4,
    maxHeightMm: 16.4,
    layerHeightMm: 0.2,
  } as const;

  it("is deterministic, bounded and aligned to real printer layers", () => {
    const samples = Array.from({ length: 21 * 17 }, (_, index) => {
      const column = index % 21;
      const row = Math.floor(index / 21);
      return sampleQuantizedLiquidField(
        { x: (column / 20) * 2 - 1, y: (row / 16) * 2 - 1 },
        options,
      );
    });
    const repeated = Array.from({ length: 21 * 17 }, (_, index) => {
      const column = index % 21;
      const row = Math.floor(index / 21);
      return sampleQuantizedLiquidField(
        { x: (column / 20) * 2 - 1, y: (row / 16) * 2 - 1 },
        options,
      );
    });
    expect(repeated).toEqual(samples);
    expect(new Set(samples.map((sample) => sample.bandIndex)).size).toBeGreaterThan(3);
    expect(new Set(samples.map((sample) => sample.heightMm)).size).toBeLessThanOrEqual(
      options.bandCount,
    );
    for (const sample of samples) {
      expect(sample.rawValue).toBeGreaterThanOrEqual(0);
      expect(sample.rawValue).toBeLessThanOrEqual(1);
      expect(sample.quantizedValue).toBe(sample.bandIndex / (options.bandCount - 1));
      expect(sample.heightMm).toBeGreaterThanOrEqual(options.minHeightMm);
      expect(sample.heightMm).toBeLessThanOrEqual(options.maxHeightMm);
      expect((sample.heightMm - options.minHeightMm) / options.layerHeightMm).toBeCloseTo(
        sample.layerIndex,
        10,
      );
      expect(Number.isInteger(sample.layerIndex)).toBe(true);
    }
  });

  it("samples global coordinates identically across hypothetical panel seams", () => {
    const seamPoint = { x: 0.125, y: -0.375 };
    const leftPanelEdge = sampleQuantizedLiquidField(seamPoint, options);
    const rightPanelEdge = sampleQuantizedLiquidField({ ...seamPoint }, options);
    expect(rightPanelEdge).toEqual(leftPanelEdge);
  });

  it("changes with seed and rejects impossible layer-band requests", () => {
    const points = [
      { x: -0.7, y: -0.4 },
      { x: 0.2, y: -0.1 },
      { x: 0.65, y: 0.72 },
    ];
    const first = points.map((point) => sampleQuantizedLiquidField(point, options));
    const alternate = points.map((point) =>
      sampleQuantizedLiquidField(point, { ...options, seed: "alternate-liquid" }),
    );
    expect(alternate).not.toEqual(first);
    expect(() =>
      sampleQuantizedLiquidField(
        { x: 0, y: 0 },
        {
          ...options,
          bandCount: 12,
          minHeightMm: 2,
          maxHeightMm: 3,
          layerHeightMm: 0.2,
        },
      ),
    ).toThrow(/too few printer layers/);
  });
});

describe("radial fracture field", () => {
  const options = {
    seed: "fracture-graph-contract",
    center: { x: 0, y: 0 },
    armCount: 7,
    segmentsPerArm: 5,
    maximumRadius: 0.82,
    angularJitterRad: 0.25,
    branchProbability: 1,
    crackHalfWidth: 0.045,
    crackDepth: 0.48,
    bulgeStrength: 0.5,
    baseHeight: 0.3,
    minimumHeight: 0.08,
  } as const;

  it("builds a deterministic bounded graph with stable main arms and branches", () => {
    const graph = createRadialFractureGraph(options);
    expect(createRadialFractureGraph(options)).toEqual(graph);
    expect(createRadialFractureGraph({ ...options, seed: "alternate-fracture" })).not.toEqual(
      graph,
    );
    expect(graph.guides).toHaveLength(options.armCount * 2);
    expect(new Set(graph.guides.map((guide) => guide.id)).size).toBe(graph.guides.length);
    for (const guide of graph.guides) {
      expect(polylineLength(guide)).toBeGreaterThan(0.03);
      for (const point of guide.points) {
        expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
        expect(Math.abs(point.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(point.y)).toBeLessThanOrEqual(1);
        expect(Math.hypot(point.x - graph.center.x, point.y - graph.center.y)).toBeLessThanOrEqual(
          graph.maximumRadius + 1e-9,
        );
      }
    }
  });

  it("cuts a localized smooth channel while retaining a bounded bulge field", () => {
    const graph = createRadialFractureGraph(options);
    const main = graph.guides[0];
    const start = main.points[1];
    const end = main.points[2];
    const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const segmentLength = Math.hypot(end.x - start.x, end.y - start.y);
    const normal = {
      x: -(end.y - start.y) / segmentLength,
      y: (end.x - start.x) / segmentLength,
    };
    const outsideChannel = {
      x: midpoint.x + normal.x * graph.crackHalfWidth * 1.8,
      y: midpoint.y + normal.y * graph.crackHalfWidth * 1.8,
    };
    const onCrack = sampleRadialFractureField(graph, midpoint);
    const offCrack = sampleRadialFractureField(graph, outsideChannel);
    expect(onCrack.crackInfluence).toBeCloseTo(1, 10);
    expect(offCrack.crackInfluence).toBeLessThan(0.1);
    expect(onCrack.height).toBeLessThan(offCrack.height);
    expect(onCrack.distanceToCrack).toBeCloseTo(0, 10);
    expect(Math.hypot(onCrack.tangent.x, onCrack.tangent.y)).toBeCloseTo(1, 12);
  });

  it("stays finite and manufacturing-bounded across the full art domain", () => {
    const graph = createRadialFractureGraph(options);
    const samples = Array.from({ length: 25 * 25 }, (_, index) => {
      const column = index % 25;
      const row = Math.floor(index / 25);
      return sampleRadialFractureField(graph, {
        x: (column / 24) * 2 - 1,
        y: (row / 24) * 2 - 1,
      });
    });
    expect(samples.some((sample) => sample.crackInfluence > 0.9)).toBe(true);
    expect(samples.some((sample) => sample.crackInfluence === 0)).toBe(true);
    for (const sample of samples) {
      expect(Number.isFinite(sample.height)).toBe(true);
      expect(sample.height).toBeGreaterThanOrEqual(graph.minimumHeight);
      expect(sample.height).toBeLessThanOrEqual(1);
      expect(sample.crackInfluence).toBeGreaterThanOrEqual(0);
      expect(sample.crackInfluence).toBeLessThanOrEqual(1);
      expect(sample.bulge).toBeGreaterThanOrEqual(0);
      expect(sample.bulge).toBeLessThanOrEqual(1);
    }
  });
});
