import { describe, expect, it } from "vitest";
import {
  buildFullArtMesh,
  createWallArtConfig,
  GEOMETRY_ALGORITHM_VERSION,
  PHOTO_GEOMETRY_ALGORITHM_VERSION,
  PROCEDURAL_GEOMETRY_ALGORITHM_VERSION,
  generateWallArt,
  gridForPartSize,
  meshBounds,
  samplePattern,
  wallArtProjectId,
  type GeneratedTile,
} from "./index";

function generatedTopCenter(tile: GeneratedTile): { x: number; y: number } {
  const maximumZ = Math.max(...tile.mesh.vertices.map((vertex) => vertex.z));
  const top = tile.mesh.vertices.filter(
    (vertex) => Math.abs(vertex.z - maximumZ) < 1e-9,
  );
  return top.reduce(
    (sum, vertex) => ({
      x: sum.x + vertex.x / top.length,
      y: sum.y + vertex.y / top.length,
    }),
    { x: 0, y: 0 },
  );
}

function expectRaisedCapContainedByBase(tile: GeneratedTile): void {
  const minimumZ = Math.min(...tile.mesh.vertices.map((vertex) => vertex.z));
  const maximumZ = Math.max(...tile.mesh.vertices.map((vertex) => vertex.z));
  const baseBoundary = tile.mesh.vertices.slice(0, 3);
  const raisedCap = tile.mesh.vertices.slice(3, 6);

  expect(
    baseBoundary.every((vertex) => Math.abs(vertex.z - minimumZ) < 1e-9),
  ).toBe(true);
  expect(
    raisedCap.every((vertex) => Math.abs(vertex.z - maximumZ) < 1e-9),
  ).toBe(true);
  for (const capVertex of raisedCap) {
    const edgeCrosses = baseBoundary.map((start, index) => {
      const end = baseBoundary[(index + 1) % baseBoundary.length];
      return (
        (end.x - start.x) * (capVertex.y - start.y) -
        (end.y - start.y) * (capVertex.x - start.x)
      );
    });
    expect(
      edgeCrosses.every((cross) => cross <= 1e-8) ||
      edgeCrosses.every((cross) => cross >= -1e-8),
    ).toBe(true);
  }
}

function expectedFinalGuideVector(
  tile: GeneratedTile,
  widthMm: number,
  depthMm: number,
  start: { x: number; y: number },
  end: { x: number; y: number },
): { x: number; y: number } {
  const halfWidth = widthMm / 2;
  const halfDepth = depthMm / 2;
  // This is the viewer's actual final-space mapping, not the family's nominal
  // pre-crop/pre-scale normalized carrier coordinate.
  const point = {
    x: tile.centerXmm / halfWidth - 1,
    y: 1 - tile.centerYmm / halfDepth,
  };
  const dx = (end.x - start.x) * halfWidth;
  const dy = (end.y - start.y) * halfDepth;
  const amount = Math.max(0, Math.min(1,
    (((point.x - start.x) * halfWidth) * dx +
      ((point.y - start.y) * halfDepth) * dy) /
      (dx * dx + dy * dy),
  ));
  const closest = {
    x: start.x + (end.x - start.x) * amount,
    y: start.y + (end.y - start.y) * amount,
  };
  return {
    x: (closest.x - point.x) * halfWidth,
    y: -(closest.y - point.y) * halfDepth,
  };
}

function wrappedAngleDifference(left: number, right: number): number {
  return Math.atan2(Math.sin(left - right), Math.cos(left - right));
}

