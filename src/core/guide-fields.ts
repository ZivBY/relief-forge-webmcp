/**
 * Deterministic, normalized guide-line geometry for local composition fields.
 *
 * Coordinates use the same [-1, 1] art domain as the family generators.
 * Browser Y coordinates are inverted during normalization so +Y points up.
 */

export interface NormalizedPoint {
  readonly x: number;
  readonly y: number;
}

export interface PointerSample {
  readonly clientX: number;
  readonly clientY: number;
}

export interface PointerBounds {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface GuidePolyline {
  readonly id: string;
  readonly points: readonly NormalizedPoint[];
  readonly closed: boolean;
}

export interface PrepareGuideOptions {
  readonly id: string;
  readonly simplifyTolerance?: number;
  readonly resampleSpacing?: number;
  readonly closed?: boolean;
}

export type GuideInfluenceMode = "unsigned" | "signed";

export interface GuideFieldOptions {
  /** Influence half-width in normalized units, or scaled units when supplied. */
  readonly radius: number;
  readonly mode?: GuideInfluenceMode;
  /** Positive raises an unsigned ridge; negative cuts an unsigned channel. */
  readonly strength?: number;
  readonly falloffPower?: number;
  /**
   * Optional normalized-to-physical metric. Passing finished width/2 and
   * depth/2 in mm makes distance, radius and tangent physically isotropic.
   */
  readonly coordinateScale?: NormalizedPoint;
}

export interface GuideFieldSample {
  readonly closestPoint: NormalizedPoint;
  readonly tangent: NormalizedPoint;
  readonly normal: NormalizedPoint;
  readonly distance: number;
  readonly signedDistance: number;
  readonly normalizedDistance: number;
  readonly influence: number;
  /** Signed, strength-adjusted value intended for height/depth modulation. */
  readonly modulation: number;
  readonly guideIndex: number;
  readonly segmentIndex: number;
  readonly withinInfluence: boolean;
}

export interface HeightModulationOptions {
  readonly amplitudeMm: number;
  readonly minHeightMm: number;
  readonly maxHeightMm: number;
  /** Optional manufacturing guard independent of the artistic amplitude. */
  readonly maxAbsoluteDeltaMm?: number;
}

export interface HeightModulationResult {
  readonly heightMm: number;
  readonly appliedDeltaMm: number;
  readonly requestedDeltaMm: number;
  readonly clamped: boolean;
}

const EPSILON = 1e-12;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite; received ${String(value)}.`);
  }
}

function assertNonNegative(name: string, value: number): void {
  assertFinite(name, value);
  if (value < 0) throw new Error(`${name} cannot be negative.`);
}

function distance(left: NormalizedPoint, right: NormalizedPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function deduplicateConsecutive(
  points: readonly NormalizedPoint[],
  epsilon = 1e-9,
  closed = false,
): NormalizedPoint[] {
  const result: NormalizedPoint[] = [];
  for (const point of points) {
    const previous = result[result.length - 1];
    if (!previous || distance(previous, point) > epsilon) result.push({ ...point });
  }
  if (closed && result.length > 1 && distance(result[0], result[result.length - 1]) <= epsilon) {
    result.pop();
  }
  return result;
}

function pointSegmentDistanceSquared(
  point: NormalizedPoint,
  start: NormalizedPoint,
  end: NormalizedPoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= EPSILON) {
    const px = point.x - start.x;
    const py = point.y - start.y;
    return px * px + py * py;
  }
  const amount = clamp(
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
    0,
    1,
  );
  const closestX = start.x + dx * amount;
  const closestY = start.y + dy * amount;
  const px = point.x - closestX;
  const py = point.y - closestY;
  return px * px + py * py;
}

/** Convert viewport pointer coordinates to the normalized art domain. */
export function normalizePointerSamples(
  samples: readonly PointerSample[],
  bounds: PointerBounds,
): NormalizedPoint[] {
  assertFinite("bounds.left", bounds.left);
  assertFinite("bounds.top", bounds.top);
  assertFinite("bounds.width", bounds.width);
  assertFinite("bounds.height", bounds.height);
  if (!(bounds.width > 0) || !(bounds.height > 0)) {
    throw new Error("Pointer bounds must have positive width and height.");
  }
  return deduplicateConsecutive(
    samples.map((sample, index) => {
      assertFinite(`samples[${index}].clientX`, sample.clientX);
      assertFinite(`samples[${index}].clientY`, sample.clientY);
      return {
        x: clamp(((sample.clientX - bounds.left) / bounds.width) * 2 - 1, -1, 1),
        y: clamp(1 - ((sample.clientY - bounds.top) / bounds.height) * 2, -1, 1),
      };
    }),
  );
}

/** Stable Ramer-Douglas-Peucker simplification that preserves both endpoints. */
export function simplifyPolyline(
  input: readonly NormalizedPoint[],
  tolerance: number,
): NormalizedPoint[] {
  assertNonNegative("tolerance", tolerance);
  const points = deduplicateConsecutive(input);
  if (points.length <= 2 || tolerance === 0) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  const toleranceSquared = tolerance * tolerance;

  while (stack.length > 0) {
    const [startIndex, endIndex] = stack.pop()!;
    let furthestIndex = -1;
    let furthestDistanceSquared = toleranceSquared;
    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const candidateDistanceSquared = pointSegmentDistanceSquared(
        points[index],
        points[startIndex],
        points[endIndex],
      );
      // Strict comparison makes equal-distance tie handling stable.
      if (candidateDistanceSquared > furthestDistanceSquared) {
        furthestDistanceSquared = candidateDistanceSquared;
        furthestIndex = index;
      }
    }
    if (furthestIndex >= 0) {
      keep[furthestIndex] = 1;
      stack.push([furthestIndex, endIndex], [startIndex, furthestIndex]);
    }
  }

  return points.filter((_, index) => keep[index] === 1);
}

/** Uniform arc-length resampling, with exact endpoints retained for open lines. */
export function resamplePolyline(
  input: readonly NormalizedPoint[],
  spacing: number,
  closed = false,
): NormalizedPoint[] {
  assertFinite("spacing", spacing);
  if (!(spacing > 0)) throw new Error("spacing must be greater than zero.");
  const points = deduplicateConsecutive(input, 1e-9, closed);
  if (points.length <= 1) return points;
  const path = closed ? [...points, points[0]] : points;
  const cumulative = [0];
  for (let index = 1; index < path.length; index += 1) {
    cumulative.push(cumulative[index - 1] + distance(path[index - 1], path[index]));
  }
  const totalLength = cumulative[cumulative.length - 1];
  if (totalLength <= EPSILON) return [points[0]];

  const result: NormalizedPoint[] = [{ ...path[0] }];
  let segmentIndex = 1;
  for (let target = spacing; target < totalLength - EPSILON; target += spacing) {
    while (
      segmentIndex < cumulative.length - 1 &&
      cumulative[segmentIndex] < target
    ) {
      segmentIndex += 1;
    }
    const segmentStartLength = cumulative[segmentIndex - 1];
    const segmentLength = cumulative[segmentIndex] - segmentStartLength;
    const amount = segmentLength <= EPSILON ? 0 : (target - segmentStartLength) / segmentLength;
    const start = path[segmentIndex - 1];
    const end = path[segmentIndex];
    result.push({
      x: start.x + (end.x - start.x) * amount,
      y: start.y + (end.y - start.y) * amount,
    });
  }
  if (!closed) result.push({ ...path[path.length - 1] });
  return deduplicateConsecutive(result, 1e-9, closed);
}

export function createGuidePolyline(
  id: string,
  input: readonly NormalizedPoint[],
  closed = false,
): GuidePolyline {
  if (id.trim().length === 0) throw new Error("A guide line needs a stable non-empty id.");
  for (let index = 0; index < input.length; index += 1) {
    const point = input[index];
    assertFinite(`points[${index}].x`, point.x);
    assertFinite(`points[${index}].y`, point.y);
    if (point.x < -1 || point.x > 1 || point.y < -1 || point.y > 1) {
      throw new Error(`points[${index}] is outside the normalized [-1, 1] art domain.`);
    }
  }
  const points = deduplicateConsecutive(input, 1e-9, closed);
  if (points.length < (closed ? 3 : 2)) {
    throw new Error(`A ${closed ? "closed" : "open"} guide line needs at least ${closed ? 3 : 2} distinct points.`);
  }
  return { id, points, closed };
}

/** Normalize, simplify and uniformly resample one raw pointer stroke. */
export function preparePointerGuide(
  samples: readonly PointerSample[],
  bounds: PointerBounds,
  options: PrepareGuideOptions,
): GuidePolyline {
  const tolerance = options.simplifyTolerance ?? 0.008;
  const spacing = options.resampleSpacing ?? 0.035;
  const closed = options.closed ?? false;
  const normalized = normalizePointerSamples(samples, bounds);
  const simplified = simplifyPolyline(normalized, tolerance);
  const resampled = resamplePolyline(simplified, spacing, closed);
  return createGuidePolyline(options.id, resampled, closed);
}

export function polylineLength(guide: GuidePolyline): number {
  let total = 0;
  for (let index = 1; index < guide.points.length; index += 1) {
    total += distance(guide.points[index - 1], guide.points[index]);
  }
  if (guide.closed) total += distance(guide.points[guide.points.length - 1], guide.points[0]);
  return total;
}

function smootherstep(value: number): number {
  const amount = clamp(value, 0, 1);
  return amount * amount * amount * (amount * (amount * 6 - 15) + 10);
}

/** Sample the nearest segment from a stable ordered set of guide polylines. */
export function sampleGuideField(
  guides: readonly GuidePolyline[],
  point: NormalizedPoint,
  options: GuideFieldOptions,
): GuideFieldSample {
  if (guides.length === 0) throw new Error("At least one guide line is required.");
  assertFinite("point.x", point.x);
  assertFinite("point.y", point.y);
  assertFinite("radius", options.radius);
  if (!(options.radius > 0)) throw new Error("Guide influence radius must be greater than zero.");
  const strength = options.strength ?? 1;
  const falloffPower = options.falloffPower ?? 1;
  const coordinateScale = options.coordinateScale ?? { x: 1, y: 1 };
  assertFinite("strength", strength);
  assertFinite("falloffPower", falloffPower);
  assertFinite("coordinateScale.x", coordinateScale.x);
  assertFinite("coordinateScale.y", coordinateScale.y);
  if (!(falloffPower > 0)) throw new Error("falloffPower must be greater than zero.");
  if (!(coordinateScale.x > 0) || !(coordinateScale.y > 0)) {
    throw new Error("coordinateScale components must be greater than zero.");
  }

  let best:
    | {
        distanceSquared: number;
        closestPoint: NormalizedPoint;
        tangent: NormalizedPoint;
        guideIndex: number;
        segmentIndex: number;
      }
    | undefined;

  for (let guideIndex = 0; guideIndex < guides.length; guideIndex += 1) {
    const guide = guides[guideIndex];
    const segmentCount = guide.closed ? guide.points.length : guide.points.length - 1;
    for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
      const start = guide.points[segmentIndex];
      const end = guide.points[(segmentIndex + 1) % guide.points.length];
      const normalizedDx = end.x - start.x;
      const normalizedDy = end.y - start.y;
      const dx = normalizedDx * coordinateScale.x;
      const dy = normalizedDy * coordinateScale.y;
      const segmentLength = Math.hypot(dx, dy);
      if (segmentLength <= EPSILON) continue;
      const amount = clamp(
        (((point.x - start.x) * coordinateScale.x) * dx +
          ((point.y - start.y) * coordinateScale.y) * dy) /
          (segmentLength * segmentLength),
        0,
        1,
      );
      const closestPoint = {
        x: start.x + normalizedDx * amount,
        y: start.y + normalizedDy * amount,
      };
      const offsetX = (point.x - closestPoint.x) * coordinateScale.x;
      const offsetY = (point.y - closestPoint.y) * coordinateScale.y;
      const distanceSquared = offsetX * offsetX + offsetY * offsetY;
      if (!best || distanceSquared < best.distanceSquared - EPSILON) {
        best = {
          distanceSquared,
          closestPoint,
          tangent: { x: dx / segmentLength, y: dy / segmentLength },
          guideIndex,
          segmentIndex,
        };
      }
    }
  }
  if (!best) throw new Error("Guide lines contain no non-zero-length segments.");

  const normal = { x: -best.tangent.y, y: best.tangent.x };
  const offsetX = (point.x - best.closestPoint.x) * coordinateScale.x;
  const offsetY = (point.y - best.closestPoint.y) * coordinateScale.y;
  const measuredDistance = Math.sqrt(best.distanceSquared);
  const signedDistance = offsetX * normal.x + offsetY * normal.y;
  const normalizedDistance = clamp(measuredDistance / options.radius, 0, 1);
  const influence = Math.pow(1 - smootherstep(normalizedDistance), falloffPower);
  const withinInfluence = measuredDistance < options.radius;
  let modulation: number;
  if ((options.mode ?? "unsigned") === "signed") {
    // u(1-u)^2 peaks at 4/27. Normalization makes the two-sided field reach
    // +/-1 while staying continuous at both the guide centerline and radius.
    const signedUnit = clamp(signedDistance / options.radius, -1, 1);
    const magnitude = Math.abs(signedUnit);
    modulation =
      Math.sign(signedUnit) * magnitude * (1 - magnitude) ** 2 * (27 / 4) * strength;
  } else {
    modulation = influence * strength;
  }
  if (!withinInfluence) modulation = 0;

  return {
    closestPoint: best.closestPoint,
    tangent: best.tangent,
    normal,
    distance: measuredDistance,
    signedDistance,
    normalizedDistance,
    influence,
    modulation,
    guideIndex: best.guideIndex,
    segmentIndex: best.segmentIndex,
    withinInfluence,
  };
}

/** Apply a sampled guide field while enforcing explicit printable Z bounds. */
export function applyGuideHeightModulation(
  baseHeightMm: number,
  field: GuideFieldSample,
  options: HeightModulationOptions,
): HeightModulationResult {
  assertFinite("baseHeightMm", baseHeightMm);
  assertFinite("amplitudeMm", options.amplitudeMm);
  assertFinite("minHeightMm", options.minHeightMm);
  assertFinite("maxHeightMm", options.maxHeightMm);
  if (options.maxHeightMm < options.minHeightMm) {
    throw new Error("maxHeightMm cannot be below minHeightMm.");
  }
  const requestedDeltaMm = options.amplitudeMm * field.modulation;
  let guardedDeltaMm = requestedDeltaMm;
  if (options.maxAbsoluteDeltaMm !== undefined) {
    assertNonNegative("maxAbsoluteDeltaMm", options.maxAbsoluteDeltaMm);
    guardedDeltaMm = clamp(
      guardedDeltaMm,
      -options.maxAbsoluteDeltaMm,
      options.maxAbsoluteDeltaMm,
    );
  }
  const heightMm = clamp(
    baseHeightMm + guardedDeltaMm,
    options.minHeightMm,
    options.maxHeightMm,
  );
  const appliedDeltaMm = heightMm - baseHeightMm;
  return {
    heightMm,
    appliedDeltaMm,
    requestedDeltaMm,
    clamped: Math.abs(appliedDeltaMm - requestedDeltaMm) > 1e-9,
  };
}

/** Lightweight normalized form for families that calculate height afterward. */
export function applyGuideReliefModulation(
  baseAmount: number,
  field: GuideFieldSample,
  amplitude: number,
): number {
  assertFinite("baseAmount", baseAmount);
  assertFinite("amplitude", amplitude);
  return clamp(baseAmount + field.modulation * amplitude, 0, 1);
}

/** Rotation for a local +X feature to follow the sampled guide. */
export function guideFollowAngle(
  field: Pick<GuideFieldSample, "tangent">,
  axis: "tangent" | "normal" = "tangent",
): number {
  const tangentAngle = Math.atan2(field.tangent.y, field.tangent.x);
  return tangentAngle + (axis === "normal" ? Math.PI / 2 : 0);
}

/**
 * Amplitude ceiling for the module's default falloff profiles. For a physical
 * influence radius R and maximum surface angle alpha:
 *
 *   A <= R * tan(alpha) / Gmax
 *
 * Gmax is 1.875 for unsigned smootherstep and 6.75 for the continuous signed
 * side field. The caller should still take the minimum with its available Z
 * budget and any printer/process-specific overhang limit.
 */
export function slopeSafeGuideAmplitudeMm(
  physicalInfluenceRadiusMm: number,
  maximumSurfaceAngleDeg: number,
  mode: GuideInfluenceMode = "unsigned",
): number {
  assertFinite("physicalInfluenceRadiusMm", physicalInfluenceRadiusMm);
  assertFinite("maximumSurfaceAngleDeg", maximumSurfaceAngleDeg);
  if (!(physicalInfluenceRadiusMm > 0)) {
    throw new Error("physicalInfluenceRadiusMm must be greater than zero.");
  }
  if (!(maximumSurfaceAngleDeg > 0) || maximumSurfaceAngleDeg >= 90) {
    throw new Error("maximumSurfaceAngleDeg must be greater than 0 and below 90.");
  }
  const maximumNormalizedGradient = mode === "signed" ? 6.75 : 1.875;
  return (
    (physicalInfluenceRadiusMm *
      Math.tan((maximumSurfaceAngleDeg * Math.PI) / 180)) /
    maximumNormalizedGradient
  );
}
