import { describe, expect, it, vi } from "vitest";

import {
  canonicalDimensions,
  decodePhotoFile,
  detectPhotoFileType,
  drawPhotoCrop,
  isAnimatedPhotoBytes,
  readEncodedPhotoDimensions,
} from "./canonicalize";

function ascii(value: string): number[] {
  return Array.from(value, (character) => character.charCodeAt(0));
}

function uint32BigEndian(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function uint32LittleEndian(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function pngHeader(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0x89, ...ascii("PNG"), 0x0d, 0x0a, 0x1a, 0x0a,
    0, 0, 0, 13, ...ascii("IHDR"),
    ...uint32BigEndian(width), ...uint32BigEndian(height),
    8, 6, 0, 0, 0, 0, 0, 0, 0,
  ]);
}

function webpChunk(name: string, payload: number[]): Uint8Array {
  const paddedPayload = payload.length % 2 === 0 ? payload : [...payload, 0];
  const riffLength = 4 + 8 + paddedPayload.length;
  return new Uint8Array([
    ...ascii("RIFF"), ...uint32LittleEndian(riffLength), ...ascii("WEBP"),
    ...ascii(name), ...uint32LittleEndian(payload.length), ...paddedPayload,
  ]);
}

function extendedWebp(chunks: Array<{ name: string; payload: number[] }>): Uint8Array {
  const chunkBytes = chunks.flatMap(({ name, payload }) => {
    const paddedPayload = payload.length % 2 === 0 ? payload : [...payload, 0];
    return [...ascii(name), ...uint32LittleEndian(payload.length), ...paddedPayload];
  });
  return new Uint8Array([
    ...ascii("RIFF"),
    ...uint32LittleEndian(4 + chunkBytes.length),
    ...ascii("WEBP"),
    ...chunkBytes,
  ]);
}

