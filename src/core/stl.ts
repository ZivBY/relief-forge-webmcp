import {
  combineMeshes,
  rotateMeshZ,
  translateMesh,
  triangleNormal,
} from "./mesh";
import type {
  GeneratedTile,
  Mesh,
  PackedPlate,
  Triangle,
  WallArtProject,
} from "./types";

export type StlFormat = "ascii" | "binary";

function safeSolidName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "wall-art";
}

function numberForAscii(value: number): string {
  if (Object.is(value, -0) || Math.abs(value) < 1e-12) return "0";
  return Number(value.toPrecision(9)).toString();
}

export function serializeAsciiStl(mesh: Mesh, name = mesh.name): string {
  const solidName = safeSolidName(name);
  const lines = [`solid ${solidName}`];
  for (const triangle of mesh.triangles) {
    const normal = triangleNormal(mesh, triangle);
    lines.push(
      `  facet normal ${numberForAscii(normal.x)} ${numberForAscii(normal.y)} ${numberForAscii(normal.z)}`,
      "    outer loop",
    );
    for (const vertexIndex of triangle) {
      const vertex = mesh.vertices[vertexIndex];
      lines.push(
        `      vertex ${numberForAscii(vertex.x)} ${numberForAscii(vertex.y)} ${numberForAscii(vertex.z)}`,
      );
    }
    lines.push("    endloop", "  endfacet");
  }
  lines.push(`endsolid ${solidName}`);
  return `${lines.join("\n")}\n`;
}

function writeHeader(bytes: Uint8Array, name: string): void {
  const header = `Deterministic wall art STL: ${safeSolidName(name)}`.slice(0, 80);
  for (let index = 0; index < header.length; index += 1) {
    bytes[index] = header.charCodeAt(index) & 0x7f;
  }
}

export function serializeBinaryStl(mesh: Mesh, name = mesh.name): Uint8Array {
  const buffer = new ArrayBuffer(84 + mesh.triangles.length * 50);
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  writeHeader(bytes, name);
  view.setUint32(80, mesh.triangles.length, true);
  let offset = 84;
  for (const triangle of mesh.triangles) {
    const normal = triangleNormal(mesh, triangle);
    for (const value of [normal.x, normal.y, normal.z]) {
      view.setFloat32(offset, value, true);
      offset += 4;
    }
    for (const vertexIndex of triangle) {
      const vertex = mesh.vertices[vertexIndex];
      for (const value of [vertex.x, vertex.y, vertex.z]) {
        view.setFloat32(offset, value, true);
        offset += 4;
      }
    }
    view.setUint16(offset, 0, true);
    offset += 2;
  }
  return bytes;
}

export function buildPackedPlateMesh(
  project: WallArtProject,
  plate: PackedPlate,
): Mesh {
  const byId = new Map(project.tiles.map((tile) => [tile.id, tile]));
  const meshes = plate.placements.map((placement) => {
    const tile = byId.get(placement.tileId);
    if (!tile) throw new Error(`Plate references unknown tile: ${placement.tileId}.`);
    const rotated =
      placement.rotationDeg === 90
        ? rotateMeshZ(tile.mesh, Math.PI / 2, tile.id)
        : tile.mesh;
    return translateMesh(
      rotated,
      placement.translateXmm,
      placement.translateYmm,
      0,
      tile.id,
    );
  });
  return combineMeshes(meshes, `${project.id}-${plate.id}`);
}

/**
 * Build the assembled artwork in the same orientation shown by WallArtViewer.
 *
 * The generator uses an installation plane whose Y axis increases from the
 * top row toward the bottom row. The WebGL preview reflects that axis so the
 * first row is at the top of the screen. Historically `full-art.stl` skipped
 * this reflection, so directional designs arrived in a slicer vertically
 * mirrored relative to the preview. Reflecting Y reverses handedness, so the
 * triangle order is swapped here to preserve outward winding.
 */
export function buildPreviewAlignedFullArtMesh(project: WallArtProject): Mesh {
  const previewAlignedTile = (tile: GeneratedTile): Mesh => ({
    name: tile.id,
    vertices: tile.mesh.vertices.map((vertex) => ({
      x: tile.centerXmm + vertex.x,
      y: project.depthMm - (tile.centerYmm + vertex.y),
      z: vertex.z,
    })),
    triangles: tile.mesh.triangles.map(
      ([a, b, c]) => [a, c, b] as Triangle,
    ),
  });

  return combineMeshes(
    project.tiles.map(previewAlignedTile),
    `${project.id}-full-art-preview-aligned`,
  );
}

export function serializeFullArtStl(
  project: WallArtProject,
  format: StlFormat = "binary",
): string | Uint8Array {
  const mesh = buildPreviewAlignedFullArtMesh(project);
  return format === "ascii"
    ? serializeAsciiStl(mesh, mesh.name)
    : serializeBinaryStl(mesh, mesh.name);
}

export function serializePackedPlateStl(
  project: WallArtProject,
  plate: PackedPlate,
  format: StlFormat = "binary",
): string | Uint8Array {
  const mesh = buildPackedPlateMesh(project, plate);
  return format === "ascii"
    ? serializeAsciiStl(mesh, mesh.name)
    : serializeBinaryStl(mesh, mesh.name);
}
