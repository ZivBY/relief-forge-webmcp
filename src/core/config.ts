import type {
  WallArtConfig,
  DesignFamilyKind,
  SilhouetteKind,
  PatternKind,
  TileShapeKind,
  ColorAssignmentMode,
  GuideDirectionMode,
  GuideInterpolation,
  GuideTemplateKind,
  GuideEffectOverrides,
  PhotoColorMode,
  PhotoDirectionMode,
  PhotoToneMode,
  WallArtConfigInput,
} from "./types";
import { validateDepthProfileConfig } from "./depth-profile";
import { validateRegionalDepthMasks } from "./depth-masks";
import {
  DEPTH_PAINT_FIELD_VERSION,
  DEPTH_PAINT_UNITS_PER_MM,
  validateDepthPaintFieldDescriptor,
} from "../depth-paint/field";

/**
 * Hard workload and scale ceilings shared by imported recipes and the UI.
 *
 * Ten metres preserves the largest natural layout exposed by the current UI
 * (40 columns of 240 mm panels plus gaps is 9,912 mm) while rejecting values
 * that are outside this browser-based wall-art tool's intended domain.
 */
export const MAX_FINISHED_DIMENSION_MM = 10_000;
export const MAX_GRID_COLUMNS = 40;
export const MAX_GRID_ROWS = 30;
export const MIN_PHOTO_COLORS = 2;
export const MAX_PHOTO_COLORS = 10;
export const MAX_CANONICAL_PHOTO_EDGE = 512;
const MAX_PHYSICAL_PARAMETER_MM = 10_000;
const MAX_SCALAR_MAGNITUDE = 10_000;
const MAX_ANGLE_MAGNITUDE_DEG = 1_000_000;
const MAX_PALETTE_COLORS = 64;
const MAX_SEED_LENGTH = 256;

/**
 * Guide sampling is O(tile count * segment count). 4,096 segments keeps even
 * the two-parts-per-cell triangular family below ten million comparisons at
 * the UI's 1,200-cell ceiling, while leaving room for ordinary resampled strokes.
 */
export const MAX_TOTAL_GUIDE_SEGMENTS = 4_096;

export const DEFAULT_WALL_ART_CONFIG: Readonly<WallArtConfig> = {
  schemaVersion: 3,
  seed: "wall-art-001",
  source: {
    kind: "procedural",
  },
  finishedSize: {
    widthMm: undefined,
    heightMm: undefined,
    lockAspect: true,
  },
  design: {
    family: "folded-flow",
    silhouette: "rectangle",
    variation: 0.58,
    symmetry: 8,
    surfaceResolution: 12,
  },
  grid: {
    columns: 12,
    rows: 8,
    tileSizeMm: 28,
    gapMm: 2,
  },
  tile: {
    shape: "folded-ridge",
    baseHeightMm: 2.4,
    reliefHeightMm: 18,
    topScale: 0.38,
    leanRatio: 0.18,
    twistDeg: 28,
  },
  depthProfile: {
    invert: false,
    contrast: 1,
    curve: 0,
    levels: 0,
  },
  localDepth: {
    masks: [],
  },
  pattern: {
    kind: "wave",
    frequency: 1.15,
    amplitude: 1,
    angleDeg: 32,
    phaseDeg: 0,
    centerX: 0,
    centerY: 0,
    arms: 3,
    noiseScale: 1.8,
    octaves: 4,
    lacunarity: 2,
    gain: 0.5,
  },
  guides: {
    lines: [],
    influenceRadius: 0.24,
    // Missing fields in older schema-v1 recipes inherit a clearly visible but
    // not fully saturated pull while their part bases remain fixed.
    centerPull: 0.85,
    followStrength: 0.9,
    heightDeltaMm: 8,
  },
  palette: {
    colors: ["#16324f", "#2a628f", "#5aa9e6", "#f9f7f3", "#ffcb77", "#fe6d73"],
    mode: "field-bands",
    offset: 0,
    reverse: false,
  },
  printer: {
    bedWidthMm: 256,
    bedDepthMm: 256,
    marginMm: 5,
    spacingMm: 4,
    allowRotate90: true,
    separateColors: true,
  },
};

