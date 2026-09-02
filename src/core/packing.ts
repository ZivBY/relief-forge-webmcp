import { validateWallArtConfig } from "./config";
import { meshBounds, rotateMeshZ } from "./mesh";
import type {
  GeneratedTile,
  PackedPlacement,
  PackedPlate,
  PackingResult,
  PrinterConfig,
  Rect2,
  WallArtProject,
} from "./types";

const FIT_EPSILON = 1e-7;

interface FootprintOption {
  rotationDeg: 0 | 90;
  width: number;
  depth: number;
  localMinX: number;
  localMinY: number;
}

interface PackingState {
  plate: PackedPlate;
  cursorX: number;
  cursorY: number;
  rowDepth: number;
}

export class OversizedTileError extends Error {
  readonly tileId: string;
  readonly requiredWidthMm: number;
  readonly requiredDepthMm: number;

  constructor(tile: GeneratedTile, widthMm: number, depthMm: number, printer: PrinterConfig) {
    super(
      `${tile.id} requires ${widthMm.toFixed(3)} x ${depthMm.toFixed(3)} mm, ` +
        `which exceeds the usable ${(
          printer.bedWidthMm -
          printer.marginMm * 2
        ).toFixed(3)} x ${(
          printer.bedDepthMm -
          printer.marginMm * 2
        ).toFixed(3)} mm bed area.`,
    );
    this.name = "OversizedTileError";
    this.tileId = tile.id;
    this.requiredWidthMm = widthMm;
    this.requiredDepthMm = depthMm;
  }
}

function footprintOptions(tile: GeneratedTile, allowRotate90: boolean): FootprintOption[] {
  const rotations: Array<0 | 90> = allowRotate90 ? [0, 90] : [0];
  return rotations.map((rotationDeg) => {
    const rotated =
      rotationDeg === 0 ? tile.mesh : rotateMeshZ(tile.mesh, Math.PI / 2);
    const bounds = meshBounds(rotated);
    return {
      rotationDeg,
      width: bounds.size.x,
      depth: bounds.size.y,
      localMinX: bounds.min.x,
      localMinY: bounds.min.y,
    };
  });
}

function compareOptions(a: FootprintOption, b: FootprintOption, rowDepth: number): number {
  const aGrowth = Math.max(rowDepth, a.depth) - rowDepth;
  const bGrowth = Math.max(rowDepth, b.depth) - rowDepth;
  return (
    aGrowth - bGrowth ||
    a.depth - b.depth ||
    a.width - b.width ||
    a.rotationDeg - b.rotationDeg
  );
}

function selectOption(
  options: readonly FootprintOption[],
  state: PackingState,
  printer: PrinterConfig,
): FootprintOption | undefined {
  const maxX = printer.bedWidthMm - printer.marginMm;
  const maxY = printer.bedDepthMm - printer.marginMm;
  return [...options]
    .filter(
      (option) =>
        state.cursorX + option.width <= maxX + FIT_EPSILON &&
        state.cursorY + option.depth <= maxY + FIT_EPSILON,
    )
    .sort((a, b) => compareOptions(a, b, state.rowDepth))[0];
}

function makePlate(index: number, printer: PrinterConfig): PackedPlate {
  return {
    index,
    id: `plate-${String(index).padStart(3, "0")}`,
    bedWidthMm: printer.bedWidthMm,
    bedDepthMm: printer.bedDepthMm,
    colorIndices: [],
    placements: [],
  };
}

function makeState(index: number, printer: PrinterConfig): PackingState {
  return {
    plate: makePlate(index, printer),
    cursorX: printer.marginMm,
    cursorY: printer.marginMm,
    rowDepth: 0,
  };
}

function addPlacement(
  state: PackingState,
  tile: GeneratedTile,
  option: FootprintOption,
  printer: PrinterConfig,
): void {
  const minX = state.cursorX;
  const minY = state.cursorY;
  const footprint: Rect2 = {
    minX,
    minY,
    maxX: minX + option.width,
    maxY: minY + option.depth,
    width: option.width,
    depth: option.depth,
  };
  const placement: PackedPlacement = {
    tileId: tile.id,
    colorIndex: tile.colorIndex,
    color: tile.color,
    plateIndex: state.plate.index,
    rotationDeg: option.rotationDeg,
    translateXmm: minX - option.localMinX,
    translateYmm: minY - option.localMinY,
    footprint,
  };
  state.plate.placements.push(placement);
  if (!state.plate.colorIndices.includes(tile.colorIndex)) {
    state.plate.colorIndices.push(tile.colorIndex);
    state.plate.colorIndices.sort((a, b) => a - b);
  }
  state.cursorX = footprint.maxX + printer.spacingMm;
  state.rowDepth = Math.max(state.rowDepth, option.depth);
}

