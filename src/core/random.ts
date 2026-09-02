import type { Seed } from "./types";

/** Stable FNV-1a hash used instead of runtime-dependent random state. */
export function hashUint32(seed: Seed, ...parts: Array<string | number>): number {
  const input = [String(seed), ...parts.map(String)].join("\u001f");
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return hash >>> 0;
}
export function deterministicUnit(seed: Seed, ...parts: Array<string | number>): number {
  return hashUint32(seed, ...parts) / 0x1_0000_0000;
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function lerp(a: number, b: number, amount: number): number {
  return a + (b - a) * amount;
}

/** Order-independent smooth value noise in [-1, 1]. */
export function valueNoise2D(seed: Seed, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothstep(x - x0);
  const ty = smoothstep(y - y0);
  const at = (ix: number, iy: number) => deterministicUnit(seed, "noise", ix, iy) * 2 - 1;
  const top = lerp(at(x0, y0), at(x0 + 1, y0), tx);
  const bottom = lerp(at(x0, y0 + 1), at(x0 + 1, y0 + 1), tx);
  return lerp(top, bottom, ty);
}

export function fbmNoise2D(
  seed: Seed,
  x: number,
  y: number,
  octaves: number,
  lacunarity: number,
  gain: number,
): number {
  let sum = 0;
  let amplitude = 1;
  let frequency = 1;
  let normalization = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += valueNoise2D(`${String(seed)}:${octave}`, x * frequency, y * frequency) * amplitude;
    normalization += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return normalization === 0 ? 0 : sum / normalization;
}
