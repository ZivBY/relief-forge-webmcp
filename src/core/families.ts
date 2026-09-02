import { diagnoseMesh, meshBounds, rotateMeshZ } from "./mesh";
import { createDepthMapper, type DepthMapper } from "./depth-profile";
import { assignTileColor } from "./palette";
import { createCompositionSampler, type CompositionSampler } from "./composition";
import { createHexReliefMesh, type HexReliefShape } from "./hex-relief";
import { deterministicUnit, fbmNoise2D, hashUint32 } from "./random";
import {
  createHeightfieldPanelMesh,
  createPolygonFrustumMesh,
  createRidgeTileMesh,
  createRingPodMesh,
  createSurfaceColumnMesh,
  createTerracedPanelMesh,
  createTileMesh,
} from "./shapes";
import type {
  GeneratedTile,
  GenerationAssets,
  Mesh,
  PatternSample,
  TileShapeKind,
  WallArtConfig,
} from "./types";
import type { Point2 } from "./shapes";

export interface FamilyGeneration {
  widthMm: number;
  depthMm: number;
  tiles: GeneratedTile[];
}

interface TileInput {
  id: string;
  row: number;
  column: number;
  centerXmm: number;
  centerYmm: number;
  widthMm: number;
  depthMm: number;
  shape: TileShapeKind;
  mesh: Mesh;
  pattern?: PatternSample;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

function proceduralVariationFactor(config: WallArtConfig): number {
  const photo = config.source.kind === "photo" ? config.source.photo : undefined;
  return photo && photo.toneMode !== "off"
    ? 1 - photo.geometryStrength
    : 1;
}

function gridId(row: number, column: number): string {
  return `tile-r${String(row + 1).padStart(4, "0")}-c${String(column + 1).padStart(4, "0")}`;
}

function polarId(ring: number, sector: number): string {
  return `tile-ring${String(ring + 1).padStart(3, "0")}-sector${String(sector + 1).padStart(3, "0")}`;
}

function normalized(value: number, span: number): number {
  return span <= 0 ? 0 : clamp((value / span) * 2 - 1, -1, 1);
}

function makeTile(
  config: WallArtConfig,
  input: TileInput,
  sampler: CompositionSampler,
): GeneratedTile {
  const normalizedX = normalized(input.centerXmm, input.widthMm);
  const normalizedY = normalized(input.centerYmm, input.depthMm);
  const pattern =
    input.pattern ?? sampler(normalizedX, normalizedY);
  const color = assignTileColor(config, {
    row: input.row,
    column: input.column,
    normalizedX,
    normalizedY,
    patternValue: pattern.value,
    tileId: input.id,
    sourceColor: pattern.sourceColor,
  });
  const bounds = meshBounds(input.mesh);
  return {
    id: input.id,
    row: input.row,
    column: input.column,
    centerXmm: input.centerXmm,
    centerYmm: input.centerYmm,
    normalizedX,
    normalizedY,
    orientationRad: pattern.angleRad,
    patternValue: pattern.value,
    heightMm: bounds.max.z,
    colorIndex: color.colorIndex,
    color: color.color,
    family: config.design.family,
    shape: input.shape,
    mesh: input.mesh,
    diagnostics: diagnoseMesh(input.mesh),
  };
}

function targetGridSize(config: WallArtConfig): {
  widthMm: number;
  depthMm: number;
  pitch: number;
} {
  const pitch = config.grid.tileSizeMm + config.grid.gapMm;
  return {
    widthMm:
      config.grid.columns * config.grid.tileSizeMm +
      (config.grid.columns - 1) * config.grid.gapMm,
    depthMm:
      config.grid.rows * config.grid.tileSizeMm +
      (config.grid.rows - 1) * config.grid.gapMm,
    pitch,
  };
}

function reliefAmount(
  config: WallArtConfig,
  pattern: PatternSample,
  ...identity: Array<string | number>
): number {
  const seededOffset =
    identity.length === 0
      ? 0
      : (deterministicUnit(config.seed, "relief-variation", ...identity) * 2 -
          1) *
        config.design.variation *
        proceduralVariationFactor(config) *
        0.16;
  return clamp((pattern.value + 1) / 2 + seededOffset, 0, 1);
}

function reliefHeight(
  config: WallArtConfig,
  depth: DepthMapper,
  pattern: PatternSample,
  ...identity: Array<string | number>
): number {
  return depth.heightMm(
    reliefAmount(config, pattern, ...identity),
    pattern.guideHeightDeltaMm,
  );
}

function inSilhouette(config: WallArtConfig, x: number, y: number): boolean {
  const radius = Math.hypot(x, y);
  switch (config.design.silhouette) {
    case "rectangle":
      return Math.abs(x) <= 1 && Math.abs(y) <= 1;
    case "ellipse":
      return x * x + y * y <= 0.96;
    case "ring":
      return radius >= 0.38 && radius <= 0.98;
    case "crescent": {
      const outer = x * x + y * y <= 0.95;
      const cutout = (x + 0.36) * (x + 0.36) + y * y <= 0.72;
      return outer && !cutout;
    }
    case "archipelago": {
      // A small union of overlapping, seed-perturbed ellipses produces
      // readable island masses. Pure thresholded noise was deterministic, but
      // on a coarse tile grid it frequently collapsed into one-cell-high bars.
      const lobes = [
        { x: -0.5, y: -0.03, radiusX: 0.34, radiusY: 0.39 },
        { x: -0.24, y: 0.2, radiusX: 0.25, radiusY: 0.27 },
        { x: 0.5, y: 0.1, radiusX: 0.3, radiusY: 0.37 },
        { x: 0.14, y: -0.58, radiusX: 0.19, radiusY: 0.2 },
      ];
      return lobes.some((lobe, index) => {
        const centerX =
          lobe.x +
          (deterministicUnit(config.seed, "island-x", index) - 0.5) * 0.08;
        const centerY =
          lobe.y +
          (deterministicUnit(config.seed, "island-y", index) - 0.5) * 0.08;
        const radiusX =
          lobe.radiusX *
          (0.92 + deterministicUnit(config.seed, "island-rx", index) * 0.16);
        const radiusY =
          lobe.radiusY *
          (0.92 + deterministicUnit(config.seed, "island-ry", index) * 0.16);
        const dx = (x - centerX) / radiusX;
        const dy = (y - centerY) / radiusY;
        const edgeNoise = fbmNoise2D(
          `${String(config.seed)}:island-edge:${index}`,
          x * 2.4 + index * 3.1,
          y * 2.4 - index * 1.7,
          3,
          2,
          0.5,
        );
        return dx * dx + dy * dy <= 1 + edgeNoise * 0.1;
      });
    }
  }
}

function createFoldedFlow(config: WallArtConfig, sampler: CompositionSampler): FamilyGeneration {
  const depth = createDepthMapper(
    config.depthProfile,
    config.tile.baseHeightMm,
    config.tile.reliefHeightMm,
  );
  const { widthMm, depthMm, pitch } = targetGridSize(config);
  const tiles: GeneratedTile[] = [];
  const allowed = new Set<TileShapeKind>([
    "folded-ridge",
    "twisted-prism",
    "leaning-pyramid",
  ]);
  const selectedShape = allowed.has(config.tile.shape)
    ? config.tile.shape
    : "folded-ridge";
  for (let row = 0; row < config.grid.rows; row += 1) {
    for (let column = 0; column < config.grid.columns; column += 1) {
      const centerXmm = column * pitch + config.grid.tileSizeMm / 2;
      const centerYmm = row * pitch + config.grid.tileSizeMm / 2;
      const nx = normalized(centerXmm, widthMm);
      const ny = normalized(centerYmm, depthMm);
      if (!inSilhouette(config, nx, ny)) continue;
      const id = gridId(row, column);
      const pattern = sampler(nx, ny);
      const heightMm = reliefHeight(config, depth, pattern, row, column);
      const mesh =
        selectedShape === "folded-ridge"
          ? createRidgeTileMesh(
              config.grid.tileSizeMm,
              heightMm,
              pattern.angleRad,
              id,
            )
          : createTileMesh({
              shape: selectedShape,
              sizeMm: config.grid.tileSizeMm,
              heightMm,
              topScale: config.tile.topScale,
              leanRatio: config.tile.leanRatio,
              twistDeg:
                config.tile.twistDeg * (0.5 + ((pattern.value + 1) / 2) * 0.5),
              orientationRad: pattern.angleRad,
              name: id,
            });
      tiles.push(
        makeTile(config, {
          id,
          row,
          column,
          centerXmm,
          centerYmm,
          widthMm,
          depthMm,
          shape: selectedShape,
          mesh,
          pattern,
        }, sampler),
      );
    }
  }
  return { widthMm, depthMm, tiles };
}

/** Discrete square columns whose top corners sample one continuous field. */
function createSampledBlocks(config: WallArtConfig, sampler: CompositionSampler): FamilyGeneration {
  const depth = createDepthMapper(
    config.depthProfile,
    config.tile.baseHeightMm,
    config.tile.reliefHeightMm,
  );
  const { widthMm, depthMm, pitch } = targetGridSize(config);
  const logicalWidthMm = config.grid.columns * config.grid.tileSizeMm;
  const logicalDepthMm = config.grid.rows * config.grid.tileSizeMm;
  const selectedShape: TileShapeKind =
    config.tile.shape === "planar-cap-column"
      ? "planar-cap-column"
      : "surface-column";
  const tiles: GeneratedTile[] = [];

  const sampleHeight = (logicalXmm: number, logicalYmm: number): number => {
    const nx = normalized(logicalXmm, logicalWidthMm);
    const ny = normalized(logicalYmm, logicalDepthMm);
    const pattern = sampler.point(nx, ny);
    const seededSurface = fbmNoise2D(
      `${String(config.seed)}:block-surface`,
      nx * 2.25 + 1.7,
      ny * 2.25 - 2.1,
      4,
      2,
      0.5,
    );
    const broadSurface = fbmNoise2D(
      `${String(config.seed)}:block-broad-surface`,
      nx * 1.05 - 3.2,
      ny * 1.05 + 2.6,
      3,
      2,
      0.52,
    );
    const coherentAmount = (pattern.value + 1) / 2;
    const alternateAmount = clamp(
      0.5 + seededSurface * 0.58 + broadSurface * 0.2,
      0,
      1,
    );
    // Keep variation 0 as the clean, globally sampled analytic surface. The
    // upper endpoint deliberately blends strongly toward a second coherent
    // seeded surface so the control changes form, rather than only texture.
    const amount = clamp(
      lerp(
        coherentAmount,
        alternateAmount,
        config.design.variation * proceduralVariationFactor(config) * 0.82,
      ),
      0,
      1,
    );
    return depth.heightMm(amount, pattern.guideHeightDeltaMm);
  };

  for (let row = 0; row < config.grid.rows; row += 1) {
    for (let column = 0; column < config.grid.columns; column += 1) {
      const centerXmm = column * pitch + config.grid.tileSizeMm / 2;
      const centerYmm = row * pitch + config.grid.tileSizeMm / 2;
      const logicalCenterXmm = (column + 0.5) * config.grid.tileSizeMm;
      const logicalCenterYmm = (row + 0.5) * config.grid.tileSizeMm;
      const nx = normalized(logicalCenterXmm, logicalWidthMm);
      const ny = normalized(logicalCenterYmm, logicalDepthMm);
      if (!inSilhouette(config, nx, ny)) continue;
      const half = config.grid.tileSizeMm / 2;
      let cornerHeights: [number, number, number, number];
      if (selectedShape === "planar-cap-column") {
        const centerHeight = sampleHeight(logicalCenterXmm, logicalCenterYmm);
        const dx =
          (sampleHeight(logicalCenterXmm + half, logicalCenterYmm) -
            sampleHeight(logicalCenterXmm - half, logicalCenterYmm)) /
          2;
        const dy =
          (sampleHeight(logicalCenterXmm, logicalCenterYmm + half) -
            sampleHeight(logicalCenterXmm, logicalCenterYmm - half)) /
          2;
        cornerHeights = [
          centerHeight - dx - dy,
          centerHeight + dx - dy,
          centerHeight + dx + dy,
          centerHeight - dx + dy,
        ].map((height) => depth.clampHeightMm(height)) as [
          number,
          number,
          number,
          number,
        ];
      } else {
        cornerHeights = [
          sampleHeight(logicalCenterXmm - half, logicalCenterYmm - half),
          sampleHeight(logicalCenterXmm + half, logicalCenterYmm - half),
          sampleHeight(logicalCenterXmm + half, logicalCenterYmm + half),
          sampleHeight(logicalCenterXmm - half, logicalCenterYmm + half),
        ];
      }
      const id = gridId(row, column);
      const pattern = sampler(nx, ny);
      const mesh = createSurfaceColumnMesh({
        sizeMm: config.grid.tileSizeMm,
        cornerHeightsMm: cornerHeights,
        topScale: selectedShape === "planar-cap-column" ? 0.72 : 1,
        name: id,
      });
      tiles.push(
        makeTile(config, {
          id,
          row,
          column,
          centerXmm,
          centerYmm,
          widthMm,
          depthMm,
          shape: selectedShape,
          mesh,
          pattern,
        }, sampler),
      );
    }
  }

  return { widthMm, depthMm, tiles };
}

/** Equilateral-triangle carrier with two independently printable facets per cell. */
function createTriangularCurrent(
  config: WallArtConfig,
  sampler: CompositionSampler,
  assets: GenerationAssets,
): FamilyGeneration {
  const depth = createDepthMapper(
    config.depthProfile,
    config.tile.baseHeightMm,
    config.tile.reliefHeightMm,
  );
  const sideMm = config.grid.tileSizeMm;
  const triangleHeightMm = (sideMm * Math.sqrt(3)) / 2;
  const widthMm = config.grid.columns * sideMm + sideMm / 2;
  const depthMm = config.grid.rows * triangleHeightMm;
  const selectedShape: TileShapeKind =
    config.tile.shape === "triangle-plateau"
      ? "triangle-plateau"
      : "triangle-sail";
  const unGuidedConfig: WallArtConfig =
    config.guides.lines.length === 0
      ? config
      : {
          ...config,
          guides: { ...config.guides, lines: [] },
        };
  const unGuidedSampler = createCompositionSampler(unGuidedConfig, assets);
  const tiles: GeneratedTile[] = [];

  for (let row = 0; row < config.grid.rows; row += 1) {
    const y0 = row * triangleHeightMm;
    const y1 = y0 + triangleHeightMm;
    const bottomOffset = ((row % 2) * sideMm) / 2;
    const topOffset = (((row + 1) % 2) * sideMm) / 2;

    for (let column = 0; column < config.grid.columns; column += 1) {
      const p0 = { x: bottomOffset + column * sideMm, y: y0 };
      const p1 = { x: bottomOffset + (column + 1) * sideMm, y: y0 };
      const p2 = { x: topOffset + column * sideMm, y: y1 };
      const p3 = { x: topOffset + (column + 1) * sideMm, y: y1 };
      const polygons: Point2[][] =
        topOffset > bottomOffset
          ? [
              [p0, p1, p2],
              [p1, p3, p2],
            ]
          : [
              [p0, p1, p3],
              [p0, p3, p2],
            ];

      for (let half = 0; half < polygons.length; half += 1) {
        const polygon = shrinkPolygon(polygons[half], config.grid.gapMm);
        const center = polygonCentroid(polygon);
        const nx = normalized(center.x, widthMm);
        const ny = normalized(center.y, depthMm);
        if (!inSilhouette(config, nx, ny)) continue;
        const unGuidedPattern = unGuidedSampler(nx, ny);
        const guidedPattern = sampler(nx, ny);
        // Triangle guide orientation and cap pull are composed once, after
        // finished-size scaling, from the actual final tile centre. Relief can
        // still use the ordinary guide-modulated scalar at this stage.
        const pattern = {
          ...guidedPattern,
          angleRad: unGuidedPattern.angleRad,
        };
        const id = gridId(row, column * 2 + half);
        const local = polygon.map((point) => ({
          x: point.x - center.x,
          y: point.y - center.y,
        }));
        const leanMm =
          sideMm *
          config.tile.leanRatio *
          (selectedShape === "triangle-sail" ? 0.52 : 0.18);
        const topScale = selectedShape === "triangle-sail" ? 0.055 : 0.56;
        const baseOffsetX = Math.cos(pattern.angleRad) * leanMm;
        const baseOffsetY = Math.sin(pattern.angleRad) * leanMm;
        const mesh = createPolygonFrustumMesh({
          polygon: local,
          heightMm: reliefHeight(
            config,
            depth,
            pattern,
            row,
            column * 2 + half,
          ),
          topScale,
          topOffsetX: baseOffsetX,
          topOffsetY: baseOffsetY,
          name: id,
        });
        tiles.push(
          makeTile(config, {
            id,
            row,
            column: column * 2 + half,
            centerXmm: center.x,
            centerYmm: center.y,
            widthMm,
            depthMm,
            shape: selectedShape,
            mesh,
            pattern,
          }, sampler),
        );
      }
    }
  }

  return { widthMm, depthMm, tiles };
}

function polygonCentroid(points: readonly Point2[]): Point2 {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function createPolarBloom(config: WallArtConfig, sampler: CompositionSampler): FamilyGeneration {
  const depth = createDepthMapper(
    config.depthProfile,
    config.tile.baseHeightMm,
    config.tile.reliefHeightMm,
  );
  const target = targetGridSize(config);
  const widthMm = target.widthMm;
  const depthMm = target.depthMm;
  const radiusX = Math.max(config.grid.tileSizeMm, widthMm / 2);
  const radiusY = Math.max(config.grid.tileSizeMm, depthMm / 2);
  const ringCount = Math.max(
    2,
    Math.floor(Math.min(radiusX, radiusY) / target.pitch),
  );
  const innerVoid = config.design.silhouette === "ring" ? 0.34 : 0.08;
  const selectedShape: TileShapeKind =
    config.tile.shape === "polar-petal" ? "polar-petal" : "polar-wedge";
  const tiles: GeneratedTile[] = [];

  if (innerVoid < 0.1 && inSilhouette(config, 0, 0)) {
    const centerRadius = Math.max(
      2,
      Math.min(radiusX, radiusY) * 0.075 - config.grid.gapMm / 2,
    );
    const polygon = Array.from(
      { length: Math.max(8, config.design.symmetry) },
      (_, index) => {
        const angle =
          (index / Math.max(8, config.design.symmetry)) * Math.PI * 2;
        return {
          x: Math.cos(angle) * centerRadius,
          y: Math.sin(angle) * centerRadius,
        };
      },
    );
    const pattern = sampler(0, 0);
    const id = polarId(0, 0);
    const mesh = createPolygonFrustumMesh({
      polygon,
      heightMm: reliefHeight(config, depth, pattern, "center"),
      topScale: selectedShape === "polar-petal" ? 0.18 : 0.62,
      name: id,
    });
    tiles.push(
      makeTile(config, {
        id,
        row: 0,
        column: 0,
        centerXmm: widthMm / 2,
        centerYmm: depthMm / 2,
        widthMm,
        depthMm,
        shape: selectedShape,
        mesh,
        pattern,
      }, sampler),
    );
  }

  for (let ring = 0; ring < ringCount; ring += 1) {
    const inner = innerVoid + ((1 - innerVoid) * ring) / ringCount;
    const outer = innerVoid + ((1 - innerVoid) * (ring + 1)) / ringCount;
    const midRadiusMm = ((inner + outer) / 2) * Math.min(radiusX, radiusY);
    const rawSectors = Math.max(
      config.design.symmetry,
      Math.round((Math.PI * 2 * midRadiusMm) / target.pitch),
    );
    const sectorCount = Math.max(
      config.design.symmetry,
      Math.round(rawSectors / config.design.symmetry) * config.design.symmetry,
    );
    const angleGap = clamp(
      config.grid.gapMm / Math.max(midRadiusMm, 1),
      0.008,
      0.16,
    );
    const radialGapX = config.grid.gapMm / Math.max(radiusX, 1) / 2;
    const radialGapY = config.grid.gapMm / Math.max(radiusY, 1) / 2;
    for (let sector = 0; sector < sectorCount; sector += 1) {
      const a0 = (sector / sectorCount) * Math.PI * 2 + angleGap / 2;
      const a1 = ((sector + 1) / sectorCount) * Math.PI * 2 - angleGap / 2;
      const outerX = Math.max(inner + 0.01, outer - radialGapX);
      const outerY = Math.max(inner + 0.01, outer - radialGapY);
      const innerX = Math.min(outerX - 0.01, inner + radialGapX);
      const innerY = Math.min(outerY - 0.01, inner + radialGapY);
      const worldPolygon: Point2[] = [];
      for (let step = 0; step <= 2; step += 1) {
        const angle = a0 + ((a1 - a0) * step) / 2;
        worldPolygon.push({
          x: widthMm / 2 + Math.cos(angle) * radiusX * outerX,
          y: depthMm / 2 + Math.sin(angle) * radiusY * outerY,
        });
      }
      for (let step = 2; step >= 0; step -= 1) {
        const angle = a0 + ((a1 - a0) * step) / 2;
        worldPolygon.push({
          x: widthMm / 2 + Math.cos(angle) * radiusX * innerX,
          y: depthMm / 2 + Math.sin(angle) * radiusY * innerY,
        });
      }
      const center = polygonCentroid(worldPolygon);
      const localPolygon = worldPolygon.map((point) => ({
        x: point.x - center.x,
        y: point.y - center.y,
      }));
      const nx = normalized(center.x, widthMm);
      const ny = normalized(center.y, depthMm);
      // Polar sectors are still independently printable whole parts.  Until a
      // robust nonlinear clipping kernel is introduced, the silhouette owns a
      // sector by its installation anchor.  This keeps crescent, island and
      // ring compositions genuinely different without producing cut slivers.
      if (!inSilhouette(config, nx, ny)) continue;
      const pattern = sampler(nx, ny);
      const id = polarId(ring + 1, sector);
      const radialAngle = Math.atan2(ny, nx);
      const lean =
        config.grid.tileSizeMm *
        config.tile.leanRatio *
        (selectedShape === "polar-petal" ? 0.7 : 0.3);
      const mesh = createPolygonFrustumMesh({
        polygon: localPolygon,
        heightMm: reliefHeight(config, depth, pattern, ring, sector),
        topScale:
          selectedShape === "polar-petal"
            ? 0.16
            : clamp(config.tile.topScale + 0.25, 0.42, 0.86),
        topOffsetX: Math.cos(radialAngle) * lean,
        topOffsetY: Math.sin(radialAngle) * lean,
        name: id,
      });
      tiles.push(
        makeTile(config, {
          id,
          row: ring + 1,
          column: sector,
          centerXmm: center.x,
          centerYmm: center.y,
          widthMm,
          depthMm,
          shape: selectedShape,
          mesh,
          pattern,
        }, sampler),
      );
    }
  }
  return { widthMm, depthMm, tiles };
}

const POLYGON_POINT_EPSILON_MM = 1e-7;

function pointsNearlyEqual(left: Point2, right: Point2): boolean {
  return (
    Math.hypot(left.x - right.x, left.y - right.y) <= POLYGON_POINT_EPSILON_MM
  );
}

/**
 * Sutherland-Hodgman clipping can emit the same endpoint twice when an input
 * vertex lies exactly on the clipping line. That is common for the perfectly
 * regular Voronoi grid at variation 0. Consecutive duplicate vertices later
 * become zero-area cap and wall triangles, so normalize every clipping result
 * before it is fed into the next half-plane.
 */
function deduplicatePolygonEndpoints(points: readonly Point2[]): Point2[] {
  const result: Point2[] = [];
  for (const point of points) {
    const previous = result[result.length - 1];
    if (!previous || !pointsNearlyEqual(previous, point)) result.push(point);
  }
  if (
    result.length > 1 &&
    pointsNearlyEqual(result[0], result[result.length - 1])
  ) {
    result.pop();
  }
  return result;
}

function clipHalfPlane(
  polygon: readonly Point2[],
  a: number,
  b: number,
  c: number,
): Point2[] {
  const result: Point2[] = [];
  const inside = (point: Point2) => a * point.x + b * point.y <= c + 1e-7;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    const currentInside = inside(current);
    const nextInside = inside(next);
    if (currentInside) result.push(current);
    if (currentInside !== nextInside) {
      const dx = next.x - current.x;
      const dy = next.y - current.y;
      const denominator = a * dx + b * dy;
      if (Math.abs(denominator) > 1e-10) {
        const amount = clamp(
          (c - a * current.x - b * current.y) / denominator,
          0,
          1,
        );
        result.push({ x: current.x + dx * amount, y: current.y + dy * amount });
      }
    }
  }
  return deduplicatePolygonEndpoints(result);
}

function shrinkPolygon(polygon: readonly Point2[], gapMm: number): Point2[] {
  const center = polygonCentroid(polygon);
  const xs = polygon.map((point) => point.x);
  const ys = polygon.map((point) => point.y);
  const minimumSpan = Math.max(
    0.1,
    Math.min(
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys),
    ),
  );
  const scale = clamp(1 - gapMm / minimumSpan, 0.34, 0.96);
  return polygon.map((point) => ({
    x: center.x + (point.x - center.x) * scale,
    y: center.y + (point.y - center.y) * scale,
  }));
}

