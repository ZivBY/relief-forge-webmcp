import { describe, expect, it } from "vitest";

import {
  createHexReliefMesh,
  diagnoseMesh,
  edgeUseCounts,
  HEX_RELIEF_SHAPES,
} from "./index";

function xySignature(mesh: ReturnType<typeof createHexReliefMesh>): string {
  return JSON.stringify(mesh.vertices.map((vertex) => [vertex.x, vertex.y]));
}

describe("sculpted hex relief solids", () => {
  it.each(HEX_RELIEF_SHAPES)(
    "builds deterministic, closed, outward-wound %s terrain",
    (shape) => {
      for (const subdivisions of [2, 5, 8]) {
        const options = {
          shape,
          radiusMm: 32,
          baseHeightMm: 2.4,
          peakHeightMm: 24,
          orientationRad: 0.37,
          subdivisions,
          name: `${shape}-${subdivisions}`,
        } as const;
        const mesh = createHexReliefMesh(options);
        const repeated = createHexReliefMesh(options);
        const diagnostics = diagnoseMesh(mesh);

        expect(repeated).toEqual(mesh);
        expect(diagnostics.degenerateTriangleCount).toBe(0);
        expect(diagnostics.boundaryEdgeCount).toBe(0);
        expect(diagnostics.nonManifoldEdgeCount).toBe(0);
        expect(diagnostics.closedManifold).toBe(true);
        expect(diagnostics.outwardWinding).toBe(true);
        expect(diagnostics.bounds.min.z).toBe(0);
        expect(diagnostics.bounds.max.z).toBeGreaterThan(2.4);
        expect(diagnostics.bounds.max.z).toBeLessThanOrEqual(24);
        expect(
          [...edgeUseCounts(mesh).values()].every((count) => count === 2),
        ).toBe(true);
      }
    },
  );

  it("keeps one exact regular-hex XY carrier while changing only top relief", () => {
    const meshes = HEX_RELIEF_SHAPES.map((shape) =>
      createHexReliefMesh({
        shape,
        radiusMm: 30,
        baseHeightMm: 2.4,
        peakHeightMm: 22,
        orientationRad: 0.61,
        subdivisions: 5,
      }),
    );

    expect(new Set(meshes.map(xySignature))).toHaveLength(1);
    expect(
      new Set(
        meshes.map((mesh) =>
          JSON.stringify(mesh.vertices.map((vertex) => vertex.z)),
        ),
      ),
    ).toHaveLength(HEX_RELIEF_SHAPES.length);

    const bottomVertices = meshes[0].vertices.filter(
      (vertex) => vertex.z === 0,
    );
    const corners = bottomVertices.filter(
      (vertex) => Math.abs(Math.hypot(vertex.x, vertex.y) - 30) < 1e-9,
    );
    expect(corners).toHaveLength(6);
    const sideLengths = corners.map((corner, index) => {
      const next = corners[(index + 1) % corners.length];
      return Math.hypot(corner.x - next.x, corner.y - next.y);
    });
    expect(sideLengths.every((length) => Math.abs(length - 30) < 1e-9)).toBe(
      true,
    );
  });

  it("rotates the relief without rotating or resizing the hex carrier", () => {
    const first = createHexReliefMesh({
      shape: "hex-wave-bands",
      radiusMm: 28,
      baseHeightMm: 2.4,
      peakHeightMm: 20,
      orientationRad: 0,
    });
    const rotated = createHexReliefMesh({
      shape: "hex-wave-bands",
      radiusMm: 28,
      baseHeightMm: 2.4,
      peakHeightMm: 20,
      orientationRad: Math.PI / 3,
    });

    expect(xySignature(rotated)).toBe(xySignature(first));
    expect(rotated.vertices.map((vertex) => vertex.z)).not.toEqual(
      first.vertices.map((vertex) => vertex.z),
    );
  });
});
