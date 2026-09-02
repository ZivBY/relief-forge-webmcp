import { createWallArtConfig } from "./config";
import { generateFamily } from "./families";
import { combineMeshes, diagnoseMesh, meshBounds, translateMesh } from "./mesh";
import { hashUint32 } from "./random";
import { applyFinalTriangleGuides } from "./triangle-guide-correction";
import { resolvePhotoFieldAsset, validatePhotoFieldAsset } from "./photo-field";
import {
  resolveDepthPaintFieldAsset,
  validateDepthPaintFieldAsset,
} from "../depth-paint/field";
import type {
  GenerationAssets,
  GeneratedTile,
  Mesh,
  MeshDiagnostics,
  WallArtConfig,
  WallArtConfigInput,
  WallArtProject,
} from "./types";

/**
 * Increment whenever identical normalized config can produce different mesh
 * geometry. Keeping this separate from the recipe schema prevents old meshes
 * and new algorithms from silently sharing a project/export identity.
 */
export const PROCEDURAL_GEOMETRY_ALGORITHM_VERSION = 6;
export const PHOTO_GEOMETRY_ALGORITHM_VERSION = 7;
/** Backward-compatible name for the newest (photo) geometry algorithm. */
export const GEOMETRY_ALGORITHM_VERSION = PHOTO_GEOMETRY_ALGORITHM_VERSION;

export function meshesAtArtPositions(tiles: readonly GeneratedTile[]): Mesh[] {
  return tiles.map((tile) =>
    translateMesh(tile.mesh, tile.centerXmm, tile.centerYmm, 0, tile.id),
  );
}

export function buildFullArtMesh(project: WallArtProject): Mesh {
  return combineMeshes(meshesAtArtPositions(project.tiles), `${project.id}-full-art`);
}

function fabricationDiagnosticsPass(diagnostics: MeshDiagnostics): boolean {
  return (
    diagnostics.nonFiniteVertexCount === 0 &&
    diagnostics.invalidTriangleIndexCount === 0 &&
    diagnostics.nonFiniteNormalCount === 0 &&
    diagnostics.nonFiniteMetricCount === 0 &&
    diagnostics.degenerateTriangleCount === 0 &&
    diagnostics.boundaryEdgeCount === 0 &&
    diagnostics.nonManifoldEdgeCount === 0 &&
    diagnostics.closedManifold &&
    diagnostics.outwardWinding
  );
}

/**
 * Stable identity of a normalized generator recipe.
 *
 * Keep this calculation separate from geometry generation so every export
 * boundary can reject a project whose configuration was mutated after it was
 * generated. Without that check, a ZIP could carry an old mesh under a
 * project.json recipe that describes a different design.
 */
export function wallArtProjectId(
  config: WallArtConfig,
  geometryAlgorithmVersion?: number,
): string {
  const normalized = createWallArtConfig(config);
  const resolvedGeometryVersion = geometryAlgorithmVersion ?? (
    normalized.source.kind === "photo"
      ? PHOTO_GEOMETRY_ALGORITHM_VERSION
      : PROCEDURAL_GEOMETRY_ALGORITHM_VERSION
  );
  if (!Number.isInteger(resolvedGeometryVersion) || resolvedGeometryVersion < 1) {
    throw new Error("Geometry algorithm version must be a positive integer.");
  }
  const fingerprint = JSON.stringify(normalized);
  return `wall-art-g${resolvedGeometryVersion}-${hashUint32(
    normalized.seed,
    "project",
    `geometry-v${resolvedGeometryVersion}`,
    fingerprint,
  )
    .toString(16)
    .padStart(8, "0")}`;
}

/** Throw when a project no longer has the identity of its stored recipe. */
export function assertWallArtProjectIdentity(project: WallArtProject): void {
  const expectedId = wallArtProjectId(project.config);
  if (project.id !== expectedId) {
    throw new Error(
      `Project identity mismatch: project ${project.id} contains recipe ${expectedId}. Regenerate before exporting.`,
    );
  }
  if (project.config.source.kind === "photo") {
    if (!project.sourceAsset) {
      throw new Error("Photo project is missing its canonical source asset.");
    }
    validatePhotoFieldAsset(project.sourceAsset);
    if (project.sourceAsset.sha256 !== project.config.source.photo?.assetSha256) {
      throw new Error("Photo project source asset does not match its recipe.");
    }
    if (
      project.sourceAsset.width !== project.config.source.photo.canonicalWidth ||
      project.sourceAsset.height !== project.config.source.photo.canonicalHeight
    ) {
      throw new Error("Photo project source dimensions do not match its recipe.");
    }
  } else if (project.sourceAsset) {
    throw new Error("Procedural project cannot carry a photo source asset.");
  }
  const paintConfig = project.config.localDepth.paint;
  if (paintConfig) {
    if (!project.depthPaintAsset) {
      throw new Error("Project is missing its retained canonical depth-paint field.");
    }
    validateDepthPaintFieldAsset(project.depthPaintAsset);
    resolveDepthPaintFieldAsset(paintConfig.descriptor, {
      [project.depthPaintAsset.sha256]: project.depthPaintAsset,
    });
  } else if (project.depthPaintAsset) {
    throw new Error("Project cannot carry a depth-paint field without a recipe descriptor.");
  }
}