function createCellularCrystal(config: WallArtConfig, sampler: CompositionSampler): FamilyGeneration {
  const depth = createDepthMapper(
    config.depthProfile,
    config.tile.baseHeightMm,
    config.tile.reliefHeightMm,
  );
  const { widthMm, depthMm } = targetGridSize(config);
  const cellWidth = widthMm / config.grid.columns;
  const cellDepth = depthMm / config.grid.rows;
  const sites: Array<Point2 & { row: number; column: number }> = [];
  for (let row = 0; row < config.grid.rows; row += 1) {
    for (let column = 0; column < config.grid.columns; column += 1) {
      const jitterX =
        (deterministicUnit(config.seed, "cell-x", row, column) - 0.5) *
        cellWidth *
        config.design.variation *
        0.78;
      const jitterY =
        (deterministicUnit(config.seed, "cell-y", row, column) - 0.5) *
        cellDepth *
        config.design.variation *
        0.78;
      sites.push({
        x: (column + 0.5) * cellWidth + jitterX,
        y: (row + 0.5) * cellDepth + jitterY,
        row,
        column,
      });
    }
  }
  const selectedShape: TileShapeKind =
    config.tile.shape === "cell-plateau" ? "cell-plateau" : "cell-crystal";
  const tiles: GeneratedTile[] = [];
  for (let siteIndex = 0; siteIndex < sites.length; siteIndex += 1) {
    const site = sites[siteIndex];
    const nx = normalized(site.x, widthMm);
    const ny = normalized(site.y, depthMm);
    if (!inSilhouette(config, nx, ny)) continue;
    let polygon: Point2[] = [
      { x: 0, y: 0 },
      { x: widthMm, y: 0 },
      { x: widthMm, y: depthMm },
      { x: 0, y: depthMm },
    ];
    for (
      let otherIndex = 0;
      otherIndex < sites.length && polygon.length >= 3;
      otherIndex += 1
    ) {
      if (otherIndex === siteIndex) continue;
      const other = sites[otherIndex];
      const a = other.x - site.x;
      const b = other.y - site.y;
      const c =
        (other.x * other.x +
          other.y * other.y -
          site.x * site.x -
          site.y * site.y) /
        2;
      polygon = clipHalfPlane(polygon, a, b, c);
    }
    if (polygon.length < 3) continue;
    polygon = shrinkPolygon(polygon, config.grid.gapMm);
    const center = polygonCentroid(polygon);
    const local = polygon.map((point) => ({
      x: point.x - center.x,
      y: point.y - center.y,
    }));
    const pattern = sampler(
      normalized(center.x, widthMm),
      normalized(center.y, depthMm),
    );
    const id = gridId(site.row, site.column);
    const lean =
      config.grid.tileSizeMm *
      config.tile.leanRatio *
      (selectedShape === "cell-crystal" ? 0.7 : 0.25);
    const mesh = createPolygonFrustumMesh({
      polygon: local,
      heightMm: reliefHeight(
        config,
        depth,
        pattern,
        site.row,
        site.column,
      ),
      topScale: selectedShape === "cell-crystal" ? 0.12 : 0.72,
      topOffsetX: Math.cos(pattern.angleRad) * lean,
      topOffsetY: Math.sin(pattern.angleRad) * lean,
      name: id,
    });
    tiles.push(
      makeTile(config, {
        id,
        row: site.row,
        column: site.column,
        centerXmm: center.x,
        centerYmm: center.y,
        widthMm,
        depthMm,
        shape: selectedShape,
        mesh,
        pattern,
      }, sampler),
    );
  }
  return { widthMm, depthMm, tiles };
}

