/**
 * Deterministic regional depth masks in the generator's normalized artwork
 * plane. Coordinates span [-1, 1] on each axis and +Y points down. Positive
 * angles therefore rotate clockwise when viewed from the front of the art.
 *
 * This module returns signed millimetre contributions only. The caller owns
 * the single final clamp after masks, painting, guides, and other local effects
 * have been combined.
 */

export const MAX_REGIONAL_DEPTH_MASKS = 8;
export const MAX_REGIONAL_DEPTH_STRENGTH_MM = 200;
export const MAX_REGIONAL_DEPTH_SIZE = 4;
export const MAX_REGIONAL_DEPTH_NAME_LENGTH = 80;

export type RegionalDepthMaskKind =
  | "circle"
  | "ellipse"
  | "rectangle"
  | "linear-gradient"
  | "radial-gradient"
  | "edge-falloff";

export interface ArtworkDepthPoint {
  readonly x: number;
  readonly y: number;
}

/** Full width and height in normalized artwork units. */
export interface RegionalDepthMaskSize {
  readonly x: number;
  readonly y: number;
}

export interface RegionalDepthMask {
  /** Stable identity used to make overlap summation order-independent. */
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly kind: RegionalDepthMaskKind;
  readonly strengthMm: number;
  readonly center: ArtworkDepthPoint;
  readonly size: RegionalDepthMaskSize;
  /** Clockwise rotation in the +Y-down artwork plane. */
  readonly angleDeg: number;
  /** A normalized 0..1 softness/transition width. */
  readonly feather: number;
}

export type RegionalDepthMaskSampler = (point: ArtworkDepthPoint) => number;