function applyFinishedSize(
  config: WallArtConfig,
  naturalWidthMm: number,
  naturalDepthMm: number,
  naturalTiles: GeneratedTile[],
): { widthMm: number; depthMm: number; tiles: GeneratedTile[] } {
  const requestedWidth = config.finishedSize.widthMm;
  const requestedHeight = config.finishedSize.heightMm;
  if (requestedWidth === undefined && requestedHeight === undefined) {
    return { widthMm: naturalWidthMm, depthMm: naturalDepthMm, tiles: naturalTiles };
  }

  const naturalFullMesh = combineMeshes(
    meshesAtArtPositions(naturalTiles),
    "natural-finished-size-bounds",
  );
  const bounds = meshBounds(naturalFullMesh);
  if (!(bounds.size.x > 0) || !(bounds.size.y > 0)) {
    throw new Error("Generated artwork must have positive XY bounds before finished-size scaling.");
  }

  const widthMm = requestedWidth ?? naturalWidthMm;
  const depthMm = requestedHeight ?? naturalDepthMm;
  const scaleX = widthMm / bounds.size.x;
  const scaleY = depthMm / bounds.size.y;

  const tiles = naturalTiles.map((tile) => {
    const mesh: Mesh = {
      ...tile.mesh,
      vertices: tile.mesh.vertices.map((vertex) => ({
        x: vertex.x * scaleX,
        y: vertex.y * scaleY,
        z: vertex.z,
      })),
      triangles: tile.mesh.triangles,
    };
    return {
      ...tile,
      centerXmm: (tile.centerXmm - bounds.min.x) * scaleX,
      centerYmm: (tile.centerYmm - bounds.min.y) * scaleY,
      orientationRad: config.source.kind === "photo"
        ? Math.atan2(
            Math.sin(tile.orientationRad) * scaleY,
            Math.cos(tile.orientationRad) * scaleX,
          )
        : tile.orientationRad,
      mesh,
      diagnostics: diagnoseMesh(mesh),
    };
  });

  return { widthMm, depthMm, tiles };
}

export function generateWallArt(
  overrides: WallArtConfigInput = {},
  assets: GenerationAssets = {},
): WallArtProject {
  const config = createWallArtConfig(overrides);
  const sourceAsset = resolvePhotoFieldAsset(config, assets);
  const paintConfig = config.localDepth.paint;
  const depthPaintAsset = paintConfig
    ? resolveDepthPaintFieldAsset(
        paintConfig.descriptor,
        assets.depthPaintFields ?? {},
      )
    : undefined;
  const natural = generateFamily(config, assets);
  if (natural.tiles.length === 0) {
    throw new Error(
      "No parts intersect the selected silhouette at this density. Increase Across or Down, reduce Part size, or choose another silhouette.",
    );
  }
  const finished = applyFinishedSize(
    config,
    natural.widthMm,
    natural.depthMm,
    natural.tiles,
  );
  const naturalGeometryPasses = natural.tiles.every((tile) =>
    fabricationDiagnosticsPass(tile.diagnostics),
  );
  if (
    naturalGeometryPasses &&
    finished.tiles.some((tile) => !fabricationDiagnosticsPass(tile.diagnostics))
  ) {
    throw new Error(
      "The finished size is too small for this part density at supported geometry precision. Increase Width or Height, reduce Across or Down, or use fewer parts.",
    );
  }
  const { widthMm, depthMm } = finished;
  const tiles = applyFinalTriangleGuides(
    config,
    widthMm,
    depthMm,
    finished.tiles,
  );

  const id = wallArtProjectId(config);
  const fullMesh = combineMeshes(meshesAtArtPositions(tiles), `${id}-full-art`);
  const closedTileCount = tiles.filter((tile) => tile.diagnostics.closedManifold).length;
  return {
    schemaVersion: 3,
    id,
    config,
    sourceAsset,
    depthPaintAsset,
    widthMm,
    depthMm,
    tiles,
    diagnostics: {
      tileCount: tiles.length,
      closedTileCount,
      allTilesClosedManifold:
        tiles.length > 0 && closedTileCount === tiles.length,
      fullMesh: diagnoseMesh(fullMesh),
    },
  };
}
