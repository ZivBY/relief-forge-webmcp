import { sha256Hex } from "../core/photo-color";

export const DEPTH_PAINT_FIELD_VERSION = 1 as const;
export const DEPTH_PAINT_LONG_EDGE_PX = 512;
export const DEPTH_PAINT_UNITS_PER_MM = 100 as const;
export const DEPTH_PAINT_MAX_ABS_MM = 200;

const DEPTH_PAINT_MAX_ABS_UNITS = DEPTH_PAINT_MAX_ABS_MM * DEPTH_PAINT_UNITS_PER_MM;
const PORTABLE_HEADER_BYTES = 20;
const PORTABLE_MAGIC = Uint8Array.from([0x52, 0x46, 0x44, 0x50, 0x41, 0x49, 0x4e, 0x54]); // RFDPAINT

/**
 * Canonical signed depth field. Raster rows and generator artwork coordinates
 * both increase downward, so no Y reflection belongs at this boundary.
 */
export interface DepthPaintFieldAsset {
  readonly version: typeof DEPTH_PAINT_FIELD_VERSION;
  readonly width: number;
  readonly height: number;
  readonly unitsPerMm: typeof DEPTH_PAINT_UNITS_PER_MM;
  readonly values: Int16Array;
  readonly sha256: string;
}

/** Bounded JSON-safe recipe data; canonical field bytes live outside recipes. */
export interface DepthPaintFieldDescriptor {
  readonly version: typeof DEPTH_PAINT_FIELD_VERSION;
  readonly assetSha256: string;
  readonly canonicalWidth: number;
  readonly canonicalHeight: number;
  readonly unitsPerMm: typeof DEPTH_PAINT_UNITS_PER_MM;
}