export const DEFAULT_PHOTO_COMPOSITION_CONFIG = {
  assetSha256: "",
  canonicalWidth: 1,
  canonicalHeight: 1,
  toneMode: "light-raised" as PhotoToneMode,
  toneContrast: 0.55,
  geometryStrength: 1,
  directionMode: "gradient" as PhotoDirectionMode,
  directionStrength: 0.72,
  colorMode: "auto-palette" as PhotoColorMode,
  colorStrength: 1,
  requestedColorCount: 5,
};

const PATTERN_KINDS = new Set<PatternKind>([
  "flat",
  "wave",
  "ripple",
  "vortex",
  "dunes",
  "noise",
  "interference",
  "liquid",
  "fracture",
]);
const DESIGN_FAMILIES = new Set<DesignFamilyKind>([
  "folded-flow",
  "sampled-blocks",
  "triangular-current",
  "polar-bloom",
  "cellular-crystal",
  "hex-canopy",
  "coral-cluster",
  "contour-relief",
  "silhouette-mosaic",
]);
const SILHOUETTES = new Set<SilhouetteKind>([
  "rectangle",
  "ellipse",
  "archipelago",
  "crescent",
  "ring",
]);
const TILE_SHAPES = new Set<TileShapeKind>([
  "leaning-pyramid",
  "twisted-prism",
  "hex-spike",
  "folded-ridge",
  "surface-column",
  "planar-cap-column",
  "triangle-sail",
  "triangle-plateau",
  "polar-wedge",
  "polar-petal",
  "cell-crystal",
  "cell-plateau",
  "hex-petal",
  "hex-folded-fan",
  "hex-pinwheel",
  "hex-curved-sweep",
  "hex-wave-bands",
  "hex-mixed",
  "ring-pod",
  "solid-pod",
  "relief-panel",
  "terraced-panel",
  "mixed-block",
]);
const COLOR_MODES = new Set<ColorAssignmentMode>([
  "field-bands",
  "checker",
  "radial",
  "rows",
  "seeded-random",
]);
const GUIDE_DIRECTION_MODES = new Set<GuideDirectionMode>([
  "toward",
  "toward-forward",
]);
const GUIDE_INTERPOLATIONS = new Set<GuideInterpolation>(["linear", "smooth"]);
const GUIDE_TEMPLATE_KINDS = new Set<GuideTemplateKind>([
  "freehand",
  "line",
  "arc",
  "circle",
  "ellipse",
  "square",
  "triangle",
  "diamond",
  "s-curve",
]);
const PHOTO_TONE_MODES = new Set<PhotoToneMode>([
  "off",
  "light-raised",
  "dark-raised",
]);
const PHOTO_DIRECTION_MODES = new Set<PhotoDirectionMode>([
  "off",
  "gradient",
  "contour",
]);
const PHOTO_COLOR_MODES = new Set<PhotoColorMode>([
  "auto-palette",
  "current-palette",
]);

