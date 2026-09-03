import {
  MAX_PRINTER_BED_DIMENSION_MM,
  MAX_PRINTER_MARGIN_MM,
  MAX_PRINTER_SPACING_MM,
  MIN_PRINTER_BED_DIMENSION_MM,
  MIN_PRINTER_MARGIN_MM,
  MIN_PRINTER_SPACING_MM,
} from "../control-boundaries";
import {
  createWallArtConfig,
  DEFAULT_WALL_ART_CONFIG,
} from "../core/config";
import { generateWallArt } from "../core/generate";
import { OversizedTileError, packWallArt } from "../core/packing";
import type {
  GenerationAssets,
  PackingResult,
  PrinterConfig,
  WallArtConfig,
  WallArtProject,
} from "../core/types";

export const INCH_TO_MM = 25.4;
export const TOPOGRAPHIC_TERRACES_PRESET = "topographic-terraces" as const;
export const TOPOGRAPHIC_MOSAIC_PRESET = "topographic-mosaic" as const;
export const POLAR_BLOOM_PRESET = "polar-bloom" as const;
export const POLAR_BLOOM_PALETTE = [
  "#30251f",
  "#8f4f3b",
  "#b8613f",
  "#d9c7aa",
  "#f3eadc",
] as const;
export const MIN_OBJECT_DEPTH_MM = 3;
export const MAX_OBJECT_DEPTH_MM = 80;
export const DEFAULT_WALL_ART_HEIGHT_MM = 609.6;
export const DEFAULT_WALL_ART_WIDTH_MM = 914.4;
export const DEFAULT_TOPOGRAPHIC_SEED = "webmcp-demo-001";

type PlainRecord = Record<string, unknown>;

export type WallArtLengthUnit = "mm" | "in";
export type TopographicPreset =
  | typeof TOPOGRAPHIC_TERRACES_PRESET
  | typeof TOPOGRAPHIC_MOSAIC_PRESET;

export type WallArtPreset = TopographicPreset | typeof POLAR_BLOOM_PRESET;

export interface CreateWallArtActionInput {
  preset: WallArtPreset;
  width: number;
  height?: number;
  unit: WallArtLengthUnit;
  depthMm: number;
  seed?: string;
}

export interface SetPrinterBedActionInput {
  bedWidthMm: number;
  bedDepthMm: number;
  marginMm?: number;
  spacingMm?: number;
  allowRotate90?: boolean;
  separateColors?: boolean;
}

export interface PackingFailure {
  code: "part_exceeds_usable_bed" | "packing_failed";
  message: string;
  tileId?: string;
  requiredWidthMm?: number;
  requiredDepthMm?: number;
  usableWidthMm: number;
  usableDepthMm: number;
}

export interface FabricationPlanSummary {
  projectId: string;
  preset: WallArtPreset | "custom";
  finishedSizeMm: {
    width: number;
    height: number;
  };
  objectDepthMm: {
    configuredRange: {
      minimum: number;
      maximum: number;
      levelCount: number;
    };
    actualPartThicknessRange: {
      minimum: number;
      maximum: number;
    };
    observedPositiveSurfaceLevels: {
      minimum: number;
      maximum: number;
      distinctCount: number;
    };
  };
  partCount: number;
  printerBedMm: {
    width: number;
    depth: number;
    margin: number;
    spacing: number;
    usableWidth: number;
    usableDepth: number;
    allowRotate90: boolean;
    separateColors: boolean;
  };
  digitalFit: {
    status: "fits" | "needs_attention";
    placedPartCount: number;
    plateCount: number;
    everyPartPlaced: boolean;
    allPartsClosedManifold: boolean;
    fullMeshClosedManifold: boolean;
    fullMeshOutwardWinding: boolean;
  };
  warning: string;
}

export interface WallArtActionResult {
  config: WallArtConfig;
  project: WallArtProject;
  packing?: PackingResult;
  packingError?: PackingFailure;
  summary: FabricationPlanSummary;
}

export interface PreparedPackageDetails {
  fileName: string;
  byteLength: number;
  saveLinkReady: boolean;
}

