import { rotateMeshZ } from "./mesh";
import type { Mesh, TileShapeKind, Triangle, Vec3 } from "./types";

export interface Point2 {
  x: number;
  y: number;
}

export interface PolygonFrustumOptions {
  polygon: Point2[];
  heightMm: number;
  topScale?: number;
  topOffsetX?: number;
  topOffsetY?: number;
  name?: string;
}

export interface RingPodOptions {
  radiusMm: number;
  heightMm: number;
  innerRatio?: number;
  topScale?: number;
  eccentricity?: number;
  topOffsetX?: number;
  topOffsetY?: number;
  segments?: number;
  name?: string;
}

export interface HeightfieldPanelOptions {
  widthMm: number;
  depthMm: number;
  resolution: number;
  sampleHeight: (xMm: number, yMm: number) => number;
  name?: string;
}

export interface SurfaceColumnOptions {
  sizeMm: number;
  /** Heights at local bottom-left, bottom-right, top-right and top-left. */
  cornerHeightsMm: readonly [number, number, number, number];
  topScale?: number;
  name?: string;
}

export interface TileMeshOptions {
  shape: TileShapeKind;
  sizeMm: number;
  heightMm: number;
  topScale: number;
  leanRatio: number;
  twistDeg: number;
  orientationRad: number;
  name?: string;
}

function squareBase(sizeMm: number): Vec3[] {
  const half = sizeMm / 2;
  return [
    { x: -half, y: -half, z: 0 },
    { x: half, y: -half, z: 0 },
    { x: half, y: half, z: 0 },
    { x: -half, y: half, z: 0 },
  ];
}

function signedArea(polygon: readonly Point2[]): number {
  let area = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

function polygonCentroid(polygon: readonly Point2[]): Point2 {
  const area = signedArea(polygon);
  if (Math.abs(area) < 1e-9) {
    return {
      x: polygon.reduce((sum, point) => sum + point.x, 0) / polygon.length,
      y: polygon.reduce((sum, point) => sum + point.y, 0) / polygon.length,
    };
  }
  let x = 0;
  let y = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    const cross = current.x * next.y - next.x * current.y;
    x += (current.x + next.x) * cross;
    y += (current.y + next.y) * cross;
  }
  return { x: x / (6 * area), y: y / (6 * area) };
}

/** Closed convex polygon solid used by cellular, polar, and hex families. */
export function createPolygonFrustumMesh(options: PolygonFrustumOptions): Mesh {
  if (options.polygon.length < 3)
    throw new Error("A polygon tile needs at least three points.");
  if (!(options.heightMm > 0))
    throw new Error("Polygon tile height must be greater than zero.");
  const polygon =
    signedArea(options.polygon) < 0
      ? [...options.polygon].reverse()
      : [...options.polygon];
  const center = polygonCentroid(polygon);
  const topScale = Math.max(0.04, Math.min(1, options.topScale ?? 0.45));
  const offsetX = options.topOffsetX ?? 0;
  const offsetY = options.topOffsetY ?? 0;
  const vertices: Vec3[] = [
    ...polygon.map((point) => ({ x: point.x, y: point.y, z: 0 })),
    ...polygon.map((point) => ({
      x: center.x + (point.x - center.x) * topScale + offsetX,
      y: center.y + (point.y - center.y) * topScale + offsetY,
      z: options.heightMm,
    })),
  ];
  const bottomCenter = vertices.length;
  vertices.push({ x: center.x, y: center.y, z: 0 });
  const topCenter = vertices.length;
  vertices.push({
    x: center.x + offsetX,
    y: center.y + offsetY,
    z: options.heightMm,
  });
  const count = polygon.length;
  const triangles: Triangle[] = [];
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % count;
    const top = count + index;
    const topNext = count + next;
    triangles.push([bottomCenter, next, index]);
    triangles.push([topCenter, top, topNext]);
    triangles.push([index, next, topNext]);
    triangles.push([index, topNext, top]);
  }
  return { name: options.name ?? "polygon-frustum", vertices, triangles };
}