function finite(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite; received ${String(value)}.`);
  }
}

function positive(name: string, value: number): void {
  finite(name, value);
  if (value <= 0) throw new Error(`${name} must be greater than zero.`);
}

function nonNegative(name: string, value: number): void {
  finite(name, value);
  if (value < 0) throw new Error(`${name} cannot be negative.`);
}

function atMost(name: string, value: number, maximum: number): void {
  if (value > maximum) {
    throw new Error(`${name} cannot exceed ${maximum}.`);
  }
}

function magnitudeAtMost(name: string, value: number, maximum: number): void {
  if (Math.abs(value) > maximum) {
    throw new Error(`${name} must stay between -${maximum} and ${maximum}.`);
  }
}

function validateGuideEffectOverrides(
  name: string,
  effects: GuideEffectOverrides,
): void {
  if (effects.influenceRadius !== undefined) {
    positive(`${name}.influenceRadius`, effects.influenceRadius);
    if (effects.influenceRadius > 2) {
      throw new Error(`${name}.influenceRadius cannot exceed 2 normalized art units.`);
    }
  }
  if (effects.centerPull !== undefined) {
    finite(`${name}.centerPull`, effects.centerPull);
    if (effects.centerPull < 0 || effects.centerPull > 1) {
      throw new Error(`${name}.centerPull must be between 0 and 1.`);
    }
  }
  if (effects.followStrength !== undefined) {
    finite(`${name}.followStrength`, effects.followStrength);
    if (effects.followStrength < 0 || effects.followStrength > 1) {
      throw new Error(`${name}.followStrength must be between 0 and 1.`);
    }
  }
  if (effects.heightDeltaMm !== undefined) {
    finite(`${name}.heightDeltaMm`, effects.heightDeltaMm);
    if (Math.abs(effects.heightDeltaMm) > 200) {
      throw new Error(`${name}.heightDeltaMm must stay between -200 and 200 mm.`);
    }
  }
  if (
    effects.directionMode !== undefined &&
    !GUIDE_DIRECTION_MODES.has(effects.directionMode)
  ) {
    throw new Error(`${name}.directionMode is not supported.`);
  }
}

export function validateWallArtConfig(config: WallArtConfig): void {
  if (config.schemaVersion !== 3) throw new Error("Only project schemaVersion 3 is supported.");
  if (typeof config.seed === "string") {
    if (config.seed.length === 0) throw new Error("seed must be a non-empty string or finite number.");
    if (config.seed.length > MAX_SEED_LENGTH) {
      throw new Error(`seed cannot exceed ${MAX_SEED_LENGTH} characters.`);
    }
  } else if (typeof config.seed === "number") {
    finite("seed", config.seed);
  } else {
    throw new Error("seed must be a non-empty string or finite number.");
  }
  if (config.source.kind !== "procedural" && config.source.kind !== "photo") {
    throw new Error(`Unsupported composition source: ${String(config.source.kind)}.`);
  }
  if (config.source.kind === "procedural") {
    if (config.source.photo !== undefined) {
      throw new Error("A procedural composition cannot include photo settings.");
    }
  } else {
    const photo = config.source.photo;
    if (!photo) throw new Error("A photo composition requires photo settings.");
    if (!/^[0-9a-f]{64}$/.test(photo.assetSha256)) {
      throw new Error("source.photo.assetSha256 must be a lowercase SHA-256 digest.");
    }
    for (const [name, value] of [
      ["source.photo.canonicalWidth", photo.canonicalWidth],
      ["source.photo.canonicalHeight", photo.canonicalHeight],
    ] as const) {
      if (!Number.isInteger(value) || value < 1 || value > MAX_CANONICAL_PHOTO_EDGE) {
        throw new Error(`${name} must be an integer from 1 through ${MAX_CANONICAL_PHOTO_EDGE}.`);
      }
    }
    if (!PHOTO_TONE_MODES.has(photo.toneMode)) {
      throw new Error(`Unsupported photo tone mode: ${String(photo.toneMode)}.`);
    }
    if (!PHOTO_DIRECTION_MODES.has(photo.directionMode)) {
      throw new Error(`Unsupported photo direction mode: ${String(photo.directionMode)}.`);
    }
    if (!PHOTO_COLOR_MODES.has(photo.colorMode)) {
      throw new Error(`Unsupported photo color mode: ${String(photo.colorMode)}.`);
    }
    for (const [name, value] of [
      ["source.photo.toneContrast", photo.toneContrast],
      ["source.photo.geometryStrength", photo.geometryStrength],
      ["source.photo.directionStrength", photo.directionStrength],
      ["source.photo.colorStrength", photo.colorStrength],
    ] as const) {
      finite(name, value);
      if (value < 0 || value > 1) throw new Error(`${name} must be between 0 and 1.`);
    }
    if (
      !Number.isInteger(photo.requestedColorCount) ||
      photo.requestedColorCount < MIN_PHOTO_COLORS ||
      photo.requestedColorCount > MAX_PHOTO_COLORS
    ) {
      throw new Error(
        `source.photo.requestedColorCount must be an integer from ${MIN_PHOTO_COLORS} through ${MAX_PHOTO_COLORS}.`,
      );
    }
    if (config.palette.colors.length > MAX_PHOTO_COLORS) {
      throw new Error(`Photo compositions cannot use more than ${MAX_PHOTO_COLORS} colors.`);
    }
    if (config.palette.colors.length < 1) {
      throw new Error("Photo compositions require at least one palette color.");
    }
    if (!config.palette.colors.every((color) => /^#[0-9a-f]{6}$/i.test(color))) {
      throw new Error("Photo compositions require six-digit HEX palette colors.");
    }
  }
  if (!DESIGN_FAMILIES.has(config.design.family)) {
    throw new Error(`Unsupported design family: ${String(config.design.family)}.`);
  }
  if (!SILHOUETTES.has(config.design.silhouette)) {
    throw new Error(`Unsupported silhouette: ${String(config.design.silhouette)}.`);
  }
  if (!PATTERN_KINDS.has(config.pattern.kind)) {
    throw new Error(`Unsupported pattern kind: ${String(config.pattern.kind)}.`);
  }
  if (!TILE_SHAPES.has(config.tile.shape)) {
    throw new Error(`Unsupported tile shape: ${String(config.tile.shape)}.`);
  }
  if (!COLOR_MODES.has(config.palette.mode)) {
    throw new Error(`Unsupported color mode: ${String(config.palette.mode)}.`);
  }

  if (!Number.isInteger(config.grid.columns) || config.grid.columns < 1) {
    throw new Error("grid.columns must be a positive integer.");
  }
  if (config.grid.columns > MAX_GRID_COLUMNS) {
    throw new Error(`grid.columns cannot exceed ${MAX_GRID_COLUMNS}.`);
  }
  if (!Number.isInteger(config.grid.rows) || config.grid.rows < 1) {
    throw new Error("grid.rows must be a positive integer.");
  }
  if (config.grid.rows > MAX_GRID_ROWS) {
    throw new Error(`grid.rows cannot exceed ${MAX_GRID_ROWS}.`);
  }
  if (config.finishedSize.widthMm !== undefined) {
    positive("finishedSize.widthMm", config.finishedSize.widthMm);
    if (config.finishedSize.widthMm > MAX_FINISHED_DIMENSION_MM) {
      throw new Error(
        `finishedSize.widthMm cannot exceed ${MAX_FINISHED_DIMENSION_MM} mm.`,
      );
    }
  }
  if (config.finishedSize.heightMm !== undefined) {
    positive("finishedSize.heightMm", config.finishedSize.heightMm);
    if (config.finishedSize.heightMm > MAX_FINISHED_DIMENSION_MM) {
      throw new Error(
        `finishedSize.heightMm cannot exceed ${MAX_FINISHED_DIMENSION_MM} mm.`,
      );
    }
  }
  if (typeof config.finishedSize.lockAspect !== "boolean") {
    throw new Error("finishedSize.lockAspect must be a boolean.");
  }
  positive("grid.tileSizeMm", config.grid.tileSizeMm);
  atMost("grid.tileSizeMm", config.grid.tileSizeMm, MAX_PHYSICAL_PARAMETER_MM);
  nonNegative("grid.gapMm", config.grid.gapMm);
  atMost("grid.gapMm", config.grid.gapMm, MAX_PHYSICAL_PARAMETER_MM);

  finite("design.variation", config.design.variation);
  if (config.design.variation < 0 || config.design.variation > 1) {
    throw new Error("design.variation must be between 0 and 1.");
  }
  if (!Number.isInteger(config.design.symmetry) || config.design.symmetry < 1 || config.design.symmetry > 24) {
    throw new Error("design.symmetry must be an integer from 1 through 24.");
  }
  if (!Number.isInteger(config.design.surfaceResolution) || config.design.surfaceResolution < 3 || config.design.surfaceResolution > 32) {
    throw new Error("design.surfaceResolution must be an integer from 3 through 32.");
  }

  positive("tile.baseHeightMm", config.tile.baseHeightMm);
  atMost("tile.baseHeightMm", config.tile.baseHeightMm, MAX_PHYSICAL_PARAMETER_MM);
  nonNegative("tile.reliefHeightMm", config.tile.reliefHeightMm);
  atMost("tile.reliefHeightMm", config.tile.reliefHeightMm, MAX_PHYSICAL_PARAMETER_MM);
  positive("tile.topScale", config.tile.topScale);
  if (config.tile.topScale > 1) throw new Error("tile.topScale cannot exceed 1.");
  nonNegative("tile.leanRatio", config.tile.leanRatio);
  atMost("tile.leanRatio", config.tile.leanRatio, MAX_SCALAR_MAGNITUDE);
  finite("tile.twistDeg", config.tile.twistDeg);
  magnitudeAtMost("tile.twistDeg", config.tile.twistDeg, MAX_ANGLE_MAGNITUDE_DEG);

  validateDepthProfileConfig(config.depthProfile);
  validateRegionalDepthMasks(config.localDepth.masks);
  if (config.localDepth.paint !== undefined) {
    if (typeof config.localDepth.paint.enabled !== "boolean") {
      throw new Error("localDepth.paint.enabled must be a boolean.");
    }
    validateDepthPaintFieldDescriptor(config.localDepth.paint.descriptor);
  }

  nonNegative("pattern.frequency", config.pattern.frequency);
  atMost("pattern.frequency", config.pattern.frequency, MAX_SCALAR_MAGNITUDE);
  positive("pattern.amplitude", config.pattern.amplitude);
  atMost("pattern.amplitude", config.pattern.amplitude, MAX_SCALAR_MAGNITUDE);
  finite("pattern.angleDeg", config.pattern.angleDeg);
  magnitudeAtMost("pattern.angleDeg", config.pattern.angleDeg, MAX_ANGLE_MAGNITUDE_DEG);
  finite("pattern.phaseDeg", config.pattern.phaseDeg);
  magnitudeAtMost("pattern.phaseDeg", config.pattern.phaseDeg, MAX_ANGLE_MAGNITUDE_DEG);
  finite("pattern.centerX", config.pattern.centerX);
  magnitudeAtMost("pattern.centerX", config.pattern.centerX, MAX_SCALAR_MAGNITUDE);
  finite("pattern.centerY", config.pattern.centerY);
  magnitudeAtMost("pattern.centerY", config.pattern.centerY, MAX_SCALAR_MAGNITUDE);
  if (!Number.isSafeInteger(config.pattern.arms) || config.pattern.arms < 1) {
    throw new Error("pattern.arms must be a positive safe integer.");
  }
  atMost("pattern.arms", config.pattern.arms, MAX_SCALAR_MAGNITUDE);
  positive("pattern.noiseScale", config.pattern.noiseScale);
  atMost("pattern.noiseScale", config.pattern.noiseScale, MAX_SCALAR_MAGNITUDE);
  if (!Number.isInteger(config.pattern.octaves) || config.pattern.octaves < 1 || config.pattern.octaves > 8) {
    throw new Error("pattern.octaves must be an integer from 1 through 8.");
  }
  positive("pattern.lacunarity", config.pattern.lacunarity);
  atMost("pattern.lacunarity", config.pattern.lacunarity, MAX_SCALAR_MAGNITUDE);
  positive("pattern.gain", config.pattern.gain);
  if (config.pattern.gain > 1) throw new Error("pattern.gain cannot exceed 1.");

  positive("guides.influenceRadius", config.guides.influenceRadius);
  if (config.guides.influenceRadius > 2) {
    throw new Error("guides.influenceRadius cannot exceed 2 normalized art units.");
  }
  finite("guides.centerPull", config.guides.centerPull);
  if (config.guides.centerPull < 0 || config.guides.centerPull > 1) {
    throw new Error("guides.centerPull must be between 0 and 1.");
  }
  finite("guides.followStrength", config.guides.followStrength);
  if (config.guides.followStrength < 0 || config.guides.followStrength > 1) {
    throw new Error("guides.followStrength must be between 0 and 1.");
  }
  finite("guides.heightDeltaMm", config.guides.heightDeltaMm);
  if (Math.abs(config.guides.heightDeltaMm) > 200) {
    throw new Error("guides.heightDeltaMm must stay between -200 and 200 mm.");
  }
  if (config.guides.lines.length > 32) {
    throw new Error("A project can contain at most 32 guide lines.");
  }
  const guideIds = new Set<string>();
  let totalGuideSegments = 0;
  for (const [lineIndex, line] of config.guides.lines.entries()) {
    if (!line.id.trim()) throw new Error(`guides.lines[${lineIndex}].id cannot be empty.`);
    if (guideIds.has(line.id)) throw new Error(`Duplicate guide line id: ${line.id}.`);
    guideIds.add(line.id);
    if (line.name !== undefined && (!line.name.trim() || line.name.length > 80)) {
      throw new Error(`guides.lines[${lineIndex}].name must be 1 through 80 characters.`);
    }
    if (
      line.interpolation !== undefined &&
      !GUIDE_INTERPOLATIONS.has(line.interpolation)
    ) {
      throw new Error(`Guide line ${line.id} has an unsupported interpolation mode.`);
    }
    if (
      line.templateKind !== undefined &&
      !GUIDE_TEMPLATE_KINDS.has(line.templateKind)
    ) {
      throw new Error(`Guide line ${line.id} has an unsupported template kind.`);
    }
    if (line.effects !== undefined) {
      validateGuideEffectOverrides(
        `guides.lines[${lineIndex}].effects`,
        line.effects,
      );
    }
    const minimumPoints = line.closed ? 3 : 2;
    if (line.points.length < minimumPoints) {
      throw new Error(`Guide line ${line.id} needs at least ${minimumPoints} points.`);
    }
    if (line.points.length > 2048) {
      throw new Error(`Guide line ${line.id} exceeds the 2048-point limit.`);
    }
    totalGuideSegments += line.closed ? line.points.length : line.points.length - 1;
    if (totalGuideSegments > MAX_TOTAL_GUIDE_SEGMENTS) {
      throw new Error(
        `Guide lines contain ${totalGuideSegments} segments; the project limit is ${MAX_TOTAL_GUIDE_SEGMENTS}. Simplify or remove guide lines.`,
      );
    }
    for (const [pointIndex, point] of line.points.entries()) {
      finite(`guides.lines[${lineIndex}].points[${pointIndex}].x`, point.x);
      finite(`guides.lines[${lineIndex}].points[${pointIndex}].y`, point.y);
      if (Math.abs(point.x) > 1 || Math.abs(point.y) > 1) {
        throw new Error(`Guide line ${line.id} contains a point outside the normalized art.`);
      }
    }
    const segmentCount = line.closed ? line.points.length : line.points.length - 1;
    const hasUsableSegment = Array.from({ length: segmentCount }, (_, segmentIndex) => {
      const start = line.points[segmentIndex];
      const end = line.points[(segmentIndex + 1) % line.points.length];
      return Math.hypot(end.x - start.x, end.y - start.y) > 1e-9;
    }).some(Boolean);
    if (!hasUsableSegment) {
      throw new Error(`Guide line ${line.id} contains no usable segment.`);
    }
    const controlPoints = line.controlPoints;
    if (controlPoints !== undefined) {
      if (controlPoints.length < minimumPoints) {
        throw new Error(
          `Guide line ${line.id} needs at least ${minimumPoints} editable control points.`,
        );
      }
      if (controlPoints.length > 128) {
        throw new Error(`Guide line ${line.id} exceeds the 128-control-point limit.`);
      }
      for (const [pointIndex, point] of controlPoints.entries()) {
        finite(`guides.lines[${lineIndex}].controlPoints[${pointIndex}].x`, point.x);
        finite(`guides.lines[${lineIndex}].controlPoints[${pointIndex}].y`, point.y);
        if (Math.abs(point.x) > 1 || Math.abs(point.y) > 1) {
          throw new Error(
            `Guide line ${line.id} contains an editable point outside the normalized art.`,
          );
        }
      }
    }
  }

  if (config.palette.colors.length === 0) throw new Error("palette.colors cannot be empty.");
  if (config.palette.colors.length > MAX_PALETTE_COLORS) {
    throw new Error(`palette.colors cannot contain more than ${MAX_PALETTE_COLORS} colors.`);
  }
  if (!config.palette.colors.every((color) => typeof color === "string" && color.trim().length > 0 && color.length <= 128)) {
    throw new Error("Every palette color must be a non-empty string.");
  }
  if (!Number.isInteger(config.palette.offset)) throw new Error("palette.offset must be an integer.");
  if (typeof config.palette.reverse !== "boolean") throw new Error("palette.reverse must be a boolean.");

  positive("printer.bedWidthMm", config.printer.bedWidthMm);
  atMost("printer.bedWidthMm", config.printer.bedWidthMm, MAX_PHYSICAL_PARAMETER_MM);
  positive("printer.bedDepthMm", config.printer.bedDepthMm);
  atMost("printer.bedDepthMm", config.printer.bedDepthMm, MAX_PHYSICAL_PARAMETER_MM);
  nonNegative("printer.marginMm", config.printer.marginMm);
  atMost("printer.marginMm", config.printer.marginMm, MAX_PHYSICAL_PARAMETER_MM);
  nonNegative("printer.spacingMm", config.printer.spacingMm);
  atMost("printer.spacingMm", config.printer.spacingMm, MAX_PHYSICAL_PARAMETER_MM);
  if (typeof config.printer.allowRotate90 !== "boolean") {
    throw new Error("printer.allowRotate90 must be a boolean.");
  }
  if (typeof config.printer.separateColors !== "boolean") {
    throw new Error("printer.separateColors must be a boolean.");
  }
  if (config.printer.marginMm * 2 >= config.printer.bedWidthMm) {
    throw new Error("printer.marginMm leaves no usable bed width.");
  }
  if (config.printer.marginMm * 2 >= config.printer.bedDepthMm) {
    throw new Error("printer.marginMm leaves no usable bed depth.");
  }
}

/** Merge a partial configuration with safe defaults and validate the result. */
export function createWallArtConfig(
  overrides: WallArtConfigInput = {},
): WallArtConfig {
  const inputSchemaVersion = overrides.schemaVersion ?? 3;
  if (
    inputSchemaVersion !== 1 &&
    inputSchemaVersion !== 2 &&
    inputSchemaVersion !== 3
  ) {
    throw new Error("Only project schemaVersion 1, 2, or 3 can be loaded.");
  }
  const requestedSource = inputSchemaVersion === 1
    ? { kind: "procedural" as const }
    : overrides.source;
  if (inputSchemaVersion >= 2 && overrides.source !== undefined) {
    const rawSource = overrides.source as { kind?: unknown; photo?: unknown } | null;
    if (!rawSource || (rawSource.kind !== "procedural" && rawSource.kind !== "photo")) {
      throw new Error(`Unsupported composition source: ${String(rawSource?.kind)}.`);
    }
    if (rawSource.kind === "procedural" && rawSource.photo !== undefined) {
      throw new Error("A procedural composition cannot include photo settings.");
    }
  }
  const source = requestedSource?.kind === "photo"
    ? {
        kind: "photo" as const,
        photo: {
          assetSha256: requestedSource.photo?.assetSha256 ?? DEFAULT_PHOTO_COMPOSITION_CONFIG.assetSha256,
          canonicalWidth: requestedSource.photo?.canonicalWidth ?? DEFAULT_PHOTO_COMPOSITION_CONFIG.canonicalWidth,
          canonicalHeight: requestedSource.photo?.canonicalHeight ?? DEFAULT_PHOTO_COMPOSITION_CONFIG.canonicalHeight,
          toneMode: requestedSource.photo?.toneMode ?? DEFAULT_PHOTO_COMPOSITION_CONFIG.toneMode,
          toneContrast: requestedSource.photo?.toneContrast ?? DEFAULT_PHOTO_COMPOSITION_CONFIG.toneContrast,
          geometryStrength: requestedSource.photo?.geometryStrength ?? DEFAULT_PHOTO_COMPOSITION_CONFIG.geometryStrength,
          directionMode: requestedSource.photo?.directionMode ?? DEFAULT_PHOTO_COMPOSITION_CONFIG.directionMode,
          directionStrength: requestedSource.photo?.directionStrength ?? DEFAULT_PHOTO_COMPOSITION_CONFIG.directionStrength,
          colorMode: requestedSource.photo?.colorMode ?? DEFAULT_PHOTO_COMPOSITION_CONFIG.colorMode,
          colorStrength: requestedSource.photo?.colorStrength ?? DEFAULT_PHOTO_COMPOSITION_CONFIG.colorStrength,
          requestedColorCount: requestedSource.photo?.requestedColorCount ?? DEFAULT_PHOTO_COMPOSITION_CONFIG.requestedColorCount,
        },
      }
    : { kind: "procedural" as const };
  const requestedLocalDepth = inputSchemaVersion === 3
    ? overrides.localDepth
    : undefined;
  if (inputSchemaVersion === 3 && overrides.localDepth !== undefined) {
    const rawLocalDepth = overrides.localDepth as unknown;
    if (
      !rawLocalDepth ||
      typeof rawLocalDepth !== "object" ||
      Array.isArray(rawLocalDepth)
    ) {
      throw new Error("localDepth must be an object.");
    }
    const rawRecord = rawLocalDepth as Record<string, unknown>;
    if (rawRecord.masks !== undefined && !Array.isArray(rawRecord.masks)) {
      throw new Error("localDepth.masks must be an array.");
    }
    if (
      rawRecord.paint !== undefined &&
      (!rawRecord.paint ||
        typeof rawRecord.paint !== "object" ||
        Array.isArray(rawRecord.paint))
    ) {
      throw new Error("localDepth.paint must be an object when retained.");
    }
  }
  const requestedPaint = requestedLocalDepth?.paint;
  if (requestedPaint && !requestedPaint.descriptor) {
    throw new Error("localDepth.paint.descriptor is required when paint is retained.");
  }
  const localDepth = {
    masks: requestedLocalDepth?.masks
      ? requestedLocalDepth.masks.map((mask) => ({
          id: mask.id,
          name: mask.name,
          enabled: mask.enabled,
          kind: mask.kind,
          strengthMm: mask.strengthMm,
          center: { ...mask.center },
          size: { ...mask.size },
          angleDeg: mask.angleDeg,
          feather: mask.feather,
        }))
      : [],
    ...(requestedPaint?.descriptor
      ? {
          paint: {
            enabled: requestedPaint.enabled ?? true,
            descriptor: {
              version:
                requestedPaint.descriptor.version ?? DEPTH_PAINT_FIELD_VERSION,
              assetSha256: requestedPaint.descriptor.assetSha256 ?? "",
              canonicalWidth: requestedPaint.descriptor.canonicalWidth ?? 0,
              canonicalHeight: requestedPaint.descriptor.canonicalHeight ?? 0,
              unitsPerMm:
                requestedPaint.descriptor.unitsPerMm ?? DEPTH_PAINT_UNITS_PER_MM,
            },
          },
        }
      : {}),
  };
  const config: WallArtConfig = {
    ...DEFAULT_WALL_ART_CONFIG,
    schemaVersion: 3,
    seed: overrides.seed ?? DEFAULT_WALL_ART_CONFIG.seed,
    source,
    finishedSize: {
      ...DEFAULT_WALL_ART_CONFIG.finishedSize,
      ...overrides.finishedSize,
    },
    design: { ...DEFAULT_WALL_ART_CONFIG.design, ...overrides.design },
    grid: { ...DEFAULT_WALL_ART_CONFIG.grid, ...overrides.grid },
    tile: { ...DEFAULT_WALL_ART_CONFIG.tile, ...overrides.tile },
    depthProfile: {
      ...DEFAULT_WALL_ART_CONFIG.depthProfile,
      ...(inputSchemaVersion === 3 ? overrides.depthProfile : undefined),
    },
    localDepth,
    pattern: { ...DEFAULT_WALL_ART_CONFIG.pattern, ...overrides.pattern },
    guides: {
      ...DEFAULT_WALL_ART_CONFIG.guides,
      ...overrides.guides,
      lines: overrides.guides?.lines
        ? overrides.guides.lines.map((line) => ({
            ...line,
            points: line.points.map((point) => ({ ...point })),
            controlPoints: line.controlPoints?.map((point) => ({ ...point })),
            effects: line.effects ? { ...line.effects } : undefined,
          }))
        : [],
    },
    palette: {
      ...DEFAULT_WALL_ART_CONFIG.palette,
      ...overrides.palette,
      colors: overrides.palette?.colors
        ? [...overrides.palette.colors]
        : [...DEFAULT_WALL_ART_CONFIG.palette.colors],
    },
    printer: { ...DEFAULT_WALL_ART_CONFIG.printer, ...overrides.printer },
  };
  validateWallArtConfig(config);
  return config;
}
