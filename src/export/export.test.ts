import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { generateWallArt, packWallArt } from '../core';
import {
  buildMasterAssemblyDocument,
  buildTiledAssemblyDocument,
  calculateTiledLayout,
  createAssemblyManifestCsv,
  createFabricationPackage,
  createFabricationPackageBytes,
  createFullArt3mfBytes,
  createMasterAssemblyPdf,
  createPackedPlate3mfBytes,
  createPlateManifestCsv,
  createTiledAssemblyPdf,
  getTileFootprint,
  fullArt3mfFileName,
  fullArtStlFileName,
  MAX_TILED_PDF_PAGES,
  normalizeRgba,
  plate3mfFileName,
  plateStlFileName,
} from './index';

function fixture() {
  const project = generateWallArt({
    seed: 'export-fixture',
    finishedSize: { widthMm: 123.45, heightMm: 87.65, lockAspect: false },
    grid: { columns: 4, rows: 3, tileSizeMm: 28, gapMm: 2 },
    tile: { shape: 'twisted-prism' },
    palette: { colors: ['#214761', '#d79a34', '#6c8b43'], mode: 'rows' },
    printer: {
      bedWidthMm: 140,
      bedDepthMm: 140,
      marginMm: 5,
      spacingMm: 3,
      allowRotate90: true,
      separateColors: true,
    },
  });
  return { project, packing: packWallArt(project) };
}

describe('assembly PDF export', () => {
  it('creates a one-page vector master larger than the finished art', async () => {
    const { project } = fixture();
    const doc = buildMasterAssemblyDocument(project);
    expect(doc.getNumberOfPages()).toBe(1);
    expect(doc.internal.pageSize.getWidth()).toBeGreaterThan(project.widthMm);
    expect(doc.internal.pageSize.getHeight()).toBeGreaterThan(project.depthMm);

    const blob = createMasterAssemblyPdf(project);
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(2_000);
    const header = new TextDecoder().decode((await blob.arrayBuffer()).slice(0, 5));
    expect(header).toBe('%PDF-');
  });

  it('projects local meshes into rotated global assembly footprints', () => {
    const { project } = fixture();
    const tile = project.tiles[0];
    const footprint = getTileFootprint(tile);
    expect(footprint.length).toBeGreaterThanOrEqual(3);
    const centerX = footprint.reduce((sum, point) => sum + point.x, 0) / footprint.length;
    const centerY = footprint.reduce((sum, point) => sum + point.y, 0) / footprint.length;
    expect(Math.abs(centerX - tile.centerXmm)).toBeLessThan(project.config.grid.tileSizeMm);
    expect(Math.abs(centerY - tile.centerYmm)).toBeLessThan(project.config.grid.tileSizeMm);
  });

  it.each(['a4', 'letter'] as const)('creates a %s cover plus every calculated assembly page', async (paper) => {
    const project = generateWallArt({
      seed: `tiled-${paper}`,
      grid: { columns: 13, rows: 8, tileSizeMm: 28, gapMm: 2 },
    });
    const options = { paper, overlapMm: 14 };
    const layout = calculateTiledLayout(project, options);
    const doc = buildTiledAssemblyDocument(project, options);
    expect(layout.columns).toBeGreaterThan(1);
    expect(layout.rows).toBeGreaterThan(1);
    expect(doc.getNumberOfPages()).toBe(layout.totalPageCount);

    const blob = createTiledAssemblyPdf(project, options);
    expect(blob.type).toBe('application/pdf');
    expect(blob.size).toBeGreaterThan(4_000);
  });

  it('rejects overlap that cannot leave a usable tiled page', () => {
    const { project } = fixture();
    expect(() => calculateTiledLayout(project, { overlapMm: 500 })).toThrow(/overlap/i);
  });

  it('rejects tiled packets beyond the synchronous browser page budget', () => {
    expect(() => calculateTiledLayout(
      { widthMm: 10_000, depthMm: 10_000 },
      { paper: 'a4', overlapMm: 12 },
    )).toThrow(
      new RegExp(`requires .*pages.*budget is ${MAX_TILED_PDF_PAGES}`, 'i'),
    );
  });

  it('rejects non-finite dimensions before allocating page windows', () => {
    expect(() => calculateTiledLayout({ widthMm: Number.POSITIVE_INFINITY, depthMm: 500 }))
      .toThrow(/positive finite numbers/i);
    expect(() => calculateTiledLayout({ widthMm: Number.NaN, depthMm: 500 }))
      .toThrow(/positive finite numbers/i);
  });
});

