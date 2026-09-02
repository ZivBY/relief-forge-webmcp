export type PatternKind =
  | "flat"
  | "wave"
  | "ripple"
  | "vortex"
  | "dunes"
  | "noise"
  | "interference"
  | "liquid"
  | "fracture";

/**
 * A design family changes the topology of the artwork, not just the scalar
 * field painted across one square grid.
 */
export type DesignFamilyKind =
  | "folded-flow"
  | "sampled-blocks"
  | "triangular-current"
  | "polar-bloom"
  | "cellular-crystal"
  | "hex-canopy"
  | "coral-cluster"
  | "contour-relief"
  | "silhouette-mosaic";

export type SilhouetteKind =
  | "rectangle"
  | "ellipse"
  | "archipelago"
  | "crescent"
  | "ring";

export type TileShapeKind =
  | "leaning-pyramid"
  | "twisted-prism"
  | "hex-spike"
  | "folded-ridge"
  | "surface-column"
  | "planar-cap-column"
  | "triangle-sail"
  | "triangle-plateau"
  | "polar-wedge"
  | "polar-petal"
  | "cell-crystal"
  | "cell-plateau"
  | "hex-petal"
  | "hex-folded-fan"
  | "hex-pinwheel"
  | "hex-curved-sweep"
  | "hex-wave-bands"
  | "hex-mixed"
  | "ring-pod"
  | "solid-pod"
  | "relief-panel"
  | "terraced-panel"
  | "mixed-block";

export type ColorAssignmentMode =
  | "field-bands"
  | "checker"
  | "radial"
  | "rows"
  | "seeded-random";

export type Seed = string | number;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type Triangle = [number, number, number];

/** An indexed triangle mesh. Vertices use millimetres. */
export interface Mesh {
  name: string;
  vertices: Vec3[];
  triangles: Triangle[];
}

export interface Bounds3 {
  min: Vec3;
  max: Vec3;
  size: Vec3;
}

export interface MeshDiagnostics {
  vertexCount: number;
  triangleCount: number;
  /** Vertices whose x, y, or z coordinate is NaN or infinite. */
  nonFiniteVertexCount: number;
  /** Triangle index entries that are non-integers, negative, or out of range. */
  invalidTriangleIndexCount: number;
  /** Triangle normals whose derived components or magnitude are non-finite. */
  nonFiniteNormalCount: number;
  /** Triangle area/volume contributions that cannot be represented finitely. */
  nonFiniteMetricCount: number;
  bounds: Bounds3;
  surfaceAreaMm2: number;
  signedVolumeMm3: number;
  volumeMm3: number;
  degenerateTriangleCount: number;
  boundaryEdgeCount: number;
  nonManifoldEdgeCount: number;
  closedManifold: boolean;
  outwardWinding: boolean;
}

export interface GridConfig {
  columns: number;
  rows: number;
  tileSizeMm: number;
  gapMm: number;
}

/**
 * Optional exact finished bounds for the assembled artwork. When either value
 * is present the generated XY geometry is affinely scaled to the requested
 * millimetres; Z/relief dimensions are deliberately left unchanged.
 */
export interface FinishedSizeConfig {
  widthMm?: number;
  heightMm?: number;
  lockAspect: boolean;
}

export interface DesignConfig {
  family: DesignFamilyKind;
  silhouette: SilhouetteKind;
  /** Seeded geometric displacement in the inclusive range [0, 1]. */
  variation: number;
  /** Rotational repeat count used by radial and masked compositions. */
  symmetry: number;
  /** Samples per side for continuous relief panels. */
  surfaceResolution: number;
}

export interface TileGeometryConfig {
  shape: TileShapeKind;
  /** Minimum configured overall Z depth generated from the composition field. */
  baseHeightMm: number;
  /** Available relief span above the minimum thickness. */
  reliefHeightMm: number;
  topScale: number;
  leanRatio: number;
  twistDeg: number;
}

