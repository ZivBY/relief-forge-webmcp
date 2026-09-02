import { describe, expect, it } from "vitest";
import {
  createTerracedPanelMesh,
  createTileMesh,
  diagnoseMesh,
  edgeUseCounts,
  triangleNormal,
} from "./index";
import type { Mesh, TileShapeKind, Vec3 } from "./index";

function average(vertices: readonly Vec3[]): Vec3 {
  const sum = vertices.reduce(
    (total, vertex) => ({
      x: total.x + vertex.x,
      y: total.y + vertex.y,
      z: total.z + vertex.z,
    }),
    { x: 0, y: 0, z: 0 },
  );
  return {
    x: sum.x / vertices.length,
    y: sum.y / vertices.length,
    z: sum.z / vertices.length,
  };
}

function expectPrintableTerrace(mesh: Mesh): void {
  const diagnostics = diagnoseMesh(mesh);
  expect(mesh.vertices.length).toBeGreaterThan(0);
  expect(mesh.triangles.length).toBeGreaterThan(0);
  expect(
    mesh.vertices.every(
      (vertex) =>
        Number.isFinite(vertex.x) &&
        Number.isFinite(vertex.y) &&
        Number.isFinite(vertex.z),
    ),
  ).toBe(true);
  expect(diagnostics.degenerateTriangleCount).toBe(0);
  expect(diagnostics.boundaryEdgeCount).toBe(0);
  expect(diagnostics.nonManifoldEdgeCount).toBe(0);
  expect(diagnostics.closedManifold).toBe(true);
  expect(diagnostics.outwardWinding).toBe(true);
  expect(diagnostics.signedVolumeMm3).toBeGreaterThan(0);
  expect(diagnostics.bounds.min.z).toBe(0);
  expect([...edgeUseCounts(mesh).values()].every((count) => count === 2)).toBe(
    true,
  );
  const directedEdgeBalance = new Map<string, number>();
  for (const [a, b, c] of mesh.triangles) {
    for (const [start, end] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const key = start < end ? `${start}:${end}` : `${end}:${start}`;
      const direction = start < end ? 1 : -1;
      directedEdgeBalance.set(
        key,
        (directedEdgeBalance.get(key) ?? 0) + direction,
      );
    }
  }
  expect(
    [...directedEdgeBalance.values()].every((balance) => balance === 0),
  ).toBe(true);

  let upwardCount = 0;
  let verticalCount = 0;
  for (const triangle of mesh.triangles) {
    const normal = triangleNormal(mesh, triangle);
    const horizontal = Math.abs(Math.abs(normal.z) - 1) < 1e-10;
    const vertical = Math.abs(normal.z) < 1e-10;
    expect(horizontal || vertical).toBe(true);
    if (normal.z > 0.9999999999) upwardCount += 1;
    if (vertical) verticalCount += 1;
  }
  expect(upwardCount).toBeGreaterThan(0);
  expect(verticalCount).toBeGreaterThan(0);
}

describe("tile solids", () => {
  const cases: Array<[TileShapeKind, number]> = [
    ["leaning-pyramid", 6],
    ["twisted-prism", 12],
    ["hex-spike", 12],
  ];

  it.each(cases)(
    "builds a closed, outward-wound %s",
    (shape, triangleCount) => {
      const mesh = createTileMesh({
        shape,
        sizeMm: 24,
        heightMm: 16,
        topScale: 0.35,
        leanRatio: 0.1,
        twistDeg: 17,
        orientationRad: 0.31,
      });
      const diagnostics = diagnoseMesh(mesh);
      expect(mesh.triangles).toHaveLength(triangleCount);
      expect(diagnostics.degenerateTriangleCount).toBe(0);
      expect(diagnostics.boundaryEdgeCount).toBe(0);
      expect(diagnostics.nonManifoldEdgeCount).toBe(0);
      expect(diagnostics.closedManifold).toBe(true);
      expect(diagnostics.outwardWinding).toBe(true);
      expect(
        [...edgeUseCounts(mesh).values()].every((count) => count === 2),
      ).toBe(true);

      const center = average(mesh.vertices);
      for (const triangle of mesh.triangles) {
        const faceCenter = average(
          triangle.map((index) => mesh.vertices[index]),
        );
        const normal = triangleNormal(mesh, triangle);
        const outwardDot =
          normal.x * (faceCenter.x - center.x) +
          normal.y * (faceCenter.y - center.y) +
          normal.z * (faceCenter.z - center.z);
        expect(outwardDot).toBeGreaterThan(0);
      }
    },
  );

  it("keeps every prism face outward across a full field-orientation sweep", () => {
    for (let step = 0; step < 24; step += 1) {
      const orientationRad = -Math.PI + (step * Math.PI * 2) / 24;
      const mesh = createTileMesh({
        shape: "twisted-prism",
        sizeMm: 24,
        heightMm: 16,
        topScale: 0.35,
        leanRatio: 0.1,
        twistDeg: 24,
        orientationRad,
      });
      const center = average(mesh.vertices);
      for (const triangle of mesh.triangles) {
        const faceCenter = average(
          triangle.map((index) => mesh.vertices[index]),
        );
        const normal = triangleNormal(mesh, triangle);
        const outwardDot =
          normal.x * (faceCenter.x - center.x) +
          normal.y * (faceCenter.y - center.y) +
          normal.z * (faceCenter.z - center.z);
        expect(outwardDot).toBeGreaterThan(0);
      }
    }
  });
});