export interface PreparedFabricationPackageResult {
  projectId: string;
  status: "ready_to_save" | "build_incomplete";
  fileName: string;
  byteLength: number;
  saveLinkReady: boolean;
  summary: FabricationPlanSummary;
  nextStep: string;
}

const DIGITAL_VALIDATION_WARNING =
  "Digital geometry and bed-fit checks only. Verify the exported files in the intended slicer and printer profile before printing.";

function assertPlainRecord(name: string, value: unknown): asserts value is PlainRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
}

function assertKnownKeys(
  name: string,
  value: PlainRecord,
  allowed: readonly string[],
): void {
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unknown.length > 0) {
    throw new Error(`${name} contains unsupported field${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}.`);
  }
}

function requiredFiniteNumber(
  input: PlainRecord,
  field: string,
  minimum?: number,
  maximum?: number,
): number {
  const value = input[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number.`);
  }
  if (minimum !== undefined && value < minimum) {
    throw new Error(`${field} must be at least ${minimum}.`);
  }
  if (maximum !== undefined && value > maximum) {
    throw new Error(`${field} cannot exceed ${maximum}.`);
  }
  return value;
}

function optionalFiniteNumber(
  input: PlainRecord,
  field: string,
  minimum?: number,
  maximum?: number,
): number | undefined {
  if (!(field in input) || input[field] === undefined) return undefined;
  return requiredFiniteNumber(input, field, minimum, maximum);
}

function optionalBoolean(input: PlainRecord, field: string): boolean | undefined {
  if (!(field in input) || input[field] === undefined) return undefined;
  const value = input[field];
  if (typeof value !== "boolean") throw new Error(`${field} must be a boolean.`);
  return value;
}

function optionalSeed(input: PlainRecord): string | undefined {
  if (!("seed" in input) || input.seed === undefined) return undefined;
  if (typeof input.seed === "string" && input.seed.length > 0 && input.seed.length <= 128) {
    return input.seed;
  }
  throw new Error("seed must be a non-empty string of at most 128 characters.");
}

function parseCreateWallArtInput(input: unknown): CreateWallArtActionInput {
  assertPlainRecord("create wall art input", input);
  assertKnownKeys("create wall art input", input, [
    "preset",
    "width",
    "height",
    "unit",
    "depthMm",
    "seed",
  ]);

  if (
    input.preset !== TOPOGRAPHIC_TERRACES_PRESET &&
    input.preset !== TOPOGRAPHIC_MOSAIC_PRESET &&
    input.preset !== POLAR_BLOOM_PRESET
  ) {
    throw new Error(
      `preset must be ${TOPOGRAPHIC_TERRACES_PRESET}, ${TOPOGRAPHIC_MOSAIC_PRESET}, or ${POLAR_BLOOM_PRESET}.`,
    );
  }
  if (input.unit !== "mm" && input.unit !== "in") {
    throw new Error('unit must be either "mm" or "in".');
  }

  return {
    preset: input.preset,
    width: requiredFiniteNumber(input, "width", Number.MIN_VALUE),
    height: optionalFiniteNumber(input, "height", Number.MIN_VALUE),
    unit: input.unit,
    depthMm: requiredFiniteNumber(
      input,
      "depthMm",
      MIN_OBJECT_DEPTH_MM,
      MAX_OBJECT_DEPTH_MM,
    ),
    seed: optionalSeed(input),
  };
}

function parsePrinterBedInput(input: unknown): SetPrinterBedActionInput {
  assertPlainRecord("printer bed input", input);
  assertKnownKeys("printer bed input", input, [
    "bedWidthMm",
    "bedDepthMm",
    "marginMm",
    "spacingMm",
    "allowRotate90",
    "separateColors",
  ]);
  return {
    bedWidthMm: requiredFiniteNumber(
      input,
      "bedWidthMm",
      MIN_PRINTER_BED_DIMENSION_MM,
      MAX_PRINTER_BED_DIMENSION_MM,
    ),
    bedDepthMm: requiredFiniteNumber(
      input,
      "bedDepthMm",
      MIN_PRINTER_BED_DIMENSION_MM,
      MAX_PRINTER_BED_DIMENSION_MM,
    ),
    marginMm: optionalFiniteNumber(
      input,
      "marginMm",
      MIN_PRINTER_MARGIN_MM,
      MAX_PRINTER_MARGIN_MM,
    ),
    spacingMm: optionalFiniteNumber(
      input,
      "spacingMm",
      MIN_PRINTER_SPACING_MM,
      MAX_PRINTER_SPACING_MM,
    ),
    allowRotate90: optionalBoolean(input, "allowRotate90"),
    separateColors: optionalBoolean(input, "separateColors"),
  };
}

function toMillimetres(value: number, unit: WallArtLengthUnit): number {
  if (unit === "mm") return value;
  // Preserve the exact decimal conversion without exposing binary floating
  // point artifacts such as 24 in becoming 609.5999999999999 mm.
  return Math.round(value * INCH_TO_MM * 1_000_000_000) / 1_000_000_000;
}

function packProject(project: WallArtProject): {
  packing?: PackingResult;
  packingError?: PackingFailure;
} {
  const printer = project.config.printer;
  const usableWidthMm = printer.bedWidthMm - printer.marginMm * 2;
  const usableDepthMm = printer.bedDepthMm - printer.marginMm * 2;
  try {
    return { packing: packWallArt(project, printer) };
  } catch (error) {
    if (error instanceof OversizedTileError) {
      return {
        packingError: {
          code: "part_exceeds_usable_bed",
          message: error.message,
          tileId: error.tileId,
          requiredWidthMm: error.requiredWidthMm,
          requiredDepthMm: error.requiredDepthMm,
          usableWidthMm,
          usableDepthMm,
        },
      };
    }
    return {
      packingError: {
        code: "packing_failed",
        message: error instanceof Error ? error.message : "Unable to pack the generated parts.",
        usableWidthMm,
        usableDepthMm,
      },
    };
  }
}

function hasTopographicRecipe(config: WallArtConfig): boolean {
  return (
    config.source.kind === "procedural" &&
    config.design.family === "contour-relief" &&
    config.design.silhouette === "rectangle" &&
    config.design.variation === 0.42 &&
    config.design.symmetry === 8 &&
    config.design.surfaceResolution === 20 &&
    config.grid.tileSizeMm === 150 &&
    config.grid.gapMm === 2 &&
    config.tile.shape === "terraced-panel" &&
    config.tile.topScale === 0.38 &&
    config.tile.leanRatio === 0 &&
    config.tile.twistDeg === 0 &&
    config.pattern.kind === "noise" &&
    config.pattern.frequency === 1 &&
    config.pattern.amplitude === 1 &&
    config.pattern.angleDeg === 0 &&
    config.pattern.phaseDeg === 0 &&
    config.pattern.centerX === 0 &&
    config.pattern.centerY === 0 &&
    config.pattern.arms === 3 &&
    config.pattern.noiseScale === 1.42 &&
    config.pattern.octaves === 4 &&
    config.pattern.lacunarity === 2 &&
    config.pattern.gain === 0.5 &&
    config.depthProfile.invert === false &&
    config.depthProfile.contrast === 1.2 &&
    config.depthProfile.curve === -0.08 &&
    config.depthProfile.levels === 8 &&
    config.localDepth.masks.length === 0 &&
    !config.localDepth.paint &&
    config.guides.lines.length === 0
  );
}

function hasPolarBloomRecipe(config: WallArtConfig): boolean {
  return (
    config.source.kind === "procedural" &&
    config.design.family === "polar-bloom" &&
    config.design.silhouette === "ellipse" &&
    config.design.variation === 0.45 &&
    config.design.symmetry === 16 &&
    config.design.surfaceResolution === 12 &&
    config.grid.columns === 10 &&
    config.grid.rows === 10 &&
    config.grid.tileSizeMm === 32 &&
    config.grid.gapMm === 2.4 &&
    config.tile.shape === "polar-petal" &&
    config.tile.baseHeightMm === DEFAULT_WALL_ART_CONFIG.tile.baseHeightMm &&
    config.tile.reliefHeightMm >= MIN_OBJECT_DEPTH_MM - config.tile.baseHeightMm &&
    config.tile.reliefHeightMm <= MAX_OBJECT_DEPTH_MM - config.tile.baseHeightMm &&
    config.tile.topScale === 0.38 &&
    config.tile.leanRatio === 0.18 &&
    config.tile.twistDeg === 28 &&
    config.pattern.kind === "ripple" &&
    config.pattern.frequency === 1.2 &&
    config.pattern.amplitude === 1 &&
    config.pattern.angleDeg === 32 &&
    config.pattern.phaseDeg === 0 &&
    config.pattern.centerX === 0 &&
    config.pattern.centerY === 0 &&
    config.pattern.arms === 3 &&
    config.pattern.noiseScale === 1.8 &&
    config.pattern.octaves === 4 &&
    config.pattern.lacunarity === 2 &&
    config.pattern.gain === 0.5 &&
    config.depthProfile.invert === false &&
    config.depthProfile.contrast === 1 &&
    config.depthProfile.curve === 0 &&
    config.depthProfile.levels === 0 &&
    config.localDepth.masks.length === 0 &&
    !config.localDepth.paint &&
    config.guides.lines.length === 0
  );
}

function identifyWallArtPreset(config: WallArtConfig): WallArtPreset | "custom" {
  if (hasTopographicRecipe(config)) {
    if (config.grid.columns === 4 && config.grid.rows === 3) {
      return TOPOGRAPHIC_TERRACES_PRESET;
    }
    if (config.grid.columns === 12 && config.grid.rows === 8) {
      return TOPOGRAPHIC_MOSAIC_PRESET;
    }
  }
  if (hasPolarBloomRecipe(config)) return POLAR_BLOOM_PRESET;
  return "custom";
}

export function summarizeFabricationPlan(
  project: WallArtProject,
  packing?: PackingResult,
  packingError?: PackingFailure,
): FabricationPlanSummary {
  if (packing && packing.projectId !== project.id) {
    throw new Error(`Packing result belongs to ${packing.projectId}, not ${project.id}.`);
  }
  if (packing && packingError) {
    throw new Error("A fabrication plan cannot contain both packing and a packing error.");
  }
  const printer = project.config.printer;
  const everyPartPlaced =
    packing !== undefined && packing.placementCount === project.tiles.length;
  const fits = everyPartPlaced && packingError === undefined;
  const actualPartThicknesses = project.tiles.map((tile) => tile.heightMm);
  const positiveSurfaceHeights = project.tiles.flatMap((tile) =>
    tile.mesh.vertices.map((vertex) => vertex.z).filter((z) => z > 1e-9),
  );

  return {
    projectId: project.id,
    preset: identifyWallArtPreset(project.config),
    finishedSizeMm: {
      width: project.widthMm,
      height: project.depthMm,
    },
    objectDepthMm: {
      configuredRange: {
        minimum: project.config.tile.baseHeightMm,
        maximum: project.config.tile.baseHeightMm + project.config.tile.reliefHeightMm,
        levelCount: project.config.depthProfile.levels,
      },
      actualPartThicknessRange: {
        minimum: Math.min(...actualPartThicknesses),
        maximum: Math.max(...actualPartThicknesses),
      },
      observedPositiveSurfaceLevels: {
        minimum: Math.min(...positiveSurfaceHeights),
        maximum: Math.max(...positiveSurfaceHeights),
        distinctCount: new Set(
          positiveSurfaceHeights.map((depth) => depth.toFixed(9)),
        ).size,
      },
    },
    partCount: project.tiles.length,
    printerBedMm: {
      width: printer.bedWidthMm,
      depth: printer.bedDepthMm,
      margin: printer.marginMm,
      spacing: printer.spacingMm,
      usableWidth: printer.bedWidthMm - printer.marginMm * 2,
      usableDepth: printer.bedDepthMm - printer.marginMm * 2,
      allowRotate90: printer.allowRotate90,
      separateColors: printer.separateColors,
    },
    digitalFit: {
      status: fits ? "fits" : "needs_attention",
      placedPartCount: packing?.placementCount ?? 0,
      plateCount: packing?.plates.length ?? 0,
      everyPartPlaced,
      allPartsClosedManifold: project.diagnostics.allTilesClosedManifold,
      fullMeshClosedManifold: project.diagnostics.fullMesh.closedManifold,
      fullMeshOutwardWinding: project.diagnostics.fullMesh.outwardWinding,
    },
    warning: packingError
      ? `${packingError.message} ${DIGITAL_VALIDATION_WARNING}`
      : DIGITAL_VALIDATION_WARNING,
  };
}

function buildActionResult(
  config: WallArtConfig,
  assets: GenerationAssets = {},
): WallArtActionResult {
  const project = generateWallArt(config, assets);
  const { packing, packingError } = packProject(project);
  return {
    config: project.config,
    project,
    packing,
    packingError,
    summary: summarizeFabricationPlan(project, packing, packingError),
  };
}

/**
 * Build one of the challenge's deterministic presets while retaining the exact
 * printer-bed settings. Topographic recipes retain the current palette; Polar
 * Bloom applies its curated showcase palette.
 */
export function createWallArtAction(
  input: unknown,
  currentConfig: WallArtConfig = createWallArtConfig(),
): WallArtActionResult {
  const parsed = parseCreateWallArtInput(input);
  const current = createWallArtConfig(currentConfig);
  const widthMm = toMillimetres(parsed.width, parsed.unit);
  const isPolarBloom = parsed.preset === POLAR_BLOOM_PRESET;
  const heightMm =
    parsed.height === undefined
      ? isPolarBloom
        ? widthMm
        : Math.round(
            widthMm * (DEFAULT_WALL_ART_HEIGHT_MM / DEFAULT_WALL_ART_WIDTH_MM) * 1_000_000_000,
          ) / 1_000_000_000
      : toMillimetres(parsed.height, parsed.unit);
  const baseHeightMm = Math.min(
    DEFAULT_WALL_ART_CONFIG.tile.baseHeightMm,
    parsed.depthMm,
  );
  const grid = isPolarBloom
    ? { columns: 10, rows: 10, tileSizeMm: 32, gapMm: 2.4 }
    : parsed.preset === TOPOGRAPHIC_MOSAIC_PRESET
      ? { columns: 12, rows: 8, tileSizeMm: 150, gapMm: 2 }
      : { columns: 4, rows: 3, tileSizeMm: 150, gapMm: 2 };

  const config = createWallArtConfig({
    seed: parsed.seed ?? DEFAULT_TOPOGRAPHIC_SEED,
    source: { kind: "procedural" },
    finishedSize: { widthMm, heightMm, lockAspect: false },
    design: isPolarBloom
      ? {
          family: "polar-bloom",
          silhouette: "ellipse",
          variation: 0.45,
          symmetry: 16,
          surfaceResolution: 12,
        }
      : {
          family: "contour-relief",
          silhouette: "rectangle",
          variation: 0.42,
          symmetry: 8,
          surfaceResolution: 20,
        },
    grid,
    tile: isPolarBloom
      ? {
          shape: "polar-petal",
          baseHeightMm,
          reliefHeightMm: parsed.depthMm - baseHeightMm,
          topScale: 0.38,
          leanRatio: 0.18,
          twistDeg: 28,
        }
      : {
          shape: "terraced-panel",
          baseHeightMm,
          reliefHeightMm: parsed.depthMm - baseHeightMm,
          topScale: 0.38,
          leanRatio: 0,
          twistDeg: 0,
        },
    depthProfile: isPolarBloom
      ? {
          invert: false,
          contrast: 1,
          curve: 0,
          levels: 0,
        }
      : {
          invert: false,
          contrast: 1.2,
          curve: -0.08,
          levels: 8,
        },
    localDepth: { masks: [] },
    pattern: {
      kind: isPolarBloom ? "ripple" : "noise",
      frequency: isPolarBloom ? 1.2 : 1,
      amplitude: 1,
      angleDeg: isPolarBloom ? 32 : 0,
      phaseDeg: 0,
      centerX: 0,
      centerY: 0,
      arms: 3,
      noiseScale: isPolarBloom ? 1.8 : 1.42,
      octaves: 4,
      lacunarity: 2,
      gain: 0.5,
    },
    guides: {
      ...DEFAULT_WALL_ART_CONFIG.guides,
      lines: [],
    },
    palette: isPolarBloom
      ? {
          colors: [...POLAR_BLOOM_PALETTE],
          mode: "field-bands",
          offset: 0,
          reverse: false,
        }
      : current.palette,
    printer: current.printer,
  });

  return buildActionResult(config);
}

/** Update exact bed dimensions; model names are deliberately not accepted. */
export function setPrinterBedAction(
  input: unknown,
  currentConfig: WallArtConfig,
  assets: GenerationAssets = {},
): WallArtActionResult {
  const parsed = parsePrinterBedInput(input);
  const current = createWallArtConfig(currentConfig);
  const printer: PrinterConfig = {
    ...current.printer,
    bedWidthMm: parsed.bedWidthMm,
    bedDepthMm: parsed.bedDepthMm,
    ...(parsed.marginMm === undefined ? {} : { marginMm: parsed.marginMm }),
    ...(parsed.spacingMm === undefined ? {} : { spacingMm: parsed.spacingMm }),
    ...(parsed.allowRotate90 === undefined
      ? {}
      : { allowRotate90: parsed.allowRotate90 }),
    ...(parsed.separateColors === undefined
      ? {}
      : { separateColors: parsed.separateColors }),
  };
  return buildActionResult(createWallArtConfig({ ...current, printer }), assets);
}

/** Recompute geometry and packing from the current normalized recipe. */
export function inspectFabricationPlanAction(
  currentConfig: WallArtConfig,
  assets: GenerationAssets = {},
): WallArtActionResult {
  return buildActionResult(createWallArtConfig(currentConfig), assets);
}

/** Defense in depth for hosts that do not enforce the empty JSON schema. */
export function assertEmptyToolInput(input: unknown): void {
  assertPlainRecord("tool input", input);
  assertKnownKeys("tool input", input, []);
}

/** Shape the result returned after App.tsx has asynchronously built the ZIP. */
export function shapeFabricationPackageResult(
  plan: Pick<WallArtActionResult, "project" | "packing" | "packingError">,
  details: unknown,
): PreparedFabricationPackageResult {
  if (!plan.packing || plan.packingError) {
    throw new Error("Resolve the printer packing warning before preparing the fabrication package.");
  }
  if (
    plan.project.tiles.length === 0 ||
    !plan.project.diagnostics.allTilesClosedManifold ||
    !plan.project.diagnostics.fullMesh.closedManifold ||
    !plan.project.diagnostics.fullMesh.outwardWinding
  ) {
    throw new Error("Resolve the digital geometry warning before preparing the fabrication package.");
  }
  if (plan.packing.placementCount !== plan.project.tiles.length) {
    throw new Error("Every part must be placed before preparing the fabrication package.");
  }
  assertPlainRecord("prepared package details", details);
  assertKnownKeys("prepared package details", details, [
    "fileName",
    "byteLength",
    "saveLinkReady",
  ]);
  if (typeof details.fileName !== "string" || !details.fileName.trim()) {
    throw new Error("fileName must be a non-empty string.");
  }
  if (details.fileName.length > 240 || /[\\/:*?"<>|\u0000-\u001f]/.test(details.fileName)) {
    throw new Error("fileName contains unsupported characters or is too long.");
  }
  const byteLength = requiredFiniteNumber(details, "byteLength", 0);
  if (!Number.isSafeInteger(byteLength)) {
    throw new Error("byteLength must be a non-negative safe integer.");
  }
  if (typeof details.saveLinkReady !== "boolean") {
    throw new Error("saveLinkReady must be a boolean.");
  }
  const ready = details.saveLinkReady && byteLength > 0;
  if (details.saveLinkReady && byteLength === 0) {
    throw new Error("saveLinkReady cannot be true when byteLength is zero.");
  }
  return {
    projectId: plan.project.id,
    status: ready ? "ready_to_save" : "build_incomplete",
    fileName: details.fileName,
    byteLength,
    saveLinkReady: ready,
    summary: summarizeFabricationPlan(plan.project, plan.packing),
    nextStep: ready
      ? "Use the visible Save file now link in Relief Forge to download the generated ZIP."
      : "Wait for Relief Forge to finish building the package and expose the visible Save file now link.",
  };
}

export const prepareFabricationPackageResult = shapeFabricationPackageResult;
