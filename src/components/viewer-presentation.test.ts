import { describe, expect, it } from "vitest";

import { createWallArtConfig } from "../core/config";
import { generateWallArt } from "../core/generate";
import { gridForPartSize } from "../core/part-sizing";
import {
  projectHeightToFootprintRatio,
  shouldSuggestTopView,
} from "./viewer-presentation";

function triangularCurrentAt(partSizeMm: number) {
  const base = createWallArtConfig({
    seed: "reported-part-size-preview",
    finishedSize: { widthMm: 403.4, heightMm: 247.4, lockAspect: false },
    design: {
      family: "triangular-current",
      silhouette: "rectangle",
      variation: 0.55,
    },
    grid: { columns: 10, rows: 8, tileSizeMm: 34, gapMm: 2.2 },
    tile: {
      shape: "triangle-sail",
      baseHeightMm: 2.4,
      reliefHeightMm: 28,
      leanRatio: 0.18,
    },
    pattern: { kind: "wave", frequency: 1.35, angleDeg: 18 },
  });
  return generateWallArt({
    ...base,
    grid: gridForPartSize(base, partSizeMm),
  });
}

describe("high-aspect preview guidance", () => {
  it("recognizes the reported 16 mm triangular-current configuration", () => {
    const project = triangularCurrentAt(16);

    expect(project.config.design.family).toBe("triangular-current");
    expect(project.config.pattern.kind).toBe("wave");
    expect(project.config.grid).toMatchObject({
      columns: 25,
      rows: 18,
      tileSizeMm: 16,
    });
    expect(project.tiles).toHaveLength(900);
    expect(project.diagnostics.allTilesClosedManifold).toBe(true);
    expect(projectHeightToFootprintRatio(project)).toBeGreaterThanOrEqual(1.5);
    expect(shouldSuggestTopView(project)).toBe(true);
  });

  it("does not interrupt an ordinary low-aspect preview", () => {
    const project = generateWallArt({
      grid: { columns: 4, rows: 3, tileSizeMm: 40, gapMm: 2 },
      tile: { baseHeightMm: 2.4, reliefHeightMm: 12 },
    });

    expect(projectHeightToFootprintRatio(project)).toBeLessThan(1.5);
    expect(shouldSuggestTopView(project)).toBe(false);
  });
});
