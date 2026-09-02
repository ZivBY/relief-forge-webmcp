import { sampleGuideField } from "./guide-fields";
import type { GuideFieldSample, NormalizedPoint } from "./guide-fields";
import type {
  GuideCompositionConfig,
  GuideDirectionMode,
  GuideLineConfig,
  PatternSample,
  WallArtConfig,
} from "./types";

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

export function shortestAngleBlend(start: number, end: number, amount: number): number {
  const delta = Math.atan2(Math.sin(end - start), Math.cos(end - start));
  return start + delta * clamp(amount, 0, 1);
}

/**
 * Convert the user-facing line-attraction setting into an angular blend.
 *
 * Full attraction is intentionally exact everywhere strictly inside the
 * selected radius: distance controls which parts participate, not whether a
 * participating part can finish pointing at the guide. Partial settings keep
 * a continuous distance falloff and use an ease-out strength curve so the
 * pattern remains legible before the slider reaches 100%.
 */
export function directionAttractionAmount(
  followStrength: number,
  normalizedDistance: number,
): number {
  const strength = clamp(followStrength, 0, 1);
  if (strength === 0) return 0;
  if (strength === 1) return 1;

  const distance = clamp(normalizedDistance, 0, 1);
  const proximity = 1 - distance ** 4;
  if (proximity <= 0) return 0;

  const emphasizedStrength = 1 - (1 - strength) ** 2;
  return emphasizedStrength ** (1 / proximity);
}

/**
 * Aim a directional part at the nearest point on the guide, rather than along
 * the guide tangent. The sampled guide lives in the drawing's +Y-up plane, so
 * the toward vector is reflected back into the generator's +Y-down plane.
 *
 * A part whose centre is exactly on the stroke has no unique "toward" vector;
 * following the local tangent is the stable, deterministic fallback there.
 */
export function angleTowardGuide(
  field: Pick<GuideFieldSample, "closestPoint" | "tangent">,
  point: NormalizedPoint,
  coordinateScale: Readonly<{ x: number; y: number }>,
): number {
  const towardX = (field.closestPoint.x - point.x) * coordinateScale.x;
  const towardY = -(field.closestPoint.y - point.y) * coordinateScale.y;
  if (Math.hypot(towardX, towardY) <= 1e-9) {
    // Direction-off must not acquire start/end semantics at the one position
    // where no unique inward vector exists. Canonicalize the tangent so
    // reversing a guide remains an exact no-op in ordinary "toward" mode.
    let tangentX = field.tangent.x;
    let tangentY = -field.tangent.y;
    if (tangentX < -1e-9 || (Math.abs(tangentX) <= 1e-9 && tangentY < 0)) {
      tangentX *= -1;
      tangentY *= -1;
    }
    return Math.atan2(tangentY, tangentX);
  }
  return Math.atan2(towardY, towardX);
}

/**
 * Aim toward a short look-ahead point in the ordered path direction. Farther
 * parts still point mostly inward; parts near the stroke increasingly follow
 * its start-to-end flow. The tangent is already normalized in physical space.
 */
export function angleTowardForwardGuide(
  field: Pick<GuideFieldSample, "closestPoint" | "tangent">,
  point: NormalizedPoint,
  coordinateScale: Readonly<{ x: number; y: number }>,
  lookAheadMm: number,
): number {
  const towardX = (field.closestPoint.x - point.x) * coordinateScale.x;
  const towardY = -(field.closestPoint.y - point.y) * coordinateScale.y;
  const forwardX = field.tangent.x;
  const forwardY = -field.tangent.y;
  const targetX = towardX + forwardX * Math.max(0, lookAheadMm);
  const targetY = towardY + forwardY * Math.max(0, lookAheadMm);
  if (Math.hypot(targetX, targetY) <= 1e-9) {
    return Math.atan2(forwardY, forwardX);
  }
  return Math.atan2(targetY, targetX);
}

export interface ResolvedGuideEffects {
  influenceRadius: number;
  centerPull: number;
  followStrength: number;
  heightDeltaMm: number;
  directionMode: GuideDirectionMode;
}

export interface ConfiguredGuideInfluence {
  line: GuideLineConfig;
  lineIndex: number;
  effects: ResolvedGuideEffects;
  field: GuideFieldSample;
  physicalRadiusMm: number;
  targetAngle: number;
  directionAmount: number;
  pullAmount: number;
}

export function resolveGuideEffects(
  guides: GuideCompositionConfig,
  line: GuideLineConfig,
): ResolvedGuideEffects {
  return {
    influenceRadius: line.effects?.influenceRadius ?? guides.influenceRadius,
    centerPull: line.effects?.centerPull ?? guides.centerPull,
    followStrength: line.effects?.followStrength ?? guides.followStrength,
    heightDeltaMm: line.effects?.heightDeltaMm ?? guides.heightDeltaMm,
    directionMode: line.effects?.directionMode ?? "toward",
  };
}