function createHexCanopy(config: WallArtConfig, sampler: CompositionSampler): FamilyGeneration {
  const depth = createDepthMapper(
    config.depthProfile,
    config.tile.baseHeightMm,
    config.tile.reliefHeightMm,
  );
  const radius = config.grid.tileSizeMm / 2;
  const hexHeight = Math.sqrt(3) * radius;
  const xPitch = radius * 1.5 + config.grid.gapMm * 0.75;
  const yPitch = hexHeight + config.grid.gapMm;
  const widthMm = radius * 2 + (config.grid.columns - 1) * xPitch;
  const depthMm =
    config.grid.rows * yPitch -
    config.grid.gapMm +
    (config.grid.columns > 1 ? yPitch / 2 : 0);
  const effectiveRadius = Math.max(1, radius - config.grid.gapMm / 2);
  const polygon = Array.from({ length: 6 }, (_, index) => ({
    x: Math.cos((index * Math.PI) / 3) * effectiveRadius,
    y: Math.sin((index * Math.PI) / 3) * effectiveRadius,
  }));
  const tiles: GeneratedTile[] = [];
  type HexCanopyShape = "hex-petal" | "hex-spike" | HexReliefShape;
  const mixedShapes: readonly HexCanopyShape[] = [
    "hex-folded-fan",
    "hex-pinwheel",
    "hex-curved-sweep",
    "hex-wave-bands",
    "hex-spike",
  ];
  const resolveShape = (row: number, column: number): HexCanopyShape => {
    switch (config.tile.shape) {
      case "hex-folded-fan":
      case "hex-pinwheel":
      case "hex-curved-sweep":
      case "hex-wave-bands":
      case "hex-spike":
      case "hex-petal":
        return config.tile.shape;
      case "hex-mixed": {
        const unit = deterministicUnit(
          config.seed,
          "hex-mixed-relief",
          row,
          column,
        );
        return mixedShapes[
          Math.min(
            mixedShapes.length - 1,
            Math.floor(unit * mixedShapes.length),
          )
        ];
      }
      default:
        // Preserve the legacy family fallback for imported incompatible forms.
        return "hex-petal";
    }
  };
  for (let column = 0; column < config.grid.columns; column += 1) {
    for (let row = 0; row < config.grid.rows; row += 1) {
      const centerXmm = radius + column * xPitch;
      const centerYmm =
        hexHeight / 2 + row * yPitch + ((column % 2) * yPitch) / 2;
      const nx = normalized(centerXmm, widthMm);
      const ny = normalized(centerYmm, depthMm);
      if (!inSilhouette(config, nx, ny)) continue;
      const id = gridId(row, column);
      const pattern = sampler(nx, ny);
      const amount = reliefAmount(config, pattern, row, column);
      const heightMm = depth.heightMm(amount, pattern.guideHeightDeltaMm);
      const selectedShape = resolveShape(row, column);
      let mesh: Mesh;
      switch (selectedShape) {
        case "hex-spike":
          mesh = createTileMesh({
            shape: "hex-spike",
            sizeMm: effectiveRadius * 2,
            heightMm,
            topScale: config.tile.topScale,
            leanRatio: config.tile.leanRatio,
            twistDeg: 0,
            orientationRad: pattern.angleRad,
            name: id,
          });
          break;
        case "hex-petal": {
          const petalTopScale = 0.64;
          const requestedPetalLean = radius * config.tile.leanRatio * 0.45;
          const containedPetalLean = Math.min(
            requestedPetalLean,
            effectiveRadius * (1 - petalTopScale) * 0.72,
          );
          mesh = createPolygonFrustumMesh({
            polygon,
            heightMm: depth.clampHeightMm(
              config.tile.baseHeightMm +
                (depth.heightMm(amount) - config.tile.baseHeightMm) * 0.56 +
                (pattern.guideHeightDeltaMm ?? 0),
            ),
            topScale: petalTopScale,
            topOffsetX: Math.cos(pattern.angleRad) * containedPetalLean,
            topOffsetY: Math.sin(pattern.angleRad) * containedPetalLean,
            name: id,
          });
          break;
        }
        case "hex-folded-fan":
        case "hex-pinwheel":
        case "hex-curved-sweep":
        case "hex-wave-bands":
          mesh = createHexReliefMesh({
            shape: selectedShape,
            radiusMm: effectiveRadius,
            baseHeightMm: config.tile.baseHeightMm,
            peakHeightMm: heightMm,
            orientationRad: pattern.angleRad,
            name: id,
          });
          break;
      }
      tiles.push(
        makeTile(config, {
          id,
          row,
          column,
          centerXmm,
          centerYmm,
          widthMm,
          depthMm,
          shape: selectedShape,
          mesh,
          pattern,
        }, sampler),
      );
    }
  }
  return { widthMm, depthMm, tiles };
}

