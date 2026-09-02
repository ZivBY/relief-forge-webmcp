import { applyConfiguredGuides } from "./guide-composition";
import {
  preparePhotoFieldAsset,
  resolvePhotoFieldAsset,
  samplePhotoField,
} from "./photo-field";
import { sampleProceduralPattern } from "./patterns";
import { createRegionalDepthMaskSampler } from "./depth-masks";
import {
  createDepthPaintSampler,
  resolveDepthPaintFieldAsset,
} from "../depth-paint/field";
import type {
  DesignFamilyKind,
  GenerationAssets,
  PatternSample,
  WallArtConfig,
} from "./types";

export interface CompositionSampler {
  (normalizedX: number, normalizedY: number): PatternSample;
  /** Point sampler used by continuous contour vertices without area averaging. */
  point(normalizedX: number, normalizedY: number): PatternSample;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function blendAngles(from: number, to: number, amount: number): number {
  const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  const blended = from + delta * amount;
  return Math.atan2(Math.sin(blended), Math.cos(blended));
}

/** Families whose sampled photo direction changes the physical mesh. */
export function photoFamilyUsesDirection(family: DesignFamilyKind): boolean {
  return family !== "sampled-blocks" &&
    family !== "polar-bloom" &&
    family !== "contour-relief";
}

/**
 * Compose the procedural/photo macro field, then regional masks, retained
 * paint, and user guides as signed local millimetre offsets. The returned
 * sample is the single source used by geometry, palette, and exports.
 */
export function createCompositionSampler(
  config: WallArtConfig,
  assets: GenerationAssets = {},
): CompositionSampler {
  const photoAsset = resolvePhotoFieldAsset(config, assets);
  const prepared = photoAsset ? preparePhotoFieldAsset(photoAsset) : undefined;
  const regionalDepth = createRegionalDepthMaskSampler(config.localDepth.masks);
  const paintConfig = config.localDepth.paint;
  const depthPaintAsset = paintConfig
    ? resolveDepthPaintFieldAsset(
        paintConfig.descriptor,
        assets.depthPaintFields ?? {},
      )
    : undefined;
  const paintedDepth = paintConfig?.enabled && depthPaintAsset
    ? createDepthPaintSampler(depthPaintAsset)
    : undefined;
  const compose = (
    normalizedX: number,
    normalizedY: number,
    footprint?: { x: number; y: number },
  ) => {
    const procedural = sampleProceduralPattern(config, normalizedX, normalizedY);
    let composed = procedural;
    const photo = config.source.photo;
    if (config.source.kind === "photo" && photo && prepared) {
      const sampled = samplePhotoField(
        prepared,
        photo,
        normalizedX,
        normalizedY,
        footprint,
      );
      const useTone = photo.toneMode !== "off";
      const useDirection = photoFamilyUsesDirection(config.design.family) &&
        photo.directionMode !== "off" &&
        sampled.angleRad !== undefined;
      composed = {
        value: useTone
          ? clamp(
              procedural.value * (1 - photo.geometryStrength) +
              sampled.value * photo.geometryStrength,
              -1,
              1,
            )
          : procedural.value,
        angleRad: useDirection
          ? blendAngles(
              procedural.angleRad,
              sampled.angleRad!,
              photo.directionStrength * sampled.directionConfidence,
            )
          : procedural.angleRad,
        sourceColor: sampled.sourceColor,
      };
    }
    const regionalOffsetMm = regionalDepth({ x: normalizedX, y: normalizedY });
    const paintedOffsetMm = paintedDepth?.(normalizedX, normalizedY) ?? 0;
    const localOffsetMm = regionalOffsetMm + paintedOffsetMm;
    const locallyComposed = localOffsetMm === 0
      ? composed
      : { ...composed, guideHeightDeltaMm: localOffsetMm };
    return applyConfiguredGuides(
      config,
      normalizedX,
      normalizedY,
      locallyComposed,
    );
  };
  const sampler = ((normalizedX: number, normalizedY: number) => compose(
    normalizedX,
    normalizedY,
    {
      x: 2 / Math.max(1, config.grid.columns),
      y: 2 / Math.max(1, config.grid.rows),
    },
  )) as CompositionSampler;
  sampler.point = (normalizedX, normalizedY) => compose(normalizedX, normalizedY);
  return sampler;
}
