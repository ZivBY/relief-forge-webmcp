import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer } from 'vite'

const root = resolve(import.meta.dirname, '..')
const pdfDirectory = resolve(root, 'output', 'pdf')
const exportDirectory = resolve(root, 'output', 'exports')
const plateDirectory = resolve(exportDirectory, 'stl', 'plates')
const threeMfDirectory = resolve(exportDirectory, '3mf', 'plates')

await mkdir(pdfDirectory, { recursive: true })
await mkdir(plateDirectory, { recursive: true })
await mkdir(threeMfDirectory, { recursive: true })

const vite = await createServer({
  root,
  configFile: false,
  cacheDir: resolve(root, 'node_modules', '.vite-sample'),
  appType: 'custom',
  server: { middlewareMode: true },
})

try {
  const core = await vite.ssrLoadModule('/src/core/index.ts')
  const exports = await vite.ssrLoadModule('/src/export/index.ts')

  const project = core.generateWallArt({
    seed: 'relief-forge-sample-001',
    design: { family: 'sampled-blocks', silhouette: 'rectangle', variation: 0.48 },
    grid: { columns: 12, rows: 8, tileSizeMm: 28, gapMm: 2 },
    tile: {
      shape: 'surface-column',
      baseHeightMm: 2.4,
      reliefHeightMm: 18,
      topScale: 0.38,
      leanRatio: 0.18,
      twistDeg: 28,
    },
    pattern: {
      kind: 'vortex',
      frequency: 1.15,
      amplitude: 1,
      angleDeg: 32,
      phaseDeg: 0,
      centerX: 0,
      centerY: 0,
      arms: 3,
      noiseScale: 1.8,
      octaves: 4,
      lacunarity: 2,
      gain: 0.5,
    },
    palette: {
      colors: ['#173936', '#2f645c', '#6b9b87', '#c8b98f', '#eee4ca'],
      mode: 'field-bands',
      offset: 0,
      reverse: false,
    },
    printer: {
      bedWidthMm: 256,
      bedDepthMm: 256,
      marginMm: 5,
      spacingMm: 4,
      allowRotate90: true,
      separateColors: true,
    },
  })
  const packing = core.packWallArt(project)

  await Promise.all([
    writeFile(resolve(pdfDirectory, 'relief-forge-sample-master-1-to-1.pdf'), exports.createMasterAssemblyPdfBytes(project)),
    writeFile(resolve(pdfDirectory, 'relief-forge-sample-tiled-a4.pdf'), exports.createTiledAssemblyPdfBytes(project, { paper: 'a4' })),
    writeFile(resolve(pdfDirectory, 'relief-forge-sample-tiled-letter.pdf'), exports.createTiledAssemblyPdfBytes(project, { paper: 'letter' })),
    writeFile(resolve(exportDirectory, exports.fullArtStlFileName(project)), core.serializeFullArtStl(project, 'binary')),
    writeFile(resolve(exportDirectory, exports.fullArt3mfFileName(project)), await exports.createFullArt3mfBytes(project)),
    writeFile(resolve(exportDirectory, 'relief-forge-sample-project.json'), exports.createProjectExportJson(project, packing)),
    writeFile(resolve(exportDirectory, 'relief-forge-sample-manifest.csv'), exports.createAssemblyManifestCsv(project, packing)),
    writeFile(resolve(exportDirectory, 'relief-forge-sample-plate-manifest.csv'), exports.createPlateManifestCsv(project, packing)),
    writeFile(resolve(exportDirectory, 'relief-forge-sample-PROJECT-IDENTITY.txt'), exports.createPackageIdentityText(project, packing)),
    writeFile(
      resolve(exportDirectory, 'relief-forge-sample-README.txt'),
      exports.createFabricationReadme(project, packing, {
        includesA4: true,
        includesLetter: true,
        stlFormat: 'binary',
      }),
    ),
    writeFile(
      resolve(exportDirectory, 'relief-forge-sample-fabrication-package.zip'),
      await exports.createFabricationPackageBytes(project, packing, { includeA4: true, includeLetter: true }),
    ),
    ...packing.plates.map((plate) =>
      writeFile(
        resolve(plateDirectory, exports.plateStlFileName(project, plate)),
        core.serializePackedPlateStl(project, plate, 'binary'),
      ),
    ),
    ...packing.plates.map(async (plate) =>
      writeFile(
        resolve(threeMfDirectory, exports.plate3mfFileName(project, plate)),
        await exports.createPackedPlate3mfBytes(project, plate),
      ),
    ),
  ])

  console.log(JSON.stringify({
    projectId: project.id,
    finishedSizeMm: [project.widthMm, project.depthMm],
    parts: project.tiles.length,
    plates: packing.plates.length,
    allTilesClosedManifold: project.diagnostics.allTilesClosedManifold,
    output: { pdfDirectory, exportDirectory },
  }, null, 2))
} finally {
  await vite.close()
}
