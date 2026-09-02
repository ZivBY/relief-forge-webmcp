import { canonicalPhotoSha256 } from "../core/photo-color";
import type { PhotoFieldAsset } from "../core/types";

export type PhotoFitMode = "cover" | "contain" | "stretch";

export interface PhotoCropTransform {
  fit: PhotoFitMode;
  zoom: number;
  offsetX: number;
  offsetY: number;
  rotationDeg: 0 | 90 | 180 | 270;
  flipHorizontal: boolean;
  flipVertical: boolean;
}

export const DEFAULT_PHOTO_CROP: PhotoCropTransform = {
  fit: "cover",
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  rotationDeg: 0,
  flipHorizontal: false,
  flipVertical: false,
};

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_DECODED_PIXELS = 24_000_000;

export type SupportedPhotoFileType = "jpeg" | "png" | "webp";

export interface EncodedPhotoDimensions {
  width: number;
  height: number;
}

export function detectPhotoFileType(bytes: Uint8Array): SupportedPhotoFileType | undefined {
  const png = bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp = bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (png) return "png";
  if (jpeg) return "jpeg";
  if (webp) return "webp";
  return undefined;
}

function chunkName(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function invalidEncodedDimensions(): never {
  throw new Error("The encoded image has invalid or unsupported dimensions.");
}

function checkedDimensions(width: number, height: number): EncodedPhotoDimensions {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return invalidEncodedDimensions();
  }
  return { width, height };
}

function uint16BigEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset] * 0x100 + bytes[offset + 1];
}

function uint24LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + bytes[offset + 1] * 0x100 + bytes[offset + 2] * 0x10000;
}

function uint32LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset] +
    bytes[offset + 1] * 0x100 +
    bytes[offset + 2] * 0x10000 +
    bytes[offset + 3] * 0x1000000;
}

function readPngDimensions(bytes: Uint8Array): EncodedPhotoDimensions {
  if (
    bytes.length < 24 ||
    detectPhotoFileType(bytes) !== "png" ||
    new DataView(bytes.buffer, bytes.byteOffset + 8, 4).getUint32(0) !== 13 ||
    chunkName(bytes, 12) !== "IHDR"
  ) {
    return invalidEncodedDimensions();
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset + 16, 8);
  return checkedDimensions(view.getUint32(0), view.getUint32(4));
}

const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3,
  0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb,
  0xcd, 0xce, 0xcf,
]);

function readJpegDimensions(bytes: Uint8Array): EncodedPhotoDimensions {
  if (bytes.length < 4 || detectPhotoFileType(bytes) !== "jpeg") {
    return invalidEncodedDimensions();
  }
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return invalidEncodedDimensions();
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return invalidEncodedDimensions();
    const marker = bytes[offset];
    offset += 1;

    // Byte stuffing is only valid inside entropy-coded scan data, which cannot
    // occur before the frame header that supplies the dimensions.
    if (marker === 0x00) return invalidEncodedDimensions();
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9 || marker === 0xda) return invalidEncodedDimensions();
    if (offset + 2 > bytes.length) return invalidEncodedDimensions();

    const segmentLength = uint16BigEndian(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) {
      return invalidEncodedDimensions();
    }
    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (segmentLength < 8) return invalidEncodedDimensions();
      const height = uint16BigEndian(bytes, offset + 3);
      const width = uint16BigEndian(bytes, offset + 5);
      return checkedDimensions(width, height);
    }
    offset += segmentLength;
  }
  return invalidEncodedDimensions();
}

