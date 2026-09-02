import { canonicalPhotoSha256, compositeRgbaPixel, relativeLuminance } from "./photo-color";
import type {
  GenerationAssets,
  PhotoCompositionConfig,
  PhotoFieldAsset,
  RgbColor,
  WallArtConfig,
} from "./types";

export interface PreparedPhotoField {
  asset: PhotoFieldAsset;
  luminance: Float32Array;
  gradientX: Float32Array;
  gradientY: Float32Array;
  gradientP95: number;
  luminanceLow: number;
  luminanceHigh: number;
}

export interface PhotoFieldSample {
  value: number;
  angleRad?: number;
  directionConfidence: number;
  sourceColor: RgbColor;
}

const preparedCache = new WeakMap<PhotoFieldAsset, PreparedPhotoField>();
const MIN_USEFUL_DIRECTION_GRADIENT = 0.04;
const FULL_DIRECTION_GRADIENT = 0.24;
const MIN_USEFUL_TONE_SPAN = 0.015;
const FULL_TONE_SPAN = 0.25;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function percentile(sorted: Float32Array, amount: number): number {
  if (sorted.length === 0) return 0;
  const index = clamp(Math.floor((sorted.length - 1) * amount), 0, sorted.length - 1);
  return sorted[index];
}

export function validatePhotoFieldAsset(asset: PhotoFieldAsset): void {
  if (asset.version !== 1) throw new Error("Only photo-field asset version 1 is supported.");
  if (asset.colorSpace !== "srgb") throw new Error("Photo fields must use the sRGB color space.");
  if (!Number.isInteger(asset.width) || asset.width < 1 || asset.width > 512) {
    throw new Error("Photo-field width must be an integer from 1 through 512 pixels.");
  }
  if (!Number.isInteger(asset.height) || asset.height < 1 || asset.height > 512) {
    throw new Error("Photo-field height must be an integer from 1 through 512 pixels.");
  }
  if (!(asset.rgba8 instanceof Uint8Array)) {
    throw new Error("Photo-field pixels must be a Uint8Array.");
  }
  if (asset.rgba8.length !== asset.width * asset.height * 4) {
    throw new Error("Photo-field byte length does not match its dimensions.");
  }
  const actualSha = canonicalPhotoSha256(asset.width, asset.height, asset.rgba8);
  if (asset.sha256 !== actualSha) {
    throw new Error("Photo-field bytes do not match their SHA-256 identifier.");
  }
}

export function resolvePhotoFieldAsset(
  config: WallArtConfig,
  assets: GenerationAssets = {},
): PhotoFieldAsset | undefined {
  if (config.source.kind !== "photo") return undefined;
  const descriptor = config.source.photo;
  if (!descriptor) throw new Error("The photo settings are missing from this project.");
  const asset = assets.photoFields?.[descriptor.assetSha256];
  if (!asset) {
    throw new Error("This photo field is not available on this device. Re-upload the source image to recover the project.");
  }
  validatePhotoFieldAsset(asset);
  if (
    asset.sha256 !== descriptor.assetSha256 ||
    asset.width !== descriptor.canonicalWidth ||
    asset.height !== descriptor.canonicalHeight
  ) {
    throw new Error("The available photo field does not match this project's photo descriptor.");
  }
  return asset;
}

function pixelIndex(width: number, height: number, x: number, y: number): number {
  const boundedX = clamp(x, 0, width - 1);
  const boundedY = clamp(y, 0, height - 1);
  return boundedY * width + boundedX;
}

export function preparePhotoFieldAsset(asset: PhotoFieldAsset): PreparedPhotoField {
  validatePhotoFieldAsset(asset);
  const cached = preparedCache.get(asset);
  if (cached) return cached;
  const pixelCount = asset.width * asset.height;
  const luminance = new Float32Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    luminance[index] = relativeLuminance(compositeRgbaPixel(asset.rgba8, index * 4));
  }
  const sorted = Float32Array.from(luminance).sort();
  const luminanceLow = percentile(sorted, 0.02);
  const luminanceHigh = percentile(sorted, 0.98);
  const gradientX = new Float32Array(pixelCount);
  const gradientY = new Float32Array(pixelCount);
  const sample = (x: number, y: number) => luminance[pixelIndex(asset.width, asset.height, x, y)];
  for (let y = 0; y < asset.height; y += 1) {
    for (let x = 0; x < asset.width; x += 1) {
      const index = y * asset.width + x;
      gradientX[index] =
        -sample(x - 1, y - 1) + sample(x + 1, y - 1) +
        -2 * sample(x - 1, y) + 2 * sample(x + 1, y) +
        -sample(x - 1, y + 1) + sample(x + 1, y + 1);
      gradientY[index] =
        -sample(x - 1, y - 1) - 2 * sample(x, y - 1) - sample(x + 1, y - 1) +
        sample(x - 1, y + 1) + 2 * sample(x, y + 1) + sample(x + 1, y + 1);
    }
  }
  const gradientMagnitudes = Float32Array.from(
    gradientX,
    (value, index) => Math.hypot(value, gradientY[index]),
  );
  const positiveGradientMagnitudes = Float32Array.from(
    gradientMagnitudes.filter((value) => value > 1e-8),
  ).sort();
  const gradientP95 = positiveGradientMagnitudes.length === 0
    ? 0
    : percentile(positiveGradientMagnitudes, 0.95);
  const prepared = {
    asset,
    luminance,
    gradientX,
    gradientY,
    gradientP95,
    luminanceLow,
    luminanceHigh,
  };
  preparedCache.set(asset, prepared);
  return prepared;
}