/** A support-free roof/ridge block whose crease can rotate with a vector field. */
export function createRidgeTileMesh(
  sizeMm: number,
  heightMm: number,
  orientationRad: number,
  name = "folded-ridge",
): Mesh {
  const half = sizeMm / 2;
  const shoulder = Math.max(0.8, heightMm * 0.28);
  const wrapped = wrapSquareSymmetry(orientationRad);
  const tangent = clampTangent(Math.tan(wrapped));
  const leftRidgeY = -half * tangent;
  const rightRidgeY = half * tangent;
  const vertices: Vec3[] = [
    { x: -half, y: -half, z: 0 },
    { x: half, y: -half, z: 0 },
    { x: half, y: half, z: 0 },
    { x: -half, y: half, z: 0 },
    { x: -half, y: -half, z: shoulder },
    { x: half, y: -half, z: shoulder },
    { x: half, y: half, z: shoulder },
    { x: -half, y: half, z: shoulder },
    { x: -half, y: leftRidgeY, z: heightMm },
    { x: half, y: rightRidgeY, z: heightMm },
  ];
  const triangles: Triangle[] = [
    [0, 2, 1],
    [0, 3, 2],
    [4, 5, 9],
    [4, 9, 8],
    [8, 9, 6],
    [8, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [1, 2, 6],
    [1, 6, 9],
    [1, 9, 5],
    [2, 3, 7],
    [2, 7, 6],
    [3, 0, 4],
    [3, 4, 8],
    [3, 8, 7],
  ];
  return { name, vertices, triangles };
}

function clampTangent(value: number): number {
  return Math.max(-0.82, Math.min(0.82, value));
}

/** Closed annular solid with an open centre, printable upright without support. */
export function createRingPodMesh(options: RingPodOptions): Mesh {
  if (!(options.radiusMm > 0) || !(options.heightMm > 0)) {
    throw new Error("Ring pod radius and height must be greater than zero.");
  }
  const segments = Math.max(
    8,
    Math.min(32, Math.round(options.segments ?? 16)),
  );
  const innerRatio = Math.max(0.18, Math.min(0.78, options.innerRatio ?? 0.52));
  const topScale = Math.max(0.45, Math.min(1.15, options.topScale ?? 0.82));
  const eccentricity = Math.max(
    0.55,
    Math.min(1, options.eccentricity ?? 0.86),
  );
  const offsetX = options.topOffsetX ?? 0;
  const offsetY = options.topOffsetY ?? 0;
  const vertices: Vec3[] = [];
  const bottomOuter: number[] = [];
  const bottomInner: number[] = [];
  const topOuter: number[] = [];
  const topInner: number[] = [];
  for (let index = 0; index < segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    bottomOuter.push(vertices.length);
    vertices.push({
      x: cosine * options.radiusMm,
      y: sine * options.radiusMm * eccentricity,
      z: 0,
    });
    bottomInner.push(vertices.length);
    vertices.push({
      x: cosine * options.radiusMm * innerRatio,
      y: sine * options.radiusMm * innerRatio * eccentricity,
      z: 0,
    });
    topOuter.push(vertices.length);
    vertices.push({
      x: cosine * options.radiusMm * topScale + offsetX,
      y: sine * options.radiusMm * topScale * eccentricity + offsetY,
      z: options.heightMm,
    });
    topInner.push(vertices.length);
    vertices.push({
      x: cosine * options.radiusMm * innerRatio * topScale + offsetX,
      y:
        sine * options.radiusMm * innerRatio * topScale * eccentricity +
        offsetY,
      z: options.heightMm,
    });
  }
  const triangles: Triangle[] = [];
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments;
    triangles.push([bottomOuter[index], bottomInner[index], bottomInner[next]]);
    triangles.push([bottomOuter[index], bottomInner[next], bottomOuter[next]]);
    triangles.push([topOuter[index], topOuter[next], topInner[next]]);
    triangles.push([topOuter[index], topInner[next], topInner[index]]);
    triangles.push([bottomOuter[index], bottomOuter[next], topOuter[next]]);
    triangles.push([bottomOuter[index], topOuter[next], topOuter[index]]);
    triangles.push([bottomInner[index], topInner[index], topInner[next]]);
    triangles.push([bottomInner[index], topInner[next], bottomInner[next]]);
  }
  return { name: options.name ?? "ring-pod", vertices, triangles };
}

