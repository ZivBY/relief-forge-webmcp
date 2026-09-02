import { describe, expect, it } from "vitest";

import {
  DEPTH_PAINT_LONG_EDGE_PX,
  DEPTH_PAINT_UNITS_PER_MM,
  canonicalDepthPaintDimensions,
  copyDepthPaintFieldAsset,
  createDepthPaintField,
  createDepthPaintFieldAsset,
  createDepthPaintFieldDescriptor,
  createDepthPaintSampler,
  decodeDepthPaintFieldAsset,
  encodeDepthPaintFieldAsset,
  resolveDepthPaintFieldAsset,
  sampleDepthPaintField,
  validateDepthPaintFieldAsset,
  validateDepthPaintFieldDescriptor,
} from "./field";
import type { DepthPaintFieldDescriptor } from "./field";

describe("canonical depth-paint fields", () => {
  it("uses a 512-pixel long edge with aspect-aware dimensions", () => {
    expect(canonicalDepthPaintDimensions(1)).toEqual({ width: 512, height: 512 });
    expect(canonicalDepthPaintDimensions(2)).toEqual({ width: 512, height: 256 });
    expect(canonicalDepthPaintDimensions(0.5)).toEqual({ width: 256, height: 512 });
    expect(canonicalDepthPaintDimensions(1_000)).toEqual({ width: 512, height: 1 });
    expect(canonicalDepthPaintDimensions(0.001)).toEqual({ width: 1, height: 512 });
    expect(() => canonicalDepthPaintDimensions(0)).toThrow(/positive finite/);
    expect(() => canonicalDepthPaintDimensions(Number.NaN)).toThrow(/positive finite/);
  });

  it("creates bounded signed Int16 fields at hundredths of a millimetre", () => {
    const field = createDepthPaintField(512, -12.34);
    expect(field.width).toBe(DEPTH_PAINT_LONG_EDGE_PX);
    expect(field.height).toBe(1);
    expect(field.unitsPerMm).toBe(DEPTH_PAINT_UNITS_PER_MM);
    expect(field.values).toBeInstanceOf(Int16Array);
    expect(field.values[0]).toBe(-1_234);
    expect(sampleDepthPaintField(field, 0, 0)).toBe(-12.34);
    expect(createDepthPaintField(512, 0.015).values[0]).toBe(2);
    expect(createDepthPaintField(512, -0.015).values[0]).toBe(-2);
    expect(() => createDepthPaintField(1, 200.01)).toThrow(/-200 and 200/);
  });

  it("samples bilinearly with canonical rows increasing in +Y-down order", () => {
    const values = new Int16Array(512);
    for (let y = 0; y < values.length; y += 1) {
      values[y] = Math.round(-100 + y / 511 * 200);
    }
    const field = createDepthPaintFieldAsset(1, 512, values);
    expect(sampleDepthPaintField(field, 0, -1)).toBe(-1);
    expect(sampleDepthPaintField(field, 0, 1)).toBe(1);
    expect(sampleDepthPaintField(field, 0, 0)).toBeCloseTo(0, 2);

    const sampler = createDepthPaintSampler(field);
    expect(sampler(0, -1)).toBe(-1);
    expect(sampler(0, 1)).toBe(1);
    expect(() => sampler(0, 1.001)).toThrow(/\[-1, 1\]/);
    field.values[0] = 20_000;
    expect(sampler(0, -1)).toBe(-1);
  });

  it("encodes deterministically and round-trips exact little-endian values", () => {
    const values = new Int16Array(512);
    values[0] = -20_000;
    values[1] = -123;
    values[2] = 456;
    values[511] = 20_000;
    const field = createDepthPaintFieldAsset(512, 1, values);
    const first = encodeDepthPaintFieldAsset(field);
    const second = encodeDepthPaintFieldAsset(copyDepthPaintFieldAsset(field));
    expect(second).toEqual(first);
    expect(first.byteLength).toBe(20 + field.values.length * 2);

    const decoded = decodeDepthPaintFieldAsset(first);
    expect(decoded.sha256).toBe(field.sha256);
    expect(decoded.width).toBe(field.width);
    expect(decoded.height).toBe(field.height);
    expect(decoded.values).toEqual(field.values);
  });

  it("hashes dimensions and canonical signed values and detects stale identities", () => {
    const values = new Int16Array(512);
    const horizontal = createDepthPaintFieldAsset(512, 1, values);
    const vertical = createDepthPaintFieldAsset(1, 512, values);
    expect(vertical.sha256).not.toBe(horizontal.sha256);

    const changedValues = values.slice();
    changedValues[0] = 1;
    const changed = createDepthPaintFieldAsset(512, 1, changedValues);
    expect(changed.sha256).not.toBe(horizontal.sha256);

    const stale = copyDepthPaintFieldAsset(horizontal);
    stale.values[0] = 1;
    expect(() => validateDepthPaintFieldAsset(stale)).toThrow(/SHA-256/);
  });

  it("uses a bounded metadata-free descriptor and resolves only matching assets", () => {
    const field = createDepthPaintField(512);
    const descriptor = createDepthPaintFieldDescriptor(field);
    expect(descriptor).toEqual({
      version: 1,
      assetSha256: field.sha256,
      canonicalWidth: 512,
      canonicalHeight: 1,
      unitsPerMm: 100,
    });
    expect(Object.keys(descriptor).sort()).toEqual([
      "assetSha256",
      "canonicalHeight",
      "canonicalWidth",
      "unitsPerMm",
      "version",
    ]);
    expect(JSON.stringify(descriptor)).not.toMatch(/filename|source|path|data:|blob:/i);
    expect(resolveDepthPaintFieldAsset(descriptor, { [field.sha256]: field })).toBe(field);
    expect(() => resolveDepthPaintFieldAsset(descriptor, {})).toThrow(/not available/);

    const privateDescriptor = {
      ...descriptor,
      sourcePath: "C:\\private\\source.png",
    } as DepthPaintFieldDescriptor;
    expect(() => validateDepthPaintFieldDescriptor(privateDescriptor)).toThrow(/sourcePath/);
  });

  it("rejects malformed, extended, or out-of-range portable data", () => {
    const field = createDepthPaintField(512);
    const bytes = encodeDepthPaintFieldAsset(field);

    expect(() => decodeDepthPaintFieldAsset(bytes.slice(0, 10))).toThrow(/truncated/);
    const wrongMagic = bytes.slice();
    wrongMagic[0] = 0;
    expect(() => decodeDepthPaintFieldAsset(wrongMagic)).toThrow(/signature/);
    const reserved = bytes.slice();
    reserved[9] = 1;
    expect(() => decodeDepthPaintFieldAsset(reserved)).toThrow(/reserved/);
    const extended = new Uint8Array(bytes.length + 8);
    extended.set(bytes);
    extended.set(new TextEncoder().encode("private!"), bytes.length);
    expect(() => decodeDepthPaintFieldAsset(extended)).toThrow(/byte length/);

    const outOfRange = bytes.slice();
    const view = new DataView(outOfRange.buffer);
    view.setInt16(20, 32_767, true);
    expect(() => decodeDepthPaintFieldAsset(outOfRange)).toThrow(/exceeds/);
  });
});
