import JSZip from 'jszip';

import type {
  GeneratedTile,
  Mesh,
  PackedPlate,
  Triangle,
  WallArtProject,
} from '../core';
import { normalizeRgba, plateColorLabel } from './naming';

const MODEL_CONTENT_TYPE = 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml';
const RELATIONSHIP_TYPE = 'http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel';
const CORE_NAMESPACE = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const MATERIAL_NAMESPACE = 'http://schemas.microsoft.com/3dmanufacturing/material/2015/02';
const FIXED_ZIP_DATE = new Date('1980-01-01T00:00:00.000Z');
const BASE_MATERIALS_ID = 1;
const COLOR_GROUP_ID = 2;
const FIRST_OBJECT_ID = 3;

interface ThreeMfObject {
  tile: GeneratedTile;
  mesh: Mesh;
  transform?: string;
}

interface ThreeMfModel {
  title: string;
  description: string;
  objects: ThreeMfObject[];
}

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function decimal(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`3MF coordinates must be finite; received ${String(value)}.`);
  const rounded = Math.abs(value) < 0.0000005 ? 0 : value;
  return rounded.toFixed(6).replace(/0+$/, '').replace(/\.$/, '') || '0';
}

function itemTransform(rotationDeg: 0 | 90, translateXmm: number, translateYmm: number): string {
  if (rotationDeg === 90) {
    return `0 1 0 -1 0 0 0 0 1 ${decimal(translateXmm)} ${decimal(translateYmm)} 0`;
  }
  return `1 0 0 0 1 0 0 0 1 ${decimal(translateXmm)} ${decimal(translateYmm)} 0`;
}

function contentTypesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Override PartName="/3D/3dmodel.model" ContentType="${MODEL_CONTENT_TYPE}"/>` +
    `</Types>`;
}

function relationshipsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="${RELATIONSHIP_TYPE}"/>` +
    `</Relationships>`;
}

function objectDisplayName(tile: GeneratedTile): string {
  const colorOrdinal = String(tile.colorIndex + 1).padStart(2, '0');
  const colorHex = normalizeRgba(tile.color).slice(0, 7);
  return `${tile.id} - Color ${colorOrdinal} ${colorHex}`;
}

function objectXml(source: ThreeMfObject, objectId: number): string {
  const { tile, mesh } = source;
  const vertices = mesh.vertices
    .map((vertex) => `<vertex x="${decimal(vertex.x)}" y="${decimal(vertex.y)}" z="${decimal(vertex.z)}"/>`)
    .join('');
  // Bambu Studio's standard-color importer reads the Materials extension's
  // per-triangle property references. Core basematerials alone are ignored.
  const triangles = mesh.triangles
    .map(([a, b, c]) =>
      `<triangle v1="${a}" v2="${b}" v3="${c}" pid="${COLOR_GROUP_ID}" ` +
      `p1="${tile.colorIndex}" p2="${tile.colorIndex}" p3="${tile.colorIndex}"/>`,
    )
    .join('');
  return `<object id="${objectId}" type="model" pid="${COLOR_GROUP_ID}" pindex="${tile.colorIndex}" ` +
    `name="${xmlEscape(objectDisplayName(tile))}" ` +
    `partnumber="${xmlEscape(tile.id)}">` +
    `<mesh><vertices>${vertices}</vertices><triangles>${triangles}</triangles></mesh></object>`;
}