/** One printable panel cut from a globally continuous sampled relief surface. */
export function createHeightfieldPanelMesh(
  options: HeightfieldPanelOptions,
): Mesh {
  if (!(options.widthMm > 0) || !(options.depthMm > 0)) {
    throw new Error("Relief panel dimensions must be greater than zero.");
  }
  const resolution = Math.max(3, Math.min(32, Math.round(options.resolution)));
  const rowSize = resolution + 1;
  const vertices: Vec3[] = [];
  for (let row = 0; row <= resolution; row += 1) {
    const y = -options.depthMm / 2 + (row / resolution) * options.depthMm;
    for (let column = 0; column <= resolution; column += 1) {
      const x = -options.widthMm / 2 + (column / resolution) * options.widthMm;
      const z = options.sampleHeight(x, y);
      if (!(z > 0) || !Number.isFinite(z))
        throw new Error("Relief panel samples must be finite and above zero.");
      vertices.push({ x, y, z });
    }
  }
  const triangles: Triangle[] = [];
  for (let row = 0; row < resolution; row += 1) {
    for (let column = 0; column < resolution; column += 1) {
      const a = row * rowSize + column;
      const b = a + 1;
      const d = (row + 1) * rowSize + column;
      const c = d + 1;
      triangles.push([a, b, c], [a, c, d]);
    }
  }
  const perimeter: number[] = [];
  for (let column = 0; column <= resolution; column += 1)
    perimeter.push(column);
  for (let row = 1; row <= resolution; row += 1)
    perimeter.push(row * rowSize + resolution);
  for (let column = resolution - 1; column >= 0; column -= 1)
    perimeter.push(resolution * rowSize + column);
  for (let row = resolution - 1; row >= 1; row -= 1)
    perimeter.push(row * rowSize);
  const bottomPerimeter = perimeter.map((topIndex) => {
    const top = vertices[topIndex];
    const index = vertices.length;
    vertices.push({ x: top.x, y: top.y, z: 0 });
    return index;
  });
  const bottomCenter = vertices.length;
  vertices.push({ x: 0, y: 0, z: 0 });
  for (let index = 0; index < perimeter.length; index += 1) {
    const next = (index + 1) % perimeter.length;
    triangles.push([
      bottomCenter,
      bottomPerimeter[next],
      bottomPerimeter[index],
    ]);
    triangles.push([
      perimeter[index],
      bottomPerimeter[index],
      bottomPerimeter[next],
    ]);
    triangles.push([perimeter[index], bottomPerimeter[next], perimeter[next]]);
  }
  return { name: options.name ?? "relief-panel", vertices, triangles };
}

interface TerraceJunctionRelief {
  centerX: number;
  centerY: number;
  halfWidth: number;
  halfDepth: number;
  heightMm: number;
}

const TERRACE_HEIGHT_EPSILON = 1e-7;
const TERRACE_COORDINATE_EPSILON = 1e-10;
const TERRACE_JUNCTION_HALF_FRACTION = 0.12;

function uniqueSortedNumbers(
  values: readonly number[],
  epsilon: number,
): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const unique: number[] = [];
  for (const value of sorted) {
    const previous = unique[unique.length - 1];
    if (previous === undefined || Math.abs(value - previous) > epsilon)
      unique.push(value);
  }
  return unique;
}