/** Sample each configured guide with its own physical effect radius. */
export function sampleConfiguredGuideInfluences(
  guides: GuideCompositionConfig,
  point: NormalizedPoint,
  coordinateScale: Readonly<{ x: number; y: number }>,
): ConfiguredGuideInfluence[] {
  const shorterHalfSpanMm = Math.min(coordinateScale.x, coordinateScale.y);
  const influences: ConfiguredGuideInfluence[] = [];
  for (let lineIndex = 0; lineIndex < guides.lines.length; lineIndex += 1) {
    const line = guides.lines[lineIndex];
    const effects = resolveGuideEffects(guides, line);
    const physicalRadiusMm = effects.influenceRadius * shorterHalfSpanMm;
    const field = sampleGuideField([line], point, {
      radius: physicalRadiusMm,
      mode: "unsigned",
      coordinateScale,
    });
    if (!field.withinInfluence) continue;
    const targetAngle = effects.directionMode === "toward-forward"
      ? angleTowardForwardGuide(
          field,
          point,
          coordinateScale,
          physicalRadiusMm * 0.35,
        )
      : angleTowardGuide(field, point, coordinateScale);
    influences.push({
      line,
      lineIndex,
      effects,
      field,
      physicalRadiusMm,
      targetAngle,
      directionAmount: directionAttractionAmount(
        effects.followStrength,
        field.normalizedDistance,
      ),
      pullAmount: clamp(effects.centerPull, 0, 1) *
        (1 - field.normalizedDistance ** 3),
    });
  }
  return influences;
}

function strongestInfluence(
  influences: readonly ConfiguredGuideInfluence[],
  score: (influence: ConfiguredGuideInfluence) => number,
): ConfiguredGuideInfluence | undefined {
  return influences
    .filter((influence) => score(influence) > 0)
    .reduce<ConfiguredGuideInfluence | undefined>((best, candidate) => {
      if (!best) return candidate;
      const scoreDelta = score(candidate) - score(best);
      if (scoreDelta > 1e-12) return candidate;
      if (scoreDelta < -1e-12) return best;
      const distanceDelta = candidate.field.normalizedDistance - best.field.normalizedDistance;
      if (distanceDelta < -1e-12) return candidate;
      if (distanceDelta > 1e-12) return best;
      return candidate.line.id.localeCompare(best.line.id) < 0 ? candidate : best;
    }, undefined);
}

export function strongestDirectionalInfluence(
  influences: readonly ConfiguredGuideInfluence[],
): ConfiguredGuideInfluence | undefined {
  return strongestInfluence(influences, (influence) => influence.directionAmount);
}

export function strongestPullInfluence(
  influences: readonly ConfiguredGuideInfluence[],
): ConfiguredGuideInfluence | undefined {
  return strongestInfluence(influences, (influence) => influence.pullAmount);
}

function approximateArtSize(config: WallArtConfig): { widthMm: number; depthMm: number } {
  const rectangularWidth =
    config.grid.columns * config.grid.tileSizeMm +
    Math.max(0, config.grid.columns - 1) * config.grid.gapMm;
  const rectangularDepth =
    config.grid.rows * config.grid.tileSizeMm +
    Math.max(0, config.grid.rows - 1) * config.grid.gapMm;
  let naturalWidth = rectangularWidth;
  let naturalDepth = rectangularDepth;

  if (config.design.family === "triangular-current") {
    naturalWidth =
      config.grid.columns * config.grid.tileSizeMm +
      config.grid.tileSizeMm / 2;
    naturalDepth =
      config.grid.rows * config.grid.tileSizeMm * Math.sqrt(3) / 2;
  } else if (config.design.family === "hex-canopy") {
    const radius = config.grid.tileSizeMm / 2;
    const hexHeight = Math.sqrt(3) * radius;
    const xPitch = radius * 1.5 + config.grid.gapMm * 0.75;
    const yPitch = hexHeight + config.grid.gapMm;
    naturalWidth = radius * 2 + Math.max(0, config.grid.columns - 1) * xPitch;
    naturalDepth =
      config.grid.rows * yPitch -
      config.grid.gapMm +
      (config.grid.columns > 1 ? yPitch / 2 : 0);
  }

  return {
    widthMm: config.finishedSize.widthMm ?? naturalWidth,
    depthMm: config.finishedSize.heightMm ?? naturalDepth,
  };
}

/**
 * Apply user-authored guide strokes to any macro field before a family builds
 * geometry. Guide coordinates are +Y-up (matching the top-view drawing), while
 * family sampling is +Y-down; the conversion here keeps preview and export in
 * the same orientation.
 */
export function applyConfiguredGuides(
  config: WallArtConfig,
  normalizedX: number,
  normalizedY: number,
  sample: PatternSample,
): PatternSample {
  if (config.guides.lines.length === 0) return sample;

  const { widthMm, depthMm } = approximateArtSize(config);
  const halfWidth = Math.max(widthMm / 2, 0.001);
  const halfDepth = Math.max(depthMm / 2, 0.001);
  const guidePoint = { x: normalizedX, y: -normalizedY };
  const coordinateScale = { x: halfWidth, y: halfDepth };
  const influences = sampleConfiguredGuideInfluences(
    config.guides,
    guidePoint,
    coordinateScale,
  );
  if (influences.length === 0) return sample;

  // Direction has its own response curve. At 100%, every participating part
  // reaches the target angle exactly; partial settings taper continuously to
  // zero at the radius. Relief intentionally retains its existing profile.
  const directional = strongestDirectionalInfluence(influences);
  const angleRad = directional
    ? shortestAngleBlend(
        sample.angleRad,
        directional.targetAngle,
        directional.directionAmount,
      )
    : sample.angleRad;
  const guideHeightDeltaMm = influences.reduce(
    (total, influence) => total +
      influence.effects.heightDeltaMm * influence.field.modulation,
    sample.guideHeightDeltaMm ?? 0,
  );

  return {
    ...sample,
    angleRad,
    ...(guideHeightDeltaMm === 0 && sample.guideHeightDeltaMm === undefined
      ? {}
      : { guideHeightDeltaMm }),
  };
}
