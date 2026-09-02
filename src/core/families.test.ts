import { describe, expect, it } from "vitest";
import {
  buildFullArtMesh,
  createHeightfieldPanelMesh,
  edgeUseCounts,
  generateWallArt,
  meshBounds,
  packWallArt,
  triangleNormal,
} from "./index";
import type {
  DesignFamilyKind,
  GeneratedTile,
  Mesh,
  Rect2,
  TileShapeKind,
  WallArtProject,
} from "./index";

interface FamilyCase {
  family: DesignFamilyKind;
  shape: TileShapeKind;
}

const FAMILY_CASES: readonly FamilyCase[] = [
  { family: "folded-flow", shape: "folded-ridge" },
  { family: "sampled-blocks", shape: "surface-column" },
  { family: "triangular-current", shape: "triangle-sail" },
  { family: "polar-bloom", shape: "polar-petal" },
  { family: "cellular-crystal", shape: "cell-crystal" },
  { family: "hex-canopy", shape: "hex-petal" },
  { family: "coral-cluster", shape: "ring-pod" },
  { family: "contour-relief", shape: "relief-panel" },
  { family: "silhouette-mosaic", shape: "mixed-block" },
];

const EPSILON = 1e-7;

function makeProject(
  familyCase: FamilyCase,
  seed = `family-contract-${familyCase.family}`,
): WallArtProject {
  return generateWallArt({
    seed,
    design: {
      family: familyCase.family,
      silhouette: "rectangle",
      variation: 0.64,
      symmetry: 5,
      surfaceResolution: 6,
    },
    grid: {
      columns: 5,
      rows: 4,
      tileSizeMm: 18,
      gapMm: 1.5,
    },
    tile: {
      shape: familyCase.shape,
      baseHeightMm: 2.4,
      reliefHeightMm: 14,
      topScale: 0.38,
      leanRatio: 0.12,
      twistDeg: 23,
    },
    pattern: {
      kind: "vortex",
      frequency: 1.1,
      arms: 4,
    },
    palette: {
      colors: ["#336699"],
      mode: "field-bands",
    },
    printer: {
      bedWidthMm: 220,
      bedDepthMm: 220,
      marginMm: 5,
      spacingMm: 3,
      allowRotate90: true,
      separateColors: false,
    },
  });
}

function allFinite(values: readonly number[]): boolean {
  return values.every(Number.isFinite);
}

function assertValidTileMesh(mesh: Mesh): void {
  expect(mesh.vertices.length).toBeGreaterThan(0);
  expect(mesh.triangles.length).toBeGreaterThan(0);
  expect(
    mesh.vertices.every((vertex) => allFinite([vertex.x, vertex.y, vertex.z])),
  ).toBe(true);
  expect(
    mesh.triangles.every(
      (triangle) =>
        triangle.every(Number.isInteger) &&
        triangle.every((index) => index >= 0 && index < mesh.vertices.length),
    ),
  ).toBe(true);
  const directedEdgeBalance = new Map<string, number>();
  for (const [a, b, c] of mesh.triangles) {
    for (const [from, to] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const key = from < to ? `${from}:${to}` : `${to}:${from}`;
      const direction = from < to ? 1 : -1;
      directedEdgeBalance.set(
        key,
        (directedEdgeBalance.get(key) ?? 0) + direction,
      );
    }
  }
  expect(
    [...directedEdgeBalance.values()].every((balance) => balance === 0),
  ).toBe(true);
  const bounds = meshBounds(mesh);
  for (const triangle of mesh.triangles) {
    const vertices = triangle.map((index) => mesh.vertices[index]);
    const normal = triangleNormal(mesh, triangle);
    if (
      vertices.every((vertex) => Math.abs(vertex.z - bounds.min.z) <= EPSILON)
    ) {
      expect(normal.z).toBeLessThan(0);
    }
    if (
      vertices.every((vertex) => Math.abs(vertex.z - bounds.max.z) <= EPSILON)
    ) {
      expect(normal.z).toBeGreaterThan(0);
    }
  }
}