function readWebpDimensions(bytes: Uint8Array): EncodedPhotoDimensions {
  if (bytes.length < 20 || detectPhotoFileType(bytes) !== "webp") {
    return invalidEncodedDimensions();
  }
  const riffLength = uint32LittleEndian(bytes, 4);
  const containerEnd = riffLength + 8;
  if (riffLength < 4 || containerEnd > bytes.length) return invalidEncodedDimensions();

  let canvasDimensions: EncodedPhotoDimensions | undefined;
  let frameDimensions: EncodedPhotoDimensions | undefined;
  for (let offset = 12; offset + 8 <= containerEnd;) {
    const name = chunkName(bytes, offset);
    const chunkLength = uint32LittleEndian(bytes, offset + 4);
    const payload = offset + 8;
    const payloadEnd = payload + chunkLength;
    if (payloadEnd > containerEnd) return invalidEncodedDimensions();

    if (name === "VP8X") {
      if (chunkLength < 10 || canvasDimensions) return invalidEncodedDimensions();
      canvasDimensions = checkedDimensions(
        uint24LittleEndian(bytes, payload + 4) + 1,
        uint24LittleEndian(bytes, payload + 7) + 1,
      );
    } else if (name === "VP8L") {
      if (chunkLength < 5 || bytes[payload] !== 0x2f || frameDimensions) {
        return invalidEncodedDimensions();
      }
      const byte1 = bytes[payload + 1];
      const byte2 = bytes[payload + 2];
      const byte3 = bytes[payload + 3];
      const byte4 = bytes[payload + 4];
      frameDimensions = checkedDimensions(
        1 + byte1 + ((byte2 & 0x3f) << 8),
        1 + (byte2 >> 6) + (byte3 << 2) + ((byte4 & 0x0f) << 10),
      );
    } else if (name === "VP8 ") {
      if (
        chunkLength < 10 ||
        frameDimensions ||
        (bytes[payload] & 0x01) !== 0 ||
        bytes[payload + 3] !== 0x9d ||
        bytes[payload + 4] !== 0x01 ||
        bytes[payload + 5] !== 0x2a
      ) {
        return invalidEncodedDimensions();
      }
      const width = (bytes[payload + 6] + bytes[payload + 7] * 0x100) & 0x3fff;
      const height = (bytes[payload + 8] + bytes[payload + 9] * 0x100) & 0x3fff;
      frameDimensions = checkedDimensions(width, height);
    }

    const paddedEnd = payloadEnd + (chunkLength % 2);
    if (paddedEnd > containerEnd) return invalidEncodedDimensions();
    offset = paddedEnd;
  }
  if (
    canvasDimensions &&
    frameDimensions &&
    (canvasDimensions.width !== frameDimensions.width ||
      canvasDimensions.height !== frameDimensions.height)
  ) {
    return invalidEncodedDimensions();
  }
  return canvasDimensions ?? frameDimensions ?? invalidEncodedDimensions();
}

export function readEncodedPhotoDimensions(
  bytes: Uint8Array,
  type: SupportedPhotoFileType,
): EncodedPhotoDimensions {
  if (type === "png") return readPngDimensions(bytes);
  if (type === "jpeg") return readJpegDimensions(bytes);
  return readWebpDimensions(bytes);
}

function exceedsDecodedPixelLimit(dimensions: EncodedPhotoDimensions): boolean {
  return dimensions.width > Math.floor(MAX_DECODED_PIXELS / dimensions.height);
}

export function isAnimatedPhotoBytes(bytes: Uint8Array, type: SupportedPhotoFileType): boolean {
  if (type === "jpeg") return false;
  if (type === "png") {
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
      if (chunkName(bytes, offset + 4) === "acTL") return true;
      if (length > bytes.length - offset - 12) return false;
      offset += length + 12;
    }
    return false;
  }
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const name = chunkName(bytes, offset);
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset + 4, 4).getUint32(0, true);
    if (name === "ANIM" || name === "ANMF") return true;
    if (name === "VP8X" && length >= 1 && offset + 8 < bytes.length && (bytes[offset + 8] & 0x02) !== 0) {
      return true;
    }
    if (length > bytes.length - offset - 8) return false;
    offset += 8 + length + (length % 2);
  }
  return false;
}

