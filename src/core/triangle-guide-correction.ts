import {
  angleTowardGuide,
  sampleConfiguredGuideInfluences,
  shortestAngleBlend,
  strongestDirectionalInfluence,
  strongestPullInfluence,
} from "./guide-composition";
import { diagnoseMesh } from "./mesh";
import type {
  GeneratedTile,
  Mesh,
  Vec3,
  WallArtConfig,
} from "./types";

interface Point2 {
  x: number;
  y: number;
}

const EPSILON = 1e-9;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function cross(origin: Point2, end: Point2, point: Point2): number {
  return (
    (end.x - origin.x) * (point.y - origin.y) -
    (end.y - origin.y) * (point.x - origin.x)
  );
}

function convexHull(points: readonly Point2[]): Point2[] {
  const sorted = [...points]
    .sort((left, right) => left.x - right.x || left.y - right.y)
    .filter(
      (point, index, all) =>
        index === 0 ||
        Math.abs(point.x - all[index - 1].x) > EPSILON ||
        Math.abs(point.y - all[index - 1].y) > EPSILON,
    );
  if (sorted.length <= 2) return sorted;

  const half = (input: readonly Point2[]) => {
    const result: Point2[] = [];
    for (const point of input) {
      while (
        result.length >= 2 &&
        cross(result[result.length - 2], result[result.length - 1], point) <= EPSILON
      ) {
        result.pop();
      }
      result.push(point);
    }
    return result;
  };
  const lower = half(sorted);
  const upper = half([...sorted].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
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

/** Maximum cap-centre travel along `direction` with every cap vertex in base. */
function containedCenterDistance(
  baseBoundary: readonly Point2[],
  capOffsets: readonly Point2[],
  direction: Point2,
): number {
  if (baseBoundary.length < 3 || capOffsets.length === 0) return 0;
  const winding = signedArea(baseBoundary) >= 0 ? 1 : -1;
  let maximum = Number.POSITIVE_INFINITY;

  for (let index = 0; index < baseBoundary.length; index += 1) {
    const start = baseBoundary[index];
    const end = baseBoundary[(index + 1) % baseBoundary.length];
    const directionSlope =
      winding *
      ((end.x - start.x) * direction.y -
        (end.y - start.y) * direction.x);
    for (const offset of capOffsets) {
      const initialSlack = winding * cross(start, end, offset);
      if (initialSlack < -EPSILON) return 0;
      if (directionSlope < -EPSILON) {
        maximum = Math.min(maximum, Math.max(0, initialSlack / -directionSlope));
      }
    }
  }
  return Number.isFinite(maximum) ? maximum : 0;
}

function averageVertices(mesh: Mesh, indices: readonly number[]): Point2 {
  return indices.reduce(
    (sum, index) => ({
      x: sum.x + mesh.vertices[index].x / indices.length,
      y: sum.y + mesh.vertices[index].y / indices.length,
    }),
    { x: 0, y: 0 },
  );
}

function topVertexIndices(mesh: Mesh): number[] {
  const maximumZ = Math.max(...mesh.vertices.map((vertex) => vertex.z));
  return mesh.vertices
    .map((vertex, index) => ({ vertex, index }))
    .filter(({ vertex }) => Math.abs(vertex.z - maximumZ) <= EPSILON)
    .map(({ index }) => index);
}

function meshTopOrientation(mesh: Mesh): number | undefined {
  const indices = topVertexIndices(mesh);
  if (indices.length === 0) return undefined;
  const center = averageVertices(mesh, indices);
  return Math.hypot(center.x, center.y) > EPSILON
    ? Math.atan2(center.y, center.x)
    : undefined;
}

function translateTop(mesh: Mesh, indices: readonly number[], delta: Point2): Mesh {
  const moved = new Set(indices);
  return {
    ...mesh,
    vertices: mesh.vertices.map((vertex, index): Vec3 =>
      moved.has(index)
        ? { x: vertex.x + delta.x, y: vertex.y + delta.y, z: vertex.z }
        : vertex,
    ),
  };
}

function correctTriangleTile(
  config: WallArtConfig,
  widthMm: number,
  depthMm: number,
  tile: GeneratedTile,
): GeneratedTile {
  const topIndices = topVertexIndices(tile.mesh);
  if (topIndices.length < 3) return tile;
  const originalTopCenter = averageVertices(tile.mesh, topIndices);
  const actualBaseAngle =
    Math.hypot(originalTopCenter.x, originalTopCenter.y) > EPSILON
      ? Math.atan2(originalTopCenter.y, originalTopCenter.x)
      : tile.orientationRad;

  if (
    config.guides.lines.length === 0 ||
    !(widthMm > 0) ||
    !(depthMm > 0)
  ) {
    return { ...tile, orientationRad: actualBaseAngle };
  }

  const halfWidth = widthMm / 2;
  const halfDepth = depthMm / 2;
  const point = {
    x: clamp(tile.centerXmm / halfWidth - 1, -1, 1),
    y: clamp(1 - tile.centerYmm / halfDepth, -1, 1),
  };
  const coordinateScale = { x: halfWidth, y: halfDepth };
  const influences = sampleConfiguredGuideInfluences(
    config.guides,
    point,
    coordinateScale,
  );
  const directionalInfluence = strongestDirectionalInfluence(influences);
  const pullInfluence = strongestPullInfluence(influences);
  if (!directionalInfluence && !pullInfluence) {
    return { ...tile, orientationRad: actualBaseAngle };
  }

  const attractedAngle = shortestAngleBlend(
    actualBaseAngle,
    directionalInfluence?.targetAngle ?? actualBaseAngle,
    directionalInfluence?.directionAmount ?? 0,
  );
  const baseMagnitude = Math.hypot(originalTopCenter.x, originalTopCenter.y);
  const topOffsets = topIndices.map((index) => ({
    x: tile.mesh.vertices[index].x - originalTopCenter.x,
    y: tile.mesh.vertices[index].y - originalTopCenter.y,
  }));
  const minimumZ = Math.min(...tile.mesh.vertices.map((vertex) => vertex.z));
  const baseBoundary = convexHull(
    tile.mesh.vertices
      .filter((vertex) => Math.abs(vertex.z - minimumZ) <= EPSILON)
      .map((vertex) => ({ x: vertex.x, y: vertex.y })),
  );
  const attractedDirection = {
    x: Math.cos(attractedAngle),
    y: Math.sin(attractedAngle),
  };
  const attractedLimit = containedCenterDistance(
    baseBoundary,
    topOffsets,
    attractedDirection,
  );
  const safeBaseMagnitude = Math.min(baseMagnitude, attractedLimit);
  const attractedBase = {
    x: attractedDirection.x * safeBaseMagnitude,
    y: attractedDirection.y * safeBaseMagnitude,
  };

  // Spatial pull always targets the closest point on its winning guide. The
  // optional forward look-ahead changes orientation only; using it here would
  // invalidate the stop-before-guide and carrier-containment calculations.
  const spatialInfluence = pullInfluence ?? directionalInfluence!;
  const spatialTowardAngle = angleTowardGuide(
    spatialInfluence.field,
    point,
    coordinateScale,
  );
  const toward = {
    x: Math.cos(spatialTowardAngle),
    y: Math.sin(spatialTowardAngle),
  };
  const targetContainmentLimit = containedCenterDistance(
    baseBoundary,
    topOffsets,
    toward,
  );
  const capClearance = Math.max(
    0,
    ...topOffsets.map((offset) => offset.x * toward.x + offset.y * toward.y),
  );
  const beforeGuideLimit = Math.max(
    0,
    spatialInfluence.field.distance - capClearance,
  );
  const safeTargetLength = Math.min(targetContainmentLimit, beforeGuideLimit);
  const safeTarget = {
    x: toward.x * safeTargetLength,
    y: toward.y * safeTargetLength,
  };
  // A point exactly on the stroke has no meaningful inward direction. Keep
  // the deterministic tangent rotation, but never collapse its cap to base.
  const pullAmount =
    !pullInfluence || pullInfluence.field.distance <= EPSILON
      ? 0
      : pullInfluence.pullAmount;
  let finalOffset = {
    x: attractedBase.x + (safeTarget.x - attractedBase.x) * pullAmount,
    y: attractedBase.y + (safeTarget.y - attractedBase.y) * pullAmount,
  };

  if (
    pullInfluence?.effects.centerPull === 1 &&
    pullInfluence.field.distance > EPSILON
  ) {
    const projection = finalOffset.x * toward.x + finalOffset.y * toward.y;
    if (projection > beforeGuideLimit) {
      const excess = projection - beforeGuideLimit;
      finalOffset = {
        x: finalOffset.x - toward.x * excess,
        y: finalOffset.y - toward.y * excess,
      };
    }
  }
  const finalLength = Math.hypot(finalOffset.x, finalOffset.y);
  if (finalLength > EPSILON) {
    const finalDirection = {
      x: finalOffset.x / finalLength,
      y: finalOffset.y / finalLength,
    };
    const finalLimit = containedCenterDistance(
      baseBoundary,
      topOffsets,
      finalDirection,
    );
    if (finalLength > finalLimit) {
      finalOffset = {
        x: finalDirection.x * finalLimit,
        y: finalDirection.y * finalLimit,
      };
    }
  }

  const mesh = translateTop(tile.mesh, topIndices, {
    x: finalOffset.x - originalTopCenter.x,
    y: finalOffset.y - originalTopCenter.y,
  });
  const orientationRad = meshTopOrientation(mesh) ?? attractedAngle;
  return {
    ...tile,
    mesh,
    orientationRad,
    diagnostics: diagnoseMesh(mesh),
  };
}

/**
 * Canonical final-space triangle guide pass.
 *
 * Families first build their un-guided lean, finished-size scaling establishes
 * the exact displayed carrier, and only then does this pass sample guides from
 * actual tile centres and translate the raised cap. Preview and exports consume
 * this same corrected mesh.
 */
export function applyFinalTriangleGuides(
  config: WallArtConfig,
  widthMm: number,
  depthMm: number,
  tiles: readonly GeneratedTile[],
): GeneratedTile[] {
  if (config.design.family !== "triangular-current") return [...tiles];
  return tiles.map((tile) => correctTriangleTile(config, widthMm, depthMm, tile));
}