/** Global mapping from a normalized macro field to physical part depth. */
export interface DepthProfileConfig {
  invert: boolean;
  /** Linear contrast around the normalized midpoint, in [0, 2]. */
  contrast: number;
  /** Peak/valley emphasis in [-1, 1]; zero is the identity curve. */
  curve: number;
  /** Zero keeps continuous depth; otherwise use 2 through 16 height levels. */
  levels: number;
}

export interface LocalDepthPaintConfig {
  enabled: boolean;
  descriptor: DepthPaintFieldDescriptor;
}

/** Signed local millimetre effects applied after the global depth profile. */
export interface LocalDepthConfig {
  masks: RegionalDepthMask[];
  /** Omit when the project has never created or retained a paint field. */
  paint?: LocalDepthPaintConfig;
}

export interface PatternConfig {
  kind: PatternKind;
  frequency: number;
  amplitude: number;
  angleDeg: number;
  phaseDeg: number;
  centerX: number;
  centerY: number;
  arms: number;
  noiseScale: number;
  octaves: number;
  lacunarity: number;
  gain: number;
}

/** A user-authored composition stroke in a +Y-up normalized art plane. */
export type GuideDirectionMode = "toward" | "toward-forward";

export type GuideInterpolation = "linear" | "smooth";

export type GuideTemplateKind =
  | "freehand"
  | "line"
  | "arc"
  | "circle"
  | "ellipse"
  | "square"
  | "triangle"
  | "diamond"
  | "s-curve";

export interface GuideEffectOverrides {
  /** Per-line radius override; omitted values inherit the guide defaults. */
  influenceRadius?: number;
  /** Per-line directional tip/apex pull override in [0, 1]. */
  centerPull?: number;
  /** Per-line angular attraction override in [0, 1]. */
  followStrength?: number;
  /** Per-line physical relief raise/cut in millimetres. */
  heightDeltaMm?: number;
  /** Whether ordered start-to-end flow contributes to the target direction. */
  directionMode?: GuideDirectionMode;
}

export interface GuideLineConfig {
  id: string;
  /** Stable user-facing label. Legacy recipes may omit it. */
  name?: string;
  points: Array<{ x: number; y: number }>;
  closed: boolean;
  /** Sparse editable handles. Legacy guides use their sampled points directly. */
  controlPoints?: Array<{ x: number; y: number }>;
  interpolation?: GuideInterpolation;
  templateKind?: GuideTemplateKind;
  /** Optional values override the guide-wide defaults for only this line. */
  effects?: GuideEffectOverrides;
}

/**
 * Guide strokes independently steer local orientation and raise/cut relief.
 * The radius is stored in normalized units so it scales with finished size;
 * heightDeltaMm remains an explicit fabrication dimension.
 */
export interface GuideCompositionConfig {
  lines: GuideLineConfig[];
  influenceRadius: number;
  /** Normalized directional tip/apex pull toward the nearest guide in [0, 1]. */
  centerPull: number;
  followStrength: number;
  heightDeltaMm: number;
}

export interface PaletteConfig {
  colors: string[];
  mode: ColorAssignmentMode;
  offset: number;
  reverse: boolean;
}

export type PhotoToneMode = "off" | "light-raised" | "dark-raised";
export type PhotoDirectionMode = "off" | "gradient" | "contour";
export type PhotoColorMode = "auto-palette" | "current-palette";

/**
 * A descriptor for a canonical, metadata-free image field. Pixel bytes live in
 * IndexedDB/runtime assets rather than the recipe so localStorage stays small.
 */
export interface PhotoCompositionConfig {
  assetSha256: string;
  canonicalWidth: number;
  canonicalHeight: number;
  toneMode: PhotoToneMode;
  /** Normalized user-facing contrast amount in the inclusive range [0, 1]. */
  toneContrast: number;
  /** Blend from the procedural scalar field to photo tone in [0, 1]. */
  geometryStrength: number;
  directionMode: PhotoDirectionMode;
  /** Circular blend from procedural direction to image direction in [0, 1]. */
  directionStrength: number;
  colorMode: PhotoColorMode;
  /** Blend from the configured procedural color assignment to image color. */
  colorStrength: number;
  /** Requested auto-palette size. Extraction may return fewer unique colors. */
  requestedColorCount: number;
}