function topologySignature(project: WallArtProject): string {
  const meshClasses = new Map<string, number>();
  for (const tile of project.tiles) {
    const edgeCount = edgeUseCounts(tile.mesh).size;
    const eulerCharacteristic =
      tile.mesh.vertices.length - edgeCount + tile.mesh.triangles.length;
    const key = [
      tile.mesh.vertices.length,
      edgeCount,
      tile.mesh.triangles.length,
      eulerCharacteristic,
    ].join(":");
    meshClasses.set(key, (meshClasses.get(key) ?? 0) + 1);
  }
  return JSON.stringify({
    tileCount: project.tiles.length,
    meshClasses: [...meshClasses.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  });
}

function separated(a: Rect2, b: Rect2, spacingMm: number): boolean {
  return (
    a.maxX + spacingMm <= b.minX + EPSILON ||
    b.maxX + spacingMm <= a.minX + EPSILON ||
    a.maxY + spacingMm <= b.minY + EPSILON ||
    b.maxY + spacingMm <= a.minY + EPSILON
  );
}

function expectPrintableTiles(project: WallArtProject): void {
  expect(project.tiles.length).toBeGreaterThan(0);
  expect(project.diagnostics.closedTileCount).toBe(project.tiles.length);
  expect(project.diagnostics.allTilesClosedManifold).toBe(true);
  for (const tile of project.tiles) {
    expect(tile.diagnostics.degenerateTriangleCount).toBe(0);
    expect(tile.diagnostics.boundaryEdgeCount).toBe(0);
    expect(tile.diagnostics.nonManifoldEdgeCount).toBe(0);
    expect(tile.diagnostics.closedManifold).toBe(true);
    expect(tile.diagnostics.outwardWinding).toBe(true);
  }
}

function localRadialExtent(mesh: Mesh): number {
  return Math.max(...mesh.vertices.map((vertex) => Math.hypot(vertex.x, vertex.y)));
}

function pointInsideConvexPolygon(
  point: { x: number; y: number },
  polygon: ReadonlyArray<{ x: number; y: number }>,
): boolean {
  let direction = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    const cross =
      (end.x - start.x) * (point.y - start.y) -
      (end.y - start.y) * (point.x - start.x);
    if (Math.abs(cross) <= EPSILON) continue;
    const currentDirection = Math.sign(cross);
    if (direction === 0) direction = currentDirection;
    else if (currentDirection !== direction) return false;
  }
  return true;
}

function convexPolygonsStrictlyOverlap(
  left: ReadonlyArray<{ x: number; y: number }>,
  right: ReadonlyArray<{ x: number; y: number }>,
): boolean {
  for (const polygon of [left, right]) {
    for (let index = 0; index < polygon.length; index += 1) {
      const start = polygon[index];
      const end = polygon[(index + 1) % polygon.length];
      const axis = { x: -(end.y - start.y), y: end.x - start.x };
      const project = (
        points: ReadonlyArray<{ x: number; y: number }>,
      ): [number, number] => {
        const values = points.map((point) => point.x * axis.x + point.y * axis.y);
        return [Math.min(...values), Math.max(...values)];
      };
      const [leftMin, leftMax] = project(left);
      const [rightMin, rightMax] = project(right);
      if (leftMax <= rightMin + EPSILON || rightMax <= leftMin + EPSILON) {
        return false;
      }
    }
  }
  return true;
}

function tileComponents(project: WallArtProject): GeneratedTile[][] {
  const byCell = new Map(
    project.tiles.map((tile) => [`${tile.row}:${tile.column}`, tile]),
  );
  const remaining = new Set(byCell.keys());
  const components: GeneratedTile[][] = [];
  while (remaining.size > 0) {
    const first = remaining.values().next().value as string;
    remaining.delete(first);
    const queue = [first];
    const component: GeneratedTile[] = [];
    while (queue.length > 0) {
      const key = queue.shift()!;
      const tile = byCell.get(key)!;
      component.push(tile);
      for (const [rowOffset, columnOffset] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const) {
        const neighbor = `${tile.row + rowOffset}:${tile.column + columnOffset}`;
        if (remaining.delete(neighbor)) queue.push(neighbor);
      }
    }
    components.push(component);
  }
  return components;
}

