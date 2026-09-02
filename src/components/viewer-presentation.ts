import type { WallArtProject } from "../core/types";

export const HIGH_ASPECT_PREVIEW_RATIO = 1.5;

export function maximumProjectHeight(project: WallArtProject): number {
  return project.tiles.reduce(
    (maximum, tile) => Math.max(maximum, tile.diagnostics.bounds.max.z),
    0,
  );
}

export function representativeProjectFootprint(project: WallArtProject): number {
  const footprints = project.tiles
    .map(({ diagnostics }) => Math.sqrt(
      diagnostics.bounds.size.x * diagnostics.bounds.size.y,
    ))
    .filter((footprint) => footprint > 0)
    .sort((left, right) => left - right);
  return footprints[Math.floor(footprints.length / 2)] ?? 0;
}

export function projectHeightToFootprintRatio(
  project: WallArtProject,
): number {
  const footprint = representativeProjectFootprint(project);
  return footprint > 0 ? maximumProjectHeight(project) / footprint : 0;
}

/**
 * Tall, densely spaced parts can occlude one another in an angled projection
 * even though their XY composition and export meshes remain distinct.
 */
export function shouldSuggestTopView(project: WallArtProject): boolean {
  return (
    project.tiles.length > 0 &&
    projectHeightToFootprintRatio(project) >= HIGH_ASPECT_PREVIEW_RATIO
  );
}