function snapTerraceHeights(samples: readonly number[]): Map<number, number> {
  const levels = uniqueSortedNumbers(samples, TERRACE_HEIGHT_EPSILON);
  const snapped = new Map<number, number>();
  for (const sample of samples) {
    let closest = levels[0];
    for (const level of levels) {
      if (Math.abs(level - sample) <= TERRACE_HEIGHT_EPSILON) {
        closest = level;
        break;
      }
      if (level > sample) break;
      closest = level;
    }
    snapped.set(sample, closest);
  }
  return snapped;
}

function intervalContaining(bounds: readonly number[], value: number): number {
  for (let index = 0; index < bounds.length - 1; index += 1) {
    if (value < bounds[index + 1]) return index;
  }
  return bounds.length - 2;
}

function hasDiagonalTerraceContact(
  lowerLeft: number,
  lowerRight: number,
  upperLeft: number,
  upperRight: number,
): boolean {
  return (
    Math.min(lowerLeft, upperRight) >
      Math.max(lowerRight, upperLeft) + TERRACE_HEIGHT_EPSILON ||
    Math.min(lowerRight, upperLeft) >
      Math.max(lowerLeft, upperRight) + TERRACE_HEIGHT_EPSILON
  );
}

/**
 * Closed, piecewise-constant relief panel with horizontal region tops and
 * vertical step walls.
 *
 * Each sample owns the rectangular area halfway to its neighbouring samples,
 * which keeps boundary samples identical across adjacent generated panels.
 * A checkerboard saddle would otherwise make diagonal high regions touch only
 * along a vertical line, producing a non-manifold solid. At only those saddle
 * junctions, a small deterministic square is assigned the minimum of the four
 * incident heights. This separates the diagonal regions without adding slopes;
 * all remaining region boundaries stay as direct vertical steps.
 */
