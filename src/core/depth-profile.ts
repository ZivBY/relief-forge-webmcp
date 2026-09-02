import type { DepthProfileConfig } from "./types";

export const MIN_DEPTH_CURVE_EXPONENT = 0.25;
export const MAX_DEPTH_CURVE_EXPONENT = 4;

function finite(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite; received ${String(value)}.`);
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/** Validate the bounded, recipe-safe controls used by the depth mapper. */
export function validateDepthProfileConfig(
  profile: DepthProfileConfig,
  name = "depthProfile",
): void {
  if (typeof profile.invert !== "boolean") {
    throw new Error(`${name}.invert must be a boolean.`);
  }
  finite(`${name}.contrast`, profile.contrast);
  if (profile.contrast < 0 || profile.contrast > 2) {
    throw new Error(`${name}.contrast must be between 0 and 2.`);
  }
  finite(`${name}.curve`, profile.curve);
  if (profile.curve < -1 || profile.curve > 1) {
    throw new Error(`${name}.curve must be between -1 and 1.`);
  }
  if (
    !Number.isInteger(profile.levels) ||
    (profile.levels !== 0 && (profile.levels < 2 || profile.levels > 16))
  ) {
    throw new Error(`${name}.levels must be 0 or an integer from 2 through 16.`);
  }
}

/**
 * Convert the signed curve control to a bounded exponent. Positive values
 * isolate high peaks; negative values lift the valleys. The endpoints are
 * deliberately limited to [0.25, 4] so the control remains useful rather than
 * collapsing nearly the whole field to one extreme.
 */
export function depthCurveExponent(curve: number): number {
  finite("depth curve", curve);
  if (curve < -1 || curve > 1) {
    throw new Error("depth curve must be between -1 and 1.");
  }
  return Math.pow(MAX_DEPTH_CURVE_EXPONENT, curve);
}

function mapValidatedDepthAmount(
  inputAmount: number,
  profile: DepthProfileConfig,
): number {
  finite("depth amount", inputAmount);

  // The algorithm order is part of the geometry contract:
  // clamp -> invert -> contrast around 0.5 -> bounded exponent -> quantize.
  let amount = clamp(inputAmount, 0, 1);
  if (profile.invert) amount = 1 - amount;
  if (profile.contrast !== 1) {
    amount = clamp(0.5 + (amount - 0.5) * profile.contrast, 0, 1);
  }
  if (profile.curve !== 0) {
    amount = Math.pow(amount, depthCurveExponent(profile.curve));
  }
  if (profile.levels !== 0) {
    const intervals = profile.levels - 1;
    amount = Math.round(amount * intervals) / intervals;
  }
  return clamp(amount, 0, 1);
}

/** Pure normalized depth transform. Neutral settings return the input exactly. */
export function mapDepthAmount(
  inputAmount: number,
  profile: DepthProfileConfig,
): number {
  validateDepthProfileConfig(profile);
  return mapValidatedDepthAmount(inputAmount, profile);
}

export interface DepthMapper {
  readonly minimumHeightMm: number;
  readonly maximumHeightMm: number;
  mapAmount(inputAmount: number): number;
  /** Clamp a fully composed physical height to the configured printable span. */
  clampHeightMm(heightMm: number): number;
  /**
   * Map macro depth first, then apply an exact signed local offset in
   * millimetres, and clamp once to the configured physical height span.
   */
  heightMm(inputAmount: number, localOffsetMm?: number): number;
}

/**
 * Compile a validated profile once for efficient repeated surface sampling.
 * baseHeightMm is the minimum configured overall object depth and
 * reliefHeightMm is the available relief span, so maximum object depth is
 * their sum. Individual sculpted walls or shoulders can be thinner.
 */
export function createDepthMapper(
  profile: DepthProfileConfig,
  baseHeightMm: number,
  reliefHeightMm: number,
): DepthMapper {
  validateDepthProfileConfig(profile);
  finite("baseHeightMm", baseHeightMm);
  finite("reliefHeightMm", reliefHeightMm);
  if (baseHeightMm <= 0) throw new Error("baseHeightMm must be greater than zero.");
  if (reliefHeightMm < 0) throw new Error("reliefHeightMm cannot be negative.");

  const minimumHeightMm = baseHeightMm;
  const maximumHeightMm = baseHeightMm + reliefHeightMm;
  finite("maximumHeightMm", maximumHeightMm);
  const clampHeightMm = (heightMm: number): number => {
    finite("heightMm", heightMm);
    return clamp(heightMm, minimumHeightMm, maximumHeightMm);
  };

  return {
    minimumHeightMm,
    maximumHeightMm,
    mapAmount(inputAmount) {
      return mapValidatedDepthAmount(inputAmount, profile);
    },
    clampHeightMm,
    heightMm(inputAmount, localOffsetMm = 0) {
      finite("localOffsetMm", localOffsetMm);
      const macroHeightMm =
        minimumHeightMm + reliefHeightMm * mapValidatedDepthAmount(inputAmount, profile);
      return clampHeightMm(macroHeightMm + localOffsetMm);
    },
  };
}