const REGIONAL_DEPTH_MASK_KINDS = new Set<RegionalDepthMaskKind>([
  "circle",
  "ellipse",
  "rectangle",
  "linear-gradient",
  "radial-gradient",
  "edge-falloff",
]);

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite; received ${String(value)}.`);
  }
}

function assertArtworkPoint(name: string, point: ArtworkDepthPoint): void {
  assertFinite(`${name}.x`, point.x);
  assertFinite(`${name}.y`, point.y);
  if (point.x < -1 || point.x > 1 || point.y < -1 || point.y > 1) {
    throw new Error(`${name} must stay inside the normalized [-1, 1] artwork domain.`);
  }
}

function assertMaskSize(name: string, size: RegionalDepthMaskSize): void {
  assertFinite(`${name}.x`, size.x);
  assertFinite(`${name}.y`, size.y);
  if (!(size.x > 0) || !(size.y > 0)) {
    throw new Error(`${name} components must be greater than zero.`);
  }
  if (size.x > MAX_REGIONAL_DEPTH_SIZE || size.y > MAX_REGIONAL_DEPTH_SIZE) {
    throw new Error(
      `${name} components cannot exceed ${MAX_REGIONAL_DEPTH_SIZE} normalized artwork units.`,
    );
  }
}

function assertStableLabel(name: string, value: string, maximumLength: number): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  if (value.length > maximumLength) {
    throw new Error(`${name} cannot exceed ${maximumLength} characters.`);
  }
  if (/\p{Cc}/u.test(value)) {
    throw new Error(`${name} cannot contain control characters.`);
  }
}

export function validateRegionalDepthMask(
  mask: RegionalDepthMask,
  name = "regionalDepthMask",
): void {
  assertStableLabel(`${name}.id`, mask.id, 64);
  assertStableLabel(`${name}.name`, mask.name, MAX_REGIONAL_DEPTH_NAME_LENGTH);
  if (typeof mask.enabled !== "boolean") {
    throw new Error(`${name}.enabled must be a boolean.`);
  }
  if (!REGIONAL_DEPTH_MASK_KINDS.has(mask.kind)) {
    throw new Error(`${name}.kind is not a supported regional depth mask type.`);
  }
  assertFinite(`${name}.strengthMm`, mask.strengthMm);
  if (Math.abs(mask.strengthMm) > MAX_REGIONAL_DEPTH_STRENGTH_MM) {
    throw new Error(
      `${name}.strengthMm must stay between -${MAX_REGIONAL_DEPTH_STRENGTH_MM} and ${MAX_REGIONAL_DEPTH_STRENGTH_MM} mm.`,
    );
  }
  assertArtworkPoint(`${name}.center`, mask.center);
  assertMaskSize(`${name}.size`, mask.size);
  assertFinite(`${name}.angleDeg`, mask.angleDeg);
  if (mask.angleDeg < -180 || mask.angleDeg > 180) {
    throw new Error(`${name}.angleDeg must stay between -180 and 180 degrees.`);
  }
  assertFinite(`${name}.feather`, mask.feather);
  if (mask.feather < 0 || mask.feather > 1) {
    throw new Error(`${name}.feather must stay between 0 and 1.`);
  }
}

export function validateRegionalDepthMasks(masks: readonly RegionalDepthMask[]): void {
  if (!Array.isArray(masks)) {
    throw new Error("Regional depth masks must be an array.");
  }
  if (masks.length > MAX_REGIONAL_DEPTH_MASKS) {
    throw new Error(`A project can contain at most ${MAX_REGIONAL_DEPTH_MASKS} regional depth masks.`);
  }
  const ids = new Set<string>();
  masks.forEach((mask, index) => {
    validateRegionalDepthMask(mask, `regionalDepthMasks[${index}]`);
    if (ids.has(mask.id)) {
      throw new Error(`Regional depth mask id ${JSON.stringify(mask.id)} is duplicated.`);
    }
    ids.add(mask.id);
  });
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function smootherstep(value: number): number {
  const amount = clamp(value, 0, 1);
  return amount * amount * amount * (amount * (amount * 6 - 15) + 10);
}

function compareStableIds(left: RegionalDepthMask, right: RegionalDepthMask): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function boundaryInfluence(normalizedDistance: number, feather: number): number {
  if (normalizedDistance > 1) return 0;
  if (feather === 0) return 1;
  const innerBoundary = 1 - feather;
  if (normalizedDistance <= innerBoundary) return 1;
  return 1 - smootherstep((normalizedDistance - innerBoundary) / feather);
}

function localPoint(mask: RegionalDepthMask, point: ArtworkDepthPoint): ArtworkDepthPoint {
  const radians = mask.angleDeg * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const dx = point.x - mask.center.x;
  const dy = point.y - mask.center.y;
  // Positive angles are clockwise in +Y-down coordinates. Dotting against the
  // rotated local axes performs the inverse transform without flipping Y.
  return {
    x: dx * cosine + dy * sine,
    y: -dx * sine + dy * cosine,
  };
}

function sampleRegionalDepthMaskInfluenceUnchecked(
  mask: RegionalDepthMask,
  point: ArtworkDepthPoint,
): number {
  if (!mask.enabled) return 0;

  const local = localPoint(mask, point);
  const halfWidth = mask.size.x / 2;
  const halfHeight = mask.size.y / 2;

  if (mask.kind === "circle") {
    const radius = Math.min(halfWidth, halfHeight);
    return boundaryInfluence(Math.hypot(local.x, local.y) / radius, mask.feather);
  }

  if (mask.kind === "ellipse") {
    return boundaryInfluence(
      Math.hypot(local.x / halfWidth, local.y / halfHeight),
      mask.feather,
    );
  }

  if (mask.kind === "rectangle") {
    return boundaryInfluence(
      Math.max(Math.abs(local.x) / halfWidth, Math.abs(local.y) / halfHeight),
      mask.feather,
    );
  }

  if (mask.kind === "linear-gradient") {
    // The editor represents this region as a finite rotated rectangle. Keep
    // sampling inside the same bounds instead of extending the completed end
    // of the ramp across the rest of the artwork.
    if (Math.abs(local.x) > halfWidth || Math.abs(local.y) > halfHeight) {
      return 0;
    }
    const longitudinal = smootherstep((local.x / halfWidth + 1) / 2);
    const crossBand = boundaryInfluence(Math.abs(local.y) / halfHeight, mask.feather);
    return longitudinal * crossBand;
  }

  if (mask.kind === "radial-gradient") {
    const radialDistance = Math.hypot(local.x / halfWidth, local.y / halfHeight);
    if (radialDistance >= 1) return 0;
    // Feather is the fraction of the radius occupied by the transition. At 1,
    // the gradient spans center to edge; at 0, the ellipse has a hard edge.
    return boundaryInfluence(radialDistance, mask.feather);
  }

  const coreDistance = Math.max(
    Math.abs(local.x) / halfWidth,
    Math.abs(local.y) / halfHeight,
  );
  if (coreDistance <= 1) return 0;
  // Edge falloff treats size as the unaffected inner core. Beyond that core,
  // influence ramps toward the artwork boundary. Zero feather is a hard step.
  return mask.feather === 0
    ? 1
    : smootherstep((coreDistance - 1) / mask.feather);
}

/** Return only the unitless 0..1 influence of one validated region. */
export function sampleRegionalDepthMaskInfluence(
  mask: RegionalDepthMask,
  point: ArtworkDepthPoint,
): number {
  validateRegionalDepthMask(mask);
  assertArtworkPoint("point", point);
  return sampleRegionalDepthMaskInfluenceUnchecked(mask, point);
}

/** Return one signed millimetre contribution without applying a geometry clamp. */
export function sampleRegionalDepthMask(
  mask: RegionalDepthMask,
  point: ArtworkDepthPoint,
): number {
  const influence = sampleRegionalDepthMaskInfluence(mask, point);
  return influence === 0 || mask.strengthMm === 0 ? 0 : influence * mask.strengthMm;
}

/**
 * Sum every enabled contribution in stable id order. Deliberately do not clamp
 * the result: the composition pipeline owns one final clamp after all effects.
 */
export function sampleRegionalDepthMasks(
  masks: readonly RegionalDepthMask[],
  point: ArtworkDepthPoint,
): number {
  validateRegionalDepthMasks(masks);
  assertArtworkPoint("point", point);
  return [...masks]
    .filter((mask) => mask.enabled)
    .sort(compareStableIds)
    .reduce(
      (total, mask) => total +
        sampleRegionalDepthMaskInfluenceUnchecked(mask, point) * mask.strengthMm,
      0,
    );
}

/** Validate once, then reuse a UI-agnostic pure sampler throughout generation. */
export function createRegionalDepthMaskSampler(
  masks: readonly RegionalDepthMask[],
): RegionalDepthMaskSampler {
  validateRegionalDepthMasks(masks);
  const stableMasks = [...masks]
    .filter((mask) => mask.enabled)
    .sort(compareStableIds)
    .map((mask) => ({
      ...mask,
      center: { ...mask.center },
      size: { ...mask.size },
    }));
  return (point) => {
    assertArtworkPoint("point", point);
    return stableMasks.reduce(
      (total, mask) => total +
        sampleRegionalDepthMaskInfluenceUnchecked(mask, point) * mask.strengthMm,
      0,
    );
  };
}
