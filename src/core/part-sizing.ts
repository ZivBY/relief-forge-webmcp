import type { GridConfig, WallArtConfig } from "./types";

const MAX_COLUMNS = 40;
const MAX_ROWS = 30;

function clampCount(value: number, maximum: number): number {
  return Math.max(1, Math.min(maximum, Math.round(value)));
}

function rectangularCount(
  finishedSpanMm: number,
  partSizeMm: number,
  gapMm: number,
  maximum: number,
): number {
  return clampCount((finishedSpanMm + gapMm) / (partSizeMm + gapMm), maximum);
}

function currentCarrierSpan(config: WallArtConfig): {
  widthMm: number;
  heightMm: number;
} {
  const { columns, rows, tileSizeMm, gapMm } = config.grid;
  if (config.design.family === "triangular-current") {
    return {
      widthMm: columns * tileSizeMm + tileSizeMm / 2,
      heightMm: rows * tileSizeMm * Math.sqrt(3) / 2,
    };
  }
  if (config.design.family === "hex-canopy") {
    const xPitchMm = 0.75 * (tileSizeMm + gapMm);
    const yPitchMm = tileSizeMm * Math.sqrt(3) / 2 + gapMm;
    return {
      widthMm: tileSizeMm + (columns - 1) * xPitchMm,
      heightMm:
        rows * yPitchMm - gapMm + (columns > 1 ? yPitchMm / 2 : 0),
    };
  }
  return {
    widthMm: columns * tileSizeMm + (columns - 1) * gapMm,
    heightMm: rows * tileSizeMm + (rows - 1) * gapMm,
  };
}

/**
 * Keep a requested physical part size meaningful when exact finished artwork
 * bounds are active.
 *
 * Finished-size generation scales the complete natural layout to its exact X/Y
 * bounds. If the grid count stays fixed, that global transform almost entirely
 * cancels a part-size edit. Recomputing density at the same time gives smaller
 * parts more cells and larger parts fewer cells while leaving finishedSize
 * untouched. Without exact bounds, the current natural carrier span becomes
 * the target instead. Families whose pitch is not rectangular use their own
 * layout equations so the control has the same direction across topologies.
 */
export function gridForPartSize(
  config: WallArtConfig,
  partSizeMm: number,
): GridConfig {
  if (!Number.isFinite(partSizeMm) || partSizeMm <= 0) {
    throw new Error("Part size must be a positive finite number.");
  }

  const carrierSpan = currentCarrierSpan(config);
  const widthMm = config.finishedSize.widthMm ?? carrierSpan.widthMm;
  const heightMm = config.finishedSize.heightMm ?? carrierSpan.heightMm;
  const gapMm = config.grid.gapMm;
  let columns = config.grid.columns;
  let rows = config.grid.rows;

  if (config.design.family === "triangular-current") {
    columns = clampCount(widthMm / partSizeMm - 0.5, MAX_COLUMNS);
    rows = clampCount(
      heightMm / (partSizeMm * Math.sqrt(3) / 2),
      MAX_ROWS,
    );
  } else if (config.design.family === "hex-canopy") {
    const xPitchMm = 0.75 * (partSizeMm + gapMm);
    columns = clampCount(
      1 + Math.max(0, widthMm - partSizeMm) / xPitchMm,
      MAX_COLUMNS,
    );
    const yPitchMm = partSizeMm * Math.sqrt(3) / 2 + gapMm;
    const staggerOffsetMm = columns > 1 ? yPitchMm / 2 : 0;
    rows = clampCount(
      (heightMm + gapMm - staggerOffsetMm) / yPitchMm,
      MAX_ROWS,
    );
  } else {
    columns = rectangularCount(widthMm, partSizeMm, gapMm, MAX_COLUMNS);
    rows = rectangularCount(heightMm, partSizeMm, gapMm, MAX_ROWS);
  }

  return { ...config.grid, columns, rows, tileSizeMm: partSizeMm };
}
