import { describe, expect, it } from "vitest";

import {
  canonicalPhotoSha256,
  deltaE76,
  mapPhotoToPalette,
  quantizePhotoPalette,
  rgbToLab,
  sha256Hex,
} from "./photo-color";

function rgba(colors: Array<[number, number, number, number?]>): Uint8Array {
  return Uint8Array.from(colors.flatMap(([red, green, blue, alpha = 255]) => [red, green, blue, alpha]));
}

describe("photo color and identity", () => {
  it("matches standard SHA-256 reference vectors", () => {
    expect(sha256Hex(new Uint8Array())).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("includes dimensions and exact canonical bytes in the photo digest", () => {
    const pixels = rgba([[1, 2, 3], [4, 5, 6]]);
    const original = canonicalPhotoSha256(2, 1, pixels);
    expect(canonicalPhotoSha256(1, 2, pixels)).not.toBe(original);
    const changed = pixels.slice();
    changed[4] += 1;
    expect(canonicalPhotoSha256(2, 1, changed)).not.toBe(original);
  });

  it("uses stable D65 Lab reference endpoints", () => {
    expect(rgbToLab({ r: 0, g: 0, b: 0 })).toEqual({ l: 0, a: 0, b: 0 });
    const white = rgbToLab({ r: 255, g: 255, b: 255 });
    expect(white.l).toBeCloseTo(100, 4);
    expect(white.a).toBeCloseTo(0, 3);
    expect(white.b).toBeCloseTo(0, 3);
    expect(deltaE76(white, white)).toBe(0);
  });

  it("extracts a deterministic dark-to-light palette capped at ten colors", () => {
    const pixels = rgba(Array.from({ length: 20 }, (_, index) => [
      (index * 31) % 256,
      (index * 67) % 256,
      (index * 109) % 256,
    ]));
    const first = quantizePhotoPalette(pixels, 10);
    const second = quantizePhotoPalette(pixels, 10);
    expect(second).toEqual(first);
    expect(first.colors).toHaveLength(10);
    expect(new Set(first.colors).size).toBe(first.colors.length);
    const lightness = first.colors.map((hex) => rgbToLab({
      r: Number.parseInt(hex.slice(1, 3), 16),
      g: Number.parseInt(hex.slice(3, 5), 16),
      b: Number.parseInt(hex.slice(5, 7), 16),
    }).l);
    expect(lightness).toEqual([...lightness].sort((left, right) => left - right));
  });

  it("returns fewer colors rather than inventing duplicates", () => {
    const pixels = rgba([
      [10, 20, 30], [10, 20, 30], [240, 230, 220], [240, 230, 220],
    ]);
    const result = quantizePhotoPalette(pixels, 10);
    expect(result.colors).toHaveLength(2);
    expect(result.averageDeltaE).toBeGreaterThanOrEqual(0);
    expect(result.p95DeltaE).toBeGreaterThanOrEqual(result.averageDeltaE);
  });

  it("maps previews to the exact supplied filament palette in Lab space", () => {
    const pixels = rgba([[245, 15, 20], [15, 20, 240], [130, 20, 125]]);
    const result = mapPhotoToPalette(pixels, ["#ff0000", "#0000ff"]);
    expect(result.colors).toEqual(["#ff0000", "#0000ff"]);
    const outputColors = new Set<string>();
    for (let offset = 0; offset < result.quantizedRgba8.length; offset += 4) {
      outputColors.add(Array.from(result.quantizedRgba8.slice(offset, offset + 3)).join(","));
      expect(result.quantizedRgba8[offset + 3]).toBe(255);
    }
    expect([...outputColors].every((color) => color === "255,0,0" || color === "0,0,255")).toBe(true);
    expect(() => mapPhotoToPalette(pixels, [])).toThrow(/1 through 10 colors/);
    expect(() => mapPhotoToPalette(pixels, Array.from({ length: 11 }, () => "#000000"))).toThrow(/1 through 10 colors/);
  });
});