function createCoralCluster(config: WallArtConfig, sampler: CompositionSampler): FamilyGeneration {
  const depth = createDepthMapper(
    config.depthProfile,
    config.tile.baseHeightMm,
    config.tile.reliefHeightMm,
  );
  const { widthMm, depthMm, pitch } = targetGridSize(config);
  const carrierHalf = config.grid.tileSizeMm / 2;
  const selectedShape: TileShapeKind =
    config.tile.shape === "solid-pod" ? "solid-pod" : "ring-pod";
  const tiles: GeneratedTile[] = [];
  for (let row = 0; row < config.grid.rows; row += 1) {
    for (let column = 0; column < config.grid.columns; column += 1) {
      const hierarchy = deterministicUnit(
        config.seed,
        "pod-hierarchy",
        row,
        column,
      );
      const hierarchyDetail = deterministicUnit(
        config.seed,
        "pod-hierarchy-detail",
        row,
        column,
      );
      const targetSizeScale =
        hierarchy < 0.24
          ? 0.42 + hierarchyDetail * 0.12
          : hierarchy < 0.7
            ? 0.6 + hierarchyDetail * 0.15
            : 0.82 + hierarchyDetail * 0.14;
      const sizeScale = lerp(
        0.76,
        targetSizeScale,
        config.design.variation,
      );
      const minimumRadius = Math.min(2, carrierHalf * 0.72);
      const radiusMm = clamp(
        carrierHalf * sizeScale,
        Math.max(0.05, minimumRadius),
        carrierHalf * 0.96,
      );
      const availableInset = Math.max(0, carrierHalf - radiusMm);
      const jitterMagnitude =
        availableInset *
        0.82 *
        config.design.variation *
        Math.sqrt(
          deterministicUnit(config.seed, "pod-jitter-radius", row, column),
        );
      const jitterAngle =
        deterministicUnit(config.seed, "pod-jitter-angle", row, column) *
        Math.PI *
        2;
      const jitterX = Math.cos(jitterAngle) * jitterMagnitude;
      const jitterY = Math.sin(jitterAngle) * jitterMagnitude;
      const centerXmm =
        column * pitch +
        config.grid.tileSizeMm / 2 +
        jitterX;
      const centerYmm =
        row * pitch +
        config.grid.tileSizeMm / 2 +
        jitterY;
      const nx = normalized(centerXmm, widthMm);
      const ny = normalized(centerYmm, depthMm);
      if (!inSilhouette(config, nx, ny)) continue;
      const id = gridId(row, column);
      const pattern = sampler(nx, ny);
      const smoothHeightAmount = (pattern.value + 1) / 2;
      const hierarchyHeightAmount = clamp(
        0.16 +
          deterministicUnit(config.seed, "pod-height", row, column) * 0.68 +
          (1 - targetSizeScale) * 0.18,
        0.12,
        1,
      );
      const heightMm = depth.heightMm(
        lerp(
          smoothHeightAmount,
          hierarchyHeightAmount,
          config.design.variation * proceduralVariationFactor(config) * 0.88,
        ),
        pattern.guideHeightDeltaMm,
      );
      const openingTarget = clamp(
        0.28 +
          deterministicUnit(config.seed, "pod-hole", row, column) * 0.4 +
          (1 - targetSizeScale) * 0.08,
        0.28,
        0.72,
      );
      const topScale = lerp(
        0.8,
        0.62 +
          deterministicUnit(config.seed, "pod-taper", row, column) * 0.32,
        config.design.variation,
      );
      const localEnvelopeLimit = Math.max(
        radiusMm,
        carrierHalf - jitterMagnitude,
      );
      const requestedLean = radiusMm * config.tile.leanRatio * 0.65;
      const safeTopOffset = Math.max(
        0,
        Math.min(requestedLean, localEnvelopeLimit - radiusMm * topScale),
      );
      const organicOrientation =
        pattern.angleRad +
        (deterministicUnit(config.seed, "pod-rotation", row, column) - 0.5) *
          Math.PI *
          config.design.variation;
      let mesh: Mesh;
      if (selectedShape === "ring-pod") {
        mesh = createRingPodMesh({
          radiusMm,
          heightMm,
          innerRatio: lerp(0.48, openingTarget, config.design.variation),
          topScale,
          eccentricity: lerp(
            0.88,
            0.62 +
              deterministicUnit(config.seed, "pod-ecc", row, column) * 0.36,
            config.design.variation,
          ),
          // Build the lean in pod-local +X, then rotate the complete pod once.
          // Applying the world angle both here and below doubled its direction.
          topOffsetX: safeTopOffset,
          topOffsetY: 0,
          segments: Math.round(
            lerp(
              14,
              10 +
                Math.round(
                  deterministicUnit(
                    config.seed,
                    "pod-segments",
                    row,
                    column,
                  ) * 8,
                ),
              config.design.variation,
            ),
          ),
          name: id,
        });
        mesh = rotateMeshZ(mesh, organicOrientation, id);
      } else {
        const segmentCount = Math.round(
          lerp(
            14,
            10 +
              Math.round(
                deterministicUnit(
                  config.seed,
                  "pod-segments",
                  row,
                  column,
                ) * 8,
              ),
            config.design.variation,
          ),
        );
        const eccentricity = lerp(
          0.82,
          0.62 +
            deterministicUnit(config.seed, "pod-ecc", row, column) * 0.36,
          config.design.variation,
        );
        const polygon = Array.from({ length: segmentCount }, (_, index) => {
          const angle = (index / segmentCount) * Math.PI * 2;
          return {
            x: Math.cos(angle) * radiusMm,
            y: Math.sin(angle) * radiusMm * eccentricity,
          };
        });
        mesh = createPolygonFrustumMesh({
          polygon,
          heightMm,
          topScale: 0.16,
          topOffsetX: Math.min(
            radiusMm * config.tile.leanRatio,
            Math.max(0, localEnvelopeLimit - radiusMm * 0.16),
          ),
          topOffsetY: 0,
          name: id,
        });
        mesh = rotateMeshZ(mesh, organicOrientation, id);
      }
      tiles.push(
        makeTile(config, {
          id,
          row,
          column,
          centerXmm,
          centerYmm,
          widthMm,
          depthMm,
          shape: selectedShape,
          mesh,
          pattern,
        }, sampler),
      );
    }
  }
  return { widthMm, depthMm, tiles };
}

