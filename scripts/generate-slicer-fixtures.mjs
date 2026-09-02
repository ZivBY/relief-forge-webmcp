import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer } from 'vite'

const root = resolve(import.meta.dirname, '..')
const outputDirectory = resolve(root, 'output', 'slicer-fixtures')

const printer = {
  bedWidthMm: 256,
  bedDepthMm: 256,
  marginMm: 5,
  spacingMm: 4,
  allowRotate90: true,
  separateColors: false,
}

const fixtures = [
  {
    slug: 'coral-cluster',
    config: {
      seed: 'slicer-fixture-coral-cluster',
      design: { family: 'coral-cluster', silhouette: 'ellipse', variation: 0.84 },
      grid: { columns: 10, rows: 6, tileSizeMm: 25, gapMm: 2 },
      tile: { shape: 'ring-pod', baseHeightMm: 2.4, reliefHeightMm: 30, leanRatio: 0.12 },
      pattern: { kind: 'noise', frequency: 1, noiseScale: 2.2 },
      printer,
    },
  },
  {
    slug: 'contour-relief',
    config: {
      seed: 'slicer-fixture-contour-relief',
      design: {
        family: 'contour-relief',
        silhouette: 'rectangle',
        variation: 0.45,
        surfaceResolution: 16,
      },
      grid: { columns: 2, rows: 2, tileSizeMm: 112, gapMm: 2 },
      tile: { shape: 'relief-panel', baseHeightMm: 2.4, reliefHeightMm: 32, leanRatio: 0 },
      pattern: { kind: 'vortex', frequency: 0.72, arms: 3, centerX: -0.08, centerY: 0.04 },
      printer,
    },
  },
  {
    slug: 'terraced-relief',
    config: {
      seed: 'slicer-fixture-terraced-relief',
      design: {
        family: 'contour-relief',
        silhouette: 'rectangle',
        variation: 0.38,
        surfaceResolution: 10,
      },
      grid: { columns: 2, rows: 2, tileSizeMm: 80, gapMm: 3 },
      tile: { shape: 'terraced-panel', baseHeightMm: 2.4, reliefHeightMm: 24, leanRatio: 0 },
      pattern: { kind: 'vortex', frequency: 0.82, arms: 3, centerX: -0.08, centerY: 0.04 },
      printer,
    },
  },
]

await mkdir(outputDirectory, { recursive: true })

const vite = await createServer({
  root,
  configFile: false,
  cacheDir: resolve(root, 'node_modules', '.vite-slicer-fixtures'),
  appType: 'custom',
  server: { middlewareMode: true },
})

try {
  const core = await vite.ssrLoadModule('/src/core/index.ts')
  const exports = await vite.ssrLoadModule('/src/export/index.ts')
  const results = []

  for (const fixture of fixtures) {
    const project = core.generateWallArt(fixture.config)
    const packing = core.packWallArt(project)
    const fixtureDirectory = resolve(outputDirectory, fixture.slug)
    await mkdir(fixtureDirectory, { recursive: true })

    await Promise.all(
      packing.plates.map(async (plate) => {
        const plateName = `plate-${String(plate.index).padStart(3, '0')}`
        await Promise.all([
          writeFile(
            resolve(fixtureDirectory, `${plateName}.build.3mf`),
            await exports.createPackedPlate3mfBytes(project, plate),
          ),
          writeFile(
            resolve(fixtureDirectory, `${plateName}.stl`),
            core.serializePackedPlateStl(project, plate, 'binary'),
          ),
        ])
      }),
    )

    results.push({
      family: fixture.slug,
      parts: project.tiles.length,
      plates: packing.plates.length,
      firstPlateParts: packing.plates[0]?.placements.length ?? 0,
      allTilesClosedManifold: project.diagnostics.allTilesClosedManifold,
    })
  }

  console.log(JSON.stringify({ outputDirectory, fixtures: results }, null, 2))
} finally {
  await vite.close()
}
