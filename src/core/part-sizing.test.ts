import { describe, expect, it } from "vitest";
import {
  createWallArtConfig,
  generateWallArt,
  gridForPartSize,
  meshBounds,
} from "./index";

const FAMILIES = [
  "folded-flow",
  "sampled-blocks",
  "triangular-current",
  "polar-bloom",
  "cellular-crystal",
  "hex-canopy",
  "coral-cluster",
  "contour-relief",
  "silhouette-mosaic",
] as const;

function medianFootprint(project: ReturnType<typeof generateWallArt>): number {
  const footprints = project.tiles
    .map((tile) => {
      const bounds = meshBounds(tile.mesh);
      return Math.sqrt(bounds.size.x * bounds.size.y);
    })
    .sort((left, right) => left - right);
  return footprints[Math.floor(footprints.length / 2)];
}

describe("part-size density adjustment", () => {
  it.each(FAMILIES)(
    "preserves the natural carrier span while changing %s part size in the expected direction",
    (family) => {
      const base = createWallArtConfig({
        seed: "natural-part-size-direction",
        design: { family, silhouette: "rectangle", variation: 0.35 },
        grid: { columns: 12, rows: 8, tileSizeMm: 28, gapMm: 2 },
      });
      const original = generateWallArt(base);
      const small = generateWallArt({
        ...base,
        grid: gridForPartSize(base, 20),
      });
      const large = generateWallArt({
        ...base,
        grid: gridForPartSize(base, 40),
      });

      expect(small.config.grid.columns).toBeLessThanOrEqual(40);
      expect(small.config.grid.rows).toBeLessThanOrEqual(30);
      expect(small.config.grid.columns * small.config.grid.rows).toBeGreaterThan(
        large.config.grid.columns * large.config.grid.rows,
      );
      expect(medianFootprint(large)).toBeGreaterThan(
        medianFootprint(small) * 1.35,
      );
      expect(Math.abs(small.widthMm - original.widthMm)).toBeLessThanOrEqual(22);
      expect(Math.abs(small.depthMm - original.depthMm)).toBeLessThanOrEqual(22);
      expect(Math.abs(large.widthMm - original.widthMm)).toBeLessThanOrEqual(42);
      expect(Math.abs(large.depthMm - original.depthMm)).toBeLessThanOrEqual(42);
    },
  );

  it("rejects invalid part sizes before changing grid density", () => {
    const config = createWallArtConfig();
    expect(() => gridForPartSize(config, 0)).toThrow(/positive finite/);
    expect(() => gridForPartSize(config, Number.NaN)).toThrow(/positive finite/);
  });
});