describe("photo file inspection", () => {
  it("bounds the crop raster while preserving wide and tall artwork aspects", () => {
    expect(canonicalDimensions(10)).toEqual({ width: 512, height: 51 });
    expect(canonicalDimensions(1 / 30)).toEqual({ width: 17, height: 512 });
  });

  it("applies crop rotation and flips through a bounded target transform", () => {
    const context = {
      clearRect: vi.fn(),
      save: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      rotate: vi.fn(),
      drawImage: vi.fn(),
      restore: vi.fn(),
      imageSmoothingEnabled: false,
      imageSmoothingQuality: "low",
    } as unknown as CanvasRenderingContext2D;
    const bitmap = { width: 400, height: 200 } as ImageBitmap;

    drawPhotoCrop(context, bitmap, 200, 200, {
      fit: "cover",
      zoom: 1,
      offsetX: 0,
      offsetY: 0,
      rotationDeg: 90,
      flipHorizontal: true,
      flipVertical: false,
    });

    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 200, 200);
    expect(context.translate).toHaveBeenCalledWith(100, 100);
    expect(context.scale).toHaveBeenCalledWith(-1, 1);
    expect(context.rotate).toHaveBeenCalledWith(Math.PI / 2);
    expect(context.drawImage).toHaveBeenCalledWith(bitmap, -200, -100);
    expect(context.restore).toHaveBeenCalledOnce();
  });
  it("recognizes supported formats from bytes rather than filenames", () => {
    expect(detectPhotoFileType(new Uint8Array([0xff, 0xd8, 0xff]))).toBe("jpeg");
    expect(detectPhotoFileType(new Uint8Array([0x89, ...ascii("PNG"), 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("png");
    expect(detectPhotoFileType(new Uint8Array([...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")]))).toBe("webp");
    expect(detectPhotoFileType(new Uint8Array(ascii("not an image")))).toBeUndefined();
  });

  it("rejects animated PNG and WebP containers", () => {
    const animatedPng = new Uint8Array([
      0x89, ...ascii("PNG"), 0x0d, 0x0a, 0x1a, 0x0a,
      0, 0, 0, 8, ...ascii("acTL"), 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    const animatedWebp = new Uint8Array([
      ...ascii("RIFF"), 20, 0, 0, 0, ...ascii("WEBP"),
      ...ascii("VP8X"), 10, 0, 0, 0, 0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(isAnimatedPhotoBytes(animatedPng, "png")).toBe(true);
    expect(isAnimatedPhotoBytes(animatedWebp, "webp")).toBe(true);
    expect(isAnimatedPhotoBytes(new Uint8Array([0xff, 0xd8, 0xff]), "jpeg")).toBe(false);
  });

  it("reads dimensions from PNG, JPEG, and each still WebP frame header", () => {
    const jpeg = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xe0, 0, 4, 0, 0,
      0xff, 0xc2, 0, 8, 8, 0, 200, 1, 44, 1,
    ]);
    const vp8x = webpChunk("VP8X", [0, 0, 0, 0, 0x2b, 1, 0, 0xc7, 0, 0]);
    const vp8l = webpChunk("VP8L", [0x2f, 0x2b, 0x40, 0x1f, 0]);
    const vp8 = webpChunk("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, 0x2c, 0x01, 0xc8, 0]);

    expect(readEncodedPhotoDimensions(pngHeader(300, 200), "png")).toEqual({ width: 300, height: 200 });
    expect(readEncodedPhotoDimensions(jpeg, "jpeg")).toEqual({ width: 300, height: 200 });
    expect(readEncodedPhotoDimensions(vp8x, "webp")).toEqual({ width: 300, height: 200 });
    expect(readEncodedPhotoDimensions(vp8l, "webp")).toEqual({ width: 44, height: 126 });
    expect(readEncodedPhotoDimensions(vp8, "webp")).toEqual({ width: 300, height: 200 });
  });

  it("rejects missing, zero, and truncated encoded dimension headers", () => {
    const zeroWidthPng = pngHeader(0, 200);
    const truncatedJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0]);
    const malformedWebp = webpChunk("VP8X", [0, 0, 0]);

    expect(() => readEncodedPhotoDimensions(zeroWidthPng, "png")).toThrow(/invalid or unsupported dimensions/i);
    expect(() => readEncodedPhotoDimensions(truncatedJpeg, "jpeg")).toThrow(/invalid or unsupported dimensions/i);
    expect(() => readEncodedPhotoDimensions(malformedWebp, "webp")).toThrow(/invalid or unsupported dimensions/i);
  });

  it("rejects an oversized encoded image before createImageBitmap runs", async () => {
    const createImageBitmapMock = vi.fn();
    vi.stubGlobal("createImageBitmap", createImageBitmapMock);
    try {
      const encoded = pngHeader(6000, 5000);
      const file = new File([encoded.slice().buffer as ArrayBuffer], "oversized.png", { type: "image/png" });
      await expect(decodePhotoFile(file)).rejects.toThrow(/encoded image exceeds the 24-megapixel safety limit/i);
      expect(createImageBitmapMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects an extended WebP whose small canvas hides a larger frame before decode", async () => {
    const createImageBitmapMock = vi.fn();
    vi.stubGlobal("createImageBitmap", createImageBitmapMock);
    try {
      const encoded = extendedWebp([
        {
          name: "VP8X",
          payload: [0, 0, 0, 0, 99, 0, 0, 99, 0, 0],
        },
        {
          name: "VP8 ",
          payload: [
            0, 0, 0, 0x9d, 0x01, 0x2a,
            ...[6000 & 0xff, 6000 >>> 8],
            ...[5000 & 0xff, 5000 >>> 8],
          ],
        },
      ]);
      const file = new File([encoded.slice().buffer as ArrayBuffer], "mismatched.webp", { type: "image/webp" });
      await expect(decodePhotoFile(file)).rejects.toThrow(/invalid or unsupported dimensions/i);
      expect(createImageBitmapMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
