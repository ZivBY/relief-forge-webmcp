import type { Mesh, Triangle, Vec3 } from "./types";

export const HEX_RELIEF_SHAPES = [
  "hex-folded-fan",
  "hex-pinwheel",
  "hex-curved-sweep",
  "hex-wave-bands",
] as const;

export type HexReliefShape = (typeof HEX_RELIEF_SHAPES)[number];

export interface HexReliefMeshOptions {
  shape: HexReliefShape;
  radiusMm: number;
  baseHeightMm: number;
  peakHeightMm: number;
  orientationRad: number;
  /** Radial rings and straight subdivisions per hex side. */
  subdivisions?: number;
  name?: string;
}

const DEFAULT_SUBDIVISIONS = 5;
const MIN_SUBDIVISIONS = 2;
const MAX_SUBDIVISIONS = 12;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function hexCorner(radiusMm: number, index: number): { x: number; y: number } {
  const angle = (positiveModulo(index, 6) * Math.PI) / 3;
  return { x: Math.cos(angle) * radiusMm, y: Math.sin(angle) * radiusMm };
}

function boundaryPoint(
  radiusMm: number,
  subdivisions: number,
  index: number,
): { x: number; y: number } {
  const side = Math.floor(index / subdivisions);
  const amount = (index % subdivisions) / subdivisions;
  const start = hexCorner(radiusMm, side);
  const end = hexCorner(radiusMm, side + 1);
  return {
    x: start.x + (end.x - start.x) * amount,
    y: start.y + (end.y - start.y) * amount,
  };
}

function reliefAmount(
  shape: HexReliefShape,
  xMm: number,
  yMm: number,
  radiusMm: number,
  radialFraction: number,
  orientationRad: number,
): number {
  const cosine = Math.cos(orientationRad);
  const sine = Math.sin(orientationRad);
  const u = (xMm * cosine + yMm * sine) / radiusMm;
  const v = (-xMm * sine + yMm * cosine) / radiusMm;
  const theta = Math.atan2(v, u);

  switch (shape) {
    case "hex-folded-fan": {
      const sector = positiveModulo(theta / (Math.PI / 3) + 0.5, 1);
      const fold = 1 - Math.abs(sector * 2 - 1);
      const outwardRise = 0.26 + radialFraction * 0.74;
      return clamp(0.1 + 0.9 * outwardRise * (0.18 + fold * 0.82), 0, 1);
    }
    case "hex-pinwheel": {
      const spiral = 0.5 + 0.5 * Math.sin(theta * 6 - radialFraction * 5.2);
      const outwardRise = 0.2 + radialFraction * 0.8;
      return clamp(0.12 + 0.88 * outwardRise * (0.15 + spiral * 0.85), 0, 1);
    }
    case "hex-curved-sweep": {
      const focusDistance = Math.hypot(u + 0.72, (v - 0.08) * 0.88);
      const sweep = 0.5 + 0.5 * Math.cos(focusDistance * Math.PI * 3.2);
      const directionalLift = 0.35 + 0.65 * clamp((u + 1) / 2, 0, 1);
      return clamp(0.12 + 0.88 * (0.25 + sweep * 0.75) * directionalLift, 0, 1);
    }
    case "hex-wave-bands": {
      const warpedPhase =
        (u * 2.2 + Math.sin(v * Math.PI * 1.4) * 0.18) * Math.PI;
      const bands = 0.5 + 0.5 * Math.sin(warpedPhase);
      const crossFalloff = 0.85 + 0.15 * Math.cos(v * Math.PI);
      return clamp(0.12 + 0.88 * bands * crossFalloff, 0, 1);
    }
  }
}

/**
 * Build one closed terrain solid over an exact regular-hex carrier.
 *
 * Every style shares the same XY lattice. Only the top Z samples change, so
 * switching the interior relief cannot change the part outline or packing
 * footprint.
 */