function modelXml(project: WallArtProject, model: ThreeMfModel): string {
  const colors = project.config.palette.colors;
  const baseMaterials = colors
    .map((color, index) =>
      `<base name="Color ${String(index + 1).padStart(2, '0')} ${normalizeRgba(color).slice(0, 7)}" ` +
      `displaycolor="${normalizeRgba(color)}"/>`,
    )
    .join('');
  const colorGroup = colors
    .map((color) => `<m:color color="${normalizeRgba(color)}"/>`)
    .join('');
  const objects = model.objects
    .map((source, index) => objectXml(source, FIRST_OBJECT_ID + index))
    .join('');
  const items = model.objects
    .map((source, index) => {
      const transform = source.transform ? ` transform="${source.transform}"` : '';
      return `<item objectid="${FIRST_OBJECT_ID + index}" ` +
        `partnumber="${xmlEscape(source.tile.id)}"${transform}/>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<model unit="millimeter" xml:lang="en-US" ` +
    `xmlns="${CORE_NAMESPACE}" xmlns:m="${MATERIAL_NAMESPACE}" requiredextensions="m">` +
    `<metadata name="Title">${xmlEscape(model.title)}</metadata>` +
    `<metadata name="Application">Relief Forge</metadata>` +
    `<metadata name="Description">${xmlEscape(model.description)}</metadata>` +
    `<resources>` +
    `<basematerials id="${BASE_MATERIALS_ID}">${baseMaterials}</basematerials>` +
    `<m:colorgroup id="${COLOR_GROUP_ID}">${colorGroup}</m:colorgroup>` +
    objects +
    `</resources><build>${items}</build></model>`;
}

async function packageModelXml(xml: string): Promise<Uint8Array> {
  const zip = new JSZip();
  // JSZip gives auto-created folder entries the current timestamp even when
  // the nested file has a fixed date. Create the two required directories
  // explicitly so repeated 3MF exports remain byte-for-byte deterministic.
  const options = { date: FIXED_ZIP_DATE, createFolders: false };
  const directoryOptions = {
    date: FIXED_ZIP_DATE,
    createFolders: false,
    dir: true,
  };
  // JSZip accepts null for explicit directory entries at runtime, but its
  // browser overload omits that value when Node types are also loaded.
  const emptyDirectory = null as unknown as string;
  zip.file('_rels/', emptyDirectory, directoryOptions);
  zip.file('3D/', emptyDirectory, directoryOptions);
  zip.file('[Content_Types].xml', contentTypesXml(), options);
  zip.file('_rels/.rels', relationshipsXml(), options);
  zip.file('3D/3dmodel.model', xml, options);
  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    platform: 'DOS',
    mimeType: 'model/3mf',
  });
}

function previewAlignedTileMesh(project: WallArtProject, tile: GeneratedTile): Mesh {
  return {
    name: tile.id,
    vertices: tile.mesh.vertices.map((vertex) => ({
      x: tile.centerXmm + vertex.x,
      y: project.depthMm - (tile.centerYmm + vertex.y),
      z: vertex.z,
    })),
    // Reflection reverses handedness; swap B/C to retain outward winding.
    triangles: tile.mesh.triangles.map(
      ([a, b, c]) => [a, c, b] as Triangle,
    ),
  };
}

/** Core + Materials-extension 3MF with one named/color-tagged object per packed part. */
export async function createPackedPlate3mfBytes(
  project: WallArtProject,
  plate: PackedPlate,
): Promise<Uint8Array> {
  const tileById = new Map(project.tiles.map((tile) => [tile.id, tile]));
  const objects = plate.placements.map((placement) => {
    const tile = tileById.get(placement.tileId);
    if (!tile) throw new Error(`Plate ${plate.id} references missing tile ${placement.tileId}.`);
    return {
      tile,
      mesh: tile.mesh,
      transform: itemTransform(
        placement.rotationDeg,
        placement.translateXmm,
        placement.translateYmm,
      ),
    };
  });
  const model = {
    title: `${project.id} ${plate.id} - ${plateColorLabel(project, plate)}`,
    description:
      `Pre-packed ${decimal(plate.bedWidthMm)} x ${decimal(plate.bedDepthMm)} mm build plate; ` +
      plateColorLabel(project, plate),
    objects,
  };
  return packageModelXml(modelXml(project, model));
}

export async function createPackedPlate3mf(project: WallArtProject, plate: PackedPlate): Promise<Blob> {
  const bytes = await createPackedPlate3mfBytes(project, plate);
  return new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'model/3mf' });
}

/**
 * Assembled, color-carrying reference model in exactly the app preview's
 * orientation. This is intentionally not bed-packed; decline auto-arrange in
 * the slicer when using it to compare against the on-screen composition.
 */
export async function createFullArt3mfBytes(project: WallArtProject): Promise<Uint8Array> {
  const objects = project.tiles.map((tile) => ({
    tile,
    mesh: previewAlignedTileMesh(project, tile),
  }));
  const model = {
    title: `${project.id} assembled color preview`,
    description:
      `Preview-aligned assembled artwork; ${decimal(project.widthMm)} x ${decimal(project.depthMm)} mm; ` +
      'reference layout, not a pre-packed print plate',
    objects,
  };
  return packageModelXml(modelXml(project, model));
}

export async function createFullArt3mf(project: WallArtProject): Promise<Blob> {
  const bytes = await createFullArt3mfBytes(project);
  return new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'model/3mf' });
}
