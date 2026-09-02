import { describe, expect, it } from "vitest";
import {
  buildPackedPlateMesh,
  diagnoseMesh,
  generateWallArt,
  OversizedTileError,
  packWallArt,
} from "./index";
import type { Rect2 } from "./index";

function separated(a: Rect2, b: Rect2, spacing: number): boolean {
  return (
    a.maxX + spacing <= b.minX + 1e-7 ||
    b.maxX + spacing <= a.minX + 1e-7 ||
    a.maxY + spacing <= b.minY + 1e-7 ||
    b.maxY + spacing <= a.minY + 1e-7
  );
}

describe("color-aware bed packing", () => {
  it("places every tile once, inside margins, with deterministic spacing", () => {
    const project = generateWallArt({
      seed: "packing",
      grid: { columns: 4, rows: 4, tileSizeMm: 20, gapMm: 2 },
      tile: { shape: "leaning-pyramid", leanRatio: 0.05 },
      palette: { colors: ["#111111", "#eeeeee"], mode: "checker" },
      printer: {
        bedWidthMm: 52,
        bedDepthMm: 52,
        marginMm: 5,
        spacingMm: 2,
        separateColors: true,
      },
    });
    const first = packWallArt(project);
    const second = packWallArt(project);
    expect(second).toEqual(first);
    expect(first.placementCount).toBe(project.tiles.length);

    const ids = first.plates.flatMap((plate) =>
      plate.placements.map((placement) => placement.tileId),
    );
    expect(new Set(ids).size).toBe(project.tiles.length);

    for (const plate of first.plates) {
      expect(plate.colorIndices).toHaveLength(1);
      for (const placement of plate.placements) {
        expect(placement.footprint.minX).toBeGreaterThanOrEqual(5 - 1e-7);
        expect(placement.footprint.minY).toBeGreaterThanOrEqual(5 - 1e-7);
        expect(placement.footprint.maxX).toBeLessThanOrEqual(47 + 1e-7);
        expect(placement.footprint.maxY).toBeLessThanOrEqual(47 + 1e-7);
      }
      for (let left = 0; left < plate.placements.length; left += 1) {
        for (let right = left + 1; right < plate.placements.length; right += 1) {
          expect(
            separated(
              plate.placements[left].footprint,
              plate.placements[right].footprint,
              2,
            ),
          ).toBe(true);
        }
      }
      expect(diagnoseMesh(buildPackedPlateMesh(project, plate)).closedManifold).toBe(true);
    }
  });

  it("reports an actionable oversized-part error", () => {
    const project = generateWallArt({
      grid: { columns: 1, rows: 1, tileSizeMm: 50 },
      printer: { bedWidthMm: 40, bedDepthMm: 40, marginMm: 5 },
    });
    expect(() => packWallArt(project)).toThrow(OversizedTileError);
    expect(() => packWallArt(project)).toThrow(/tile-r0001-c0001/);
  });

  it("validates caller-supplied printer overrides", () => {
    const project = generateWallArt({ grid: { columns: 1, rows: 1 } });
    expect(() =>
      packWallArt(project, { ...project.config.printer, marginMm: 200 }),
    ).toThrow(/marginMm leaves no usable bed width/);
  });

  it("can mix colors when explicitly requested", () => {
    const project = generateWallArt({
      grid: { columns: 2, rows: 2, tileSizeMm: 15 },
      palette: { colors: ["red", "blue"], mode: "checker" },
      printer: { bedWidthMm: 100, bedDepthMm: 100, separateColors: false },
    });
    const packing = packWallArt(project);
    expect(packing.plates).toHaveLength(1);
    expect(packing.plates[0].colorIndices).toEqual([0, 1]);
  });
});