function sortTilesForPacking(tiles: readonly GeneratedTile[], printer: PrinterConfig): GeneratedTile[] {
  const dimensions = new Map<string, { largest: number; area: number }>();
  for (const tile of tiles) {
    const choices = footprintOptions(tile, printer.allowRotate90);
    const best = choices.reduce((current, candidate) =>
      candidate.width * candidate.depth < current.width * current.depth ? candidate : current,
    );
    dimensions.set(tile.id, {
      largest: Math.max(best.width, best.depth),
      area: best.width * best.depth,
    });
  }
  return [...tiles].sort((a, b) => {
    const aSize = dimensions.get(a.id)!;
    const bSize = dimensions.get(b.id)!;
    return bSize.largest - aSize.largest || bSize.area - aSize.area || a.id.localeCompare(b.id);
  });
}

function assertTileFits(tile: GeneratedTile, printer: PrinterConfig): FootprintOption[] {
  const usableWidth = printer.bedWidthMm - printer.marginMm * 2;
  const usableDepth = printer.bedDepthMm - printer.marginMm * 2;
  const options = footprintOptions(tile, printer.allowRotate90);
  const fitting = options.filter(
    (option) =>
      option.width <= usableWidth + FIT_EPSILON &&
      option.depth <= usableDepth + FIT_EPSILON,
  );
  if (fitting.length === 0) {
    const smallest = [...options].sort(
      (a, b) => a.width * a.depth - b.width * b.depth || a.rotationDeg - b.rotationDeg,
    )[0];
    throw new OversizedTileError(tile, smallest.width, smallest.depth, printer);
  }
  return fitting;
}

function tileGroups(project: WallArtProject, printer: PrinterConfig): GeneratedTile[][] {
  if (!printer.separateColors) return [sortTilesForPacking(project.tiles, printer)];
  const byColor = new Map<number, GeneratedTile[]>();
  for (const tile of project.tiles) {
    const group = byColor.get(tile.colorIndex) ?? [];
    group.push(tile);
    byColor.set(tile.colorIndex, group);
  }
  return [...byColor.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, tiles]) => sortTilesForPacking(tiles, printer));
}

/** Deterministic shelf packing. Each color starts on a fresh plate by default. */
export function packWallArt(
  project: WallArtProject,
  printer: PrinterConfig = project.config.printer,
): PackingResult {
  validateWallArtConfig({ ...project.config, printer });
  const plates: PackedPlate[] = [];
  let nextPlateIndex = 1;

  for (const group of tileGroups(project, printer)) {
    if (group.length === 0) continue;
    let state = makeState(nextPlateIndex, printer);
    nextPlateIndex += 1;

    for (const tile of group) {
      const options = assertTileFits(tile, printer);
      let option = selectOption(options, state, printer);

      if (!option && state.cursorX > printer.marginMm + FIT_EPSILON) {
        state.cursorX = printer.marginMm;
        state.cursorY += state.rowDepth + printer.spacingMm;
        state.rowDepth = 0;
        option = selectOption(options, state, printer);
      }

      if (!option) {
        if (state.plate.placements.length > 0) plates.push(state.plate);
        state = makeState(nextPlateIndex, printer);
        nextPlateIndex += 1;
        option = selectOption(options, state, printer);
      }

      if (!option) {
        // assertTileFits already proved a valid orientation, so reaching this
        // branch signals a packing invariant rather than a recoverable input.
        throw new Error(`Unable to place ${tile.id} on an empty validated bed.`);
      }
      addPlacement(state, tile, option, printer);
    }

    if (state.plate.placements.length > 0) plates.push(state.plate);
  }

  return {
    projectId: project.id,
    printer: { ...printer },
    plates,
    placementCount: plates.reduce((total, plate) => total + plate.placements.length, 0),
  };
}