export function createTerracedPanelMesh(
  options: HeightfieldPanelOptions,
): Mesh {
  if (!(options.widthMm > 0) || !(options.depthMm > 0)) {
    throw new Error("Terraced panel dimensions must be greater than zero.");
  }
  const resolution = Math.max(3, Math.min(32, Math.round(options.resolution)));
  const sampleCount = resolution + 1;
  const stepX = options.widthMm / resolution;
  const stepY = options.depthMm / resolution;
  const sampleX = Array.from(
    { length: sampleCount },
    (_, column) => -options.widthMm / 2 + column * stepX,
  );
  const sampleY = Array.from(
    { length: sampleCount },
    (_, row) => -options.depthMm / 2 + row * stepY,
  );
  const rawHeights = sampleY.map((y) =>
    sampleX.map((x) => {
      const height = options.sampleHeight(x, y);
      if (!(height > 0) || !Number.isFinite(height)) {
        throw new Error(
          "Terraced panel samples must be finite and above zero.",
        );
      }
      return height;
    }),
  );
  const snappedLevels = snapTerraceHeights(rawHeights.flat());
  const heights = rawHeights.map((row) =>
    row.map((height) => snappedLevels.get(height) ?? height),
  );
  const xBounds = [
    -options.widthMm / 2,
    ...sampleX.slice(0, -1).map((x, index) => (x + sampleX[index + 1]) / 2),
    options.widthMm / 2,
  ];
  const yBounds = [
    -options.depthMm / 2,
    ...sampleY.slice(0, -1).map((y, index) => (y + sampleY[index + 1]) / 2),
    options.depthMm / 2,
  ];

  const junctionReliefs: TerraceJunctionRelief[] = [];
  for (let row = 1; row < sampleCount; row += 1) {
    for (let column = 1; column < sampleCount; column += 1) {
      const lowerLeft = heights[row - 1][column - 1];
      const lowerRight = heights[row - 1][column];
      const upperLeft = heights[row][column - 1];
      const upperRight = heights[row][column];
      if (
        !hasDiagonalTerraceContact(lowerLeft, lowerRight, upperLeft, upperRight)
      )
        continue;
      junctionReliefs.push({
        centerX: xBounds[column],
        centerY: yBounds[row],
        halfWidth: stepX * TERRACE_JUNCTION_HALF_FRACTION,
        halfDepth: stepY * TERRACE_JUNCTION_HALF_FRACTION,
        heightMm: Math.min(lowerLeft, lowerRight, upperLeft, upperRight),
      });
    }
  }

  const refinedX = uniqueSortedNumbers(
    [
      ...xBounds,
      ...junctionReliefs.flatMap((junction) => [
        junction.centerX - junction.halfWidth,
        junction.centerX + junction.halfWidth,
      ]),
    ],
    TERRACE_COORDINATE_EPSILON,
  );
  const refinedY = uniqueSortedNumbers(
    [
      ...yBounds,
      ...junctionReliefs.flatMap((junction) => [
        junction.centerY - junction.halfDepth,
        junction.centerY + junction.halfDepth,
      ]),
    ],
    TERRACE_COORDINATE_EPSILON,
  );
  const refinedColumnCount = refinedX.length - 1;
  const refinedRowCount = refinedY.length - 1;
  const refinedHeights = Array.from({ length: refinedRowCount }, (_, row) => {
    const centerY = (refinedY[row] + refinedY[row + 1]) / 2;
    return Array.from({ length: refinedColumnCount }, (_, column) => {
      const centerX = (refinedX[column] + refinedX[column + 1]) / 2;
      const junction = junctionReliefs.find(
        (candidate) =>
          Math.abs(centerX - candidate.centerX) < candidate.halfWidth &&
          Math.abs(centerY - candidate.centerY) < candidate.halfDepth,
      );
      if (junction) return junction.heightMm;
      return heights[intervalContaining(yBounds, centerY)][
        intervalContaining(xBounds, centerX)
      ];
    });
  });

  const vertices: Vec3[] = [];
  const triangles: Triangle[] = [];
  const vertexByCoordinate = new Map<string, number>();
  const coordinateKey = (value: number) => {
    const normalized =
      Math.abs(value) <= TERRACE_COORDINATE_EPSILON ? 0 : value;
    return normalized.toPrecision(15);
  };
  const vertexIndex = (gridX: number, gridY: number, z: number): number => {
    const x = refinedX[gridX];
    const y = refinedY[gridY];
    const key = `${coordinateKey(x)}:${coordinateKey(y)}:${coordinateKey(z)}`;
    const existing = vertexByCoordinate.get(key);
    if (existing !== undefined) return existing;
    const index = vertices.length;
    vertices.push({ x, y, z });
    vertexByCoordinate.set(key, index);
    return index;
  };

  for (let row = 0; row < refinedRowCount; row += 1) {
    for (let column = 0; column < refinedColumnCount; column += 1) {
      const height = refinedHeights[row][column];
      const topLowerLeft = vertexIndex(column, row, height);
      const topLowerRight = vertexIndex(column + 1, row, height);
      const topUpperRight = vertexIndex(column + 1, row + 1, height);
      const topUpperLeft = vertexIndex(column, row + 1, height);
      triangles.push(
        [topLowerLeft, topLowerRight, topUpperRight],
        [topLowerLeft, topUpperRight, topUpperLeft],
      );

      const bottomLowerLeft = vertexIndex(column, row, 0);
      const bottomLowerRight = vertexIndex(column + 1, row, 0);
      const bottomUpperRight = vertexIndex(column + 1, row + 1, 0);
      const bottomUpperLeft = vertexIndex(column, row + 1, 0);
      triangles.push(
        [bottomLowerLeft, bottomUpperRight, bottomLowerRight],
        [bottomLowerLeft, bottomUpperLeft, bottomUpperRight],
      );
    }
  }

  const levelsAtGridVertex = new Map<string, number[]>();
  const incidentLevels = (gridX: number, gridY: number): number[] => {
    const key = `${gridX}:${gridY}`;
    const cached = levelsAtGridVertex.get(key);
    if (cached) return cached;
    const levels = [0];
    for (const rowOffset of [-1, 0]) {
      for (const columnOffset of [-1, 0]) {
        const row = gridY + rowOffset;
        const column = gridX + columnOffset;
        if (
          row >= 0 &&
          row < refinedRowCount &&
          column >= 0 &&
          column < refinedColumnCount
        ) {
          levels.push(refinedHeights[row][column]);
        }
      }
    }
    const result = uniqueSortedNumbers(levels, TERRACE_HEIGHT_EPSILON);
    levelsAtGridVertex.set(key, result);
    return result;
  };
  const wallLevels = (
    gridX: number,
    gridY: number,
    low: number,
    high: number,
  ) => [
    low,
    ...incidentLevels(gridX, gridY).filter(
      (height) =>
        height > low + TERRACE_HEIGHT_EPSILON &&
        height < high - TERRACE_HEIGHT_EPSILON,
    ),
    high,
  ];

  const addVerticalWall = (
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    low: number,
    high: number,
  ) => {
    if (high <= low + TERRACE_HEIGHT_EPSILON) return;
    const startLevels = wallLevels(startX, startY, low, high);
    const endLevels = wallLevels(endX, endY, low, high);
    let startLevelIndex = 0;
    let endLevelIndex = 0;
    while (
      startLevelIndex < startLevels.length - 1 ||
      endLevelIndex < endLevels.length - 1
    ) {
      const start = vertexIndex(startX, startY, startLevels[startLevelIndex]);
      const end = vertexIndex(endX, endY, endLevels[endLevelIndex]);
      const nextStartLevel = startLevels[startLevelIndex + 1] ?? Infinity;
      const nextEndLevel = endLevels[endLevelIndex + 1] ?? Infinity;
      if (Math.abs(nextStartLevel - nextEndLevel) <= TERRACE_HEIGHT_EPSILON) {
        const nextEnd = vertexIndex(endX, endY, nextEndLevel);
        const nextStart = vertexIndex(startX, startY, nextStartLevel);
        triangles.push([start, end, nextEnd], [start, nextEnd, nextStart]);
        startLevelIndex += 1;
        endLevelIndex += 1;
      } else if (nextStartLevel < nextEndLevel) {
        const nextStart = vertexIndex(startX, startY, nextStartLevel);
        triangles.push([start, end, nextStart]);
        startLevelIndex += 1;
      } else {
        const nextEnd = vertexIndex(endX, endY, nextEndLevel);
        triangles.push([start, end, nextEnd]);
        endLevelIndex += 1;
      }
    }
  };

  for (let row = 0; row < refinedRowCount; row += 1) {
    for (let gridX = 1; gridX < refinedColumnCount; gridX += 1) {
      const left = refinedHeights[row][gridX - 1];
      const right = refinedHeights[row][gridX];
      if (left > right + TERRACE_HEIGHT_EPSILON) {
        addVerticalWall(gridX, row, gridX, row + 1, right, left);
      } else if (right > left + TERRACE_HEIGHT_EPSILON) {
        addVerticalWall(gridX, row + 1, gridX, row, left, right);
      }
    }
  }
  for (let gridY = 1; gridY < refinedRowCount; gridY += 1) {
    for (let column = 0; column < refinedColumnCount; column += 1) {
      const lower = refinedHeights[gridY - 1][column];
      const upper = refinedHeights[gridY][column];
      if (lower > upper + TERRACE_HEIGHT_EPSILON) {
        addVerticalWall(column + 1, gridY, column, gridY, upper, lower);
      } else if (upper > lower + TERRACE_HEIGHT_EPSILON) {
        addVerticalWall(column, gridY, column + 1, gridY, lower, upper);
      }
    }
  }

  for (let column = 0; column < refinedColumnCount; column += 1) {
    addVerticalWall(column, 0, column + 1, 0, 0, refinedHeights[0][column]);
    addVerticalWall(
      column + 1,
      refinedRowCount,
      column,
      refinedRowCount,
      0,
      refinedHeights[refinedRowCount - 1][column],
    );
  }
  for (let row = 0; row < refinedRowCount; row += 1) {
    addVerticalWall(
      refinedColumnCount,
      row,
      refinedColumnCount,
      row + 1,
      0,
      refinedHeights[row][refinedColumnCount - 1],
    );
    addVerticalWall(0, row + 1, 0, row, 0, refinedHeights[row][0]);
  }

  return { name: options.name ?? "terraced-panel", vertices, triangles };
}

