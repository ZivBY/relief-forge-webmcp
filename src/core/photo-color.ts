import type { RgbColor } from "./types";

export interface LabColor {
  l: number;
  a: number;
  b: number;
}

export interface QuantizedPhotoPalette {
  colors: string[];
  averageDeltaE: number;
  p95DeltaE: number;
}

export interface MappedPhotoPalette extends QuantizedPhotoPalette {
  quantizedRgba8: Uint8Array;
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value: number, count: number): number {
  return (value >>> count) | (value << (32 - count));
}

/** Small synchronous SHA-256 used at the deterministic generation boundary. */
export function sha256Hex(input: Uint8Array): string {
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(input);
  bytes[input.length] = 0x80;
  const view = new DataView(bytes.buffer);
  const bitLength = input.length * 8;
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const words = new Uint32Array(64);

  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, false);
    }
    for (let index = 16; index < 64; index += 1) {
      const previous15 = words[index - 15];
      const previous2 = words[index - 2];
      const s0 = rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^ (previous15 >>> 3);
      const s1 = rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^ (previous2 >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 = (h + sum1 + choice + SHA256_K[index] + words[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((value) => value.toString(16).padStart(8, "0"))
    .join("");
}

export function canonicalPhotoSha256(
  width: number,
  height: number,
  rgba8: Uint8Array,
): string {
  const header = new TextEncoder().encode(
    `relief-forge-photo-field-v1\0${width}x${height}\0srgb\0rgba8\0`,
  );
  const bytes = new Uint8Array(header.length + rgba8.length);
  bytes.set(header);
  bytes.set(rgba8, header.length);
  return sha256Hex(bytes);
}

export function srgbChannelToLinear(channel: number): number {
  const normalized = Math.max(0, Math.min(255, channel)) / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function linearChannelToSrgb(channel: number): number {
  const bounded = Math.max(0, Math.min(1, channel));
  const normalized = bounded <= 0.0031308
    ? bounded * 12.92
    : 1.055 * bounded ** (1 / 2.4) - 0.055;
  return Math.round(normalized * 255);
}

export function relativeLuminance(color: RgbColor): number {
  return (
    srgbChannelToLinear(color.r) * 0.2126 +
    srgbChannelToLinear(color.g) * 0.7152 +
    srgbChannelToLinear(color.b) * 0.0722
  );
}

export function rgbToLab(color: RgbColor): LabColor {
  const red = srgbChannelToLinear(color.r);
  const green = srgbChannelToLinear(color.g);
  const blue = srgbChannelToLinear(color.b);
  const x = (red * 0.4124564 + green * 0.3575761 + blue * 0.1804375) / 0.95047;
  const y = red * 0.2126729 + green * 0.7151522 + blue * 0.072175;
  const z = (red * 0.0193339 + green * 0.119192 + blue * 0.9503041) / 1.08883;
  const transform = (value: number) => value > 216 / 24389
    ? Math.cbrt(value)
    : (841 / 108) * value + 4 / 29;
  const fx = transform(x);
  const fy = transform(y);
  const fz = transform(z);
  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

export function labToRgb(color: LabColor): RgbColor {
  const fy = (color.l + 16) / 116;
  const fx = fy + color.a / 500;
  const fz = fy - color.b / 200;
  const inverse = (value: number) => value ** 3 > 216 / 24389
    ? value ** 3
    : (108 / 841) * (value - 4 / 29);
  const x = inverse(fx) * 0.95047;
  const y = inverse(fy);
  const z = inverse(fz) * 1.08883;
  return {
    r: linearChannelToSrgb(x * 3.2404542 + y * -1.5371385 + z * -0.4985314),
    g: linearChannelToSrgb(x * -0.969266 + y * 1.8760108 + z * 0.041556),
    b: linearChannelToSrgb(x * 0.0556434 + y * -0.2040259 + z * 1.0572252),
  };
}

export function deltaE76(left: LabColor, right: LabColor): number {
  return Math.hypot(left.l - right.l, left.a - right.a, left.b - right.b);
}

export function parseHexColor(value: string): RgbColor {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) throw new Error(`Color ${JSON.stringify(value)} is not a six-digit HEX value.`);
  const packed = Number.parseInt(match[1], 16);
  return { r: packed >>> 16, g: (packed >>> 8) & 0xff, b: packed & 0xff };
}

export function rgbToHex(color: RgbColor): string {
  const component = (value: number) => Math.round(Math.max(0, Math.min(255, value)))
    .toString(16)
    .padStart(2, "0");
  return `#${component(color.r)}${component(color.g)}${component(color.b)}`;
}

export function compositeRgbaPixel(
  rgba8: Uint8Array,
  offset: number,
): RgbColor {
  const alpha = rgba8[offset + 3] / 255;
  return {
    r: rgba8[offset] * alpha + 255 * (1 - alpha),
    g: rgba8[offset + 1] * alpha + 255 * (1 - alpha),
    b: rgba8[offset + 2] * alpha + 255 * (1 - alpha),
  };
}

interface HistogramColor {
  key: number;
  count: number;
  lab: LabColor;
}

function histogram(rgba8: Uint8Array): HistogramColor[] {
  if (rgba8.length === 0 || rgba8.length % 4 !== 0) {
    throw new Error("Photo pixels must be a non-empty RGBA8 buffer.");
  }
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (let offset = 0; offset < rgba8.length; offset += 4) {
    const color = compositeRgbaPixel(rgba8, offset);
    const r = Math.round(color.r);
    const g = Math.round(color.g);
    const b = Math.round(color.b);
    const key = ((r >>> 3) << 10) | ((g >>> 3) << 5) | (b >>> 3);
    const current = buckets.get(key);
    if (current) {
      current.count += 1;
      current.r += r;
      current.g += g;
      current.b += b;
    } else {
      buckets.set(key, { count: 1, r, g, b });
    }
  }
  return [...buckets.entries()]
    .sort(([left], [right]) => left - right)
    .map(([key, value]) => ({
      key,
      count: value.count,
      lab: rgbToLab({
        r: value.r / value.count,
        g: value.g / value.count,
        b: value.b / value.count,
      }),
    }));
}

function nearestLabIndex(color: LabColor, palette: readonly LabColor[]): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < palette.length; index += 1) {
    const distance = deltaE76(color, palette[index]);
    if (distance < bestDistance - 1e-12) {
      bestIndex = index;
      bestDistance = distance;
    }
  }
  return bestIndex;
}

/** Map every composited source pixel to the same Lab-nearest palette used by generation. */
export function mapPhotoToPalette(
  rgba8: Uint8Array,
  colors: readonly string[],
): MappedPhotoPalette {
  if (rgba8.length === 0 || rgba8.length % 4 !== 0) {
    throw new Error("Photo pixels must be a non-empty RGBA8 buffer.");
  }
  if (colors.length < 1 || colors.length > 10) {
    throw new Error("A photo mapping palette must contain 1 through 10 colors.");
  }
  const normalizedColors = colors.map((color) => rgbToHex(parseHexColor(color)));
  const paletteRgb = normalizedColors.map(parseHexColor);
  const paletteLab = paletteRgb.map(rgbToLab);
  const quantizedRgba8 = new Uint8Array(rgba8.length);
  const errors: number[] = [];
  let errorTotal = 0;
  for (let offset = 0; offset < rgba8.length; offset += 4) {
    const source = compositeRgbaPixel(rgba8, offset);
    const sourceLab = rgbToLab(source);
    const index = nearestLabIndex(sourceLab, paletteLab);
    const target = paletteRgb[index];
    const error = deltaE76(sourceLab, paletteLab[index]);
    errors.push(error);
    errorTotal += error;
    quantizedRgba8[offset] = target.r;
    quantizedRgba8[offset + 1] = target.g;
    quantizedRgba8[offset + 2] = target.b;
    quantizedRgba8[offset + 3] = 255;
  }
  errors.sort((left, right) => left - right);
  return {
    colors: normalizedColors,
    averageDeltaE: errorTotal / errors.length,
    p95DeltaE: errors[Math.min(errors.length - 1, Math.floor(errors.length * 0.95))],
    quantizedRgba8,
  };
}

export function quantizePhotoPalette(
  rgba8: Uint8Array,
  requestedColorCount: number,
): QuantizedPhotoPalette {
  if (!Number.isInteger(requestedColorCount) || requestedColorCount < 1 || requestedColorCount > 10) {
    throw new Error("Photo color count must be an integer from 1 through 10.");
  }
  const colors = histogram(rgba8);
  const count = Math.min(requestedColorCount, colors.length);
  const first = [...colors].sort(
    (left, right) => right.count - left.count || left.key - right.key,
  )[0];
  const centroids: LabColor[] = [{ ...first.lab }];
  while (centroids.length < count) {
    let candidate = colors[0];
    let candidateScore = -1;
    for (const color of colors) {
      const distance = Math.min(...centroids.map((centroid) => deltaE76(color.lab, centroid)));
      const score = distance * distance * Math.sqrt(color.count);
      if (score > candidateScore + 1e-9 || (Math.abs(score - candidateScore) <= 1e-9 && color.key < candidate.key)) {
        candidate = color;
        candidateScore = score;
      }
    }
    centroids.push({ ...candidate.lab });
  }

  for (let iteration = 0; iteration < 20; iteration += 1) {
    const sums = centroids.map(() => ({ l: 0, a: 0, b: 0, weight: 0 }));
    for (const color of colors) {
      const index = nearestLabIndex(color.lab, centroids);
      sums[index].l += color.lab.l * color.count;
      sums[index].a += color.lab.a * color.count;
      sums[index].b += color.lab.b * color.count;
      sums[index].weight += color.count;
    }
    let movement = 0;
    for (let index = 0; index < centroids.length; index += 1) {
      const sum = sums[index];
      if (sum.weight === 0) continue;
      const next = { l: sum.l / sum.weight, a: sum.a / sum.weight, b: sum.b / sum.weight };
      movement += deltaE76(centroids[index], next);
      centroids[index] = next;
    }
    if (movement < 1e-7) break;
  }

  const stableCentroids = centroids
    .map((lab) => ({ lab, hex: rgbToHex(labToRgb(lab)) }))
    .sort((left, right) =>
      left.lab.l - right.lab.l ||
      left.lab.a - right.lab.a ||
      left.lab.b - right.lab.b ||
      left.hex.localeCompare(right.hex),
    )
    .filter((entry, index, values) => index === 0 || entry.hex !== values[index - 1].hex);
  const paletteLab = stableCentroids.map((entry) => rgbToLab(parseHexColor(entry.hex)));
  const errors: number[] = [];
  let errorTotal = 0;
  for (let offset = 0; offset < rgba8.length; offset += 4) {
    const lab = rgbToLab(compositeRgbaPixel(rgba8, offset));
    const error = deltaE76(lab, paletteLab[nearestLabIndex(lab, paletteLab)]);
    errors.push(error);
    errorTotal += error;
  }
  errors.sort((left, right) => left - right);
  return {
    colors: stableCentroids.map((entry) => entry.hex),
    averageDeltaE: errorTotal / errors.length,
    p95DeltaE: errors[Math.min(errors.length - 1, Math.floor(errors.length * 0.95))],
  };
}