export function samplePhotoField(
  prepared: PreparedPhotoField,
  settings: PhotoCompositionConfig,
  normalizedX: number,
  normalizedY: number,
  footprint?: { x: number; y: number },
): PhotoFieldSample {
  const { asset } = prepared;
  let red = 0;
  let green = 0;
  let blue = 0;
  let luminance = 0;
  let gradientX = 0;
  let gradientY = 0;
  let samples = 0;
  const normalizedOffsets = footprint
    ? [-1 / 3, 0, 1 / 3]
    : [0];
  for (const offsetY of normalizedOffsets) {
    for (const offsetX of normalizedOffsets) {
      const sampleX = normalizedX + offsetX * (footprint?.x ?? 0);
      const sampleY = normalizedY + offsetY * (footprint?.y ?? 0);
      const rasterX = clamp((sampleX + 1) / 2, 0, 1) * (asset.width - 1);
      // Generator coordinates and canonical raster rows both increase downward.
      const rasterY = clamp((sampleY + 1) / 2, 0, 1) * (asset.height - 1);
      const x0 = Math.floor(rasterX);
      const y0 = Math.floor(rasterY);
      const x1 = Math.min(asset.width - 1, x0 + 1);
      const y1 = Math.min(asset.height - 1, y0 + 1);
      const tx = rasterX - x0;
      const ty = rasterY - y0;
      for (const [x, y, weight] of [
        [x0, y0, (1 - tx) * (1 - ty)],
        [x1, y0, tx * (1 - ty)],
        [x0, y1, (1 - tx) * ty],
        [x1, y1, tx * ty],
      ] as const) {
        if (weight === 0) continue;
        const index = pixelIndex(asset.width, asset.height, x, y);
        const color = compositeRgbaPixel(asset.rgba8, index * 4);
        red += color.r * weight;
        green += color.g * weight;
        blue += color.b * weight;
        luminance += prepared.luminance[index] * weight;
        gradientX += prepared.gradientX[index] * weight;
        gradientY += prepared.gradientY[index] * weight;
        samples += weight;
      }
    }
  }
  luminance /= samples;
  const span = prepared.luminanceHigh - prepared.luminanceLow;
  let normalizedTone = span < 1e-8
    ? 0.5
    : clamp((luminance - prepared.luminanceLow) / span, 0, 1);
  const contrastScale = 0.5 + settings.toneContrast * 1.5;
  normalizedTone = clamp((normalizedTone - 0.5) * contrastScale + 0.5, 0, 1);
  const toneConfidence = clamp(
    (span - MIN_USEFUL_TONE_SPAN) / (FULL_TONE_SPAN - MIN_USEFUL_TONE_SPAN),
    0,
    1,
  );
  let value = toneConfidence === 0
    ? 0
    : (normalizedTone * 2 - 1) * toneConfidence;
  if (settings.toneMode === "dark-raised" && value !== 0) value *= -1;
  const gradientMagnitude = Math.hypot(gradientX, gradientY) / samples;
  const relativeDirectionConfidence = prepared.gradientP95 <= 1e-8
    ? 0
    : clamp(gradientMagnitude / prepared.gradientP95, 0, 1);
  const absoluteDirectionConfidence = clamp(
    (prepared.gradientP95 - MIN_USEFUL_DIRECTION_GRADIENT) /
      (FULL_DIRECTION_GRADIENT - MIN_USEFUL_DIRECTION_GRADIENT),
    0,
    1,
  );
  const directionConfidence = relativeDirectionConfidence * absoluteDirectionConfidence;
  const baseAngle = directionConfidence >= 0.08
    ? Math.atan2(gradientY, gradientX)
    : undefined;
  const angleRad = baseAngle === undefined
    ? undefined
    : settings.directionMode === "contour"
      ? baseAngle + Math.PI / 2
      : baseAngle;
  return {
    value,
    angleRad,
    directionConfidence,
    sourceColor: {
      r: red / samples,
      g: green / samples,
      b: blue / samples,
    },
  };
}