describe('fabrication package export', () => {
  it('writes a manifest row for every stable part ID and its plate placement', () => {
    const { project, packing } = fixture();
    const csv = createAssemblyManifestCsv(project, packing);
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(project.tiles.length + 1);
    expect(csv).toContain('tile_id,row,column');
    expect(csv).toContain(project.tiles[0].id);
    expect(csv).toContain('plate_index');
  });

  it('creates stable entry names for PDFs, manifests, plates, and individual parts', async () => {
    const { project, packing } = fixture();
    const bytes = await createFabricationPackageBytes(project, packing, {
      includeA4: true,
      includeLetter: false,
    });
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files);

    expect(names).toContain('README.txt');
    expect(names).toContain('pdf/master-1-to-1.pdf');
    expect(names).toContain('pdf/tiled-a4.pdf');
    expect(names).not.toContain('pdf/tiled-us-letter.pdf');
    expect(names).toContain('project/project.json');
    expect(names).toContain('manifest/assembly-manifest.csv');
    expect(names).toContain('manifest/plate-manifest.csv');
    expect(names).toContain('manifest/PROJECT-IDENTITY.txt');
    expect(names).toContain(`3mf/${fullArt3mfFileName(project)}`);
    expect(names).toContain(`stl/${fullArtStlFileName(project)}`);
    expect(names.filter((name) => /^stl\/plates\/.*\.stl$/.test(name))).toHaveLength(packing.plates.length);
    expect(names.filter((name) => /^3mf\/plates\/.*\.build\.3mf$/.test(name))).toHaveLength(packing.plates.length);
    expect(names.filter((name) => /^stl\/parts\/color-\d+-[0-9A-F]{6}\/.*\.stl$/.test(name))).toHaveLength(
      project.tiles.length,
    );
    for (const plate of packing.plates) {
      const stlName = plateStlFileName(project, plate);
      const threeMfName = plate3mfFileName(project, plate);
      expect(stlName).toMatch(new RegExp(`^${project.id}-plate-\\d{3}-color`));
      expect(stlName).toMatch(/-\d{2}-[0-9A-F]{6}\.stl$/);
      expect(threeMfName).toBe(stlName.replace(/\.stl$/, '.build.3mf'));
      expect(names).toContain(`stl/plates/${stlName}`);
      expect(names).toContain(`3mf/plates/${threeMfName}`);
    }
    const readme = await zip.file('README.txt')!.async('string');
    expect(readme).toContain('These are geometry/color files, not Bambu Studio project files.');
    expect(readme).toContain('File > Import > Import 3MF/STL/STEP/SVG');
    expect(readme).toContain('Bambu Studio 2.8.2.60/2.8.2.61');
    expect(readme).toContain('Do not use Open Project.');
    expect(readme).toContain(fullArt3mfFileName(project));
    expect(readme).toContain('STL does not support a reliable material/color channel');
    expect(readme).toContain('may exceed your printer bed');
    const identity = await zip.file('manifest/PROJECT-IDENTITY.txt')!.async('string');
    expect(identity).toContain(`Project ID: ${project.id}`);
    expect(identity).toContain(`3mf/${fullArt3mfFileName(project)}`);

    const plateManifest = await zip.file('manifest/plate-manifest.csv')!.async('string');
    expect(plateManifest).toBe(createPlateManifestCsv(project, packing));
    for (const plate of packing.plates) {
      expect(plateManifest).toContain(plate3mfFileName(project, plate));
      expect(plateManifest).toContain(plateStlFileName(project, plate));
    }

    const blob = await createFabricationPackage(project, packing, {
      includeA4: false,
      includeLetter: false,
    });
    expect(blob.type).toBe('application/zip');
    expect(blob.size).toBeGreaterThan(2_000);
  });

  it('labels a mixed-color plate with every represented palette index and HEX value', () => {
    const project = generateWallArt({
      seed: 'mixed-color-plate-label',
      grid: { columns: 3, rows: 2, tileSizeMm: 18, gapMm: 2 },
      palette: {
        colors: ['#102030', '#A1B2C3', '#F0E0D0'],
        mode: 'checker',
      },
      printer: {
        bedWidthMm: 180,
        bedDepthMm: 180,
        marginMm: 5,
        spacingMm: 3,
        allowRotate90: true,
        separateColors: false,
      },
    });
    const packing = packWallArt(project);
    expect(packing.plates).toHaveLength(1);
    const plate = packing.plates[0];
    expect(plate.colorIndices.length).toBeGreaterThan(1);
    const stlName = plateStlFileName(project, plate);
    const manifest = createPlateManifestCsv(project, packing);
    for (const colorIndex of plate.colorIndices) {
      const ordinal = String(colorIndex + 1).padStart(2, '0');
      const rgb = project.config.palette.colors[colorIndex].slice(1).toUpperCase();
      expect(stlName).toContain(`${ordinal}-${rgb}`);
      expect(manifest).toContain(`#${rgb}`);
    }
  });

  it('writes a portable Core 3MF plate without pretending to contain slicer project settings', async () => {
    const { project, packing } = fixture();
    const plate = packing.plates[0];
    const bytes = await createPackedPlate3mfBytes(project, plate);
    const packageZip = await JSZip.loadAsync(bytes);
    expect(Object.keys(packageZip.files).sort()).toEqual([
      '3D/',
      '3D/3dmodel.model',
      '[Content_Types].xml',
      '_rels/',
      '_rels/.rels',
    ]);
    const modelTimestamp = packageZip.files['3D/3dmodel.model'].date.getTime();
    expect(packageZip.files['3D/'].date.getTime()).toBe(modelTimestamp);
    expect(packageZip.files['_rels/'].date.getTime()).toBe(modelTimestamp);
    expect(packageZip.files['_rels/.rels'].date.getTime()).toBe(modelTimestamp);
    expect(packageZip.file('Metadata/project_settings.config')).toBeNull();
    const model = await packageZip.file('3D/3dmodel.model')!.async('string');
    expect(model).toContain('<model unit="millimeter"');
    expect(model).toContain('<metadata name="Application">Relief Forge</metadata>');
    expect(model).not.toContain('BambuStudio:3mfVersion');
    expect(model.match(/<object /g)).toHaveLength(plate.placements.length);
    expect(model.match(/<item /g)).toHaveLength(plate.placements.length);
    expect(model).toContain(`partnumber="${plate.placements[0].tileId}"`);
    expect(model).toContain('xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02"');
    expect(model).toContain('requiredextensions="m"');
    expect(model).toContain('<m:colorgroup id="2">');
    const embeddedPalette = [...model.matchAll(/<m:color color="(#[0-9A-F]{8})"\/>/g)]
      .map((match) => match[1]);
    expect(embeddedPalette).toEqual(
      project.config.palette.colors.map(normalizeRgba),
    );
    expect(model).toContain('displaycolor="#');
    expect(model).toContain('pid="2" pindex="');
    const triangleCount = plate.placements.reduce((sum, placement) => {
      const tile = project.tiles.find((candidate) => candidate.id === placement.tileId)!;
      return sum + tile.mesh.triangles.length;
    }, 0);
    expect(model.match(/<triangle [^>]*pid="2" p1="\d+" p2="\d+" p3="\d+"\/>/g)).toHaveLength(
      triangleCount,
    );
    // Even a single-color packed plate carries the full project palette. Its
    // objects/triangles keep the original global palette index rather than
    // being silently remapped to local color zero.
    const representedColorIndices = new Set(
      plate.placements.map((placement) =>
        project.tiles.find((tile) => tile.id === placement.tileId)!.colorIndex,
      ),
    );
    expect(representedColorIndices.size).toBe(1);
    const [representedColorIndex] = [...representedColorIndices];
    expect([...model.matchAll(/<object [^>]*pindex="(\d+)"/g)].map((match) => Number(match[1])))
      .toEqual(plate.placements.map(() => representedColorIndex));
    expect([...model.matchAll(/<triangle [^>]*p1="(\d+)"/g)].map((match) => Number(match[1])))
      .toEqual(Array.from({ length: triangleCount }, () => representedColorIndex));
    expect(model).toContain('transform="');
  });

  it('keeps every mixed sculpted-hex triangle and object in portable plate 3MF', async () => {
    const project = generateWallArt({
      seed: 'mixed-sculpted-hex-3mf',
      design: { family: 'hex-canopy', silhouette: 'rectangle' },
      grid: { columns: 3, rows: 2, tileSizeMm: 42, gapMm: 2 },
      tile: { shape: 'hex-mixed', reliefHeightMm: 18 },
      pattern: { kind: 'flat' },
      palette: { colors: ['#D7B99A'], mode: 'rows' },
      printer: {
        bedWidthMm: 220,
        bedDepthMm: 220,
        marginMm: 5,
        spacingMm: 3,
        allowRotate90: true,
        separateColors: false,
      },
    });
    const packing = packWallArt(project);
    expect(packing.plates).toHaveLength(1);
    const plate = packing.plates[0];
    const bytes = await createPackedPlate3mfBytes(project, plate);
    const packageZip = await JSZip.loadAsync(bytes);
    const model = await packageZip.file('3D/3dmodel.model')!.async('string');
    const expectedTriangles = project.tiles.reduce(
      (sum, tile) => sum + tile.mesh.triangles.length,
      0,
    );

    expect(new Set(project.tiles.map((tile) => tile.shape)).size).toBeGreaterThanOrEqual(3);
    expect(model.match(/<object /g)).toHaveLength(project.tiles.length);
    expect(model.match(/<triangle /g)).toHaveLength(expectedTriangles);
    for (const tile of project.tiles) {
      expect(model).toContain(`partnumber="${tile.id}"`);
    }
  });

  it('writes an assembled color 3MF triangle-for-triangle in the app preview orientation', async () => {
    const { project } = fixture();
    const bytes = await createFullArt3mfBytes(project);
    const packageZip = await JSZip.loadAsync(bytes);
    const model = await packageZip.file('3D/3dmodel.model')!.async('string');
    const objectBlocks = [...model.matchAll(/<object\b[^>]*>([\s\S]*?)<\/object>/g)];
    expect(objectBlocks).toHaveLength(project.tiles.length);
    expect(model).toContain('assembled color preview');
    expect(model).not.toMatch(/<item [^>]*transform=/);

    for (let tileIndex = 0; tileIndex < project.tiles.length; tileIndex += 1) {
      const tile = project.tiles[tileIndex];
      const body = objectBlocks[tileIndex][1];
      const vertices = [...body.matchAll(
        /<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g,
      )].map((match) => ({
        x: Number(match[1]),
        y: Number(match[2]),
        z: Number(match[3]),
      }));
      expect(vertices).toHaveLength(tile.mesh.vertices.length);
      for (let index = 0; index < vertices.length; index += 1) {
        const local = tile.mesh.vertices[index];
        expect(vertices[index].x).toBeCloseTo(tile.centerXmm + local.x, 5);
        expect(vertices[index].y).toBeCloseTo(
          project.depthMm - (tile.centerYmm + local.y),
          5,
        );
        expect(vertices[index].z).toBeCloseTo(local.z, 5);
      }
      const triangles = [...body.matchAll(
        /<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"[^>]*\/>/g,
      )].map((match) => [Number(match[1]), Number(match[2]), Number(match[3])]);
      expect(triangles).toEqual(
        tile.mesh.triangles.map(([a, b, c]) => [a, c, b]),
      );
      expect(body.match(/pid="2" p1="\d+" p2="\d+" p3="\d+"/g)).toHaveLength(
        tile.mesh.triangles.length,
      );
    }
  });
});
