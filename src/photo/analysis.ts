import { mapPhotoToPalette, quantizePhotoPalette } from "../core/photo-color";
import { preparePhotoFieldAsset, samplePhotoField } from "../core/photo-field";
import type {
  DesignFamilyKind,
  PhotoFieldAsset,
  TileShapeKind,
} from "../core/types";

export interface PhotoGeometryRecommendation {
  version: 1;
  family: DesignFamilyKind;
  shape: TileShapeKind;
  columns: number;
  rows: number;
  reason: string;
}

export interface PhotoAnalysisResult {
  palette: string[];
  averageDeltaE: number;
  p95DeltaE: number;
  edgeDensity: number;
  directionCoherence: number;
  luminanceRange: number;
  recommendation: PhotoGeometryRecommendation;
  quantizedRgba8: Uint8Array;
  sampledPreviewWidth: number;
  sampledPreviewHeight: number;
  sampledPreviewRgba8: Uint8Array;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function recommendedGrid(width: number, height: number): { columns: number; rows: number } {
  const aspect = width / height;
  let columns = clamp(Math.round(22 * Math.sqrt(aspect)), 16, 36);
  let rows = Math.round(columns / aspect);
  if (rows > 28) {
    rows = 28;
    columns = Math.round(rows * aspect);
  }
  columns = clamp(columns, 8, 40);
  rows = clamp(rows, 8, 30);
  return { columns, rows };
}

export function recommendPhotoGeometry(
  asset: PhotoFieldAsset,
  edgeDensity: number,
  directionCoherence: number,
  luminanceRange: number,
): PhotoGeometryRecommendation {
  const grid = recommendedGrid(asset.width, asset.height);
  if (edgeDensity > 0.34 && directionCoherence > 0.58 && luminanceRange > 0.18) {
    return {
      version: 1,
      family: "folded-flow",
      shape: "folded-ridge",
      ...grid,
      reason: "Strong, consistent edges suit directional folded ridges.",
    };
  }
  if (edgeDensity > 0.4 && luminanceRange > 0.28) {
    return {
      version: 1,
      family: "triangular-current",
      shape: "triangle-plateau",
      ...grid,
      reason: "Dense high-contrast detail benefits from a fine triangular facet field.",
    };
  }
  return {
    version: 1,
    family: "sampled-blocks",
    shape: "surface-column",
    ...grid,
    reason: "Separate surface columns preserve the image's tone and solid colors most directly.",
  };
}

export function analyzePhotoAsset(
  asset: PhotoFieldAsset,
  requestedColorCount: number,
  paletteOverride?: readonly string[],
): PhotoAnalysisResult {
  const prepared = preparePhotoFieldAsset(asset);
  const extracted = quantizePhotoPalette(asset.rgba8, requestedColorCount);
  const mapped = mapPhotoToPalette(asset.rgba8, paletteOverride ?? extracted.colors);
  const threshold = prepared.gradientP95 * 0.12;
  let edgeCount = 0;
  let cosine = 0;
  let sine = 0;
  let directionWeight = 0;
  for (let index = 0; index < prepared.gradientX.length; index += 1) {
    const dx = prepared.gradientX[index];
    const dy = prepared.gradientY[index];
    const magnitude = Math.hypot(dx, dy);
    if (magnitude >= threshold && threshold > 0) edgeCount += 1;
    if (magnitude > 1e-8) {
      const angle = Math.atan2(dy, dx);
      cosine += Math.cos(angle * 2) * magnitude;
      sine += Math.sin(angle * 2) * magnitude;
      directionWeight += magnitude;
    }
  }
  const edgeDensity = edgeCount / prepared.gradientX.length;
  const directionCoherence = directionWeight === 0
    ? 0
    : clamp(Math.hypot(cosine, sine) / directionWeight, 0, 1);
  const luminanceRange = prepared.luminanceHigh - prepared.luminanceLow;
  const recommendation = recommendPhotoGeometry(
    asset,
    edgeDensity,
    directionCoherence,
    luminanceRange,
  );
  const sampledSourceRgba8 = new Uint8Array(
    recommendation.columns * recommendation.rows * 4,
  );
  const samplingSettings = {
    assetSha256: asset.sha256,
    canonicalWidth: asset.width,
    canonicalHeight: asset.height,
    toneMode: "light-raised" as const,
    toneContrast: 0.5,
    geometryStrength: 1,
    directionMode: "off" as const,
    directionStrength: 0,
    colorMode: "auto-palette" as const,
    colorStrength: 1,
    requestedColorCount,
  };
  for (let row = 0; row < recommendation.rows; row += 1) {
    for (let column = 0; column < recommendation.columns; column += 1) {
      const sample = samplePhotoField(
        prepared,
        samplingSettings,
        ((column + 0.5) / recommendation.columns) * 2 - 1,
        ((row + 0.5) / recommendation.rows) * 2 - 1,
        {
          x: 2 / recommendation.columns,
          y: 2 / recommendation.rows,
        },
      );
      const offset = (row * recommendation.columns + column) * 4;
      sampledSourceRgba8.set([
        Math.round(sample.sourceColor.r),
        Math.round(sample.sourceColor.g),
        Math.round(sample.sourceColor.b),
        255,
      ], offset);
    }
  }
  const sampledPreview = mapPhotoToPalette(sampledSourceRgba8, mapped.colors);
  return {
    palette: mapped.colors,
    averageDeltaE: mapped.averageDeltaE,
    p95DeltaE: mapped.p95DeltaE,
    edgeDensity,
    directionCoherence,
    luminanceRange,
    recommendation,
    quantizedRgba8: mapped.quantizedRgba8,
    sampledPreviewWidth: recommendation.columns,
    sampledPreviewHeight: recommendation.rows,
    sampledPreviewRgba8: sampledPreview.quantizedRgba8,
  };
}