/** Closed four-corner terrain column used to sample a global surface as blocks. */
export function createSurfaceColumnMesh(options: SurfaceColumnOptions): Mesh {
  if (!(options.sizeMm > 0))
    throw new Error("Surface-column size must be greater than zero.");
  if (
    !options.cornerHeightsMm.every(
      (height) => Number.isFinite(height) && height > 0,
    )
  ) {
    throw new Error(
      "Every surface-column corner height must be finite and above zero.",
    );
  }
  const half = options.sizeMm / 2;
  const topHalf = half * Math.max(0.45, Math.min(1, options.topScale ?? 1));
  const [h0, h1, h2, h3] = options.cornerHeightsMm;
  const vertices: Vec3[] = [
    { x: -half, y: -half, z: 0 },
    { x: half, y: -half, z: 0 },
    { x: half, y: half, z: 0 },
    { x: -half, y: half, z: 0 },
    { x: -topHalf, y: -topHalf, z: h0 },
    { x: topHalf, y: -topHalf, z: h1 },
    { x: topHalf, y: topHalf, z: h2 },
    { x: -topHalf, y: topHalf, z: h3 },
  ];
  const triangles: Triangle[] = [
    [0, 2, 1],
    [0, 3, 2],
    [4, 5, 6],
    [4, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [1, 2, 6],
    [1, 6, 5],
    [2, 3, 7],
    [2, 7, 6],
    [3, 0, 4],
    [3, 4, 7],
  ];
  return { name: options.name ?? "surface-column", vertices, triangles };
}

/**
 * A square repeats every quarter-turn. Keeping the labelled top corners within
 * +/-45 degrees of their matching base corners prevents folded side faces while
 * preserving the requested visible orientation.
 */
function wrapSquareSymmetry(angleRad: number): number {
  const period = Math.PI / 2;
  return (
    ((((angleRad + Math.PI / 4) % period) + period) % period) - Math.PI / 4
  );
}

function leaningPyramid(options: TileMeshOptions): Mesh {
  const vertices = squareBase(options.sizeMm);
  const lean = options.sizeMm * 0.5 * options.leanRatio;
  vertices.push({
    x: lean * Math.cos(options.orientationRad),
    y: lean * Math.sin(options.orientationRad),
    z: options.heightMm,
  });
  const triangles: Triangle[] = [
    [0, 2, 1],
    [0, 3, 2],
    [0, 1, 4],
    [1, 2, 4],
    [2, 3, 4],
    [3, 0, 4],
  ];
  return { name: options.name ?? "leaning-pyramid", vertices, triangles };
}

function twistedPrism(options: TileMeshOptions): Mesh {
  const vertices = squareBase(options.sizeMm);
  const topHalf = (options.sizeMm * options.topScale) / 2;
  const twist = wrapSquareSymmetry(
    (options.twistDeg * Math.PI) / 180 + options.orientationRad,
  );
  const cosine = Math.cos(twist);
  const sine = Math.sin(twist);
  const lean = options.sizeMm * 0.5 * options.leanRatio;
  const leanX = lean * Math.cos(options.orientationRad);
  const leanY = lean * Math.sin(options.orientationRad);
  const topCorners: Array<[number, number]> = [
    [-topHalf, -topHalf],
    [topHalf, -topHalf],
    [topHalf, topHalf],
    [-topHalf, topHalf],
  ];
  for (const [x, y] of topCorners) {
    vertices.push({
      x: x * cosine - y * sine + leanX,
      y: x * sine + y * cosine + leanY,
      z: options.heightMm,
    });
  }
  const triangles: Triangle[] = [
    [0, 2, 1],
    [0, 3, 2],
    [4, 5, 6],
    [4, 6, 7],
    [0, 1, 5],
    [0, 5, 4],
    [1, 2, 6],
    [1, 6, 5],
    [2, 3, 7],
    [2, 7, 6],
    [3, 0, 4],
    [3, 4, 7],
  ];
  return { name: options.name ?? "twisted-prism", vertices, triangles };
}

function hexSpike(options: TileMeshOptions): Mesh {
  const radius = options.sizeMm / 2;
  const vertices: Vec3[] = [];
  for (let index = 0; index < 6; index += 1) {
    const angle = (index * Math.PI) / 3;
    vertices.push({
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      z: 0,
    });
  }
  const bottomCenter = vertices.length;
  vertices.push({ x: 0, y: 0, z: 0 });
  const apex = vertices.length;
  const lean = options.sizeMm * 0.5 * options.leanRatio;
  vertices.push({
    x: lean * Math.cos(options.orientationRad),
    y: lean * Math.sin(options.orientationRad),
    z: options.heightMm,
  });
  const triangles: Triangle[] = [];
  for (let index = 0; index < 6; index += 1) {
    const next = (index + 1) % 6;
    triangles.push([bottomCenter, next, index]);
    triangles.push([index, next, apex]);
  }
  return { name: options.name ?? "hex-spike", vertices, triangles };
}

export function createTileMesh(options: TileMeshOptions): Mesh {
  if (!(options.sizeMm > 0) || !(options.heightMm > 0)) {
    throw new Error("Tile size and height must be greater than zero.");
  }
  let mesh: Mesh;
  switch (options.shape) {
    case "leaning-pyramid":
      mesh = leaningPyramid(options);
      break;
    case "twisted-prism":
      mesh = twistedPrism(options);
      break;
    case "hex-spike":
      mesh = hexSpike(options);
      break;
    case "folded-ridge":
      mesh = createRidgeTileMesh(
        options.sizeMm,
        options.heightMm,
        options.orientationRad,
        options.name,
      );
      break;
    case "hex-petal": {
      const radius = options.sizeMm / 2;
      const polygon = Array.from({ length: 6 }, (_, index) => ({
        x: Math.cos((index * Math.PI) / 3) * radius,
        y: Math.sin((index * Math.PI) / 3) * radius,
      }));
      const lean = options.sizeMm * 0.5 * options.leanRatio;
      mesh = createPolygonFrustumMesh({
        polygon,
        heightMm: options.heightMm,
        topScale: Math.min(options.topScale, 0.38),
        topOffsetX: Math.cos(options.orientationRad) * lean,
        topOffsetY: Math.sin(options.orientationRad) * lean,
        name: options.name,
      });
      break;
    }
    case "hex-folded-fan":
    case "hex-pinwheel":
    case "hex-curved-sweep":
    case "hex-wave-bands":
    case "hex-mixed":
    case "cell-crystal":
    case "cell-plateau":
    case "surface-column":
    case "planar-cap-column":
    case "triangle-sail":
    case "triangle-plateau":
    case "polar-wedge":
    case "polar-petal":
    case "ring-pod":
    case "solid-pod":
    case "relief-panel":
    case "terraced-panel":
    case "mixed-block":
      throw new Error(
        `${options.shape} requires its design-family layout generator.`,
      );
  }
  mesh.name = options.name ?? mesh.name;
  return mesh;
}