export interface CompositionSourceConfig {
  kind: "procedural" | "photo";
  photo?: PhotoCompositionConfig;
}

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface PhotoFieldAsset {
  version: 1;
  width: number;
  height: number;
  colorSpace: "srgb";
  rgba8: Uint8Array;
  sha256: string;
}

export interface GenerationAssets {
  photoFields?: Readonly<Record<string, PhotoFieldAsset>>;
  depthPaintFields?: Readonly<Record<string, DepthPaintFieldAsset>>;
}

export interface PrinterConfig {
  bedWidthMm: number;
  bedDepthMm: number;
  marginMm: number;
  spacingMm: number;
  allowRotate90: boolean;
  separateColors: boolean;
}

export interface WallArtConfig {
  schemaVersion: 3;
  seed: Seed;
  source: CompositionSourceConfig;
  finishedSize: FinishedSizeConfig;
  design: DesignConfig;
  grid: GridConfig;
  tile: TileGeometryConfig;
  depthProfile: DepthProfileConfig;
  localDepth: LocalDepthConfig;
  pattern: PatternConfig;
  guides: GuideCompositionConfig;
  palette: PaletteConfig;
  printer: PrinterConfig;
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[]
    ? T[K]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

export type WallArtConfigInput = Omit<DeepPartial<WallArtConfig>, "schemaVersion"> & {
  /** Schema 1 is accepted only as an explicit migration input. */
  schemaVersion?: number;
};

export interface PatternSample {
  /** Normalized scalar in the inclusive range [-1, 1]. */
  value: number;
  /** Suggested tile direction in radians. */
  angleRad: number;
  /**
   * Accumulated signed local fabrication offset applied after the global depth
   * profile. Regional masks, painting, and guides share this path so Raise
   * remains positive and Cut remains negative after inversion or quantization.
   */
  guideHeightDeltaMm?: number;
  /** Averaged canonical image color when photo composition is active. */
  sourceColor?: RgbColor;
}

export interface GeneratedTile {
  id: string;
  row: number;
  column: number;
  centerXmm: number;
  centerYmm: number;
  normalizedX: number;
  normalizedY: number;
  orientationRad: number;
  patternValue: number;
  heightMm: number;
  colorIndex: number;
  color: string;
  family: DesignFamilyKind;
  shape: TileShapeKind;
  /** Local mesh centred around x=0/y=0 and resting on z=0. */
  mesh: Mesh;
  diagnostics: MeshDiagnostics;
}

export interface ProjectDiagnostics {
  tileCount: number;
  closedTileCount: number;
  allTilesClosedManifold: boolean;
  fullMesh: MeshDiagnostics;
}

export interface WallArtProject {
  schemaVersion: 3;
  id: string;
  config: WallArtConfig;
  /** Verified canonical photo field used to generate this exact project. */
  sourceAsset?: PhotoFieldAsset;
  /** Verified retained paint field used by or bundled with this project. */
  depthPaintAsset?: DepthPaintFieldAsset;
  widthMm: number;
  depthMm: number;
  tiles: GeneratedTile[];
  diagnostics: ProjectDiagnostics;
}

export interface Rect2 {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  depth: number;
}

export interface PackedPlacement {
  tileId: string;
  colorIndex: number;
  color: string;
  plateIndex: number;
  /** Additional manufacturing rotation, after the artistic tile rotation. */
  rotationDeg: 0 | 90;
  /** Translation applied to the additionally rotated local tile mesh. */
  translateXmm: number;
  translateYmm: number;
  footprint: Rect2;
}

export interface PackedPlate {
  index: number;
  id: string;
  bedWidthMm: number;
  bedDepthMm: number;
  colorIndices: number[];
  placements: PackedPlacement[];
}

export interface PackingResult {
  projectId: string;
  printer: PrinterConfig;
  plates: PackedPlate[];
  placementCount: number;
}
import type { DepthPaintFieldAsset, DepthPaintFieldDescriptor } from "../depth-paint/field";
import type { RegionalDepthMask } from "./depth-masks";