export function createHexReliefMesh(options: HexReliefMeshOptions): Mesh {
  if (!(options.radiusMm > 0) || !Number.isFinite(options.radiusMm)) {
    throw new Error("Hex relief radius must be finite and greater than zero.");
  }
  if (!(options.baseHeightMm > 0) || !Number.isFinite(options.baseHeightMm)) {
    throw new Error(
      "Hex relief base height must be finite and greater than zero.",
    );
  }
  if (
    !Number.isFinite(options.peakHeightMm) ||
    options.peakHeightMm < options.baseHeightMm
  ) {
    throw new Error(
      "Hex relief peak height must be finite and at least the base height.",
    );
  }
  if (!Number.isFinite(options.orientationRad)) {
    throw new Error("Hex relief orientation must be finite.");
  }
  const subdivisions = options.subdivisions ?? DEFAULT_SUBDIVISIONS;
  if (
    !Number.isInteger(subdivisions) ||
    subdivisions < MIN_SUBDIVISIONS ||
    subdivisions > MAX_SUBDIVISIONS
  ) {
    throw new Error(
      `Hex relief subdivisions must be an integer from ${MIN_SUBDIVISIONS} through ${MAX_SUBDIVISIONS}.`,
    );
  }

  const boundaryCount = subdivisions * 6;
  const reliefSpan = options.peakHeightMm - options.baseHeightMm;
  const vertices: Vec3[] = [];
  const triangles: Triangle[] = [];
  const sampleHeight = (xMm: number, yMm: number, radialFraction: number) =>
    options.baseHeightMm +
    reliefSpan *
      reliefAmount(
        options.shape,
        xMm,
        yMm,
        options.radiusMm,
        radialFraction,
        options.orientationRad,
      );

  const topCenter = vertices.length;
  vertices.push({ x: 0, y: 0, z: sampleHeight(0, 0, 0) });
  const rings: number[][] = [];
  for (let ring = 1; ring <= subdivisions; ring += 1) {
    const radialFraction = ring / subdivisions;
    const indices: number[] = [];
    for (let index = 0; index < boundaryCount; index += 1) {
      const boundary = boundaryPoint(options.radiusMm, subdivisions, index);
      const x = boundary.x * radialFraction;
      const y = boundary.y * radialFraction;
      indices.push(vertices.length);
      vertices.push({ x, y, z: sampleHeight(x, y, radialFraction) });
    }
    rings.push(indices);
  }

  const firstRing = rings[0];
  for (let index = 0; index < boundaryCount; index += 1) {
    const next = (index + 1) % boundaryCount;
    triangles.push([topCenter, firstRing[index], firstRing[next]]);
  }
  for (let ring = 1; ring < rings.length; ring += 1) {
    const inner = rings[ring - 1];
    const outer = rings[ring];
    for (let index = 0; index < boundaryCount; index += 1) {
      const next = (index + 1) % boundaryCount;
      triangles.push([inner[index], outer[index], outer[next]]);
      triangles.push([inner[index], outer[next], inner[next]]);
    }
  }

  const outerTop = rings[rings.length - 1];
  const bottomBoundary = Array.from({ length: boundaryCount }, (_, index) => {
    const point = boundaryPoint(options.radiusMm, subdivisions, index);
    const vertexIndex = vertices.length;
    vertices.push({ x: point.x, y: point.y, z: 0 });
    return vertexIndex;
  });
  const bottomCenter = vertices.length;
  vertices.push({ x: 0, y: 0, z: 0 });

  for (let index = 0; index < boundaryCount; index += 1) {
    const next = (index + 1) % boundaryCount;
    triangles.push([
      bottomBoundary[index],
      bottomBoundary[next],
      outerTop[next],
    ]);
    triangles.push([bottomBoundary[index], outerTop[next], outerTop[index]]);
    triangles.push([bottomCenter, bottomBoundary[next], bottomBoundary[index]]);
  }

  return {
    name: options.name ?? options.shape,
    vertices,
    triangles,
  };
}
