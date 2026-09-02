import { describe, expect, it } from "vitest";
import {
  createWallArtConfig,
  generateWallArt,
  gridForPartSize,
  OversizedTileError,
  packWallArt,
  wallArtProjectId,
} from "./index";
import type {
  DesignFamilyKind,
  PatternKind,
  SilhouetteKind,
  TileShapeKind,
  WallArtProject,
} from "./index";

interface FamilyShapeCase {
  family: DesignFamilyKind;
  shape: TileShapeKind;
}

const FAMILY_SHAPE_CASES: readonly FamilyShapeCase[] = [
  { family: "folded-flow", shape: "folded-ridge" },
  { family: "folded-flow", shape: "twisted-prism" },
  { family: "folded-flow", shape: "leaning-pyramid" },
  { family: "sampled-blocks", shape: "surface-column" },
  { family: "sampled-blocks", shape: "planar-cap-column" },
  { family: "triangular-current", shape: "triangle-sail" },
  { family: "triangular-current", shape: "triangle-plateau" },
  { family: "polar-bloom", shape: "polar-petal" },
  { family: "polar-bloom", shape: "polar-wedge" },
  { family: "cellular-crystal", shape: "cell-crystal" },
  { family: "cellular-crystal", shape: "cell-plateau" },
  { family: "hex-canopy", shape: "hex-petal" },
  { family: "hex-canopy", shape: "hex-spike" },
  { family: "hex-canopy", shape: "hex-folded-fan" },
  { family: "hex-canopy", shape: "hex-pinwheel" },
  { family: "hex-canopy", shape: "hex-curved-sweep" },
  { family: "hex-canopy", shape: "hex-wave-bands" },
  { family: "hex-canopy", shape: "hex-mixed" },
  { family: "coral-cluster", shape: "ring-pod" },
  { family: "coral-cluster", shape: "solid-pod" },
  { family: "contour-relief", shape: "relief-panel" },
  { family: "contour-relief", shape: "terraced-panel" },
  { family: "silhouette-mosaic", shape: "mixed-block" },
  { family: "silhouette-mosaic", shape: "twisted-prism" },
  { family: "silhouette-mosaic", shape: "leaning-pyramid" },
];

const PATTERNS: readonly PatternKind[] = [
  "flat",
  "wave",
  "ripple",
  "vortex",
  "dunes",
  "noise",
  "interference",
  "liquid",
  "fracture",
];

const SILHOUETTES: readonly SilhouetteKind[] = [
  "rectangle",
  "ellipse",
  "archipelago",
  "crescent",
  "ring",
];

const REPRESENTATIVE_FAMILY_CASES: readonly FamilyShapeCase[] = [
  { family: "folded-flow", shape: "folded-ridge" },
  { family: "sampled-blocks", shape: "surface-column" },
  { family: "triangular-current", shape: "triangle-sail" },
  { family: "polar-bloom", shape: "polar-petal" },
  { family: "cellular-crystal", shape: "cell-crystal" },
  { family: "hex-canopy", shape: "hex-mixed" },
  { family: "coral-cluster", shape: "ring-pod" },
  { family: "contour-relief", shape: "relief-panel" },
  { family: "silhouette-mosaic", shape: "mixed-block" },
];

interface NumericBoundaryRow {
  columns: number;
  rows: number;
  partSizeMm: number;
  gapMm: number;
  reliefHeightMm: number;
  frequency: number;
  variation: number;
  finishedWidthMm: number;
  finishedHeightMm: number;
  twistDeg: number;
}

