import { sampleGuideField, createGuidePolyline } from "./guide-fields";
import type {
  GuidePolyline,
  NormalizedPoint,
} from "./guide-fields";
import { deterministicUnit, fbmNoise2D } from "./random";
import type { Seed } from "./types";

export type CatalogGapSystemId =
  | "quantized-liquid-panels"
  | "curvature-following-panels"
  | "radial-fracture-shards"
  | "layered-contour-tunnels";

export interface CatalogGapSystemCandidate {
  readonly id: CatalogGapSystemId;
  readonly label: string;
  readonly catalogTaxon: string;
  readonly catalogCoverageSignal: string;
  readonly geometrySystem: string;
  readonly manufacturingGate: string;
  readonly readiness: "field-ready" | "topology-research" | "separate-manufacturing-engine";
}

/**
 * Clean-room system candidates derived from catalog-level taxa and coverage
 * counts, not from proprietary meshes, coordinates, palettes or templates.
 */
export const CATALOG_GAP_SYSTEM_CANDIDATES: readonly CatalogGapSystemCandidate[] = [
  {
    id: "quantized-liquid-panels",
    label: "Layer-quantized liquid panels",
    catalogTaxon: "quantized-liquid-heightmap",
    catalogCoverageSignal: "8 of 54 audited 3D-model listings",
    geometrySystem:
      "One continuous seeded scalar field quantized to printer-layer-aligned Z bands, then panelized without changing seam samples.",
    manufacturingGate:
      "Band heights must align to the selected layer height; seams need shared samples and each panel needs a minimum backing thickness.",
    readiness: "field-ready",
  },
  {
    id: "curvature-following-panels",
    label: "Curvature-following ribbon panels",
    catalogTaxon: "segmented-organic-surface",
    catalogCoverageSignal: "3 of 54 audited 3D-model listings",
    geometrySystem:
      "A continuous relief plus guide/vector field whose seams follow low-curvature flow ribbons instead of a rectangular carrier grid.",
    manufacturingGate:
      "Requires robust surface partitioning, keyed seam generation, minimum panel neck width and per-part orientation checks.",
    readiness: "topology-research",
  },
  {
    id: "radial-fracture-shards",
    label: "Radial fracture and shard networks",
    catalogTaxon: "fracture-field",
    catalogCoverageSignal: "2 audited design codes",
    geometrySystem:
      "A deterministic radial crack graph drives channels, bulge relief and eventually unique polygonal shard boundaries.",
    manufacturingGate:
      "Crack width, acute shard tips, minimum shard area, numbering and true-shape nesting must be bounded before polygon export.",
    readiness: "field-ready",
  },
  {
    id: "layered-contour-tunnels",
    label: "Registered contour-tunnel stacks",
    catalogTaxon: "layered-cut-sheet",
    catalogCoverageSignal: "35 audited designs across the full catalog",
    geometrySystem:
      "Successive registered 2D profiles create tunnels, bowls and parallax as an ordered sheet stack rather than STL tiles.",
    manufacturingGate:
      "Needs kerf compensation, cut/fold semantics, registration features, sheet ordering and a laser/CNC export path.",
    readiness: "separate-manufacturing-engine",
  },
] as const;

export interface QuantizedLiquidFieldOptions {
  readonly seed: Seed;
  readonly frequency?: number;
  readonly octaves?: number;
  readonly bandCount: number;
  readonly minHeightMm: number;
  readonly maxHeightMm: number;
  readonly layerHeightMm: number;
}

export interface QuantizedLiquidFieldSample {
  readonly rawValue: number;
  readonly quantizedValue: number;
  readonly bandIndex: number;
  readonly layerIndex: number;
  readonly heightMm: number;
}

export interface RadialFractureFieldOptions {
  readonly seed: Seed;
  readonly center?: NormalizedPoint;
  readonly armCount?: number;
  readonly segmentsPerArm?: number;
  readonly maximumRadius?: number;
  readonly angularJitterRad?: number;
  readonly branchProbability?: number;
  /** Caller converts this normalized half-width from its finished art size. */
  readonly crackHalfWidth?: number;
  readonly crackDepth?: number;
  readonly bulgeStrength?: number;
  readonly baseHeight?: number;
  readonly minimumHeight?: number;
}

