import { hashUint32 } from "./random";
import { deltaE76, parseHexColor, rgbToLab } from "./photo-color";
import type { RgbColor, WallArtConfig } from "./types";

export interface ColorAssignmentInput {
  row: number;
  column: number;
  normalizedX: number;
  normalizedY: number;
  patternValue: number;
  tileId: string;
  sourceColor?: RgbColor;
}
export interface ColorAssignment {
  colorIndex: number;
  color: string;
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

export function assignTileColor(
  config: WallArtConfig,
  input: ColorAssignmentInput,
): ColorAssignment {
  const count = config.palette.colors.length;
  let index = 0;
  switch (config.palette.mode) {
    case "field-bands": {
      const normalized = Math.max(0, Math.min(0.999999999, (input.patternValue + 1) / 2));
      index = Math.floor(normalized * count);
      break;
    }
    case "checker":
      index = positiveModulo(input.row + input.column, count);
      break;
    case "radial": {
      const normalizedRadius = Math.min(0.999999999, Math.hypot(input.normalizedX, input.normalizedY) / Math.SQRT2);
      index = Math.floor(normalizedRadius * count);
      break;
    }
    case "rows":
      index = positiveModulo(input.row, count);
      break;
    case "seeded-random":
      index = hashUint32(config.seed, "palette", input.tileId) % count;
      break;
  }
  index = positiveModulo(index + config.palette.offset, count);
  if (config.palette.reverse) index = count - 1 - index;
  const photo = config.source.kind === "photo" ? config.source.photo : undefined;
  if (photo && input.sourceColor && photo.colorStrength > 0) {
    const existingLab = rgbToLab(parseHexColor(config.palette.colors[index]));
    const sourceLab = rgbToLab(input.sourceColor);
    const targetLab = {
      l: existingLab.l * (1 - photo.colorStrength) + sourceLab.l * photo.colorStrength,
      a: existingLab.a * (1 - photo.colorStrength) + sourceLab.a * photo.colorStrength,
      b: existingLab.b * (1 - photo.colorStrength) + sourceLab.b * photo.colorStrength,
    };
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let candidate = 0; candidate < config.palette.colors.length; candidate += 1) {
      const distance = deltaE76(
        targetLab,
        rgbToLab(parseHexColor(config.palette.colors[candidate])),
      );
      if (distance < nearestDistance - 1e-12) {
        nearestIndex = candidate;
        nearestDistance = distance;
      }
    }
    index = nearestIndex;
  }
  return { colorIndex: index, color: config.palette.colors[index] };
}
