import {
  serializeProjectCsv,
  serializeProjectJson,
  type PackingResult,
  type WallArtProject,
} from '../core';
import {
  fullArt3mfFileName,
  fullArtStlFileName,
  plate3mfFileName,
  plateColorDescriptors,
  plateColorLabel,
  plateStlFileName,
} from './naming';

export function createAssemblyManifestCsv(project: WallArtProject, packing?: PackingResult): string {
  return serializeProjectCsv(project, packing);
}

export function createProjectExportJson(project: WallArtProject, packing?: PackingResult): string {
  return serializeProjectJson(project, packing, true);
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One traceable row per print plate, including its exact color-labelled files. */
export function createPlateManifestCsv(
  project: WallArtProject,
  packing: PackingResult,
): string {
  if (packing.projectId !== project.id) {
    throw new Error(`Packing result belongs to project ${packing.projectId}, not ${project.id}.`);
  }
  const headers = [
    'plate_index',
    'plate_id',
    'represented_colors',
    'color_indices',
    'color_hex_values',
    'part_count',
    '3mf_file',
    'stl_file',
  ];
  const rows = [...packing.plates]
    .sort((left, right) => left.index - right.index || left.id.localeCompare(right.id))
    .map((plate) => {
      const colors = plateColorDescriptors(project, plate);
      return [
        plate.index,
        plate.id,
        plateColorLabel(project, plate),
        colors.map((color) => color.ordinal).join(' + '),
        colors.map((color) => color.hex).join(' + '),
        plate.placements.length,
        `3mf/plates/${plate3mfFileName(project, plate)}`,
        `stl/plates/${plateStlFileName(project, plate)}`,
      ].map(csvCell).join(',');
    });
  return `${[headers.join(','), ...rows].join('\r\n')}\r\n`;
}

export function createPackageIdentityText(
  project: WallArtProject,
  packing: PackingResult,
): string {
  if (packing.projectId !== project.id) {
    throw new Error(`Packing result belongs to project ${packing.projectId}, not ${project.id}.`);
  }
  const depth = project.config.depthProfile;
  const maskLines = project.config.localDepth.masks.map((mask) =>
    `  ${mask.id}: ${mask.kind}, ${mask.enabled ? 'enabled' : 'disabled'}, ${mask.strengthMm} mm`,
  );
  return [
    'RELIEF FORGE PACKAGE IDENTITY',
    '=============================',
    `Project ID: ${project.id}`,
    `Seed: ${JSON.stringify(project.config.seed)}`,
    `Geometry family: ${project.config.design.family}`,
    `Form: ${project.config.tile.shape}`,
    `Composition source: ${project.config.source.kind}`,
    ...(project.config.source.kind === 'photo'
      ? [`Canonical photo SHA-256: ${project.config.source.photo?.assetSha256}`]
      : []),
    `Silhouette: ${project.config.design.silhouette}`,
    `Finished dimensions: ${project.widthMm.toFixed(3)} x ${project.depthMm.toFixed(3)} mm`,
    `Object depth range: ${project.config.tile.baseHeightMm.toFixed(3)} to ${(project.config.tile.baseHeightMm + project.config.tile.reliefHeightMm).toFixed(3)} mm (${project.config.tile.reliefHeightMm.toFixed(3)} mm relief span)`,
    `Depth profile: invert=${depth.invert}, contrast=${depth.contrast}, curve=${depth.curve}, levels=${depth.levels === 0 ? 'continuous' : depth.levels}`,
    `Regional depth masks: ${project.config.localDepth.masks.length}`,
    ...maskLines,
    ...(project.config.localDepth.paint
      ? [
          `Depth paint: ${project.config.localDepth.paint.enabled ? 'enabled' : 'retained-disabled'}`,
          `Canonical depth-paint SHA-256: ${project.config.localDepth.paint.descriptor.assetSha256}`,
        ]
      : ['Depth paint: none']),
    `Parts: ${project.tiles.length}`,
    `Packed plates: ${packing.plates.length}`,
    `Primary visual/color check: 3mf/${fullArt3mfFileName(project)}`,
    '',
    'Do not mix this package with files whose Project ID differs.',
    '',
  ].join('\n');
}

export interface FabricationReadmeOptions {
  includesA4: boolean;
  includesLetter: boolean;
  stlFormat: 'binary';
}

export function createFabricationReadme(
  project: WallArtProject,
  packing: PackingResult,
  options: FabricationReadmeOptions,
): string {
  const tiledPackets = [options.includesA4 ? 'A4' : '', options.includesLetter ? 'US Letter' : '']
    .filter(Boolean)
    .join(' and ');
  const colors = new Map<number, { color: string; count: number }>();
  for (const tile of project.tiles) {
    const entry = colors.get(tile.colorIndex);
    if (entry) entry.count += 1;
    else colors.set(tile.colorIndex, { color: tile.color, count: 1 });
  }

  const quantityLines = [...colors.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, entry]) => `  Color ${index + 1}: ${entry.color} - ${entry.count} parts`)
    .join('\n');
  const plateLines = [...packing.plates]
    .sort((left, right) => left.index - right.index || left.id.localeCompare(right.id))
    .flatMap((plate) => [
      `  Plate ${String(plate.index).padStart(3, '0')}: ${plateColorLabel(project, plate)} - ${plate.placements.length} parts`,
      `    3MF: 3mf/plates/${plate3mfFileName(project, plate)}`,
      `    STL: stl/plates/${plateStlFileName(project, plate)}`,
    ])
    .join('\n');

  return [
    '3D WALL ART FABRICATION PACKAGE',
    '=================================',
    '',
    `Project: ${project.id}`,
    `Finished dimensions: ${project.widthMm.toFixed(2)} x ${project.depthMm.toFixed(2)} mm`,
    `Parts: ${project.tiles.length}`,
    `Packed plates: ${packing.plates.length}`,
    '',
    'START HERE',
    '----------',
    '1. Open pdf/master-1-to-1.pdf for the full-scale vector assembly map.',
    tiledPackets
      ? `2. For desktop printing, use the ${tiledPackets} packet in pdf/. Print at 100% / Actual Size.`
      : '2. This package does not include a desktop-paper tiled packet.',
    '3. Disable Fit, Shrink, Scale-to-page, and all printer-driver scaling.',
    '4. Measure the 100 x 100 mm calibration square before attaching any parts.',
    '5. Match the searchable part ID in the PDF to manifest/assembly-manifest.csv.',
    '6. Use the orientation arrow in the PDF and the rotation fields in the manifest.',
    '',
    '3MF AND STL FILES',
    '-----------------',
    `- 3mf/${fullArt3mfFileName(project)} is the assembled color reference in the exact orientation shown by the app. It is not bed-packed and may exceed your printer bed. Decline auto-arrange when comparing it with the app.`,
    '- 3mf/plates/ contains one portable, pre-packed Core + Materials-extension 3MF per printer plate. These are geometry/color files, not Bambu Studio project files.',
    '- In Bambu Studio, create/select the intended printer, nozzle, process, and filament profiles first. Then use File > Import > Import 3MF/STL/STEP/SVG as a model (or Ctrl+I) and choose geometry-only if prompted. Do not use Open Project.',
    '- When Bambu Studio shows Standard 3MF Import color, keep color data enabled and map each listed RGB color to the intended filament/AMS slot. The requested RGB colors are embedded per triangle; the file cannot identify which physical spool you loaded.',
    '- A Bambu "recommended" slot is only a display-color match. Verify the material type and physical spool; the slicer may recommend a same-color TPU/PETG slot when you intend to print PLA.',
    '- Bambu Studio 2.8.2.60/2.8.2.61 may incorrectly warn that a standards-only 3MF has "invalid config". This is a known slicer regression: acknowledge the warning, then verify the imported object count, bed bounds, scale, and active profiles before slicing.',
    '- Each 3MF keeps parts as separately named objects with their validated transforms and requested display colors.',
    '- A slicer may still offer to auto-arrange imported objects. Decline that unless you intentionally want to replace the generated packing.',
    `- stl/${fullArtStlFileName(project)} is the complete preview-aligned model for measurement and geometry-only reference. It may exceed your printer bed.`,
    '- stl/plates/ contains a legacy pre-packed multi-shell STL per plate. Import in millimeters and do not split or auto-arrange it.',
    '- stl/parts/color-XX-RRGGBB/ contains one local-origin STL per stable part ID for replacement prints.',
    '- Plate STLs preserve relative placement. Your slicer may move the combined plate object as a whole.',
    '- STL does not support a reliable material/color channel. Use the 3MF files whenever color must survive import.',
    '',
    'COLOR QUANTITIES',
    '----------------',
    quantityLines || '  No parts',
    '',
    'COLOR-LABELLED PRINT PLATES',
    '---------------------------',
    plateLines || '  No plates',
    '',
    'FILES AND TRACEABILITY',
    '----------------------',
    '- project/project.json preserves the generator configuration and packing result.',
    project.config.source.kind === 'photo'
      ? '- project/photo/ contains the metadata-free canonical RGBA8 field and its SHA-256 descriptor. It does not contain the original upload, filename, EXIF, or location metadata.'
      : '- This procedural project contains no uploaded image data.',
    project.config.localDepth.paint
      ? '- project/depth-paint/ contains the canonical signed depth field and its metadata-safe descriptor for deterministic reconstruction.'
      : '- This project contains no retained depth-paint field.',
    '- manifest/assembly-manifest.csv links every stable part ID to color, position, orientation, and plate.',
    '- manifest/plate-manifest.csv links every plate to its represented color index, HEX value, and exact 3MF/STL filenames.',
    '- Marker numbers in the PDFs are one-based color group numbers.',
    '',
    'SCALE CHECK',
    '-----------',
    'PDF and STL units are millimeters. A failed calibration measurement means the printout is not safe to use.',
    'Correct printer or PDF-viewer scaling and reprint the map before assembly.',
    '',
  ].join('\n');
}
