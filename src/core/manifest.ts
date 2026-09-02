import type {
  GeneratedTile,
  MeshDiagnostics,
  PackedPlacement,
  PackingResult,
  WallArtConfig,
  WallArtProject,
} from "./types";

export interface ManifestTile {
  id: string;
  row: number;
  column: number;
  centerXmm: number;
  centerYmm: number;
  orientationDeg: number;
  patternValue: number;
  heightMm: number;
  colorIndex: number;
  color: string;
  shape: GeneratedTile["shape"];
  diagnostics: MeshDiagnostics;
  placement?: PackedPlacement;
}
export interface ProjectManifest {
  schemaVersion: 3;
  projectId: string;
  config: WallArtConfig;
  art: {
    widthMm: number;
    depthMm: number;
    tileCount: number;
  };
  depth: {
    minimumObjectDepthMm: number;
    maximumObjectDepthMm: number;
    reliefSpanMm: number;
    profile: WallArtConfig["depthProfile"];
    masks: WallArtConfig["localDepth"]["masks"];
    paint?: {
      enabled: boolean;
      assetSha256: string;
    };
  };
  diagnostics: WallArtProject["diagnostics"];
  tiles: ManifestTile[];
  packing?: PackingResult;
}

function placementMap(packing?: PackingResult): Map<string, PackedPlacement> {
  const result = new Map<string, PackedPlacement>();
  for (const plate of packing?.plates ?? []) {
    for (const placement of plate.placements) result.set(placement.tileId, placement);
  }
  return result;
}

export function createProjectManifest(
  project: WallArtProject,
  packing?: PackingResult,
): ProjectManifest {
  if (packing && packing.projectId !== project.id) {
    throw new Error("Packing result belongs to a different wall-art project.");
  }
  const placements = placementMap(packing);
  return {
    schemaVersion: 3,
    projectId: project.id,
    config: project.config,
    art: {
      widthMm: project.widthMm,
      depthMm: project.depthMm,
      tileCount: project.tiles.length,
    },
    depth: {
      minimumObjectDepthMm: project.config.tile.baseHeightMm,
      maximumObjectDepthMm:
        project.config.tile.baseHeightMm + project.config.tile.reliefHeightMm,
      reliefSpanMm: project.config.tile.reliefHeightMm,
      profile: project.config.depthProfile,
      masks: project.config.localDepth.masks,
      ...(project.config.localDepth.paint
        ? {
            paint: {
              enabled: project.config.localDepth.paint.enabled,
              assetSha256:
                project.config.localDepth.paint.descriptor.assetSha256,
            },
          }
        : {}),
    },
    diagnostics: project.diagnostics,
    tiles: project.tiles.map((tile) => ({
      id: tile.id,
      row: tile.row,
      column: tile.column,
      centerXmm: tile.centerXmm,
      centerYmm: tile.centerYmm,
      orientationDeg: (tile.orientationRad * 180) / Math.PI,
      patternValue: tile.patternValue,
      heightMm: tile.heightMm,
      colorIndex: tile.colorIndex,
      color: tile.color,
      shape: tile.shape,
      diagnostics: tile.diagnostics,
      placement: placements.get(tile.id),
    })),
    packing,
  };
}

export function serializeProjectJson(
  project: WallArtProject,
  packing?: PackingResult,
  pretty = true,
): string {
  return JSON.stringify(createProjectManifest(project, packing), null, pretty ? 2 : 0);
}

function csvCell(value: string | number | undefined): string {
  if (value === undefined) return "";
  const text = typeof value === "number" ? Number(value.toPrecision(12)).toString() : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function serializeProjectCsv(
  project: WallArtProject,
  packing?: PackingResult,
): string {
  if (packing && packing.projectId !== project.id) {
    throw new Error("Packing result belongs to a different wall-art project.");
  }
  const placements = placementMap(packing);
  const headers = [
    "tile_id",
    "row",
    "column",
    "shape",
    "color_index",
    "color",
    "pattern_value",
    "height_mm",
    "art_center_x_mm",
    "art_center_y_mm",
    "art_orientation_deg",
    "plate_index",
    "plate_x_mm",
    "plate_y_mm",
    "plate_rotation_deg",
  ];
  const rows = project.tiles.map((tile) => {
    const placement = placements.get(tile.id);
    return [
      tile.id,
      tile.row + 1,
      tile.column + 1,
      tile.shape,
      tile.colorIndex,
      tile.color,
      tile.patternValue,
      tile.heightMm,
      tile.centerXmm,
      tile.centerYmm,
      (tile.orientationRad * 180) / Math.PI,
      placement?.plateIndex,
      placement?.translateXmm,
      placement?.translateYmm,
      placement?.rotationDeg,
    ]
      .map((value) => csvCell(value))
      .join(",");
  });
  return `${[headers.join(","), ...rows].join("\r\n")}\r\n`;
}
