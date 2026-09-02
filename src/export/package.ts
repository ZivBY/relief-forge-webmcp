import JSZip from 'jszip';

import {
  assertWallArtProjectIdentity,
  serializeBinaryStl,
  serializeFullArtStl,
  serializePackedPlateStl,
  type PackingResult,
  type WallArtProject,
} from '../core';
import {
  createAssemblyManifestCsv,
  createFabricationReadme,
  createPackageIdentityText,
  createPlateManifestCsv,
  createProjectExportJson,
} from './manifest';
import { createMasterAssemblyPdfBytes, createTiledAssemblyPdfBytes } from './pdf';
import {
  createFullArt3mfBytes,
  createPackedPlate3mfBytes,
} from './three-mf';
import {
  fullArt3mfFileName,
  fullArtStlFileName,
  normalizeRgb,
  plate3mfFileName,
  plateStlFileName,
} from './naming';
import { analyzePhotoAsset } from '../photo/analysis';
import { encodeDepthPaintFieldAsset } from '../depth-paint/field';

export interface FabricationPackageOptions {
  includeA4?: boolean;
  includeLetter?: boolean;
}

const ZIP_MIME = 'application/zip';
const FIXED_ZIP_DATE = new Date('1980-01-01T00:00:00.000Z');

function safeFileSegment(value: string): string {
  const cleaned = value
    .normalize('NFKD')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return cleaned || 'part';
}

function uniquePartPath(
  usedPaths: Set<string>,
  colorIndex: number,
  color: string,
  tileId: string,
): string {
  const folder =
    `stl/parts/color-${String(colorIndex + 1).padStart(2, '0')}-${normalizeRgb(color)}`;
  const stem = safeFileSegment(tileId);
  let candidate = `${folder}/${stem}.stl`;
  let suffix = 2;
  while (usedPaths.has(candidate.toLocaleLowerCase())) {
    candidate = `${folder}/${stem}-${suffix}.stl`;
    suffix += 1;
  }
  usedPaths.add(candidate.toLocaleLowerCase());
  return candidate;
}

function binaryStl(value: string | Uint8Array): string | Uint8Array {
  return value;
}

export async function createFabricationPackageBytes(
  project: WallArtProject,
  packing: PackingResult,
  options: FabricationPackageOptions = {},
): Promise<Uint8Array> {
  assertWallArtProjectIdentity(project);
  if (packing.projectId !== project.id) {
    throw new Error(`Packing result belongs to project ${packing.projectId}, not ${project.id}.`);
  }

  const includeA4 = options.includeA4 ?? true;
  const includeLetter = options.includeLetter ?? true;
  const zip = new JSZip();
  const fileOptions = { date: FIXED_ZIP_DATE, createFolders: false };

  zip.file('pdf/master-1-to-1.pdf', createMasterAssemblyPdfBytes(project), fileOptions);
  if (includeA4) {
    zip.file('pdf/tiled-a4.pdf', createTiledAssemblyPdfBytes(project, { paper: 'a4' }), fileOptions);
  }
  if (includeLetter) {
    zip.file('pdf/tiled-us-letter.pdf', createTiledAssemblyPdfBytes(project, { paper: 'letter' }), fileOptions);
  }

  zip.file('project/project.json', createProjectExportJson(project, packing), fileOptions);
  if (project.sourceAsset && project.config.source.kind === 'photo') {
    const analysis = analyzePhotoAsset(
      project.sourceAsset,
      project.config.source.photo!.requestedColorCount,
      project.config.palette.colors,
    );
    zip.file('project/photo/canonical-field.rgba', project.sourceAsset.rgba8, fileOptions);
    zip.file('project/photo/source.json', JSON.stringify({
      version: project.sourceAsset.version,
      width: project.sourceAsset.width,
      height: project.sourceAsset.height,
      colorSpace: project.sourceAsset.colorSpace,
      format: 'rgba8',
      sha256: project.sourceAsset.sha256,
      mapping: project.config.source.photo,
      paletteLimitAnalysis: {
        version: 1,
        palette: analysis.palette,
        averageDeltaE: analysis.averageDeltaE,
        p95DeltaE: analysis.p95DeltaE,
        edgeDensity: analysis.edgeDensity,
        directionCoherence: analysis.directionCoherence,
        luminanceRange: analysis.luminanceRange,
        recommendation: analysis.recommendation,
        note: 'Color metrics evaluate the palette limit at 100% photo color influence.',
      },
      file: 'canonical-field.rgba',
    }, null, 2), fileOptions);
  }
  if (project.config.localDepth.paint) {
    const asset = project.depthPaintAsset;
    if (!asset) {
      throw new Error('Project is missing its retained canonical depth-paint field.');
    }
    zip.file(
      'project/depth-paint/canonical-field.rfdepth',
      encodeDepthPaintFieldAsset(asset),
      fileOptions,
    );
    zip.file('project/depth-paint/descriptor.json', JSON.stringify({
      ...project.config.localDepth.paint.descriptor,
      enabled: project.config.localDepth.paint.enabled,
      format: 'relief-forge-depth-paint-int16le',
      file: 'canonical-field.rfdepth',
    }, null, 2), fileOptions);
  }
  zip.file('manifest/assembly-manifest.csv', createAssemblyManifestCsv(project, packing), fileOptions);
  zip.file('manifest/plate-manifest.csv', createPlateManifestCsv(project, packing), fileOptions);
  zip.file('manifest/PROJECT-IDENTITY.txt', createPackageIdentityText(project, packing), fileOptions);
  zip.file(
    'README.txt',
    createFabricationReadme(project, packing, {
      includesA4: includeA4,
      includesLetter: includeLetter,
      stlFormat: 'binary',
    }),
    fileOptions,
  );

  zip.file(
    `3mf/${fullArt3mfFileName(project)}`,
    await createFullArt3mfBytes(project),
    fileOptions,
  );
  zip.file(
    `stl/${fullArtStlFileName(project)}`,
    binaryStl(serializeFullArtStl(project, 'binary')),
    fileOptions,
  );

  const sortedPlates = [...packing.plates].sort((a, b) => a.index - b.index || a.id.localeCompare(b.id));
  for (const plate of sortedPlates) {
    zip.file(
      `stl/plates/${plateStlFileName(project, plate)}`,
      binaryStl(serializePackedPlateStl(project, plate, 'binary')),
      fileOptions,
    );
    zip.file(
      `3mf/plates/${plate3mfFileName(project, plate)}`,
      await createPackedPlate3mfBytes(project, plate),
      fileOptions,
    );
  }

  const usedPartPaths = new Set<string>();
  const sortedTiles = [...project.tiles].sort(
    (a, b) => a.colorIndex - b.colorIndex || a.row - b.row || a.column - b.column || a.id.localeCompare(b.id),
  );
  for (const tile of sortedTiles) {
    const path = uniquePartPath(usedPartPaths, tile.colorIndex, tile.color, tile.id);
    zip.file(path, serializeBinaryStl(tile.mesh, tile.id), fileOptions);
  }

  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    platform: 'DOS',
    mimeType: ZIP_MIME,
  });
}

export async function createFabricationPackage(
  project: WallArtProject,
  packing: PackingResult,
  options: FabricationPackageOptions = {},
): Promise<Blob> {
  const bytes = await createFabricationPackageBytes(project, packing, options);
  const arrayBuffer = bytes.slice().buffer as ArrayBuffer;
  return new Blob([arrayBuffer], { type: ZIP_MIME });
}