export async function decodePhotoFile(file: File): Promise<ImageBitmap> {
  if (file.size === 0) throw new Error("Choose a non-empty image file.");
  if (file.size > MAX_FILE_BYTES) throw new Error("Choose an image no larger than 25 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = detectPhotoFileType(bytes);
  if (!type) {
    throw new Error("Choose a valid JPEG, PNG, or still WebP image.");
  }
  if (isAnimatedPhotoBytes(bytes, type)) {
    throw new Error("Animated PNG and WebP files are not supported. Choose a still image.");
  }
  const encodedDimensions = readEncodedPhotoDimensions(bytes, type);
  if (exceedsDecodedPixelLimit(encodedDimensions)) {
    throw new Error("The encoded image exceeds the 24-megapixel safety limit.");
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("This image could not be decoded. Try a non-animated JPEG, PNG, or WebP file.");
  }
  if (!(bitmap.width > 0) || !(bitmap.height > 0)) {
    bitmap.close();
    throw new Error("The decoded image has invalid dimensions.");
  }
  if (exceedsDecodedPixelLimit(bitmap)) {
    bitmap.close();
    throw new Error("The decoded image exceeds the 24-megapixel safety limit.");
  }
  return bitmap;
}

export function drawPhotoCrop(
  context: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  targetWidth: number,
  targetHeight: number,
  transform: PhotoCropTransform,
): void {
  const quarterTurn = transform.rotationDeg === 90 || transform.rotationDeg === 270;
  const orientedWidth = quarterTurn ? bitmap.height : bitmap.width;
  const orientedHeight = quarterTurn ? bitmap.width : bitmap.height;
  context.clearRect(0, 0, targetWidth, targetHeight);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  let scaleX: number;
  let scaleY: number;
  let centerX = targetWidth / 2;
  let centerY = targetHeight / 2;
  if (transform.fit === "stretch") {
    scaleX = targetWidth / orientedWidth;
    scaleY = targetHeight / orientedHeight;
  } else {
  const baseScale = transform.fit === "cover"
      ? Math.max(targetWidth / orientedWidth, targetHeight / orientedHeight)
      : Math.min(targetWidth / orientedWidth, targetHeight / orientedHeight);
  const scale = baseScale * Math.max(1, Math.min(4, transform.zoom));
    scaleX = scale;
    scaleY = scale;
  const width = orientedWidth * scale;
  const height = orientedHeight * scale;
  const overflowX = Math.max(0, width - targetWidth);
  const overflowY = Math.max(0, height - targetHeight);
    centerX += transform.offsetX * overflowX / 2;
    centerY += transform.offsetY * overflowY / 2;
  }
  context.save();
  context.translate(centerX, centerY);
  context.scale(
    scaleX * (transform.flipHorizontal ? -1 : 1),
    scaleY * (transform.flipVertical ? -1 : 1),
  );
  context.rotate((transform.rotationDeg * Math.PI) / 180);
  context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  context.restore();
}

export function canonicalDimensions(aspectRatio: number): { width: number; height: number } {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    throw new Error("Artwork aspect ratio must be a positive finite number.");
  }
  return aspectRatio >= 1
    ? { width: 512, height: Math.max(1, Math.round(512 / aspectRatio)) }
    : { width: Math.max(1, Math.round(512 * aspectRatio)), height: 512 };
}

export function canonicalizePhoto(
  bitmap: ImageBitmap,
  aspectRatio: number,
  transform: PhotoCropTransform,
): PhotoFieldAsset {
  const dimensions = canonicalDimensions(aspectRatio);
  const canvas = document.createElement("canvas");
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });
  if (!context) throw new Error("Canvas image processing is unavailable in this browser.");
  drawPhotoCrop(context, bitmap, dimensions.width, dimensions.height, transform);
  const imageData = context.getImageData(0, 0, dimensions.width, dimensions.height);
  const rgba8 = new Uint8Array(imageData.data);
  // Hidden RGB under fully transparent pixels is normalized so it cannot alter
  // the content hash or later color analysis.
  for (let offset = 0; offset < rgba8.length; offset += 4) {
    if (rgba8[offset + 3] === 0) {
      rgba8[offset] = 0;
      rgba8[offset + 1] = 0;
      rgba8[offset + 2] = 0;
    }
  }
  return {
    version: 1,
    width: dimensions.width,
    height: dimensions.height,
    colorSpace: "srgb",
    rgba8,
    sha256: canonicalPhotoSha256(dimensions.width, dimensions.height, rgba8),
  };
}

export function drawRgbaPreview(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  rgba8: Uint8Array,
): void {
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return;
  const imageData = new ImageData(new Uint8ClampedArray(rgba8), width, height);
  context.putImageData(imageData, 0, 0);
}