describe("terraced panel solid", () => {
  it("builds genuinely horizontal plateaus joined only by vertical transition walls", () => {
    const resolution = 4;
    const levels = [
      [2, 6, 6, 4, 9],
      [3, 6, 8, 4, 7],
      [3, 5, 8, 10, 7],
      [9, 5, 2.5, 10, 4],
      [9, 7, 2.5, 6, 4],
    ];
    const mesh = createTerracedPanelMesh({
      widthMm: 32,
      depthMm: 24,
      resolution,
      sampleHeight: (x, y) => {
        const column = Math.round(((x + 16) / 32) * resolution);
        const row = Math.round(((y + 12) / 24) * resolution);
        return levels[row][column];
      },
      name: "nonuniform-terrace",
    });

    expect(mesh.name).toBe("nonuniform-terrace");
    expectPrintableTerrace(mesh);
    const topLevels = new Set(
      mesh.triangles
        .filter((triangle) => triangleNormal(mesh, triangle).z > 0.9999999999)
        .map((triangle) => mesh.vertices[triangle[0]].z),
    );
    expect([...topLevels].sort((a, b) => a - b)).toEqual([
      2, 2.5, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });

  it("resolves alternating diagonal point contacts with deterministic minimum-height junction reliefs", () => {
    const resolution = 3;
    const widthMm = 18;
    const depthMm = 18;
    const sampleHeight = (x: number, y: number) => {
      const column = Math.round(((x + widthMm / 2) / widthMm) * resolution);
      const row = Math.round(((y + depthMm / 2) / depthMm) * resolution);
      return (row + column) % 2 === 0 ? 9 : 2;
    };
    const first = createTerracedPanelMesh({
      widthMm,
      depthMm,
      resolution,
      sampleHeight,
    });
    const second = createTerracedPanelMesh({
      widthMm,
      depthMm,
      resolution,
      sampleHeight,
    });

    expect(first).toEqual(second);
    expectPrintableTerrace(first);
    const step = widthMm / resolution;
    const firstJunction = -widthMm / 2 + step / 2;
    const reliefOffset = step * 0.12;
    expect(
      first.vertices.some(
        (vertex) =>
          Math.abs(vertex.x - (firstJunction - reliefOffset)) < 1e-10 &&
          Math.abs(vertex.y - (firstJunction - reliefOffset)) < 1e-10 &&
          vertex.z === 2,
      ),
    ).toBe(true);
  });

  it("keeps a quantized smooth field watertight and free of hidden sloped faces", () => {
    const mesh = createTerracedPanelMesh({
      widthMm: 40,
      depthMm: 28,
      resolution: 9,
      sampleHeight: (x, y) => {
        const smooth =
          0.9 * Math.sin(x / 7) +
          0.65 * Math.cos(y / 5) +
          0.35 * Math.sin((x + y) / 4);
        return 2 + Math.round((smooth + 2) * 2.5) / 2.5;
      },
    });

    expectPrintableTerrace(mesh);
  });

  it("stays manifold across deterministic mixed-height saddle fields", () => {
    for (let seed = 0; seed < 12; seed += 1) {
      const resolution = 3 + (seed % 6);
      const mesh = createTerracedPanelMesh({
        widthMm: 31,
        depthMm: 23,
        resolution,
        sampleHeight: (x, y) => {
          const column = Math.round(((x + 15.5) / 31) * resolution);
          const row = Math.round(((y + 11.5) / 23) * resolution);
          return (
            1.5 +
            ((column * 7 + row * 11 + seed * 13 + column * row * 3) % 17) * 0.45
          );
        },
      });
      const diagnostics = diagnoseMesh(mesh);
      expect(diagnostics.degenerateTriangleCount, `seed ${seed}`).toBe(0);
      expect(diagnostics.boundaryEdgeCount, `seed ${seed}`).toBe(0);
      expect(diagnostics.nonManifoldEdgeCount, `seed ${seed}`).toBe(0);
      expect(diagnostics.closedManifold, `seed ${seed}`).toBe(true);
      expect(diagnostics.outwardWinding, `seed ${seed}`).toBe(true);
      expect(diagnostics.bounds.min.z, `seed ${seed}`).toBe(0);
    }
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects non-positive or non-finite terrace height %s",
    (height) => {
      expect(() =>
        createTerracedPanelMesh({
          widthMm: 20,
          depthMm: 20,
          resolution: 4,
          sampleHeight: () => height,
        }),
      ).toThrow(/finite and above zero/i);
    },
  );
});