function pairwiseNumericBoundaryRows(
  maximumPartSizeMm: number,
): NumericBoundaryRow[] {
  const minimum: NumericBoundaryRow = {
    columns: 1,
    rows: 1,
    partSizeMm: 16,
    gapMm: 0.6,
    reliefHeightMm: 4,
    frequency: 0.2,
    variation: 0,
    finishedWidthMm: 0.01,
    finishedHeightMm: 0.01,
    twistDeg: 0,
  };
  const maximum: NumericBoundaryRow = {
    columns: 40,
    rows: 30,
    partSizeMm: maximumPartSizeMm,
    gapMm: 8,
    reliefHeightMm: 70,
    frequency: 3.5,
    variation: 1,
    finishedWidthMm: 10_000,
    finishedHeightMm: 10_000,
    twistDeg: 65,
  };
  const keys = Object.keys(minimum) as Array<keyof NumericBoundaryRow>;
  const rows = [{ ...minimum }];
  for (const key of keys) rows.push({ ...minimum, [key]: maximum[key] });
  for (let left = 0; left < keys.length; left += 1) {
    for (let right = left + 1; right < keys.length; right += 1) {
      rows.push({
        ...minimum,
        [keys[left]]: maximum[keys[left]],
        [keys[right]]: maximum[keys[right]],
      });
    }
  }
  return rows;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function record(
  failures: string[],
  label: string,
  condition: boolean,
  problem: string,
): void {
  if (!condition) failures.push(`${label}: ${problem}`);
}

function auditProject(
  project: WallArtProject,
  label: string,
  failures: string[],
): void {
  record(failures, label, project.tiles.length > 0, "generated no parts");
  record(
    failures,
    label,
    Number.isFinite(project.widthMm) && project.widthMm > 0,
    `invalid project width ${String(project.widthMm)}`,
  );
  record(
    failures,
    label,
    Number.isFinite(project.depthMm) && project.depthMm > 0,
    `invalid project depth ${String(project.depthMm)}`,
  );
  record(
    failures,
    label,
    project.diagnostics.tileCount === project.tiles.length,
    "project tile count does not match its diagnostics",
  );
  record(
    failures,
    label,
    project.diagnostics.closedTileCount === project.tiles.length,
    "one or more parts are not closed manifolds",
  );
  record(
    failures,
    label,
    project.diagnostics.allTilesClosedManifold,
    "allTilesClosedManifold is false",
  );

  const fullMesh = project.diagnostics.fullMesh;
  record(
    failures,
    label,
    fullMesh.nonFiniteVertexCount === 0 &&
      fullMesh.nonFiniteNormalCount === 0 &&
      fullMesh.nonFiniteMetricCount === 0,
    "full-art diagnostics contain a non-finite value",
  );
  record(
    failures,
    label,
    fullMesh.invalidTriangleIndexCount === 0,
    "full-art diagnostics contain an invalid triangle index",
  );
  record(
    failures,
    label,
    fullMesh.closedManifold,
    "combined full-art mesh is not closed manifold",
  );

  const invalidMetadata = project.tiles.find((tile) => [
    tile.centerXmm,
    tile.centerYmm,
    tile.normalizedX,
    tile.normalizedY,
    tile.orientationRad,
    tile.patternValue,
    tile.heightMm,
  ].some((value) => !Number.isFinite(value)));
  record(
    failures,
    label,
    invalidMetadata === undefined,
    `part ${invalidMetadata?.id ?? "unknown"} has non-finite metadata`,
  );
  const invalidMesh = project.tiles.find((tile) =>
    tile.mesh.vertices.length === 0 ||
    tile.mesh.triangles.length === 0 ||
    tile.mesh.vertices.some((vertex) =>
      [vertex.x, vertex.y, vertex.z].some((value) => !Number.isFinite(value)),
    ) ||
    tile.diagnostics.nonFiniteVertexCount > 0 ||
    tile.diagnostics.nonFiniteNormalCount > 0 ||
    tile.diagnostics.nonFiniteMetricCount > 0 ||
    tile.diagnostics.invalidTriangleIndexCount > 0 ||
    tile.diagnostics.degenerateTriangleCount > 0 ||
    tile.diagnostics.boundaryEdgeCount > 0 ||
    tile.diagnostics.nonManifoldEdgeCount > 0 ||
    !tile.diagnostics.closedManifold,
  );
  record(
    failures,
    label,
    invalidMesh === undefined,
    `part ${invalidMesh?.id ?? "unknown"} is not a finite non-degenerate closed manifold`,
  );
}

function expectNoFailures(failures: readonly string[]): void {
  expect(
    failures,
    failures.length === 0
      ? undefined
      : `Control matrix failures (${failures.length}):\n${failures
          .slice(0, 25)
          .join("\n")}`,
  ).toEqual([]);
}

describe("web control boundary matrix", () => {
  it(
    "generates finite manifold parts for every family/shape, pattern, and silhouette combination",
    { timeout: 120_000 },
    () => {
      const failures: string[] = [];
      let attempts = 0;

      for (const { family, shape } of FAMILY_SHAPE_CASES) {
        for (const pattern of PATTERNS) {
          for (const silhouette of SILHOUETTES) {
            attempts += 1;
            const label = `${family}/${shape}/${pattern}/${silhouette}`;
            try {
              const project = generateWallArt({
                seed: "control-matrix-categorical-v1",
                design: {
                  family,
                  silhouette,
                  variation: 0.35,
                  symmetry: 5,
                  surfaceResolution: 5,
                },
                grid: {
                  columns: 6,
                  rows: 5,
                  tileSizeMm: 16,
                  gapMm: 1,
                },
                tile: {
                  shape,
                  baseHeightMm: 2,
                  reliefHeightMm: 12,
                  topScale: 0.45,
                  leanRatio: 0.12,
                  twistDeg: 18,
                },
                pattern: {
                  kind: pattern,
                  frequency: 1.2,
                  arms: 4,
                },
              });

              record(
                failures,
                label,
                project.config.design.family === family &&
                  project.config.tile.shape === shape &&
                  project.config.pattern.kind === pattern &&
                  project.config.design.silhouette === silhouette,
                "normalized project config did not preserve the selected controls",
              );
              auditProject(project, label, failures);
            } catch (error) {
              failures.push(`${label}: threw ${errorMessage(error)}`);
            }
          }
        }
      }

      expect(attempts).toBe(
        FAMILY_SHAPE_CASES.length * PATTERNS.length * SILHOUETTES.length,
      );
      expectNoFailures(failures);
    },
  );

  it(
    "preserves every family/shape and field across minimum and maximum Part size changes",
    { timeout: 120_000 },
    () => {
      const failures: string[] = [];
      let attempts = 0;

      for (const { family, shape } of FAMILY_SHAPE_CASES) {
        for (const pattern of PATTERNS) {
          const base = createWallArtConfig({
            seed: "control-matrix-part-size-v1",
            finishedSize: {
              widthMm: 240,
              heightMm: 180,
              lockAspect: false,
            },
            design: {
              family,
              silhouette: "rectangle",
              variation: 0.35,
              symmetry: 5,
              surfaceResolution: 5,
            },
            grid: {
              columns: 6,
              rows: 5,
              tileSizeMm: 28,
              gapMm: 1,
            },
            tile: {
              shape,
              baseHeightMm: 2,
              reliefHeightMm: 12,
              topScale: 0.45,
              leanRatio: 0.12,
              twistDeg: 18,
            },
            pattern: {
              kind: pattern,
              frequency: 1.2,
              arms: 4,
            },
          });
          const baseId = wallArtProjectId(base);
          const maximumPartSize =
            family === "contour-relief" || family === "hex-canopy" ? 240 : 90;

          for (const partSizeMm of [16, maximumPartSize]) {
            attempts += 1;
            const label = `${family}/${shape}/${pattern}/part-${partSizeMm}`;
            try {
              const project = generateWallArt({
                ...base,
                grid: gridForPartSize(base, partSizeMm),
              });

              record(
                failures,
                label,
                project.config.design.family === family &&
                  project.config.tile.shape === shape &&
                  project.config.pattern.kind === pattern &&
                  project.config.design.silhouette === "rectangle",
                "Part size change reset a categorical control",
              );
              record(
                failures,
                label,
                project.config.grid.tileSizeMm === partSizeMm,
                `normalized Part size is ${project.config.grid.tileSizeMm} mm`,
              );
              record(
                failures,
                label,
                project.config.grid.columns >= 1 &&
                  project.config.grid.columns <= 40 &&
                  project.config.grid.rows >= 1 &&
                  project.config.grid.rows <= 30,
                "Part size produced a grid outside the supported workload bounds",
              );
              record(
                failures,
                label,
                project.widthMm === 240 && project.depthMm === 180,
                "Part size change did not preserve exact finished bounds",
              );
              record(
                failures,
                label,
                project.id !== baseId,
                "Part size change did not change deterministic project identity",
              );
              auditProject(project, label, failures);
            } catch (error) {
              failures.push(`${label}: threw ${errorMessage(error)}`);
            }
          }
        }
      }

      expect(attempts).toBe(FAMILY_SHAPE_CASES.length * PATTERNS.length * 2);
      expectNoFailures(failures);
    },
  );

  it(
    "classifies a pairwise matrix of numeric control endpoints across every family",
    { timeout: 120_000 },
    () => {
      const failures: string[] = [];
      let attempts = 0;
      let validProjects = 0;
      let precisionRejections = 0;

      for (const { family, shape } of REPRESENTATIVE_FAMILY_CASES) {
        const maximumPartSizeMm =
          family === "contour-relief" || family === "hex-canopy" ? 240 : 90;
        const rows = pairwiseNumericBoundaryRows(maximumPartSizeMm);
        record(
          failures,
          family,
          rows.length === 56,
          `expected 56 pairwise rows but built ${rows.length}`,
        );

        for (const [rowIndex, row] of rows.entries()) {
          attempts += 1;
          const label = `${family}/${shape}/numeric-row-${rowIndex + 1}`;
          try {
            const project = generateWallArt({
              seed: "control-matrix-numeric-v1",
              finishedSize: {
                widthMm: row.finishedWidthMm,
                heightMm: row.finishedHeightMm,
                lockAspect: false,
              },
              design: {
                family,
                silhouette: "rectangle",
                variation: row.variation,
                symmetry: 3,
                surfaceResolution: 5,
              },
              grid: {
                columns: row.columns,
                rows: row.rows,
                tileSizeMm: row.partSizeMm,
                gapMm: row.gapMm,
              },
              tile: {
                shape,
                baseHeightMm: 2,
                reliefHeightMm: row.reliefHeightMm,
                topScale: 0.45,
                leanRatio: 0.12,
                twistDeg: row.twistDeg,
              },
              pattern: {
                kind: "wave",
                frequency: row.frequency,
                arms: 3,
                noiseScale: 0.5,
              },
            });

            record(
              failures,
              label,
              project.widthMm === row.finishedWidthMm &&
                project.depthMm === row.finishedHeightMm,
              "exact finished bounds changed",
            );
            auditProject(project, label, failures);
            validProjects += 1;
          } catch (error) {
            if (/finished size is too small for this part density/i.test(errorMessage(error))) {
              precisionRejections += 1;
            } else {
              failures.push(`${label}: threw ${errorMessage(error)}`);
            }
          }
        }
      }

      expect(attempts).toBe(504);
      expect(validProjects + precisionRejections).toBe(attempts);
      expect(validProjects).toBe(483);
      expect(precisionRejections).toBe(21);
      expectNoFailures(failures);
    },
  );

  it(
    "renders every conditional slider at its visible endpoints",
    { timeout: 120_000 },
    () => {
      const failures: string[] = [];
      let attempts = 0;
      const run = (
        label: string,
        overrides: Parameters<typeof generateWallArt>[0],
      ) => {
        attempts += 1;
        try {
          auditProject(generateWallArt(overrides), label, failures);
        } catch (error) {
          failures.push(`${label}: threw ${errorMessage(error)}`);
        }
      };
      const common = {
        seed: "control-matrix-conditional-v1",
        design: {
          silhouette: "rectangle" as const,
          variation: 0.35,
          surfaceResolution: 5,
        },
        grid: { columns: 3, rows: 3, tileSizeMm: 24, gapMm: 1 },
        tile: { baseHeightMm: 2, reliefHeightMm: 12 },
      };

      for (const shape of ["polar-petal", "polar-wedge"] as const) {
        for (const symmetry of [3, 16]) {
          run(`polar/${shape}/symmetry-${symmetry}`, {
            ...common,
            design: {
              ...common.design,
              family: "polar-bloom",
              symmetry,
            },
            tile: { ...common.tile, shape },
          });
        }
      }
      for (const shape of ["relief-panel", "terraced-panel"] as const) {
        for (const surfaceResolution of [5, 24]) {
          run(`contour/${shape}/detail-${surfaceResolution}`, {
            ...common,
            design: {
              ...common.design,
              family: "contour-relief",
              surfaceResolution,
            },
            tile: { ...common.tile, shape },
          });
        }
      }
      for (const family of ["folded-flow", "silhouette-mosaic"] as const) {
        for (const twistDeg of [0, 65]) {
          run(`${family}/twist-${twistDeg}`, {
            ...common,
            design: { ...common.design, family },
            tile: { ...common.tile, shape: "twisted-prism", twistDeg },
          });
        }
      }
      for (const pattern of [
        "vortex",
        "interference",
        "liquid",
        "fracture",
      ] as const) {
        const endpoints = pattern === "vortex" ? [1, 8] : [3, 12];
        for (const arms of endpoints) {
          run(`${pattern}/arms-${arms}`, {
            ...common,
            design: { ...common.design, family: "folded-flow" },
            tile: { ...common.tile, shape: "folded-ridge" },
            pattern: { kind: pattern, arms },
          });
        }
      }
      for (const pattern of ["dunes", "noise"] as const) {
        for (const noiseScale of [0.5, 5]) {
          run(`${pattern}/noise-${noiseScale}`, {
            ...common,
            design: { ...common.design, family: "folded-flow" },
            tile: { ...common.tile, shape: "folded-ridge" },
            pattern: { kind: pattern, noiseScale },
          });
        }
      }

      expect(attempts).toBe(24);
      expectNoFailures(failures);
    },
  );

  it(
    "classifies every printer endpoint combination at minimum and maximum Part size",
    { timeout: 120_000 },
    () => {
      const failures: string[] = [];
      let attempts = 0;
      let validPackings = 0;
      let oversizedParts = 0;

      for (const { family, shape } of FAMILY_SHAPE_CASES) {
        const maximumPartSizeMm =
          family === "contour-relief" || family === "hex-canopy" ? 240 : 90;
        const base = createWallArtConfig({
          seed: "control-matrix-packing-v1",
          finishedSize: { widthMm: 240, heightMm: 180, lockAspect: false },
          design: {
            family,
            silhouette: "rectangle",
            variation: 0.35,
            surfaceResolution: 5,
          },
          grid: { columns: 6, rows: 5, tileSizeMm: 28, gapMm: 1 },
          tile: {
            shape,
            baseHeightMm: 2,
            reliefHeightMm: 12,
            topScale: 0.45,
            leanRatio: 0.12,
          },
          palette: {
            colors: ["#16324f", "#fe6d73"],
            mode: "checker",
          },
        });

        for (const partSizeMm of [16, maximumPartSizeMm]) {
          const project = generateWallArt({
            ...base,
            grid: gridForPartSize(base, partSizeMm),
          });
          for (const bedWidthMm of [80, 1_000]) {
            for (const bedDepthMm of [80, 1_000]) {
              for (const marginMm of [0, 30]) {
                for (const spacingMm of [1, 20]) {
                  for (const separateColors of [false, true]) {
                    attempts += 1;
                    const label = [
                      family,
                      shape,
                      `part-${partSizeMm}`,
                      `${bedWidthMm}x${bedDepthMm}`,
                      `margin-${marginMm}`,
                      `spacing-${spacingMm}`,
                      separateColors ? "separate" : "mixed",
                    ].join("/");
                    try {
                      const packing = packWallArt(project, {
                        ...base.printer,
                        bedWidthMm,
                        bedDepthMm,
                        marginMm,
                        spacingMm,
                        separateColors,
                      });
                      validPackings += 1;
                      record(
                        failures,
                        label,
                        packing.placementCount === project.tiles.length,
                        "packing omitted one or more parts",
                      );
                      for (const plate of packing.plates) {
                        const outside = plate.placements.find((placement) =>
                          placement.footprint.minX < marginMm - 1e-7 ||
                          placement.footprint.minY < marginMm - 1e-7 ||
                          placement.footprint.maxX > bedWidthMm - marginMm + 1e-7 ||
                          placement.footprint.maxY > bedDepthMm - marginMm + 1e-7,
                        );
                        record(
                          failures,
                          label,
                          outside === undefined,
                          `part ${outside?.tileId ?? "unknown"} exceeds usable bed bounds`,
                        );
                      }
                    } catch (error) {
                      if (error instanceof OversizedTileError) oversizedParts += 1;
                      else failures.push(`${label}: threw ${errorMessage(error)}`);
                    }
                  }
                }
              }
            }
          }
        }
      }

      expect(attempts).toBe(FAMILY_SHAPE_CASES.length * 64);
      expect(validPackings).toBeGreaterThan(0);
      expect(oversizedParts).toBeGreaterThan(0);
      expect(validPackings + oversizedParts).toBe(attempts);
      expectNoFailures(failures);
    },
  );

  it("rejects a 1 x 1 silhouette miss with actionable recovery guidance", () => {
    expect(() =>
      generateWallArt({
        seed: "control-matrix-empty-ring-v1",
        design: {
          family: "folded-flow",
          silhouette: "ring",
        },
        grid: {
          columns: 1,
          rows: 1,
          tileSizeMm: 28,
          gapMm: 1,
        },
        tile: { shape: "folded-ridge" },
      }),
    ).toThrow(
      /No parts intersect.*Increase Across or Down.*reduce Part size.*choose another silhouette/i,
    );
  });

  it("rejects finished scaling that collapses part features below supported precision", () => {
    expect(() =>
      generateWallArt({
        seed: "control-matrix-precision-collapse-v1",
        finishedSize: { widthMm: 0.01, heightMm: 0.01, lockAspect: false },
        design: {
          family: "triangular-current",
          silhouette: "rectangle",
        },
        grid: {
          columns: 40,
          rows: 30,
          tileSizeMm: 16,
          gapMm: 0.6,
        },
        tile: { shape: "triangle-sail" },
      }),
    ).toThrow(
      /finished size is too small.*Increase Width or Height.*reduce Across or Down.*fewer parts/i,
    );
  });
});