describe.each(FAMILY_CASES)("$family family contract", (familyCase) => {
  it("is deterministic, non-empty, finite, and uses stable unique IDs", () => {
    const first = makeProject(familyCase);
    const second = makeProject(familyCase);

    expect(second).toEqual(first);
    expect(first.tiles.length).toBeGreaterThan(0);
    expect(first.diagnostics.tileCount).toBe(first.tiles.length);
    expect(first.diagnostics.closedTileCount).toBe(first.tiles.length);
    expect(first.diagnostics.allTilesClosedManifold).toBe(true);
    expect(allFinite([first.widthMm, first.depthMm])).toBe(true);
    expect(first.widthMm).toBeGreaterThan(0);
    expect(first.depthMm).toBeGreaterThan(0);

    const ids = first.tiles.map((tile) => tile.id);
    expect(ids).toEqual(second.tiles.map((tile) => tile.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      makeProject(familyCase, `alternate-${familyCase.family}`).tiles.map(
        (tile) => tile.id,
      ),
    ).toEqual(ids);

    for (const tile of first.tiles) {
      assertValidTileMesh(tile.mesh);
      expect(tile.family).toBe(familyCase.family);
      expect(tile.diagnostics.closedManifold).toBe(true);
      expect(tile.diagnostics.outwardWinding).toBe(true);
      expect(tile.diagnostics.degenerateTriangleCount).toBe(0);
      expect(tile.diagnostics.boundaryEdgeCount).toBe(0);
      expect(tile.diagnostics.nonManifoldEdgeCount).toBe(0);
      expect(tile.diagnostics.signedVolumeMm3).toBeGreaterThan(0);
      expect(tile.diagnostics.volumeMm3).toBeGreaterThan(0);
      const bounds = tile.diagnostics.bounds;
      expect(
        allFinite([
          bounds.min.x,
          bounds.min.y,
          bounds.min.z,
          bounds.max.x,
          bounds.max.y,
          bounds.max.z,
          bounds.size.x,
          bounds.size.y,
          bounds.size.z,
        ]),
      ).toBe(true);
      expect(bounds.min.z).toBeCloseTo(0, 8);
      expect(bounds.size.x).toBeGreaterThan(0);
      expect(bounds.size.y).toBeGreaterThan(0);
      expect(bounds.size.z).toBeGreaterThan(0);
    }

    const fullBounds = meshBounds(buildFullArtMesh(first));
    expect(
      allFinite([
        fullBounds.min.x,
        fullBounds.min.y,
        fullBounds.min.z,
        fullBounds.max.x,
        fullBounds.max.y,
        fullBounds.max.z,
      ]),
    ).toBe(true);
    expect(fullBounds.min.z).toBeCloseTo(0, 8);
  });

  it("uses the visible variation control in generated geometry", () => {
    const baseline = makeProject(familyCase, `variation-${familyCase.family}`);
    const low = generateWallArt({
      ...baseline.config,
      design: { ...baseline.config.design, variation: 0 },
    });
    const high = generateWallArt({
      ...baseline.config,
      design: { ...baseline.config.design, variation: 1 },
    });
    const signature = (project: WallArtProject) =>
      project.tiles.map((tile) =>
        tile.mesh.vertices.map((vertex) => [vertex.x, vertex.y, vertex.z]),
      );
    expect(signature(high)).not.toEqual(signature(low));
  });

  it("packs every part on reasonable beds without losing IDs or spacing", () => {
    const project = makeProject(familyCase);
    const packing = packWallArt(project);

    expect(packWallArt(project)).toEqual(packing);
    expect(packing.placementCount).toBe(project.tiles.length);
    expect(packing.plates.length).toBeGreaterThan(0);
    const packedIds = packing.plates.flatMap((plate) =>
      plate.placements.map((placement) => placement.tileId),
    );
    expect(new Set(packedIds).size).toBe(project.tiles.length);
    expect([...packedIds].sort()).toEqual(
      project.tiles.map((tile) => tile.id).sort(),
    );

    for (const plate of packing.plates) {
      for (const placement of plate.placements) {
        expect(
          allFinite([
            placement.translateXmm,
            placement.translateYmm,
            placement.footprint.minX,
            placement.footprint.minY,
            placement.footprint.maxX,
            placement.footprint.maxY,
          ]),
        ).toBe(true);
        expect(placement.footprint.minX).toBeGreaterThanOrEqual(
          packing.printer.marginMm - EPSILON,
        );
        expect(placement.footprint.minY).toBeGreaterThanOrEqual(
          packing.printer.marginMm - EPSILON,
        );
        expect(placement.footprint.maxX).toBeLessThanOrEqual(
          packing.printer.bedWidthMm - packing.printer.marginMm + EPSILON,
        );
        expect(placement.footprint.maxY).toBeLessThanOrEqual(
          packing.printer.bedDepthMm - packing.printer.marginMm + EPSILON,
        );
      }
      for (let left = 0; left < plate.placements.length; left += 1) {
        for (
          let right = left + 1;
          right < plate.placements.length;
          right += 1
        ) {
          expect(
            separated(
              plate.placements[left].footprint,
              plate.placements[right].footprint,
              packing.printer.spacingMm,
            ),
          ).toBe(true);
        }
      }
    }
  });

  it("keeps the generated art inside its declared finished dimensions", () => {
    const project = makeProject(familyCase);
    const bounds = meshBounds(buildFullArtMesh(project));
    expect(bounds.min.x).toBeGreaterThanOrEqual(-EPSILON);
    expect(bounds.min.y).toBeGreaterThanOrEqual(-EPSILON);
    expect(bounds.max.x).toBeLessThanOrEqual(project.widthMm + EPSILON);
    expect(bounds.max.y).toBeLessThanOrEqual(project.depthMm + EPSILON);
  });
});

describe("cellular-crystal clipping regressions", () => {
  it.each(["cell-crystal", "cell-plateau"] as const)(
    "keeps every exact-grid Voronoi cell non-degenerate at variation 0 for %s",
    (shape) => {
      const baseline = makeProject(
        { family: "cellular-crystal", shape },
        `cellular-zero-variation-${shape}`,
      );
      const project = generateWallArt({
        ...baseline.config,
        design: { ...baseline.config.design, variation: 0 },
        grid: {
          columns: 10,
          rows: 7,
          tileSizeMm: 34,
          gapMm: 2.5,
        },
      });

      expect(project.tiles).toHaveLength(70);
      expect(project.diagnostics.closedTileCount).toBe(70);
      expect(project.diagnostics.allTilesClosedManifold).toBe(true);
      for (const tile of project.tiles) {
        assertValidTileMesh(tile.mesh);
        expect(tile.diagnostics.degenerateTriangleCount).toBe(0);
        expect(tile.diagnostics.closedManifold).toBe(true);
        expect(tile.diagnostics.outwardWinding).toBe(true);
      }
    },
  );
});

describe("art-direction geometry contracts", () => {
  it("makes sampled-block variation materially reshape one continuous surface", () => {
    const baseline = makeProject(
      { family: "sampled-blocks", shape: "surface-column" },
      "sampled-block-material-variation",
    );
    const low = generateWallArt({
      ...baseline.config,
      design: { ...baseline.config.design, variation: 0 },
      grid: { columns: 8, rows: 6, tileSizeMm: 24, gapMm: 2 },
    });
    const high = generateWallArt({
      ...low.config,
      design: { ...low.config.design, variation: 1 },
    });

    expectPrintableTiles(low);
    expectPrintableTiles(high);
    expect(high.tiles.map((tile) => tile.id)).toEqual(
      low.tiles.map((tile) => tile.id),
    );
    const highById = new Map(high.tiles.map((tile) => [tile.id, tile]));
    const topHeightDeltas = low.tiles.flatMap((tile) => {
      const highTile = highById.get(tile.id)!;
      return [4, 5, 6, 7].map((index) =>
        Math.abs(tile.mesh.vertices[index].z - highTile.mesh.vertices[index].z),
      );
    });
    const meanDelta =
      topHeightDeltas.reduce((sum, delta) => sum + delta, 0) /
      topHeightDeltas.length;
    expect(meanDelta / low.config.tile.reliefHeightMm).toBeGreaterThan(0.1);
    expect(Math.max(...topHeightDeltas) / low.config.tile.reliefHeightMm).toBeGreaterThan(
      0.3,
    );

    // Both endpoints still sample one logical surface: neighboring column
    // corners agree even though the physical installation keeps a gap.
    for (const project of [low, high]) {
      const byCell = new Map(
        project.tiles.map((tile) => [`${tile.row}:${tile.column}`, tile]),
      );
      for (let row = 0; row < project.config.grid.rows; row += 1) {
        for (let column = 0; column < project.config.grid.columns - 1; column += 1) {
          const left = byCell.get(`${row}:${column}`)!;
          const right = byCell.get(`${row}:${column + 1}`)!;
          expect(left.mesh.vertices[5].z).toBeCloseTo(right.mesh.vertices[4].z, 10);
          expect(left.mesh.vertices[6].z).toBeCloseTo(right.mesh.vertices[7].z, 10);
        }
      }
      for (let row = 0; row < project.config.grid.rows - 1; row += 1) {
        for (let column = 0; column < project.config.grid.columns; column += 1) {
          const lower = byCell.get(`${row}:${column}`)!;
          const upper = byCell.get(`${row + 1}:${column}`)!;
          expect(lower.mesh.vertices[7].z).toBeCloseTo(upper.mesh.vertices[4].z, 10);
          expect(lower.mesh.vertices[6].z).toBeCloseTo(upper.mesh.vertices[5].z, 10);
        }
      }
    }
  });

  it("keeps hex petals broad, lower than spires, contained, and non-overlapping", () => {
    const petal = makeProject(
      { family: "hex-canopy", shape: "hex-petal" },
      "hex-profile-contract",
    );
    const spike = generateWallArt({
      ...petal.config,
      tile: { ...petal.config.tile, shape: "hex-spike" },
    });

    expectPrintableTiles(petal);
    expectPrintableTiles(spike);
    expect(spike.tiles.map((tile) => tile.id)).toEqual(
      petal.tiles.map((tile) => tile.id),
    );
    const spikeById = new Map(spike.tiles.map((tile) => [tile.id, tile]));
    for (const tile of petal.tiles) {
      const base = tile.mesh.vertices.slice(0, 6);
      const cap = tile.mesh.vertices.slice(6, 12);
      const baseDiameter = Math.hypot(
        base[0].x - base[3].x,
        base[0].y - base[3].y,
      );
      const capDiameter = Math.hypot(
        cap[0].x - cap[3].x,
        cap[0].y - cap[3].y,
      );
      expect(capDiameter / baseDiameter).toBeCloseTo(0.64, 10);
      expect(cap.every((point) => pointInsideConvexPolygon(point, base))).toBe(true);

      const spikeTile = spikeById.get(tile.id)!;
      expect(tile.heightMm).toBeCloseTo(
        petal.config.tile.baseHeightMm +
          (spikeTile.heightMm - spike.config.tile.baseHeightMm) * 0.56,
        10,
      );
      expect(tile.mesh.vertices.length).toBeGreaterThan(spikeTile.mesh.vertices.length);
    }

    const worldBases = petal.tiles.map((tile) =>
      tile.mesh.vertices.slice(0, 6).map((vertex) => ({
        x: vertex.x + tile.centerXmm,
        y: vertex.y + tile.centerYmm,
      })),
    );
    for (let left = 0; left < worldBases.length; left += 1) {
      for (let right = left + 1; right < worldBases.length; right += 1) {
        expect(convexPolygonsStrictlyOverlap(worldBases[left], worldBases[right])).toBe(
          false,
        );
      }
    }
  });

  it("keeps sculpted hex outlines fixed while each interior relief stays physically distinct", () => {
    const shapes = [
      "hex-folded-fan",
      "hex-pinwheel",
      "hex-curved-sweep",
      "hex-wave-bands",
      "hex-spike",
    ] as const;
    const projects = shapes.map((shape) => {
      const base = makeProject(
        { family: "hex-canopy", shape },
        "sculpted-hex-style-contract",
      );
      return generateWallArt({
        ...base.config,
        design: { ...base.config.design, variation: 0 },
        pattern: { ...base.config.pattern, kind: "flat" },
      });
    });

    for (const project of projects) expectPrintableTiles(project);
    const baseline = projects[0];
    const baselineById = new Map(baseline.tiles.map((tile) => [tile.id, tile]));
    const topSignatures = new Set<string>();
    for (const project of projects) {
      expect(project.tiles.map((tile) => tile.id)).toEqual(
        baseline.tiles.map((tile) => tile.id),
      );
      for (const tile of project.tiles) {
        const reference = baselineById.get(tile.id)!;
        expect([tile.centerXmm, tile.centerYmm]).toEqual([
          reference.centerXmm,
          reference.centerYmm,
        ]);
        expect(meshBounds(tile.mesh).size.x).toBeCloseTo(
          meshBounds(reference.mesh).size.x,
          10,
        );
        expect(meshBounds(tile.mesh).size.y).toBeCloseTo(
          meshBounds(reference.mesh).size.y,
          10,
        );
      }
      topSignatures.add(
        JSON.stringify(
          project.tiles[0].mesh.vertices.map((vertex) => vertex.z),
        ),
      );
    }
    expect(topSignatures.size).toBe(shapes.length);
  });

  it("assigns the mixed sculpted-hex set repeatably while recording each real tile relief", () => {
    const first = makeProject(
      { family: "hex-canopy", shape: "hex-mixed" },
      "mixed-sculpted-hex-contract",
    );
    const repeated = makeProject(
      { family: "hex-canopy", shape: "hex-mixed" },
      "mixed-sculpted-hex-contract",
    );
    const changedSeed = makeProject(
      { family: "hex-canopy", shape: "hex-mixed" },
      "mixed-sculpted-hex-contract-b",
    );
    const allowed = new Set<TileShapeKind>([
      "hex-folded-fan",
      "hex-pinwheel",
      "hex-curved-sweep",
      "hex-wave-bands",
      "hex-spike",
    ]);

    expectPrintableTiles(first);
    expect(first.config.tile.shape).toBe("hex-mixed");
    expect(repeated.tiles).toEqual(first.tiles);
    expect(
      new Set(first.tiles.map((tile) => tile.shape)).size,
    ).toBeGreaterThanOrEqual(3);
    expect(first.tiles.every((tile) => allowed.has(tile.shape))).toBe(true);
    expect(changedSeed.tiles.map((tile) => tile.id)).toEqual(
      first.tiles.map((tile) => tile.id),
    );
    expect(
      changedSeed.tiles.map((tile) => [tile.centerXmm, tile.centerYmm]),
    ).toEqual(first.tiles.map((tile) => [tile.centerXmm, tile.centerYmm]));
    expect(changedSeed.tiles.map((tile) => tile.shape)).not.toEqual(
      first.tiles.map((tile) => tile.shape),
    );
  });

  it.each(["ring-pod", "solid-pod"] as const)(
    "keeps %s coral endpoints inside non-overlapping carrier cells",
    (shape) => {
      const baseline = makeProject(
        { family: "coral-cluster", shape },
        `coral-clearance-${shape}`,
      );
      for (const variation of [0, 0.84, 1]) {
        const project = generateWallArt({
          ...baseline.config,
          design: {
            ...baseline.config.design,
            silhouette: "ellipse",
            variation,
          },
          grid: { columns: 14, rows: 8, tileSizeMm: 27, gapMm: 2 },
          tile: {
            ...baseline.config.tile,
            shape,
            reliefHeightMm: 36,
            leanRatio: 0.12,
          },
        });
        expect(generateWallArt(project.config)).toEqual(project);
        expectPrintableTiles(project);

        const extents = project.tiles.map((tile) => localRadialExtent(tile.mesh));
        for (let index = 0; index < project.tiles.length; index += 1) {
          const tile = project.tiles[index];
          const carrierCenterX =
            tile.column * (project.config.grid.tileSizeMm + project.config.grid.gapMm) +
            project.config.grid.tileSizeMm / 2;
          const carrierCenterY =
            tile.row * (project.config.grid.tileSizeMm + project.config.grid.gapMm) +
            project.config.grid.tileSizeMm / 2;
          const carrierOffset = Math.hypot(
            tile.centerXmm - carrierCenterX,
            tile.centerYmm - carrierCenterY,
          );
          expect(carrierOffset + extents[index]).toBeLessThanOrEqual(
            project.config.grid.tileSizeMm / 2 + EPSILON,
          );
        }
        for (let left = 0; left < project.tiles.length; left += 1) {
          for (let right = left + 1; right < project.tiles.length; right += 1) {
            const centerDistance = Math.hypot(
              project.tiles[left].centerXmm - project.tiles[right].centerXmm,
              project.tiles[left].centerYmm - project.tiles[right].centerYmm,
            );
            expect(centerDistance - extents[left] - extents[right]).toBeGreaterThanOrEqual(
              project.config.grid.gapMm - EPSILON,
            );
          }
        }
      }
    },
  );

  it("gives the coral preset a visible size, height, opening, and topology hierarchy", () => {
    const baseline = makeProject(
      { family: "coral-cluster", shape: "ring-pod" },
      "coral-organic-hierarchy",
    );
    const project = generateWallArt({
      ...baseline.config,
      design: {
        ...baseline.config.design,
        silhouette: "ellipse",
        variation: 0.84,
      },
      grid: { columns: 14, rows: 8, tileSizeMm: 27, gapMm: 2 },
      tile: {
        ...baseline.config.tile,
        shape: "ring-pod",
        reliefHeightMm: 36,
        leanRatio: 0.12,
      },
    });
    const radii = project.tiles.map((tile) => Math.hypot(
      tile.mesh.vertices[0].x,
      tile.mesh.vertices[0].y,
    ));
    const openings = project.tiles.map(
      (tile) =>
        Math.hypot(tile.mesh.vertices[1].x, tile.mesh.vertices[1].y) /
        Math.hypot(tile.mesh.vertices[0].x, tile.mesh.vertices[0].y),
    );
    const centerOffsets = project.tiles.map((tile) => {
      const pitch = project.config.grid.tileSizeMm + project.config.grid.gapMm;
      return Math.hypot(
        tile.centerXmm - (tile.column * pitch + project.config.grid.tileSizeMm / 2),
        tile.centerYmm - (tile.row * pitch + project.config.grid.tileSizeMm / 2),
      );
    });
    expect(Math.max(...radii) / Math.min(...radii)).toBeGreaterThan(1.55);
    expect(
      (Math.max(...project.tiles.map((tile) => tile.heightMm)) -
        Math.min(...project.tiles.map((tile) => tile.heightMm))) /
        project.config.tile.reliefHeightMm,
    ).toBeGreaterThan(0.45);
    expect(Math.max(...openings) - Math.min(...openings)).toBeGreaterThan(0.18);
    expect(Math.max(...centerOffsets) / project.config.grid.tileSizeMm).toBeGreaterThan(
      0.08,
    );
    expect(new Set(project.tiles.map((tile) => tile.mesh.vertices.length)).size).toBeGreaterThan(
      4,
    );
  });

  it.each([
    "archipelago-coherent-a",
    "archipelago-coherent-b",
    "archipelago-coherent-c",
  ])("forms a few two-dimensional archipelago masses for seed %s", (seed) => {
    const baseline = makeProject(
      { family: "silhouette-mosaic", shape: "mixed-block" },
      seed,
    );
    const project = generateWallArt({
      ...baseline.config,
      design: {
        ...baseline.config.design,
        silhouette: "archipelago",
        variation: 0.78,
      },
      grid: { columns: 16, rows: 10, tileSizeMm: 25, gapMm: 3 },
    });
    const components = tileComponents(project);

    expect(generateWallArt(project.config)).toEqual(project);
    expectPrintableTiles(project);
    expect(components.length).toBeGreaterThanOrEqual(2);
    expect(components.length).toBeLessThanOrEqual(4);
    expect(project.tiles.length).toBeGreaterThanOrEqual(25);
    expect(project.tiles.length).toBeLessThanOrEqual(80);
    for (const component of components) {
      expect(component.length).toBeGreaterThanOrEqual(3);
      expect(new Set(component.map((tile) => tile.row)).size).toBeGreaterThanOrEqual(2);
      expect(new Set(component.map((tile) => tile.column)).size).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("cross-family topology", () => {
  it("gives all representative families materially distinct mesh signatures", () => {
    const signatures = FAMILY_CASES.map((familyCase) =>
      topologySignature(makeProject(familyCase)),
    );
    expect(new Set(signatures).size).toBe(FAMILY_CASES.length);
  });

  it.each(FAMILY_CASES)(
    "$family honors a non-rectangular silhouette in generated geometry",
    (familyCase) => {
      const rectangle = makeProject(familyCase, "silhouette-contract");
      const crescent = generateWallArt({
        ...rectangle.config,
        design: { ...rectangle.config.design, silhouette: "crescent" },
      });
      const geometrySignature = (project: WallArtProject) =>
        project.tiles.map((tile) => ({
          id: tile.id,
          centerXmm: tile.centerXmm,
          centerYmm: tile.centerYmm,
          vertices: tile.mesh.vertices,
          triangles: tile.mesh.triangles,
        }));
      expect(geometrySignature(crescent)).not.toEqual(
        geometrySignature(rectangle),
      );
    },
  );
});

describe("contour panel continuity", () => {
  const sampleTopHeight = (
    tile: GeneratedTile,
    worldX: number,
    worldY: number,
  ): number => {
    let maximum = Number.NEGATIVE_INFINITY;
    for (const triangle of tile.mesh.triangles) {
      const [a, b, c] = triangle.map((index) => {
        const vertex = tile.mesh.vertices[index];
        return {
          x: tile.centerXmm + vertex.x,
          y: tile.centerYmm + vertex.y,
          z: vertex.z,
        };
      });
      const denominator =
        (b.y - c.y) * (a.x - c.x) +
        (c.x - b.x) * (a.y - c.y);
      if (Math.abs(denominator) < 1e-12) continue;
      const weightA =
        ((b.y - c.y) * (worldX - c.x) +
          (c.x - b.x) * (worldY - c.y)) /
        denominator;
      const weightB =
        ((c.y - a.y) * (worldX - c.x) +
          (a.x - c.x) * (worldY - c.y)) /
        denominator;
      const weightC = 1 - weightA - weightB;
      if (weightA < -1e-8 || weightB < -1e-8 || weightC < -1e-8)
        continue;
      maximum = Math.max(
        maximum,
        weightA * a.z + weightB * b.z + weightC * c.z,
      );
    }
    expect(maximum).toBeGreaterThan(0);
    return maximum;
  };

  it.each(["relief-panel", "terraced-panel"] as const)(
    "keeps %s surfaces continuous across zero-gap panel boundaries",
    (shape) => {
      const resolution = 7;
      const project = generateWallArt({
        seed: "continuous-contour-field",
        design: {
          family: "contour-relief",
          silhouette: "rectangle",
          variation: 0.5,
          symmetry: 6,
          surfaceResolution: resolution,
        },
        grid: { columns: 3, rows: 2, tileSizeMm: 20, gapMm: 0 },
        tile: { shape },
        pattern: { kind: "wave", frequency: 1.37, angleDeg: 27 },
      });
      const byCell = new Map(
        project.tiles.map((tile) => [`${tile.row}:${tile.column}`, tile]),
      );
      const tileSizeMm = project.config.grid.tileSizeMm;
      const seamSamples = resolution * 4 + 3;

      for (let row = 0; row < 2; row += 1) {
        for (let column = 0; column < 2; column += 1) {
          const left = byCell.get(`${row}:${column}`)!;
          const right = byCell.get(`${row}:${column + 1}`)!;
          const seamX = (left.centerXmm + right.centerXmm) / 2;
          for (let sample = 0; sample < seamSamples; sample += 1) {
            const worldY =
              left.centerYmm -
              tileSizeMm / 2 +
              ((sample + 0.371) / seamSamples) * tileSizeMm;
            expect(sampleTopHeight(left, seamX, worldY)).toBeCloseTo(
              sampleTopHeight(right, seamX, worldY),
              9,
            );
          }
        }
      }

      for (let row = 0; row < 1; row += 1) {
        for (let column = 0; column < 3; column += 1) {
          const lower = byCell.get(`${row}:${column}`)!;
          const upper = byCell.get(`${row + 1}:${column}`)!;
          const seamY = (lower.centerYmm + upper.centerYmm) / 2;
          for (let sample = 0; sample < seamSamples; sample += 1) {
            const worldX =
              lower.centerXmm -
              tileSizeMm / 2 +
              ((sample + 0.371) / seamSamples) * tileSizeMm;
            expect(sampleTopHeight(lower, worldX, seamY)).toBeCloseTo(
              sampleTopHeight(upper, worldX, seamY),
              9,
            );
          }
        }
      }
    },
  );

  it("keeps logical edge heights continuous before applying a physical gap", () => {
    const resolution = 7;
    const gapMm = 3;
    const project = generateWallArt({
      seed: "gapped-contour-field",
      design: {
        family: "contour-relief",
        silhouette: "rectangle",
        variation: 0.5,
        symmetry: 6,
        surfaceResolution: resolution,
      },
      grid: { columns: 2, rows: 1, tileSizeMm: 20, gapMm },
      tile: { shape: "relief-panel" },
      pattern: { kind: "wave", frequency: 1.37, angleDeg: 27 },
    });
    const left = project.tiles.find((tile) => tile.column === 0)!;
    const right = project.tiles.find((tile) => tile.column === 1)!;
    const rowSize = resolution + 1;

    for (let sampleRow = 0; sampleRow <= resolution; sampleRow += 1) {
      const leftVertex = left.mesh.vertices[sampleRow * rowSize + resolution];
      const rightVertex = right.mesh.vertices[sampleRow * rowSize];
      expect(
        rightVertex.x + right.centerXmm - (leftVertex.x + left.centerXmm),
      ).toBeCloseTo(gapMm, 10);
      expect(leftVertex.z).toBeCloseTo(rightVertex.z, 10);
    }
  });

  it("winds every sampled top triangle upward and every bottom fan triangle downward", () => {
    const resolution = 8;
    const mesh = createHeightfieldPanelMesh({
      widthMm: 24,
      depthMm: 18,
      resolution,
      sampleHeight: (x, y) => 3 + 0.04 * x + 0.02 * y + 0.5 * Math.sin(x / 5),
    });
    const topTriangleCount = resolution * resolution * 2;
    const perimeterVertexCount = resolution * 4;

    for (let index = 0; index < topTriangleCount; index += 1) {
      expect(triangleNormal(mesh, mesh.triangles[index]).z).toBeGreaterThan(0);
    }
    for (let index = 0; index < perimeterVertexCount; index += 1) {
      const bottomTriangle = mesh.triangles[topTriangleCount + index * 3];
      expect(triangleNormal(mesh, bottomTriangle).z).toBeLessThan(0);
    }
    assertValidTileMesh(mesh);
  });
});
