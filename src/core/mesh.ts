import type { Bounds3, Mesh, MeshDiagnostics, Triangle, Vec3 } from "./types";

const EPSILON = 1e-9;

function isFiniteVector(vector: Vec3): boolean {
  return Number.isFinite(vector.x) && Number.isFinite(vector.y) && Number.isFinite(vector.z);
}

function isValidVertexIndex(index: number, vertexCount: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < vertexCount;
}

function boundsFromVertices(vertices: readonly Vec3[]): Bounds3 {
  if (vertices.length === 0) {
    const zero = { x: 0, y: 0, z: 0 };
    return { min: { ...zero }, max: { ...zero }, size: { ...zero } };
  }
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const vertex of vertices) {
    min.x = Math.min(min.x, vertex.x);
    min.y = Math.min(min.y, vertex.y);
    min.z = Math.min(min.z, vertex.z);
    max.x = Math.max(max.x, vertex.x);
    max.y = Math.max(max.y, vertex.y);
    max.z = Math.max(max.z, vertex.z);
  }
  return {
    min,
    max,
    size: { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z },
  };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function length(vector: Vec3): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}

export function triangleNormal(mesh: Mesh, triangle: Triangle): Vec3 {
  for (const index of triangle) {
    if (!isValidVertexIndex(index, mesh.vertices.length)) {
      throw new Error(
        `Mesh ${mesh.name} contains invalid triangle index ${String(index)} for ${mesh.vertices.length} vertices.`,
      );
    }
  }
  const a = mesh.vertices[triangle[0]];
  const b = mesh.vertices[triangle[1]];
  const c = mesh.vertices[triangle[2]];
  if (!isFiniteVector(a) || !isFiniteVector(b) || !isFiniteVector(c)) {
    throw new Error(`Mesh ${mesh.name} cannot produce a normal from non-finite vertices.`);
  }
  const raw = cross(subtract(b, a), subtract(c, a));
  const magnitude = length(raw);
  if (!isFiniteVector(raw) || !Number.isFinite(magnitude)) {
    throw new Error(`Mesh ${mesh.name} produced a non-finite triangle normal.`);
  }
  if (magnitude <= EPSILON) return { x: 0, y: 0, z: 0 };
  return { x: raw.x / magnitude, y: raw.y / magnitude, z: raw.z / magnitude };
}

export function meshBounds(mesh: Mesh): Bounds3 {
  const invalidIndex = mesh.vertices.findIndex((vertex) => !isFiniteVector(vertex));
  if (invalidIndex >= 0) {
    throw new Error(
      `Mesh ${mesh.name} contains a non-finite vertex at index ${invalidIndex}; bounds are undefined.`,
    );
  }
  const bounds = boundsFromVertices(mesh.vertices);
  if (!isFiniteVector(bounds.min) || !isFiniteVector(bounds.max) || !isFiniteVector(bounds.size)) {
    throw new Error(`Mesh ${mesh.name} produced non-finite bounds from its vertices.`);
  }
  return bounds;
}

export function rotateMeshZ(mesh: Mesh, angleRad: number, name = mesh.name): Mesh {
  const cosine = Math.cos(angleRad);
  const sine = Math.sin(angleRad);
  return {
    name,
    vertices: mesh.vertices.map((vertex) => ({
      x: vertex.x * cosine - vertex.y * sine,
      y: vertex.x * sine + vertex.y * cosine,
      z: vertex.z,
    })),
    triangles: mesh.triangles.map((triangle) => [...triangle] as Triangle),
  };
}

export function translateMesh(mesh: Mesh, x: number, y: number, z = 0, name = mesh.name): Mesh {
  return {
    name,
    vertices: mesh.vertices.map((vertex) => ({
      x: vertex.x + x,
      y: vertex.y + y,
      z: vertex.z + z,
    })),
    triangles: mesh.triangles.map((triangle) => [...triangle] as Triangle),
  };
}

export function combineMeshes(meshes: readonly Mesh[], name = "combined-mesh"): Mesh {
  const vertices: Vec3[] = [];
  const triangles: Triangle[] = [];
  for (const mesh of meshes) {
    const offset = vertices.length;
    vertices.push(...mesh.vertices.map((vertex) => ({ ...vertex })));
    triangles.push(
      ...mesh.triangles.map(
        (triangle) => [triangle[0] + offset, triangle[1] + offset, triangle[2] + offset] as Triangle,
      ),
    );
  }
  return { name, vertices, triangles };
}