export type DepthPaintFieldAssets = Readonly<Record<string, DepthPaintFieldAsset>>;
export type DepthPaintSampler = (normalizedX: number, normalizedY: number) => number;

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite; received ${String(value)}.`);
  }
}

function assertCanonicalDimensions(width: number, height: number): void {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > DEPTH_PAINT_LONG_EDGE_PX ||
    height > DEPTH_PAINT_LONG_EDGE_PX
  ) {
    throw new Error(
      `Depth-paint dimensions must be integers from 1 through ${DEPTH_PAINT_LONG_EDGE_PX}.`,
    );
  }
  if (Math.max(width, height) !== DEPTH_PAINT_LONG_EDGE_PX) {
    throw new Error(`A canonical depth-paint field must have a ${DEPTH_PAINT_LONG_EDGE_PX}-pixel long edge.`);
  }
}

function assertArtworkCoordinate(name: string, value: number): void {
  assertFinite(name, value);
  if (value < -1 || value > 1) {
    throw new Error(`${name} must stay inside the normalized [-1, 1] artwork domain.`);
  }
}

function assertStoredValues(width: number, height: number, values: Int16Array): void {
  if (!(values instanceof Int16Array)) {
    throw new Error("Depth-paint values must be an Int16Array.");
  }
  if (values.length !== width * height) {
    throw new Error("Depth-paint value count does not match its dimensions.");
  }
  for (let index = 0; index < values.length; index += 1) {
    if (Math.abs(values[index]) > DEPTH_PAINT_MAX_ABS_UNITS) {
      throw new Error(
        `Depth-paint value ${index} exceeds the supported +/-${DEPTH_PAINT_MAX_ABS_MM} mm range.`,
      );
    }
  }
}

function roundSymmetrically(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

function portableBytes(width: number, height: number, values: Int16Array): Uint8Array {
  assertCanonicalDimensions(width, height);
  assertStoredValues(width, height, values);
  const bytes = new Uint8Array(PORTABLE_HEADER_BYTES + values.length * 2);
  bytes.set(PORTABLE_MAGIC, 0);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint8(8, DEPTH_PAINT_FIELD_VERSION);
  view.setUint8(9, 0);
  view.setUint16(10, width, true);
  view.setUint16(12, height, true);
  view.setUint16(14, DEPTH_PAINT_UNITS_PER_MM, true);
  view.setUint32(16, values.length, true);
  for (let index = 0; index < values.length; index += 1) {
    view.setInt16(PORTABLE_HEADER_BYTES + index * 2, values[index], true);
  }
  return bytes;
}

export function canonicalDepthPaintDimensions(
  aspectRatio: number,
): { width: number; height: number } {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    throw new Error("Artwork aspect ratio must be a positive finite number.");
  }
  return aspectRatio >= 1
    ? {
        width: DEPTH_PAINT_LONG_EDGE_PX,
        height: Math.max(1, Math.round(DEPTH_PAINT_LONG_EDGE_PX / aspectRatio)),
      }
    : {
        width: Math.max(1, Math.round(DEPTH_PAINT_LONG_EDGE_PX * aspectRatio)),
        height: DEPTH_PAINT_LONG_EDGE_PX,
      };
}

export function createDepthPaintFieldAsset(
  width: number,
  height: number,
  inputValues?: Int16Array,
): DepthPaintFieldAsset {
  assertCanonicalDimensions(width, height);
  const values = inputValues ? inputValues.slice() : new Int16Array(width * height);
  assertStoredValues(width, height, values);
  const sha256 = sha256Hex(portableBytes(width, height, values));
  return {
    version: DEPTH_PAINT_FIELD_VERSION,
    width,
    height,
    unitsPerMm: DEPTH_PAINT_UNITS_PER_MM,
    values,
    sha256,
  };
}

export function createDepthPaintField(
  aspectRatio: number,
  initialValueMm = 0,
): DepthPaintFieldAsset {
  assertFinite("initialValueMm", initialValueMm);
  if (Math.abs(initialValueMm) > DEPTH_PAINT_MAX_ABS_MM) {
    throw new Error(
      `initialValueMm must stay between -${DEPTH_PAINT_MAX_ABS_MM} and ${DEPTH_PAINT_MAX_ABS_MM} mm.`,
    );
  }
  const { width, height } = canonicalDepthPaintDimensions(aspectRatio);
  const value = roundSymmetrically(initialValueMm * DEPTH_PAINT_UNITS_PER_MM);
  const values = new Int16Array(width * height);
  if (value !== 0) values.fill(value);
  return createDepthPaintFieldAsset(width, height, values);
}

export function validateDepthPaintFieldAsset(asset: DepthPaintFieldAsset): void {
  if (asset.version !== DEPTH_PAINT_FIELD_VERSION) {
    throw new Error(`Only depth-paint field version ${DEPTH_PAINT_FIELD_VERSION} is supported.`);
  }
  if (asset.unitsPerMm !== DEPTH_PAINT_UNITS_PER_MM) {
    throw new Error(`Depth-paint fields must use ${DEPTH_PAINT_UNITS_PER_MM} signed units per mm.`);
  }
  assertCanonicalDimensions(asset.width, asset.height);
  assertStoredValues(asset.width, asset.height, asset.values);
  if (!/^[0-9a-f]{64}$/.test(asset.sha256)) {
    throw new Error("Depth-paint asset SHA-256 must be a lowercase hexadecimal digest.");
  }
  const actualSha256 = sha256Hex(portableBytes(asset.width, asset.height, asset.values));
  if (asset.sha256 !== actualSha256) {
    throw new Error("Depth-paint values do not match their SHA-256 identifier.");
  }
}

export function copyDepthPaintFieldAsset(asset: DepthPaintFieldAsset): DepthPaintFieldAsset {
  validateDepthPaintFieldAsset(asset);
  return {
    version: asset.version,
    width: asset.width,
    height: asset.height,
    unitsPerMm: asset.unitsPerMm,
    values: asset.values.slice(),
    sha256: asset.sha256,
  };
}

export function encodeDepthPaintFieldAsset(asset: DepthPaintFieldAsset): Uint8Array {
  validateDepthPaintFieldAsset(asset);
  return portableBytes(asset.width, asset.height, asset.values);
}

export function decodeDepthPaintFieldAsset(bytes: Uint8Array): DepthPaintFieldAsset {
  if (!(bytes instanceof Uint8Array)) {
    throw new Error("Portable depth-paint data must be a Uint8Array.");
  }
  if (bytes.byteLength < PORTABLE_HEADER_BYTES) {
    throw new Error("Portable depth-paint data is truncated.");
  }
  for (let index = 0; index < PORTABLE_MAGIC.length; index += 1) {
    if (bytes[index] !== PORTABLE_MAGIC[index]) {
      throw new Error("Portable depth-paint data has an invalid format signature.");
    }
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint8(8) !== DEPTH_PAINT_FIELD_VERSION) {
    throw new Error(`Only portable depth-paint version ${DEPTH_PAINT_FIELD_VERSION} is supported.`);
  }
  if (view.getUint8(9) !== 0) {
    throw new Error("Portable depth-paint reserved header data must be zero.");
  }
  const width = view.getUint16(10, true);
  const height = view.getUint16(12, true);
  const unitsPerMm = view.getUint16(14, true);
  const valueCount = view.getUint32(16, true);
  assertCanonicalDimensions(width, height);
  if (unitsPerMm !== DEPTH_PAINT_UNITS_PER_MM) {
    throw new Error(`Portable depth-paint data must use ${DEPTH_PAINT_UNITS_PER_MM} units per mm.`);
  }
  if (valueCount !== width * height) {
    throw new Error("Portable depth-paint value count does not match its dimensions.");
  }
  if (bytes.byteLength !== PORTABLE_HEADER_BYTES + valueCount * 2) {
    throw new Error("Portable depth-paint byte length does not match its canonical field.");
  }
  const values = new Int16Array(valueCount);
  for (let index = 0; index < valueCount; index += 1) {
    values[index] = view.getInt16(PORTABLE_HEADER_BYTES + index * 2, true);
  }
  return createDepthPaintFieldAsset(width, height, values);
}

export function createDepthPaintFieldDescriptor(
  asset: DepthPaintFieldAsset,
): DepthPaintFieldDescriptor {
  validateDepthPaintFieldAsset(asset);
  return {
    version: DEPTH_PAINT_FIELD_VERSION,
    assetSha256: asset.sha256,
    canonicalWidth: asset.width,
    canonicalHeight: asset.height,
    unitsPerMm: DEPTH_PAINT_UNITS_PER_MM,
  };
}

export function validateDepthPaintFieldDescriptor(
  descriptor: DepthPaintFieldDescriptor,
): void {
  const allowedKeys = new Set([
    "version",
    "assetSha256",
    "canonicalWidth",
    "canonicalHeight",
    "unitsPerMm",
  ]);
  const unknownKey = Object.keys(descriptor).find((key) => !allowedKeys.has(key));
  if (unknownKey) {
    throw new Error(`Depth-paint descriptor contains unsupported field ${JSON.stringify(unknownKey)}.`);
  }
  if (descriptor.version !== DEPTH_PAINT_FIELD_VERSION) {
    throw new Error(`Only depth-paint descriptor version ${DEPTH_PAINT_FIELD_VERSION} is supported.`);
  }
  if (!/^[0-9a-f]{64}$/.test(descriptor.assetSha256)) {
    throw new Error("Depth-paint descriptor assetSha256 must be a lowercase SHA-256 digest.");
  }
  if (descriptor.unitsPerMm !== DEPTH_PAINT_UNITS_PER_MM) {
    throw new Error(`Depth-paint descriptors must use ${DEPTH_PAINT_UNITS_PER_MM} units per mm.`);
  }
  assertCanonicalDimensions(descriptor.canonicalWidth, descriptor.canonicalHeight);
}

export function resolveDepthPaintFieldAsset(
  descriptor: DepthPaintFieldDescriptor,
  assets: DepthPaintFieldAssets,
): DepthPaintFieldAsset {
  validateDepthPaintFieldDescriptor(descriptor);
  const asset = assets[descriptor.assetSha256];
  if (!asset) {
    throw new Error("This depth-paint field is not available on this device or in the portable project.");
  }
  validateDepthPaintFieldAsset(asset);
  if (
    asset.sha256 !== descriptor.assetSha256 ||
    asset.width !== descriptor.canonicalWidth ||
    asset.height !== descriptor.canonicalHeight ||
    asset.unitsPerMm !== descriptor.unitsPerMm
  ) {
    throw new Error("The available depth-paint field does not match its project descriptor.");
  }
  return asset;
}

function sampleUnchecked(
  asset: DepthPaintFieldAsset,
  normalizedX: number,
  normalizedY: number,
): number {
  assertArtworkCoordinate("normalizedX", normalizedX);
  assertArtworkCoordinate("normalizedY", normalizedY);
  const rasterX = (normalizedX + 1) / 2 * (asset.width - 1);
  // Canonical rows and generator coordinates both increase downward.
  const rasterY = (normalizedY + 1) / 2 * (asset.height - 1);
  const x0 = Math.floor(rasterX);
  const y0 = Math.floor(rasterY);
  const x1 = Math.min(asset.width - 1, x0 + 1);
  const y1 = Math.min(asset.height - 1, y0 + 1);
  const tx = rasterX - x0;
  const ty = rasterY - y0;
  const top = asset.values[y0 * asset.width + x0] * (1 - tx) +
    asset.values[y0 * asset.width + x1] * tx;
  const bottom = asset.values[y1 * asset.width + x0] * (1 - tx) +
    asset.values[y1 * asset.width + x1] * tx;
  return (top * (1 - ty) + bottom * ty) / asset.unitsPerMm;
}

/**
 * Pure bilinear sampling for an already validated asset. Use
 * createDepthPaintSampler at repeated geometry call sites to validate once.
 */
export function sampleDepthPaintField(
  asset: DepthPaintFieldAsset,
  normalizedX: number,
  normalizedY: number,
): number {
  return sampleUnchecked(asset, normalizedX, normalizedY);
}

/** Validate/hash once, then reuse the returned pure sampler across a mesh. */
export function createDepthPaintSampler(asset: DepthPaintFieldAsset): DepthPaintSampler {
  validateDepthPaintFieldAsset(asset);
  const stableAsset: DepthPaintFieldAsset = {
    ...asset,
    values: asset.values.slice(),
  };
  return (normalizedX, normalizedY) => sampleUnchecked(stableAsset, normalizedX, normalizedY);
}