function createContourRelief(config: WallArtConfig, sampler: CompositionSampler): FamilyGeneration {
  const depth = createDepthMapper(
    config.depthProfile,
    config.tile.baseHeightMm,
    config.tile.reliefHeightMm,
  );
  const { widthMm, depthMm, pitch } = targetGridSize(config);
  // Surface sampling deliberately ignores the physical installation gaps.
  // Neighboring panel edges therefore have identical logical heights; the
  // gap only separates the already-sampled pieces on the wall.
  const logicalWidthMm = config.grid.columns * config.grid.tileSizeMm;
  const logicalDepthMm = config.grid.rows * config.grid.tileSizeMm;
  const selectedShape: TileShapeKind =
    config.tile.shape === "terraced-panel" ? "terraced-panel" : "relief-panel";
  const tiles: GeneratedTile[] = [];
  for (let row = 0; row < config.grid.rows; row += 1) {
    for (let column = 0; column < config.grid.columns; column += 1) {
      const centerXmm = column * pitch + config.grid.tileSizeMm / 2;
      const centerYmm = row * pitch + config.grid.tileSizeMm / 2;
      const logicalCenterXmm = (column + 0.5) * config.grid.tileSizeMm;
      const logicalCenterYmm = (row + 0.5) * config.grid.tileSizeMm;
      const nx = normalized(centerXmm, widthMm);
      const ny = normalized(centerYmm, depthMm);
      if (!inSilhouette(config, nx, ny)) continue;
      const id = gridId(row, column);
      const createPanelMesh =
        selectedShape === "terraced-panel"
          ? createTerracedPanelMesh
          : createHeightfieldPanelMesh;
      const mesh = createPanelMesh({
        widthMm: config.grid.tileSizeMm,
        depthMm: config.grid.tileSizeMm,
        resolution: config.design.surfaceResolution,
        sampleHeight: (localX, localY) => {
          const sampleX = normalized(logicalCenterXmm + localX, logicalWidthMm);
          const sampleY = normalized(logicalCenterYmm + localY, logicalDepthMm);
          const pattern = sampler.point(sampleX, sampleY);
          const surfaceNoise = fbmNoise2D(
            `${String(config.seed)}:contour-variation`,
            sampleX * 1.35,
            sampleY * 1.35,
            3,
            2,
            0.5,
          );
          let amount = clamp(
            (pattern.value + 1) / 2 +
              surfaceNoise * config.design.variation * proceduralVariationFactor(config) * 0.14,
            0,
            1,
          );
          if (selectedShape === "terraced-panel")
            amount = Math.round(amount * 7) / 7;
          return depth.heightMm(amount, pattern.guideHeightDeltaMm);
        },
        name: id,
      });
      const pattern = sampler(nx, ny);
      tiles.push(
        makeTile(config, {
          id,
          row,
          column,
          centerXmm,
          centerYmm,
          widthMm,
          depthMm,
          shape: selectedShape,
          mesh,
          pattern,
        }, sampler),
      );
    }
  }
  return { widthMm, depthMm, tiles };
}

