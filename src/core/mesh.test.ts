import { describe, expect, it } from "vitest";

import type { Mesh } from "./types";
import { diagnoseMesh, edgeUseCounts, meshBounds, triangleNormal } from "./mesh";

function tetrahedron(): Mesh {
  return {
    name: "finite-tetrahedron",
    vertices: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
    ],
    triangles: [
      [0, 2, 1],
      [0, 1, 3],
      [1, 2, 3],
      [2, 0, 3],
    ],
  };
}

describe("mesh diagnostics input safety", () => {
  it("reports non-finite vertices and derived normals without leaking NaN metrics", () => {
    const mesh = tetrahedron();
    mesh.vertices[3] = { x: Number.NaN, y: 0, z: 1 };

    const diagnostics = diagnoseMesh(mesh);
    expect(diagnostics.nonFiniteVertexCount).toBe(1);
    expect(diagnostics.nonFiniteNormalCount).toBe(3);
    expect(diagnostics.nonFiniteMetricCount).toBe(0);
    expect(diagnostics.invalidTriangleIndexCount).toBe(0);
    expect(diagnostics.closedManifold).toBe(false);
    expect(diagnostics.outwardWinding).toBe(false);
    expect(Number.isFinite(diagnostics.surfaceAreaMm2)).toBe(true);
    expect(Number.isFinite(diagnostics.volumeMm3)).toBe(true);
    expect(Object.values(diagnostics.bounds.min).every(Number.isFinite)).toBe(true);
    expect(() => meshBounds(mesh)).toThrow(/non-finite vertex at index 3/i);
    expect(() => triangleNormal(mesh, [0, 1, 3])).toThrow(/non-finite vertices/i);
  });

  it("reports every invalid triangle index and rejects topology helpers clearly", () => {
    const mesh = tetrahedron();
    mesh.triangles.push([-1, 1.5, Number.POSITIVE_INFINITY]);

    const diagnostics = diagnoseMesh(mesh);
    expect(diagnostics.invalidTriangleIndexCount).toBe(3);
    expect(diagnostics.degenerateTriangleCount).toBe(1);
    expect(diagnostics.closedManifold).toBe(false);
    expect(() => edgeUseCounts(mesh)).toThrow(/invalid triangle index -1/i);
    expect(() => triangleNormal(mesh, mesh.triangles.at(-1)!)).toThrow(/invalid triangle index/i);
  });

  it("reports overflowed derived normals from otherwise finite coordinates", () => {
    const mesh: Mesh = {
      name: "overflowed-normal",
      vertices: [
        { x: 1e308, y: 0, z: 0 },
        { x: 0, y: 1e308, z: 0 },
        { x: 0, y: 0, z: 1e308 },
      ],
      triangles: [[0, 1, 2]],
    };

    const diagnostics = diagnoseMesh(mesh);
    expect(diagnostics.nonFiniteVertexCount).toBe(0);
    expect(diagnostics.nonFiniteNormalCount).toBe(1);
    expect(diagnostics.nonFiniteMetricCount).toBe(0);
    expect(diagnostics.closedManifold).toBe(false);
    expect(Number.isFinite(diagnostics.surfaceAreaMm2)).toBe(true);
    expect(() => triangleNormal(mesh, mesh.triangles[0])).toThrow(/non-finite triangle normal/i);
  });

  it("reports non-finite area or volume contributions without corrupting totals", () => {
    const mesh: Mesh = {
      name: "overflowed-volume",
      vertices: [
        { x: 1e150, y: 0, z: 0 },
        { x: 0, y: 1e150, z: 0 },
        { x: 0, y: 0, z: 1e150 },
      ],
      triangles: [[0, 1, 2]],
    };

    const diagnostics = diagnoseMesh(mesh);
    expect(diagnostics.nonFiniteNormalCount).toBe(0);
    expect(diagnostics.nonFiniteMetricCount).toBe(1);
    expect(diagnostics.surfaceAreaMm2).toBe(0);
    expect(diagnostics.volumeMm3).toBe(0);
    expect(diagnostics.closedManifold).toBe(false);
  });

  it("reports finite vertices whose coordinate range overflows mesh bounds", () => {
    const mesh: Mesh = {
      name: "overflowed-bounds",
      vertices: [
        { x: -1e308, y: 0, z: 0 },
        { x: 1e308, y: 1, z: 0 },
        { x: 1e308, y: 0, z: 1 },
      ],
      triangles: [[0, 1, 2]],
    };

    const diagnostics = diagnoseMesh(mesh);
    expect(diagnostics.nonFiniteVertexCount).toBe(0);
    expect(diagnostics.nonFiniteMetricCount).toBeGreaterThan(0);
    expect(diagnostics.closedManifold).toBe(false);
    expect(() => meshBounds(mesh)).toThrow(/non-finite bounds/i);
  });
});