export function edgeUseCounts(mesh: Mesh): Map<string, number> {
  const counts = new Map<string, number>();
  const addEdge = (a: number, b: number) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  for (const [a, b, c] of mesh.triangles) {
    for (const index of [a, b, c]) {
      if (!isValidVertexIndex(index, mesh.vertices.length)) {
        throw new Error(
          `Mesh ${mesh.name} contains invalid triangle index ${String(index)} for ${mesh.vertices.length} vertices.`,
        );
      }
    }
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }
  return counts;
}

export function diagnoseMesh(mesh: Mesh): MeshDiagnostics {
  let surfaceAreaMm2 = 0;
  let signedVolumeMm3 = 0;
  let degenerateTriangleCount = 0;
  let invalidTriangleIndexCount = 0;
  let nonFiniteNormalCount = 0;
  let nonFiniteMetricCount = 0;
  const nonFiniteVertexCount = mesh.vertices.filter((vertex) => !isFiniteVector(vertex)).length;
  const finiteVertices = mesh.vertices.filter(isFiniteVector);
  const edgeCounts = new Map<string, number>();
  const addEdge = (a: number, b: number) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
  };

  for (const triangle of mesh.triangles) {
    const invalidIndices = triangle.filter(
      (index) => !isValidVertexIndex(index, mesh.vertices.length),
    ).length;
    invalidTriangleIndexCount += invalidIndices;
    if (invalidIndices > 0) {
      degenerateTriangleCount += 1;
      continue;
    }

    const [indexA, indexB, indexC] = triangle;
    addEdge(indexA, indexB);
    addEdge(indexB, indexC);
    addEdge(indexC, indexA);
    const a = mesh.vertices[triangle[0]];
    const b = mesh.vertices[triangle[1]];
    const c = mesh.vertices[triangle[2]];
    if (!isFiniteVector(a) || !isFiniteVector(b) || !isFiniteVector(c)) {
      degenerateTriangleCount += 1;
      nonFiniteNormalCount += 1;
      continue;
    }
    const areaVector = cross(subtract(b, a), subtract(c, a));
    const twiceArea = length(areaVector);
    if (!isFiniteVector(areaVector) || !Number.isFinite(twiceArea)) {
      degenerateTriangleCount += 1;
      nonFiniteNormalCount += 1;
      continue;
    }
    const areaContribution = twiceArea / 2;
    const volumeContribution = dot(a, cross(b, c)) / 6;
    const nextSurfaceArea = surfaceAreaMm2 + areaContribution;
    const nextSignedVolume = signedVolumeMm3 + volumeContribution;
    if (
      !Number.isFinite(areaContribution) ||
      !Number.isFinite(volumeContribution) ||
      !Number.isFinite(nextSurfaceArea) ||
      !Number.isFinite(nextSignedVolume)
    ) {
      degenerateTriangleCount += 1;
      nonFiniteMetricCount += 1;
      continue;
    }
    if (twiceArea <= EPSILON) degenerateTriangleCount += 1;
    surfaceAreaMm2 = nextSurfaceArea;
    signedVolumeMm3 = nextSignedVolume;
  }

  let boundaryEdgeCount = 0;
  let nonManifoldEdgeCount = 0;
  for (const count of edgeCounts.values()) {
    if (count === 1) boundaryEdgeCount += 1;
    else if (count !== 2) nonManifoldEdgeCount += 1;
  }

  const bounds = boundsFromVertices(finiteVertices);
  if (!isFiniteVector(bounds.min) || !isFiniteVector(bounds.max) || !isFiniteVector(bounds.size)) {
    nonFiniteMetricCount += 1;
  }

  return {
    vertexCount: mesh.vertices.length,
    triangleCount: mesh.triangles.length,
    nonFiniteVertexCount,
    invalidTriangleIndexCount,
    nonFiniteNormalCount,
    nonFiniteMetricCount,
    bounds,
    surfaceAreaMm2,
    signedVolumeMm3,
    volumeMm3: Math.abs(signedVolumeMm3),
    degenerateTriangleCount,
    boundaryEdgeCount,
    nonManifoldEdgeCount,
    closedManifold:
      mesh.triangles.length > 0 &&
      nonFiniteVertexCount === 0 &&
      invalidTriangleIndexCount === 0 &&
      nonFiniteNormalCount === 0 &&
      nonFiniteMetricCount === 0 &&
      degenerateTriangleCount === 0 &&
      boundaryEdgeCount === 0 &&
      nonManifoldEdgeCount === 0,
    outwardWinding:
      nonFiniteVertexCount === 0 &&
      invalidTriangleIndexCount === 0 &&
      nonFiniteNormalCount === 0 &&
      nonFiniteMetricCount === 0 &&
      signedVolumeMm3 > EPSILON,
  };
}