export interface RadialFractureGraph {
  readonly seed: Seed;
  readonly center: NormalizedPoint;
  readonly maximumRadius: number;
  readonly crackHalfWidth: number;
  readonly crackDepth: number;
  readonly bulgeStrength: number;
  readonly baseHeight: number;
  readonly minimumHeight: number;
  readonly guides: readonly GuidePolyline[];
}

export interface RadialFractureFieldSample {
  readonly height: number;
  readonly crackInfluence: number;
  readonly distanceToCrack: number;
  readonly bulge: number;
  readonly tangent: NormalizedPoint;
  readonly nearestGuideIndex: number;
}

const EPSILON = 1e-9;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite; received ${String(value)}.`);
  }
}

function assertNormalizedPoint(name: string, point: NormalizedPoint): void {
  assertFinite(`${name}.x`, point.x);
  assertFinite(`${name}.y`, point.y);
  if (point.x < -1 || point.x > 1 || point.y < -1 || point.y > 1) {
    throw new Error(`${name} must stay inside the normalized [-1, 1] art domain.`);
  }
}

function assertUnitInterval(name: string, value: number): void {
  assertFinite(name, value);
  if (value < 0 || value > 1) throw new Error(`${name} must be between 0 and 1.`);
}

function validateQuantizedOptions(options: QuantizedLiquidFieldOptions): {
  availableLayerSteps: number;
  frequency: number;
  octaves: number;
} {
  assertFinite("minHeightMm", options.minHeightMm);
  assertFinite("maxHeightMm", options.maxHeightMm);
  assertFinite("layerHeightMm", options.layerHeightMm);
  if (options.minHeightMm < 0) throw new Error("minHeightMm cannot be negative.");
  if (!(options.maxHeightMm > options.minHeightMm)) {
    throw new Error("maxHeightMm must be greater than minHeightMm.");
  }
  if (!(options.layerHeightMm > 0)) throw new Error("layerHeightMm must be greater than zero.");
  if (!Number.isInteger(options.bandCount) || options.bandCount < 2 || options.bandCount > 64) {
    throw new Error("bandCount must be an integer from 2 through 64.");
  }
  const availableLayerSteps = Math.floor(
    (options.maxHeightMm - options.minHeightMm) / options.layerHeightMm + EPSILON,
  );
  if (availableLayerSteps < options.bandCount - 1) {
    throw new Error("The requested Z range has too few printer layers for distinct bands.");
  }
  const frequency = options.frequency ?? 1.7;
  const octaves = options.octaves ?? 4;
  assertFinite("frequency", frequency);
  if (!(frequency > 0)) throw new Error("frequency must be greater than zero.");
  if (!Number.isInteger(octaves) || octaves < 1 || octaves > 8) {
    throw new Error("octaves must be an integer from 1 through 8.");
  }
  return { availableLayerSteps, frequency, octaves };
}

/**
 * Continuous liquid field quantized to real layer-aligned Z values. Sampling
 * uses global normalized coordinates, so adjacent panels get identical seams.
 */
export function sampleQuantizedLiquidField(
  point: NormalizedPoint,
  options: QuantizedLiquidFieldOptions,
): QuantizedLiquidFieldSample {
  assertNormalizedPoint("point", point);
  const { availableLayerSteps, frequency, octaves } = validateQuantizedOptions(options);
  const warpX = fbmNoise2D(
    `${String(options.seed)}:liquid-warp-x`,
    point.x * frequency * 0.72 + 3.1,
    point.y * frequency * 0.72 - 1.7,
    3,
    2,
    0.5,
  );
  const warpY = fbmNoise2D(
    `${String(options.seed)}:liquid-warp-y`,
    point.x * frequency * 0.72 - 2.4,
    point.y * frequency * 0.72 + 4.2,
    3,
    2,
    0.5,
  );
  const liquid = fbmNoise2D(
    `${String(options.seed)}:liquid-body`,
    (point.x + warpX * 0.24) * frequency,
    (point.y + warpY * 0.24) * frequency,
    octaves,
    2,
    0.52,
  );
  const directionalSwell = Math.sin(
    (point.x * 0.78 + point.y * 0.36 + warpY * 0.2) * Math.PI * 2,
  );
  const rawValue = clamp(0.5 + liquid * 0.68 + directionalSwell * 0.12, 0, 1);
  const bandIndex = Math.min(
    options.bandCount - 1,
    Math.floor(rawValue * options.bandCount),
  );
  const quantizedValue = bandIndex / (options.bandCount - 1);
  const layerIndex = Math.round(quantizedValue * availableLayerSteps);
  return {
    rawValue,
    quantizedValue,
    bandIndex,
    layerIndex,
    heightMm: options.minHeightMm + layerIndex * options.layerHeightMm,
  };
}

function validateFractureOptions(options: RadialFractureFieldOptions): {
  center: NormalizedPoint;
  armCount: number;
  segmentsPerArm: number;
  maximumRadius: number;
  angularJitterRad: number;
  branchProbability: number;
  crackHalfWidth: number;
  crackDepth: number;
  bulgeStrength: number;
  baseHeight: number;
  minimumHeight: number;
} {
  const center = options.center ?? { x: 0, y: 0 };
  assertNormalizedPoint("center", center);
  const armCount = options.armCount ?? 8;
  const segmentsPerArm = options.segmentsPerArm ?? 5;
  const maximumRadius = options.maximumRadius ?? 0.88;
  const angularJitterRad = options.angularJitterRad ?? 0.24;
  const branchProbability = options.branchProbability ?? 0.62;
  const crackHalfWidth = options.crackHalfWidth ?? 0.055;
  const crackDepth = options.crackDepth ?? 0.42;
  const bulgeStrength = options.bulgeStrength ?? 0.56;
  const baseHeight = options.baseHeight ?? 0.28;
  const minimumHeight = options.minimumHeight ?? 0.08;

  if (!Number.isInteger(armCount) || armCount < 3 || armCount > 24) {
    throw new Error("armCount must be an integer from 3 through 24.");
  }
  if (!Number.isInteger(segmentsPerArm) || segmentsPerArm < 2 || segmentsPerArm > 16) {
    throw new Error("segmentsPerArm must be an integer from 2 through 16.");
  }
  assertFinite("maximumRadius", maximumRadius);
  if (!(maximumRadius > 0)) throw new Error("maximumRadius must be greater than zero.");
  if (
    Math.abs(center.x) + maximumRadius > 1 + EPSILON ||
    Math.abs(center.y) + maximumRadius > 1 + EPSILON
  ) {
    throw new Error("center plus maximumRadius must remain inside the normalized art domain.");
  }
  assertFinite("angularJitterRad", angularJitterRad);
  if (angularJitterRad < 0 || angularJitterRad > Math.PI / 2) {
    throw new Error("angularJitterRad must be between 0 and pi/2.");
  }
  assertUnitInterval("branchProbability", branchProbability);
  assertFinite("crackHalfWidth", crackHalfWidth);
  if (!(crackHalfWidth > 0) || crackHalfWidth > 0.4) {
    throw new Error("crackHalfWidth must be greater than 0 and at most 0.4.");
  }
  assertUnitInterval("crackDepth", crackDepth);
  assertUnitInterval("bulgeStrength", bulgeStrength);
  assertUnitInterval("baseHeight", baseHeight);
  assertUnitInterval("minimumHeight", minimumHeight);
  if (minimumHeight > baseHeight) {
    throw new Error("minimumHeight cannot exceed baseHeight.");
  }
  return {
    center,
    armCount,
    segmentsPerArm,
    maximumRadius,
    angularJitterRad,
    branchProbability,
    crackHalfWidth,
    crackDepth,
    bulgeStrength,
    baseHeight,
    minimumHeight,
  };
}

function clampToFractureRadius(
  point: NormalizedPoint,
  center: NormalizedPoint,
  maximumRadius: number,
): NormalizedPoint {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const radialDistance = Math.hypot(dx, dy);
  if (radialDistance <= maximumRadius) return point;
  const scale = maximumRadius / radialDistance;
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

/** Build the stable guide graph once, then sample it repeatedly for a mesh. */
export function createRadialFractureGraph(
  options: RadialFractureFieldOptions,
): RadialFractureGraph {
  const validated = validateFractureOptions(options);
  const guides: GuidePolyline[] = [];
  const globalPhase =
    deterministicUnit(options.seed, "fracture-global-phase") * Math.PI * 2;

  for (let arm = 0; arm < validated.armCount; arm += 1) {
    const baseAngle = globalPhase + (arm / validated.armCount) * Math.PI * 2;
    const radialWeights = Array.from(
      { length: validated.segmentsPerArm },
      (_, step) =>
        0.78 +
        deterministicUnit(options.seed, "fracture-radius-step", arm, step) * 0.44,
    );
    const totalWeight = radialWeights.reduce((sum, weight) => sum + weight, 0);
    let accumulatedWeight = 0;
    const points: NormalizedPoint[] = [{ ...validated.center }];
    for (let step = 1; step <= validated.segmentsPerArm; step += 1) {
      accumulatedWeight += radialWeights[step - 1];
      const radialFraction = accumulatedWeight / totalWeight;
      const angle =
        baseAngle +
        (deterministicUnit(options.seed, "fracture-angle", arm, step) - 0.5) *
          validated.angularJitterRad *
          (0.5 + radialFraction * 0.5);
      const radius = validated.maximumRadius * radialFraction;
      points.push({
        x: validated.center.x + Math.cos(angle) * radius,
        y: validated.center.y + Math.sin(angle) * radius,
      });
    }
    const mainGuide = createGuidePolyline(`fracture-arm-${arm + 1}`, points);
    guides.push(mainGuide);

    if (
      deterministicUnit(options.seed, "fracture-branch-enabled", arm) <
      validated.branchProbability
    ) {
      const anchorIndex = clamp(
        1 +
          Math.floor(
            deterministicUnit(options.seed, "fracture-branch-anchor", arm) *
              Math.max(1, validated.segmentsPerArm - 2),
          ),
        1,
        validated.segmentsPerArm - 1,
      );
      const anchor = points[anchorIndex];
      const incoming = points[anchorIndex - 1];
      const incomingAngle = Math.atan2(anchor.y - incoming.y, anchor.x - incoming.x);
      const side =
        deterministicUnit(options.seed, "fracture-branch-side", arm) < 0.5 ? -1 : 1;
      const branchAngle =
        incomingAngle +
        side *
          (0.38 +
            deterministicUnit(options.seed, "fracture-branch-angle", arm) * 0.48);
      const branchLength =
        validated.maximumRadius *
        (0.14 +
          deterministicUnit(options.seed, "fracture-branch-length", arm) * 0.14);
      const branchPoints: NormalizedPoint[] = [anchor];
      for (let step = 1; step <= 2; step += 1) {
        const amount = step / 2;
        const bend =
          (deterministicUnit(options.seed, "fracture-branch-bend", arm, step) - 0.5) *
          validated.angularJitterRad;
        branchPoints.push(
          clampToFractureRadius(
            {
              x: anchor.x + Math.cos(branchAngle + bend) * branchLength * amount,
              y: anchor.y + Math.sin(branchAngle + bend) * branchLength * amount,
            },
            validated.center,
            validated.maximumRadius,
          ),
        );
      }
      guides.push(createGuidePolyline(`fracture-branch-${arm + 1}`, branchPoints));
    }
  }

  return {
    seed: options.seed,
    center: validated.center,
    maximumRadius: validated.maximumRadius,
    crackHalfWidth: validated.crackHalfWidth,
    crackDepth: validated.crackDepth,
    bulgeStrength: validated.bulgeStrength,
    baseHeight: validated.baseHeight,
    minimumHeight: validated.minimumHeight,
    guides,
  };
}

/** Sample a smooth relief precursor; later polygonization can reuse the graph. */
export function sampleRadialFractureField(
  graph: RadialFractureGraph,
  point: NormalizedPoint,
): RadialFractureFieldSample {
  assertNormalizedPoint("point", point);
  const guideField = sampleGuideField(graph.guides, point, {
    radius: graph.crackHalfWidth,
    mode: "unsigned",
  });
  const radialDistance =
    Math.hypot(point.x - graph.center.x, point.y - graph.center.y) /
    graph.maximumRadius;
  const bulge = Math.max(0, 1 - radialDistance * radialDistance) ** 2;
  const texture =
    fbmNoise2D(
      `${String(graph.seed)}:fracture-relief`,
      point.x * 2.2 + 1.3,
      point.y * 2.2 - 2.7,
      3,
      2,
      0.5,
    ) * 0.045;
  const height = clamp(
    graph.baseHeight + graph.bulgeStrength * bulge + texture - graph.crackDepth * guideField.influence,
    graph.minimumHeight,
    1,
  );
  return {
    height,
    crackInfluence: guideField.influence,
    distanceToCrack: guideField.distance,
    bulge,
    tangent: guideField.tangent,
    nearestGuideIndex: guideField.guideIndex,
  };
}