function createSilhouetteMosaic(config: WallArtConfig, sampler: CompositionSampler): FamilyGeneration {
  const depth = createDepthMapper(
    config.depthProfile,
    config.tile.baseHeightMm,
    config.tile.reliefHeightMm,
  );
  const { widthMm, depthMm, pitch } = targetGridSize(config);
  const tiles: GeneratedTile[] = [];
  for (let row = 0; row < config.grid.rows; row += 1) {
    for (let column = 0; column < config.grid.columns; column += 1) {
      const centerXmm = column * pitch + config.grid.tileSizeMm / 2;
      const centerYmm = row * pitch + config.grid.tileSizeMm / 2;
      const nx = normalized(centerXmm, widthMm);
      const ny = normalized(centerYmm, depthMm);
      if (!inSilhouette(config, nx, ny)) continue;
      const id = gridId(row, column);
      const pattern = sampler(nx, ny);
      const choice =
        config.tile.shape === "mixed-block"
          ? hashUint32(config.seed, "mosaic-shape", row, column) % 3
          : config.tile.shape === "leaning-pyramid"
            ? 1
            : config.tile.shape === "twisted-prism"
              ? 2
              : 0;
      const sizeScale =
        0.82 +
        deterministicUnit(config.seed, "mosaic-size", row, column) *
          0.18 *
          config.design.variation;
      const sizeMm = config.grid.tileSizeMm * sizeScale;
      const heightMm = reliefHeight(config, depth, pattern, row, column);
      let shape: TileShapeKind;
      let mesh: Mesh;
      if (choice === 1) {
        shape = "leaning-pyramid";
        mesh = createTileMesh({
          shape,
          sizeMm,
          heightMm,
          topScale: config.tile.topScale,
          leanRatio: config.tile.leanRatio,
          twistDeg: config.tile.twistDeg,
          orientationRad: pattern.angleRad,
          name: id,
        });
      } else if (choice === 2) {
        shape = "twisted-prism";
        mesh = createTileMesh({
          shape,
          sizeMm,
          heightMm,
          topScale: config.tile.topScale,
          leanRatio: config.tile.leanRatio,
          twistDeg: config.tile.twistDeg,
          orientationRad: pattern.angleRad,
          name: id,
        });
      } else {
        shape = "folded-ridge";
        mesh = createRidgeTileMesh(sizeMm, heightMm, pattern.angleRad, id);
      }
      tiles.push(
        makeTile(config, {
          id,
          row,
          column,
          centerXmm,
          centerYmm,
          widthMm,
          depthMm,
          shape,
          mesh,
          pattern,
        }, sampler),
      );
    }
  }
  return { widthMm, depthMm, tiles };
}

export function generateFamily(
  config: WallArtConfig,
  assets: GenerationAssets = {},
): FamilyGeneration {
  const sampler = createCompositionSampler(config, assets);
  switch (config.design.family) {
    case "folded-flow":
      return createFoldedFlow(config, sampler);
    case "sampled-blocks":
      return createSampledBlocks(config, sampler);
    case "triangular-current":
      return createTriangularCurrent(config, sampler, assets);
    case "polar-bloom":
      return createPolarBloom(config, sampler);
    case "cellular-crystal":
      return createCellularCrystal(config, sampler);
    case "hex-canopy":
      return createHexCanopy(config, sampler);
    case "coral-cluster":
      return createCoralCluster(config, sampler);
    case "contour-relief":
      return createContourRelief(config, sampler);
    case "silhouette-mosaic":
      return createSilhouetteMosaic(config, sampler);
  }
}