describe("deterministic wall-art generation", () => {
  it.each([
    "folded-flow",
    "sampled-blocks",
    "triangular-current",
    "polar-bloom",
    "cellular-crystal",
    "hex-canopy",
    "coral-cluster",
    "contour-relief",
    "silhouette-mosaic",
  ] as const)(
    "keeps exact bounds while physical part footprints grow with part size for %s",
    (family) => {
      const base = createWallArtConfig({
        seed: "part-size-direction",
        finishedSize: { widthMm: 360, heightMm: 240, lockAspect: false },
        design: { family, silhouette: "rectangle", variation: 0.35 },
        grid: { columns: 12, rows: 8, tileSizeMm: 28, gapMm: 2 },
      });
      const generateAtPartSize = (partSizeMm: number) =>
        generateWallArt({
          ...base,
          grid: gridForPartSize(base, partSizeMm),
        });
      const small = generateAtPartSize(20);
      const large = generateAtPartSize(40);
      const representativeFootprint = (project: typeof small) => {
        const footprints = project.tiles
          .map((tile) => {
            const bounds = meshBounds(tile.mesh);
            return Math.sqrt(bounds.size.x * bounds.size.y);
          })
          .sort((left, right) => left - right);
        return footprints[Math.floor(footprints.length / 2)];
      };

      expect(small.widthMm).toBe(360);
      expect(small.depthMm).toBe(240);
      expect(large.widthMm).toBe(360);
      expect(large.depthMm).toBe(240);
      expect(large.tiles.length).toBeLessThan(small.tiles.length);
      expect(representativeFootprint(large)).toBeGreaterThan(
        representativeFootprint(small) * 1.35,
      );
    },
  );

  it("merges typed defaults without sharing the palette array", () => {
    const first = createWallArtConfig({ grid: { columns: 3 } });
    const second = createWallArtConfig({ grid: { columns: 3 } });
    expect(first.grid.columns).toBe(3);
    expect(first.grid.rows).toBeGreaterThan(0);
    expect(first.palette.colors).not.toBe(second.palette.colors);
  });

  it.each(["flat", "wave", "ripple", "vortex", "dunes", "noise"] as const)(
    "samples the %s field deterministically inside normalized bounds",
    (kind) => {
      const config = createWallArtConfig({ seed: "repeatable", pattern: { kind } });
      const first = samplePattern(config, 0.37, -0.22);
      const second = samplePattern(config, 0.37, -0.22);
      expect(first).toEqual(second);
      expect(first.value).toBeGreaterThanOrEqual(-1);
      expect(first.value).toBeLessThanOrEqual(1);
      expect(Number.isFinite(first.angleRad)).toBe(true);
    },
  );

  it("keeps the flat field at a neutral scalar and shared direction", () => {
    const config = createWallArtConfig({
      seed: "flat-field-contract",
      pattern: {
        kind: "flat",
        frequency: 3.5,
        amplitude: 7,
        angleDeg: 173,
        phaseDeg: -91,
        centerX: 0.7,
        centerY: -0.6,
      },
    });

    for (const [x, y] of [[-1, -1], [-0.25, 0.75], [0, 0], [1, 1]]) {
      expect(samplePattern(config, x, y)).toEqual({ value: 0, angleRad: 0 });
    }
  });

  it("keeps guide effects available on top of the flat field", () => {
    const config = createWallArtConfig({
      pattern: { kind: "flat" },
      guides: {
        lines: [{
          id: "flat-field-guide",
          closed: false,
          points: [{ x: -0.8, y: 0 }, { x: 0.8, y: 0 }],
        }],
        influenceRadius: 0.5,
        followStrength: 1,
        heightDeltaMm: 4,
      },
    });

    expect(samplePattern(config, -1, -1)).toEqual({ value: 0, angleRad: 0 });
    const guided = samplePattern(config, 0, 0.1);
    expect(guided.value).toBe(0);
    expect(guided.guideHeightDeltaMm).toBeGreaterThan(0);
    expect(Math.abs(guided.angleRad)).toBeGreaterThan(0.1);
  });

  it("generates a uniform field-driven result and distinct identity for flat", () => {
    const common = {
      seed: "flat-generated-contract",
      design: { variation: 0 },
      grid: { columns: 4, rows: 3 },
    };
    const flat = generateWallArt({
      ...common,
      pattern: { kind: "flat" as const },
    });
    const wave = generateWallArt({
      ...common,
      pattern: { kind: "wave" as const },
    });

    expect(new Set(flat.tiles.map((tile) => tile.patternValue))).toEqual(new Set([0]));
    expect(new Set(flat.tiles.map((tile) => tile.orientationRad))).toEqual(new Set([0]));
    expect(new Set(flat.tiles.map((tile) => tile.heightMm))).toEqual(
      new Set([flat.tiles[0].heightMm]),
    );
    expect(flat.id).not.toBe(wave.id);
  });

  it("produces byte-for-byte-equivalent project data for the same seed", () => {
    const overrides = {
      seed: "same-seed",
      grid: { columns: 4, rows: 3, tileSizeMm: 20, gapMm: 2 },
      pattern: { kind: "dunes" as const },
      palette: { mode: "seeded-random" as const },
    };
    const first = generateWallArt(overrides);
    const second = generateWallArt(overrides);
    expect(second).toEqual(first);
    expect(first.tiles).toHaveLength(12);
    expect(first.tiles[0].id).toBe("tile-r0001-c0001");
    expect(first.tiles[11].id).toBe("tile-r0003-c0004");
    expect(first.widthMm).toBe(86);
    expect(first.depthMm).toBe(64);
  });

  it("changes seeded geometry fields without changing stable grid IDs", () => {
    const common = {
      grid: { columns: 5, rows: 4 },
      pattern: { kind: "vortex" as const },
    };
    const first = generateWallArt({ ...common, seed: "alpha" });
    const second = generateWallArt({ ...common, seed: "beta" });
    expect(second.id).not.toBe(first.id);
    expect(second.tiles.map((tile) => tile.id)).toEqual(first.tiles.map((tile) => tile.id));
    expect(second.tiles.map((tile) => tile.patternValue)).not.toEqual(
      first.tiles.map((tile) => tile.patternValue),
    );
  });

  it("versions project identity independently from the saved recipe schema", () => {
    const config = createWallArtConfig({ seed: "algorithm-version-identity" });
    const currentId = wallArtProjectId(config);

    expect(PROCEDURAL_GEOMETRY_ALGORITHM_VERSION).toBe(6);
    expect(PHOTO_GEOMETRY_ALGORITHM_VERSION).toBe(7);
    expect(GEOMETRY_ALGORITHM_VERSION).toBe(PHOTO_GEOMETRY_ALGORITHM_VERSION);
    expect(currentId).toMatch(
      new RegExp(`^wall-art-g${PROCEDURAL_GEOMETRY_ALGORITHM_VERSION}-[0-9a-f]{8}$`),
    );
    expect(wallArtProjectId(config, GEOMETRY_ALGORITHM_VERSION + 1)).not.toBe(currentId);
    expect(() => wallArtProjectId(config, 0)).toThrow(/positive integer/i);
  });

  it("includes every depth-profile control in procedural and photo identities", () => {
    const base = createWallArtConfig({ seed: "depth-profile-identity" });
    const changed = [
      createWallArtConfig({ ...base, depthProfile: { ...base.depthProfile, invert: true } }),
      createWallArtConfig({ ...base, depthProfile: { ...base.depthProfile, contrast: 1.5 } }),
      createWallArtConfig({ ...base, depthProfile: { ...base.depthProfile, curve: -0.5 } }),
      createWallArtConfig({ ...base, depthProfile: { ...base.depthProfile, levels: 6 } }),
    ];
    expect(new Set([base, ...changed].map((config) => wallArtProjectId(config))).size)
      .toBe(5);

    const photo = createWallArtConfig({
      ...base,
      source: {
        kind: "photo",
        photo: {
          assetSha256: "a".repeat(64),
          canonicalWidth: 8,
          canonicalHeight: 8,
          toneMode: "light-raised",
          toneContrast: 0.5,
          geometryStrength: 1,
          directionMode: "gradient",
          directionStrength: 0.7,
          colorMode: "auto-palette",
          colorStrength: 1,
          requestedColorCount: 5,
        },
      },
    });
    expect(wallArtProjectId(photo)).toMatch(
      new RegExp(`^wall-art-g${PHOTO_GEOMETRY_ALGORITHM_VERSION}-[0-9a-f]{8}$`),
    );
    expect(wallArtProjectId(photo)).not.toBe(
      wallArtProjectId(createWallArtConfig({
        ...photo,
        depthProfile: { ...photo.depthProfile, levels: 4 },
      })),
    );
  });

  it("gives each sculpted hex relief its own deterministic project identity", () => {
    const shapes = [
      "hex-folded-fan",
      "hex-pinwheel",
      "hex-curved-sweep",
      "hex-wave-bands",
      "hex-mixed",
    ] as const;
    const projects = shapes.map((shape) =>
      generateWallArt({
        seed: "sculpted-hex-identity",
        design: { family: "hex-canopy", silhouette: "rectangle" },
        grid: { columns: 3, rows: 2, tileSizeMm: 40, gapMm: 2 },
        tile: { shape, reliefHeightMm: 18 },
        pattern: { kind: "flat" },
      }),
    );

    expect(new Set(projects.map((project) => project.id))).toHaveLength(
      shapes.length,
    );
    expect(
      projects.map((project) => project.tiles.map((tile) => tile.id)),
    ).toEqual(projects.map(() => projects[0].tiles.map((tile) => tile.id)));
  });

  it("keeps every generated tile closed and the combined mesh within finite bounds", () => {
    const project = generateWallArt({
      grid: { columns: 3, rows: 2, tileSizeMm: 18, gapMm: 1.5 },
      tile: { shape: "leaning-pyramid" },
    });
    expect(project.diagnostics.allTilesClosedManifold).toBe(true);
    expect(project.diagnostics.closedTileCount).toBe(6);
    const bounds = meshBounds(buildFullArtMesh(project));
    expect(bounds.min.x).toBeGreaterThanOrEqual(-1e-8);
    expect(bounds.min.y).toBeGreaterThanOrEqual(-1e-8);
    expect(bounds.max.x).toBeLessThanOrEqual(project.widthMm + 1e-8);
    expect(bounds.max.y).toBeLessThanOrEqual(project.depthMm + 1e-8);
    expect(bounds.min.z).toBe(0);
  });

  it.each([
    "folded-flow",
    "triangular-current",
    "hex-canopy",
    "coral-cluster",
    "contour-relief",
  ] as const)("applies exact independent finished bounds to %s without scaling Z", (family) => {
    const common = {
      seed: "exact-finished-size",
      design: { family },
      grid: { columns: 4, rows: 3, tileSizeMm: 24, gapMm: 2 },
    };
    const natural = generateWallArt(common);
    const naturalMaxZ = meshBounds(buildFullArtMesh(natural)).max.z;
    const resized = generateWallArt({
      ...common,
      finishedSize: { widthMm: 713.25, heightMm: 286.75, lockAspect: false },
    });
    const bounds = meshBounds(buildFullArtMesh(resized));

    expect(resized.widthMm).toBe(713.25);
    expect(resized.depthMm).toBe(286.75);
    expect(bounds.min.x).toBeCloseTo(0, 8);
    expect(bounds.min.y).toBeCloseTo(0, 8);
    expect(bounds.size.x).toBeCloseTo(713.25, 8);
    expect(bounds.size.y).toBeCloseTo(286.75, 8);
    expect(bounds.max.z).toBeCloseTo(naturalMaxZ, 8);
    expect(resized.diagnostics.allTilesClosedManifold).toBe(true);
  });

  it("round-trips exact size and aspect-lock settings through saved config JSON", () => {
    const first = createWallArtConfig({
      finishedSize: { widthMm: 1500.5, heightMm: 800.25, lockAspect: false },
    });
    const restored = createWallArtConfig(JSON.parse(JSON.stringify(first)));

    expect(restored.finishedSize).toEqual({
      widthMm: 1500.5,
      heightMm: 800.25,
      lockAspect: false,
    });
  });

  it("applies saved guide strokes to generated orientation and physical relief", () => {
    const common = {
      seed: "guide-generation-integration",
      grid: { columns: 5, rows: 5, tileSizeMm: 24, gapMm: 2 },
      tile: { shape: "folded-ridge" as const, reliefHeightMm: 24 },
      pattern: { kind: "wave" as const, frequency: 0.2, amplitude: 0.35, angleDeg: 0 },
    };
    const natural = generateWallArt(common);
    const guided = generateWallArt({
      ...common,
      guides: {
        lines: [{
          id: "guide-01",
          closed: false,
          points: [{ x: 0, y: -1 }, { x: 0, y: 1 }],
        }],
        influenceRadius: 0.4,
        followStrength: 1,
        heightDeltaMm: 6,
      },
    });
    const naturalCenter = natural.tiles.find((tile) => tile.row === 2 && tile.column === 2)!;
    const guidedCenter = guided.tiles.find((tile) => tile.row === 2 && tile.column === 2)!;

    expect(guided.id).not.toBe(natural.id);
    expect(Math.abs(guidedCenter.orientationRad - naturalCenter.orientationRad)).toBeGreaterThan(0.5);
    expect(guidedCenter.heightMm - naturalCenter.heightMm).toBeCloseTo(6, 6);
    expect(guided.diagnostics.allTilesClosedManifold).toBe(true);

    const restored = createWallArtConfig(JSON.parse(JSON.stringify(guided.config)));
    expect(restored.guides.lines).toEqual(guided.config.guides.lines);
  });

  it("changes identity for one edited guide handle without touching the other guide", () => {
    const left = {
      id: "editable-left",
      name: "Editable left",
      closed: false,
      points: [
        { x: -0.8, y: -0.6 },
        { x: -0.55, y: 0 },
        { x: -0.8, y: 0.6 },
      ],
      controlPoints: [
        { x: -0.8, y: -0.6 },
        { x: -0.55, y: 0 },
        { x: -0.8, y: 0.6 },
      ],
      interpolation: "smooth" as const,
      templateKind: "arc" as const,
      effects: {
        influenceRadius: 0.3,
        centerPull: 0.2,
        followStrength: 0.75,
        heightDeltaMm: 4,
        directionMode: "toward" as const,
      },
    };
    const right = {
      id: "untouched-right",
      name: "Untouched right",
      closed: false,
      points: [{ x: 0.65, y: -0.7 }, { x: 0.65, y: 0.7 }],
      controlPoints: [{ x: 0.65, y: -0.7 }, { x: 0.65, y: 0.7 }],
      interpolation: "linear" as const,
      templateKind: "line" as const,
      effects: {
        influenceRadius: 0.2,
        centerPull: 0.6,
        followStrength: 0.35,
        heightDeltaMm: -3,
        directionMode: "toward-forward" as const,
      },
    };
    const common = {
      seed: "guide-handle-project-identity",
      grid: { columns: 3, rows: 3, tileSizeMm: 22, gapMm: 2 },
    };
    const before = generateWallArt({
      ...common,
      guides: { lines: [left, right] },
    });
    const movedPoint = { x: -0.35, y: 0.12 };
    const after = generateWallArt({
      ...common,
      guides: {
        lines: [{
          ...left,
          controlPoints: [left.controlPoints[0], movedPoint, left.controlPoints[2]],
        }, right],
      },
    });

    expect(after.id).not.toBe(before.id);
    expect(after.config.guides.lines[1]).toEqual(before.config.guides.lines[1]);
    expect(after.config.guides.lines[0].controlPoints).not.toEqual(
      before.config.guides.lines[0].controlPoints,
    );
    expect(after.config.guides.lines[0].points).toEqual(
      before.config.guides.lines[0].points,
    );
    expect(before.id).toBe(wallArtProjectId(before.config));
    expect(after.id).toBe(wallArtProjectId(after.config));
    expect(before.id).toMatch(
      new RegExp(`^wall-art-g${PROCEDURAL_GEOMETRY_ALGORITHM_VERSION}-[0-9a-f]{8}$`),
    );
    expect(after.id).toMatch(
      new RegExp(`^wall-art-g${PROCEDURAL_GEOMETRY_ALGORITHM_VERSION}-[0-9a-f]{8}$`),
    );
  });

  it("uses toward-forward order for orientation without changing symmetric relief", () => {
    const forwardPoints = [{ x: -0.8, y: 0 }, { x: 0.8, y: 0 }];
    const generateWithPoints = (points: typeof forwardPoints) =>
      generateWallArt({
        seed: "guide-directional-reversal",
        design: { family: "folded-flow", variation: 0 },
        grid: { columns: 5, rows: 5, tileSizeMm: 24, gapMm: 2 },
        tile: { shape: "leaning-pyramid", reliefHeightMm: 20, leanRatio: 0.2 },
        pattern: { kind: "wave", frequency: 0.2, amplitude: 0.2, angleDeg: 0 },
        guides: {
          lines: [{
            id: "ordered-horizontal",
            closed: false,
            points,
            effects: {
              influenceRadius: 0.8,
              centerPull: 0,
              followStrength: 1,
              heightDeltaMm: 4,
              directionMode: "toward-forward",
            },
          }],
          followStrength: 0,
          heightDeltaMm: 0,
        },
      });
    const forward = generateWithPoints(forwardPoints);
    const reverse = generateWithPoints([...forwardPoints].reverse());
    const centerForward = forward.tiles.find(
      (tile) => tile.row === 2 && tile.column === 2,
    )!;
    const centerReverse = reverse.tiles.find(
      (tile) => tile.id === centerForward.id,
    )!;

    expect(
      Math.abs(
        wrappedAngleDifference(
          centerForward.orientationRad,
          centerReverse.orientationRad,
        ),
      ),
    ).toBeGreaterThan(3);
    expect(generatedTopCenter(centerForward).x).toBeGreaterThan(0);
    expect(generatedTopCenter(centerReverse).x).toBeLessThan(0);
    expect(centerReverse.patternValue).toBe(centerForward.patternValue);
    expect(centerReverse.heightMm).toBe(centerForward.heightMm);
    expect(reverse.tiles.map((tile) => tile.heightMm)).toEqual(
      forward.tiles.map((tile) => tile.heightMm),
    );
  });

  it("leans triangle-sail tops toward a drawn guide from both sides", () => {
    const guided = generateWallArt({
      seed: "guide-triangle-attraction",
      design: { family: "triangular-current", variation: 0 },
      grid: { columns: 4, rows: 4, tileSizeMm: 30, gapMm: 1 },
      tile: { shape: "triangle-sail", leanRatio: 0.18, reliefHeightMm: 18 },
      pattern: { kind: "wave", frequency: 0.2, amplitude: 0.2, angleDeg: 0 },
      guides: {
        lines: [{
          id: "horizontal-attractor",
          closed: false,
          points: [{ x: -1, y: 0 }, { x: 1, y: 0 }],
        }],
        influenceRadius: 0.8,
        centerPull: 0,
        followStrength: 1,
        heightDeltaMm: 0,
      },
    });
    const adjacent = guided.tiles.filter(
      (tile) => Math.abs(tile.normalizedY) > 0.12 && Math.abs(tile.normalizedY) < 0.38,
    );

    expect(adjacent.length).toBeGreaterThanOrEqual(4);
    for (const tile of adjacent) {
      const maximumZ = Math.max(...tile.mesh.vertices.map((vertex) => vertex.z));
      const top = tile.mesh.vertices.filter((vertex) => Math.abs(vertex.z - maximumZ) < 1e-9);
      const topCenter = top.reduce(
        (sum, vertex) => ({ x: sum.x + vertex.x / top.length, y: sum.y + vertex.y / top.length }),
        { x: 0, y: 0 },
      );
      const leanLength = Math.hypot(topCenter.x, topCenter.y);
      const expectedTowardY = -Math.sign(tile.normalizedY);
      const alignment = topCenter.y / leanLength * expectedTowardY;

      // This is the family's normal (non-amplified) directional lean. Changing
      // the guide angle alone rotates the real top cap/apex toward the stroke.
      expect(leanLength).toBeCloseTo(30 * 0.18 * 0.52, 8);
      expect(alignment).toBeGreaterThan(0.98);
      expect(tile.diagnostics.closedManifold).toBe(true);
    }
    expect(guided.diagnostics.allTilesClosedManifold).toBe(true);
  });

  it("fully aligns far-inside-radius triangle-sail tops at 100 percent attraction", () => {
    const guided = generateWallArt({
      seed: "guide-triangle-full-attraction",
      design: { family: "triangular-current", variation: 0 },
      grid: { columns: 4, rows: 4, tileSizeMm: 30, gapMm: 1 },
      tile: { shape: "triangle-sail", leanRatio: 0.18, reliefHeightMm: 18 },
      pattern: { kind: "wave", frequency: 0.2, amplitude: 0.2, angleDeg: 0 },
      guides: {
        lines: [{
          id: "horizontal-attractor",
          closed: false,
          points: [{ x: -1, y: 0 }, { x: 1, y: 0 }],
        }],
        influenceRadius: 0.8,
        centerPull: 0,
        followStrength: 1,
        heightDeltaMm: 0,
      },
    });
    const farInside = guided.tiles.filter(
      (tile) => Math.abs(Math.abs(tile.normalizedY) - 2 / 3) < 1e-8,
    );

    expect(farInside.length).toBeGreaterThanOrEqual(4);
    for (const tile of farInside) {
      const maximumZ = Math.max(...tile.mesh.vertices.map((vertex) => vertex.z));
      const top = tile.mesh.vertices.filter((vertex) => Math.abs(vertex.z - maximumZ) < 1e-9);
      const topCenter = top.reduce(
        (sum, vertex) => ({ x: sum.x + vertex.x / top.length, y: sum.y + vertex.y / top.length }),
        { x: 0, y: 0 },
      );
      const leanLength = Math.hypot(topCenter.x, topCenter.y);
      const expectedTowardY = -Math.sign(tile.normalizedY);

      // These rows sit near the outer portion of the influence band. Exact
      // axis alignment proves the real apex/top cap is fully attracted; the
      // unchanged lean length proves no unrelated physical deformation occurs.
      expect(topCenter.x / leanLength).toBeCloseTo(0, 10);
      expect(topCenter.y / leanLength * expectedTowardY).toBeCloseTo(1, 10);
      expect(leanLength).toBeCloseTo(30 * 0.18 * 0.52, 8);
      expect(tile.diagnostics.closedManifold).toBe(true);
    }
    expect(guided.diagnostics.allTilesClosedManifold).toBe(true);
  });

  it("pulls triangle tops into a centered composition without moving their bases", () => {
    const common = {
      seed: "guide-triangle-centered-composition",
      design: { family: "triangular-current" as const, variation: 0 },
      grid: { columns: 4, rows: 4, tileSizeMm: 30, gapMm: 1 },
      tile: { shape: "triangle-sail" as const, leanRatio: 0.18, reliefHeightMm: 18 },
      pattern: { kind: "wave" as const, frequency: 0.2, amplitude: 0.2, angleDeg: 0 },
      guides: {
        lines: [{
          id: "horizontal-attractor",
          closed: false,
          points: [{ x: -1, y: 0 }, { x: 1, y: 0 }],
        }],
        influenceRadius: 0.8,
        followStrength: 1,
        heightDeltaMm: 0,
      },
    };
    const unpulled = generateWallArt({
      ...common,
      guides: { ...common.guides, centerPull: 0 },
    });
    const pulled = generateWallArt({
      ...common,
      guides: { ...common.guides, centerPull: 1 },
    });
    const repeated = generateWallArt({
      ...common,
      guides: { ...common.guides, centerPull: 1 },
    });
    const topCenter = (tile: (typeof pulled.tiles)[number]) => {
      const maximumZ = Math.max(...tile.mesh.vertices.map((vertex) => vertex.z));
      const top = tile.mesh.vertices.filter(
        (vertex) => Math.abs(vertex.z - maximumZ) < 1e-9,
      );
      return top.reduce(
        (sum, vertex) => ({
          x: sum.x + vertex.x / top.length,
          y: sum.y + vertex.y / top.length,
        }),
        { x: 0, y: 0 },
      );
    };
    const unpulledById = new Map(unpulled.tiles.map((tile) => [tile.id, tile]));
    const pullDeltas: Array<{ normalizedY: number; deltaMm: number }> = [];
    const guideYmm = pulled.depthMm / 2;

    expect(pulled).toEqual(repeated);
    expect(pulled.tiles).toHaveLength(unpulled.tiles.length);
    for (const tile of pulled.tiles) {
      const original = unpulledById.get(tile.id)!;
      const originalTop = topCenter(original);
      const pulledTop = topCenter(tile);
      const originalLength = Math.hypot(originalTop.x, originalTop.y);
      const pulledLength = Math.hypot(pulledTop.x, pulledTop.y);
      const expectedTowardY = -Math.sign(tile.normalizedY);
      const baseVertices = original.mesh.vertices.filter((vertex) => vertex.z === 0);
      const pulledBaseVertices = tile.mesh.vertices.filter((vertex) => vertex.z === 0);

      // Base tessellation, part centre and packing footprint remain unchanged.
      expect(pulledBaseVertices).toEqual(baseVertices);
      expect(tile.centerXmm).toBe(original.centerXmm);
      expect(tile.centerYmm).toBe(original.centerYmm);
      expect(meshBounds(tile.mesh).size.x).toBeCloseTo(meshBounds(original.mesh).size.x, 10);
      expect(meshBounds(tile.mesh).size.y).toBeCloseTo(meshBounds(original.mesh).size.y, 10);

      expectRaisedCapContainedByBase(tile);

      if (Math.abs(tile.normalizedY) < 0.8 && Math.abs(tile.normalizedY) > 0.1) {
        expect(pulledTop.x / pulledLength).toBeCloseTo(0, 10);
        expect(pulledTop.y / pulledLength * expectedTowardY).toBeCloseTo(1, 10);
        // Opposing top centres stop on their own side of the guide.
        const globalTipY = tile.centerYmm + pulledTop.y;
        expect((globalTipY - guideYmm) * Math.sign(tile.normalizedY)).toBeGreaterThan(0);
        pullDeltas.push({
          normalizedY: Math.abs(tile.normalizedY),
          deltaMm: pulledLength - originalLength,
        });
      }
      expect(tile.diagnostics.closedManifold).toBe(true);
    }

    const averageDelta = (targetY: number) => {
      const row = pullDeltas.filter(
        (sample) => Math.abs(sample.normalizedY - targetY) < 1e-8,
      );
      return row.reduce((sum, sample) => sum + sample.deltaMm, 0) / row.length;
    };
    const nearDelta = averageDelta(1 / 6);
    const farDelta = averageDelta(2 / 3);
    expect(nearDelta).toBeGreaterThan(farDelta);
    expect(farDelta).toBeGreaterThan(0);
    expect(pulled.diagnostics.allTilesClosedManifold).toBe(true);
  });

  it("keeps directional triangle caps contained and manifold at full center pull", () => {
    const guided = generateWallArt({
      seed: "guide-directional-triangle-containment",
      design: { family: "triangular-current", variation: 0 },
      grid: { columns: 4, rows: 4, tileSizeMm: 30, gapMm: 1 },
      tile: { shape: "triangle-sail", leanRatio: 0.18, reliefHeightMm: 18 },
      pattern: { kind: "wave", frequency: 0.2, amplitude: 0.2, angleDeg: 0 },
      guides: {
        lines: [{
          id: "directional-horizontal",
          closed: false,
          points: [{ x: -1, y: 0 }, { x: 1, y: 0 }],
          effects: {
            influenceRadius: 0.8,
            centerPull: 1,
            followStrength: 1,
            heightDeltaMm: 0,
            directionMode: "toward-forward",
          },
        }],
      },
    });

    expect(guided.tiles.length).toBeGreaterThan(0);
    for (const tile of guided.tiles) {
      expectRaisedCapContainedByBase(tile);
      expect(tile.diagnostics.closedManifold).toBe(true);
    }
    expect(guided.diagnostics.allTilesClosedManifold).toBe(true);
  });

  it("keeps the complete raised cap before a very-near guide at full center pull", () => {
    const guideDrawY = 0.13;
    const common = {
      seed: "guide-triangle-near-line-safety",
      design: { family: "triangular-current" as const, variation: 0 },
      grid: { columns: 4, rows: 4, tileSizeMm: 30, gapMm: 1 },
      tile: { shape: "triangle-sail" as const, leanRatio: 0.18, reliefHeightMm: 18 },
      pattern: { kind: "wave" as const, frequency: 0.2, amplitude: 0.2, angleDeg: 0 },
      guides: {
        lines: [{
          id: "near-horizontal-attractor",
          closed: false,
          points: [{ x: -1, y: guideDrawY }, { x: 1, y: guideDrawY }],
        }],
        influenceRadius: 0.8,
        followStrength: 1,
        heightDeltaMm: 0,
      },
    };
    const legacy = generateWallArt({
      ...common,
      guides: { ...common.guides, centerPull: 0 },
    });
    const safe = generateWallArt({
      ...common,
      guides: { ...common.guides, centerPull: 1 },
    });
    const legacyTile = legacy.tiles.find(
      (tile) => Math.abs(tile.normalizedY + 1 / 6) < 1e-8,
    )!;
    const safeTile = safe.tiles.find((tile) => tile.id === legacyTile.id)!;
    const guideYmm = ((-guideDrawY + 1) / 2) * safe.depthMm;
    const legacyTop = legacyTile.mesh.vertices.filter(
      (vertex) => Math.abs(vertex.z - legacyTile.heightMm) < 1e-9,
    );
    const safeTop = safeTile.mesh.vertices.filter(
      (vertex) => Math.abs(vertex.z - safeTile.heightMm) < 1e-9,
    );

    // The fixture proves the edge case: the unpulled lean crosses the stroke.
    expect(
      legacyTop.some((vertex) => legacyTile.centerYmm + vertex.y > guideYmm),
    ).toBe(true);
    // Full center pull shortens the total offset so every cap vertex stays on
    // the tile's original side of the line, with the base untouched.
    expect(
      safeTop.every((vertex) => safeTile.centerYmm + vertex.y <= guideYmm + 1e-8),
    ).toBe(true);
    expect(safeTile.mesh.vertices.filter((vertex) => vertex.z === 0)).toEqual(
      legacyTile.mesh.vertices.filter((vertex) => vertex.z === 0),
    );
    expect(meshBounds(safeTile.mesh).size.x).toBeCloseTo(
      meshBounds(legacyTile.mesh).size.x,
      10,
    );
    expect(meshBounds(safeTile.mesh).size.y).toBeCloseTo(
      meshBounds(legacyTile.mesh).size.y,
      10,
    );
    expect(safeTile.diagnostics.closedManifold).toBe(true);
  });

  it("keeps disabled final-space triangle guide effects as an exact mesh no-op", () => {
    const common = {
      seed: "guide-final-space-disabled",
      finishedSize: { widthMm: 600, heightMm: 180, lockAspect: false },
      design: {
        family: "triangular-current" as const,
        silhouette: "crescent" as const,
        variation: 0,
      },
      grid: { columns: 9, rows: 7, tileSizeMm: 34, gapMm: 2.2 },
      tile: { shape: "triangle-sail" as const, leanRatio: 0.18, reliefHeightMm: 18 },
      pattern: { kind: "wave" as const, frequency: 0.8, angleDeg: 31 },
    };
    const unGuided = generateWallArt(common);
    const disabled = generateWallArt({
      ...common,
      guides: {
        lines: [{
          id: "disabled-diagonal",
          closed: false,
          points: [{ x: -0.9, y: -0.7 }, { x: 0.9, y: 0.7 }],
        }],
        influenceRadius: 2,
        centerPull: 0,
        followStrength: 0,
        heightDeltaMm: 0,
      },
    });

    expect(disabled.tiles.map((tile) => tile.id)).toEqual(
      unGuided.tiles.map((tile) => tile.id),
    );
    expect(disabled.tiles.map((tile) => tile.mesh)).toEqual(
      unGuided.tiles.map((tile) => tile.mesh),
    );
    expect(disabled.tiles.map((tile) => tile.orientationRad)).toEqual(
      unGuided.tiles.map((tile) => tile.orientationRad),
    );
  });

  it("starts center pull from the actual post-scale un-guided vector", () => {
    const guide = {
      id: "partial-pull-diagonal",
      closed: false,
      points: [{ x: -0.9, y: -0.7 }, { x: 0.9, y: 0.7 }],
    };
    const common = {
      seed: "guide-final-space-base-vector",
      finishedSize: { widthMm: 650, heightMm: 170, lockAspect: false },
      design: {
        family: "triangular-current" as const,
        silhouette: "crescent" as const,
        variation: 0,
      },
      grid: { columns: 9, rows: 7, tileSizeMm: 34, gapMm: 2.2 },
      tile: { shape: "triangle-sail" as const, leanRatio: 0.18, reliefHeightMm: 18 },
      pattern: { kind: "wave" as const, frequency: 0.8, angleDeg: 31 },
    };
    const unGuided = generateWallArt(common);
    const pulled = generateWallArt({
      ...common,
      guides: {
        lines: [guide],
        influenceRadius: 2,
        centerPull: 0.02,
        followStrength: 0,
        heightDeltaMm: 0,
      },
    });
    const candidate = unGuided.tiles
      .map((tile) => {
        const nominal = samplePattern(
          unGuided.config,
          tile.normalizedX,
          tile.normalizedY,
        ).angleRad;
        return {
          tile,
          nominal,
          mismatch: Math.abs(wrappedAngleDifference(tile.orientationRad, nominal)),
        };
      })
      .sort((left, right) => right.mismatch - left.mismatch)[0];
    const pulledTile = pulled.tiles.find((tile) => tile.id === candidate.tile.id)!;
    const fromActual = Math.abs(
      wrappedAngleDifference(pulledTile.orientationRad, candidate.tile.orientationRad),
    );
    const fromNominal = Math.abs(
      wrappedAngleDifference(pulledTile.orientationRad, candidate.nominal),
    );

    expect(candidate.mismatch).toBeGreaterThan(0.05);
    expect(fromActual).toBeLessThan(fromNominal);
    expect(pulledTile.diagnostics.closedManifold).toBe(true);
  });

  it("uses tangent orientation but zero spatial pull for a cap centered on the guide", () => {
    const common = {
      seed: "guide-centerline-no-pull",
      finishedSize: { widthMm: 420, heightMm: 220, lockAspect: false },
      design: { family: "triangular-current" as const, variation: 0 },
      grid: { columns: 4, rows: 4, tileSizeMm: 30, gapMm: 1 },
      tile: { shape: "triangle-sail" as const, leanRatio: 0.18, reliefHeightMm: 18 },
      pattern: { kind: "wave" as const, frequency: 0.2, angleDeg: 0 },
    };
    const unGuided = generateWallArt(common);
    const reference = unGuided.tiles[Math.floor(unGuided.tiles.length / 2)];
    const guideY = 1 - reference.centerYmm / (unGuided.depthMm / 2);
    const guided = generateWallArt({
      ...common,
      guides: {
        lines: [{
          id: "through-cap-center",
          closed: false,
          points: [{ x: -1, y: guideY }, { x: 1, y: guideY }],
        }],
        influenceRadius: 2,
        centerPull: 1,
        followStrength: 1,
        heightDeltaMm: 0,
      },
    });
    const result = guided.tiles.find((tile) => tile.id === reference.id)!;
    const originalTop = generatedTopCenter(reference);
    const resultTop = generatedTopCenter(result);

    expect(Math.hypot(resultTop.x, resultTop.y)).toBeCloseTo(
      Math.hypot(originalTop.x, originalTop.y),
      8,
    );
    expect(Math.abs(Math.sin(result.orientationRad))).toBeLessThan(1e-10);
    expect(Math.hypot(resultTop.x, resultTop.y)).toBeGreaterThan(0);
    expect(result.diagnostics.closedManifold).toBe(true);
  });

  it("keeps full attraction exact after non-uniform finished-size scaling", () => {
    const guide = {
      id: "diagonal-attractor",
      closed: false,
      points: [{ x: -0.9, y: -0.7 }, { x: 0.9, y: 0.7 }],
    };
    const guided = generateWallArt({
      seed: "guide-finished-scale-direction",
      finishedSize: { widthMm: 600, heightMm: 180, lockAspect: false },
      design: { family: "triangular-current", variation: 0 },
      grid: { columns: 5, rows: 5, tileSizeMm: 30, gapMm: 1 },
      tile: { shape: "triangle-sail", leanRatio: 0.18, reliefHeightMm: 18 },
      guides: {
        lines: [guide],
        influenceRadius: 2,
        centerPull: 1,
        followStrength: 1,
        heightDeltaMm: 0,
      },
    });
    let checked = 0;

    for (const tile of guided.tiles) {
      const expected = expectedFinalGuideVector(
        tile,
        guided.widthMm,
        guided.depthMm,
        guide.points[0],
        guide.points[1],
      );
      const expectedLength = Math.hypot(expected.x, expected.y);
      if (expectedLength <= 1e-6) continue;

      const topCenter = generatedTopCenter(tile);
      const topLength = Math.hypot(topCenter.x, topCenter.y);
      const alignment =
        (topCenter.x * expected.x + topCenter.y * expected.y) /
        (topLength * expectedLength);
      const meshAngle = Math.atan2(topCenter.y, topCenter.x);

      expect(alignment).toBeGreaterThan(0.999999999);
      expect(Math.abs(wrappedAngleDifference(tile.orientationRad, meshAngle))).toBeLessThan(1e-10);
      expect(tile.diagnostics.closedManifold).toBe(true);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(10);
    expect(guided.diagnostics.allTilesClosedManifold).toBe(true);
  });

  it("uses actual final centres for cropped silhouettes and keeps orientation metadata in mesh parity", () => {
    const guide = {
      id: "cropped-diagonal-attractor",
      closed: false,
      points: [{ x: -0.82, y: -0.63 }, { x: 0.77, y: 0.71 }],
    };
    const guided = generateWallArt({
      seed: "guide-cropped-final-centres",
      finishedSize: { widthMm: 620, heightMm: 190, lockAspect: false },
      design: {
        family: "triangular-current",
        silhouette: "crescent",
        variation: 0,
      },
      grid: { columns: 9, rows: 7, tileSizeMm: 34, gapMm: 2.2 },
      tile: { shape: "triangle-sail", leanRatio: 0.18, reliefHeightMm: 18 },
      guides: {
        lines: [guide],
        influenceRadius: 2,
        centerPull: 0.85,
        followStrength: 1,
        heightDeltaMm: 0,
      },
    });
    let checked = 0;
    let actualCenterShiftObserved = false;
    let maximumNominalTargetError = 0;

    for (const tile of guided.tiles) {
      const actualNormalizedX = tile.centerXmm / (guided.widthMm / 2) - 1;
      const actualNormalizedY = tile.centerYmm / (guided.depthMm / 2) - 1;
      if (
        Math.abs(actualNormalizedX - tile.normalizedX) > 0.01 ||
        Math.abs(actualNormalizedY - tile.normalizedY) > 0.01
      ) {
        actualCenterShiftObserved = true;
      }
      const expected = expectedFinalGuideVector(
        tile,
        guided.widthMm,
        guided.depthMm,
        guide.points[0],
        guide.points[1],
      );
      const nominalExpected = expectedFinalGuideVector(
        {
          ...tile,
          centerXmm: ((tile.normalizedX + 1) / 2) * guided.widthMm,
          centerYmm: ((tile.normalizedY + 1) / 2) * guided.depthMm,
        },
        guided.widthMm,
        guided.depthMm,
        guide.points[0],
        guide.points[1],
      );
      const expectedLength = Math.hypot(expected.x, expected.y);
      const nominalExpectedLength = Math.hypot(
        nominalExpected.x,
        nominalExpected.y,
      );
      if (expectedLength > 1e-6 && nominalExpectedLength > 1e-6) {
        maximumNominalTargetError = Math.max(
          maximumNominalTargetError,
          Math.abs(
            wrappedAngleDifference(
              Math.atan2(expected.y, expected.x),
              Math.atan2(nominalExpected.y, nominalExpected.x),
            ),
          ),
        );
      }
      const topCenter = generatedTopCenter(tile);
      const topLength = Math.hypot(topCenter.x, topCenter.y);
      if (expectedLength <= 1e-6 || topLength <= 1e-6) continue;
      const alignment =
        (topCenter.x * expected.x + topCenter.y * expected.y) /
        (topLength * expectedLength);
      const meshAngle = Math.atan2(topCenter.y, topCenter.x);

      expect(alignment).toBeGreaterThan(0.999999999);
      expect(Math.abs(wrappedAngleDifference(tile.orientationRad, meshAngle))).toBeLessThan(1e-10);
      expect(tile.diagnostics.closedManifold).toBe(true);
      checked += 1;
    }

    expect(actualCenterShiftObserved).toBe(true);
    // This fixture would visibly fail if nominal family coordinates were used.
    expect(maximumNominalTargetError).toBeGreaterThan(0.05);
    expect(checked).toBeGreaterThan(20);
    expect(guided.diagnostics.allTilesClosedManifold).toBe(true);
  });
});
