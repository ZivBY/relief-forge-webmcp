import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer } from 'vite'

const root = resolve(import.meta.dirname, '..')
const outputRoot = resolve(root, 'output', 'v2-validation')

const PRINTER = {
  bedWidthMm: 256,
  bedDepthMm: 256,
  marginMm: 5,
  spacingMm: 4,
  allowRotate90: true,
  separateColors: true,
}

// Includes the nine legacy family baselines plus focused additive feature
// cases. Keeping this script outside src makes it a manufacturing audit rather
// than part of the runtime bundle.
const PRESETS = [
  {
    slug: 'folded-flow',
    overrides: {
      seed: 'v2-validation-folded-flow',
      design: { family: 'folded-flow', silhouette: 'rectangle', variation: 0.5 },
      grid: { columns: 12, rows: 8, tileSizeMm: 28, gapMm: 2 },
      tile: { shape: 'folded-ridge', reliefHeightMm: 22, leanRatio: 0.16 },
      pattern: { kind: 'wave', frequency: 1.1, angleDeg: 28 },
      printer: PRINTER,
    },
  },
  {
    slug: 'sampled-blocks',
    overrides: {
      seed: 'v2-validation-sampled-blocks',
      design: { family: 'sampled-blocks', silhouette: 'rectangle', variation: 0.42 },
      grid: { columns: 13, rows: 8, tileSizeMm: 29, gapMm: 2.2 },
      tile: { shape: 'surface-column', baseHeightMm: 2.4, reliefHeightMm: 32, leanRatio: 0 },
      pattern: { kind: 'dunes', frequency: 1.05, angleDeg: 24, noiseScale: 1.55 },
      printer: PRINTER,
    },
  },
  {
    slug: 'triangular-current',
    overrides: {
      seed: 'v2-validation-triangular-current',
      design: { family: 'triangular-current', silhouette: 'rectangle', variation: 0.55 },
      grid: { columns: 10, rows: 8, tileSizeMm: 34, gapMm: 2.2 },
      tile: { shape: 'triangle-sail', reliefHeightMm: 28, leanRatio: 0.18 },
      pattern: { kind: 'wave', frequency: 1.35, angleDeg: 18 },
      printer: PRINTER,
    },
  },
  {
    slug: 'polar-bloom',
    overrides: {
      seed: 'v2-validation-polar-bloom',
      design: { family: 'polar-bloom', silhouette: 'ellipse', variation: 0.45, symmetry: 8 },
      grid: { columns: 10, rows: 10, tileSizeMm: 32, gapMm: 2.4 },
      tile: { shape: 'polar-petal', reliefHeightMm: 30, leanRatio: 0.18 },
      pattern: { kind: 'ripple', frequency: 1.2, centerX: 0, centerY: 0 },
      printer: PRINTER,
    },
  },
  {
    slug: 'cellular-crystal',
    overrides: {
      seed: 'v2-validation-cellular-crystal',
      design: { family: 'cellular-crystal', silhouette: 'rectangle', variation: 0.7 },
      grid: { columns: 10, rows: 7, tileSizeMm: 34, gapMm: 2.5 },
      tile: { shape: 'cell-crystal', reliefHeightMm: 28, leanRatio: 0.12 },
      pattern: { kind: 'dunes', frequency: 1.05, noiseScale: 1.6 },
      printer: PRINTER,
    },
  },
  {
    slug: 'hex-canopy',
    overrides: {
      seed: 'v2-validation-hex-canopy',
      design: { family: 'hex-canopy', silhouette: 'ellipse', variation: 0.52 },
      grid: { columns: 13, rows: 8, tileSizeMm: 34, gapMm: 2.2 },
      tile: { shape: 'hex-petal', reliefHeightMm: 26, leanRatio: 0.22 },
      pattern: { kind: 'vortex', frequency: 1.15, arms: 4 },
      printer: PRINTER,
    },
  },
  {
    slug: 'hex-canopy-mixed-textures',
    overrides: {
      seed: 'v2-validation-hex-mixed-textures',
      design: { family: 'hex-canopy', silhouette: 'rectangle', variation: 0.36 },
      grid: { columns: 5, rows: 3, tileSizeMm: 72, gapMm: 3 },
      tile: { shape: 'hex-mixed', baseHeightMm: 2.4, reliefHeightMm: 24, leanRatio: 0.14 },
      pattern: { kind: 'vortex', frequency: 1.05, arms: 3 },
      palette: {
        colors: ['#f4ecdf', '#c77955', '#8f9b82', '#765238', '#3c3b38'],
        mode: 'seeded-random',
      },
      printer: PRINTER,
    },
  },
  {
    slug: 'coral-cluster',
    overrides: {
      seed: 'v2-validation-coral-cluster',
      design: { family: 'coral-cluster', silhouette: 'ellipse', variation: 0.84 },
      grid: { columns: 14, rows: 8, tileSizeMm: 27, gapMm: 2 },
      tile: { shape: 'ring-pod', reliefHeightMm: 36, leanRatio: 0.12 },
      pattern: { kind: 'noise', frequency: 1, noiseScale: 2.2 },
      printer: PRINTER,
    },
  },
  {
    slug: 'contour-relief',
    overrides: {
      seed: 'v2-validation-contour-relief',
      design: { family: 'contour-relief', silhouette: 'rectangle', variation: 0.45, surfaceResolution: 20 },
      grid: { columns: 4, rows: 3, tileSizeMm: 150, gapMm: 2 },
      tile: { shape: 'relief-panel', baseHeightMm: 2.4, reliefHeightMm: 48, leanRatio: 0 },
      pattern: { kind: 'vortex', frequency: 0.72, arms: 3, centerX: -0.08, centerY: 0.04 },
      printer: PRINTER,
    },
  },
  {
    slug: 'silhouette-mosaic',
    overrides: {
      seed: 'v2-validation-silhouette-mosaic',
      design: { family: 'silhouette-mosaic', silhouette: 'archipelago', variation: 0.78 },
      grid: { columns: 16, rows: 10, tileSizeMm: 25, gapMm: 3 },
      tile: { shape: 'mixed-block', reliefHeightMm: 25, leanRatio: 0.18 },
      pattern: { kind: 'noise', frequency: 1.1, noiseScale: 1.7 },
      printer: PRINTER,
    },
  },
]

// The legacy project ID and full-file SHA were captured from the pre-photo g5
// implementation. Binary STL bytes 0..79 contain the mesh name, so the
// intentional g6 identity bump changes that header even when every facet byte
// is unchanged. The current project ID is asserted separately, while the
// legacy full-file SHA is checked after reconstructing its original header. That
// preserves a byte-for-byte oracle for the triangle count and facet payload.
const LEGACY_PROCEDURAL_ORACLES = {
  'folded-flow': {
    legacyProjectId: 'wall-art-g5-fc44dfb3',
    currentProjectId: 'wall-art-g6-f08838ce',
    legacyFullArtSha256: 'a1a99c39f8619c30c39f33f06d7edf73950524951f94031b0f80e741db51e1ed',
  },
  'sampled-blocks': {
    legacyProjectId: 'wall-art-g5-a76b235e',
    currentProjectId: 'wall-art-g6-d6343496',
    legacyFullArtSha256: 'fd2435c359e754e36da16db6855c20224ed0ef5115098bab9677d0f739931607',
  },
  'triangular-current': {
    legacyProjectId: 'wall-art-g5-3b49095d',
    currentProjectId: 'wall-art-g6-ae27d20a',
    legacyFullArtSha256: '9020b0894816f4a6941f132d77829c772768abf000d2136d5291e15bf9cef32d',
  },
  'polar-bloom': {
    legacyProjectId: 'wall-art-g5-a3aa644b',
    currentProjectId: 'wall-art-g6-36280e80',
    legacyFullArtSha256: '782174e84569c3818dceb00dd7800e9ca0ed7c8fa5351330267655a7c6442812',
  },
  'cellular-crystal': {
    legacyProjectId: 'wall-art-g5-9004dfef',
    currentProjectId: 'wall-art-g6-8b467ba4',
    legacyFullArtSha256: '446d3bbfea24d055b66dea689aeda669e297cb1ee6628852a597652a255bf034',
  },
  'hex-canopy': {
    legacyProjectId: 'wall-art-g5-7227826a',
    currentProjectId: 'wall-art-g6-c702f3ab',
    legacyFullArtSha256: 'a47d94db3224633a5288eb1e3567aa3671273c807018a72f2d2a8c14a0d0024d',
  },
  'coral-cluster': {
    legacyProjectId: 'wall-art-g5-569ccf65',
    currentProjectId: 'wall-art-g6-07a2a3c9',
    legacyFullArtSha256: '3d17af06493ebbc373617b70c64cb3f78550a8dce5ea435795263e8018428359',
  },
  'contour-relief': {
    legacyProjectId: 'wall-art-g5-62a6fba9',
    currentProjectId: 'wall-art-g6-7634cb40',
    legacyFullArtSha256: 'e7d0ec63f28d5b5970a659ba0ac112c63f8c1689a289123087fd3cf074b9e1f8',
  },
  'silhouette-mosaic': {
    legacyProjectId: 'wall-art-g5-674c26e6',
    currentProjectId: 'wall-art-g6-bca695c4',
    legacyFullArtSha256: '57c886d3bfb7a2d56b99a9a8eadaaf29a6cfd5a3f5946fdfc7cd913b229b0bd0',
  },
}

const PDF_FAMILIES = new Set(['polar-bloom', 'cellular-crystal', 'hex-canopy-mixed-textures', 'contour-relief', 'silhouette-mosaic'])
const EPSILON = 1e-5

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function binaryStlWithHeader(bytes, name) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 84) {
    throw new Error('Cannot replace the header of an invalid binary STL.')
  }
  const replaced = Uint8Array.from(bytes)
  replaced.fill(0, 0, 80)
  const header = `Deterministic wall art STL: ${name}`.slice(0, 80)
  for (let index = 0; index < header.length; index += 1) {
    replaced[index] = header.charCodeAt(index) & 0x7f
  }
  return replaced
}

function canonicalNumber(value) {
  return Object.is(value, -0) ? '0' : String(value)
}

function vertexKey(vertex) {
  return `${canonicalNumber(vertex[0])},${canonicalNumber(vertex[1])},${canonicalNumber(vertex[2])}`
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function parseBinaryStl(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new Error('Expected Uint8Array STL bytes.')
  if (bytes.byteLength < 84) throw new Error(`Binary STL is only ${bytes.byteLength} bytes.`)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const triangleCount = view.getUint32(80, true)
  const expectedBytes = 84 + triangleCount * 50
  if (bytes.byteLength !== expectedBytes) {
    throw new Error(`STL byte count ${bytes.byteLength} does not match ${triangleCount} triangles (${expectedBytes}).`)
  }

  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  const edgeCounts = new Map()
  let degenerateTriangles = 0
  let signedVolumeMm3 = 0
  let offset = 84

  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
    const normal = [view.getFloat32(offset, true), view.getFloat32(offset + 4, true), view.getFloat32(offset + 8, true)]
    if (!normal.every(Number.isFinite)) throw new Error(`Non-finite normal in triangle ${triangleIndex}.`)
    offset += 12
    const vertices = []
    for (let vertexIndex = 0; vertexIndex < 3; vertexIndex += 1) {
      const vertex = [
        view.getFloat32(offset, true),
        view.getFloat32(offset + 4, true),
        view.getFloat32(offset + 8, true),
      ]
      if (!vertex.every(Number.isFinite)) throw new Error(`Non-finite vertex in triangle ${triangleIndex}.`)
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], vertex[axis])
        max[axis] = Math.max(max[axis], vertex[axis])
      }
      vertices.push(vertex)
      offset += 12
    }
    offset += 2

    const areaVector = cross(subtract(vertices[1], vertices[0]), subtract(vertices[2], vertices[0]))
    if (Math.hypot(...areaVector) <= 1e-8) degenerateTriangles += 1
    signedVolumeMm3 += (
      vertices[0][0] * (vertices[1][1] * vertices[2][2] - vertices[1][2] * vertices[2][1]) -
      vertices[0][1] * (vertices[1][0] * vertices[2][2] - vertices[1][2] * vertices[2][0]) +
      vertices[0][2] * (vertices[1][0] * vertices[2][1] - vertices[1][1] * vertices[2][0])
    ) / 6

    const keys = vertices.map(vertexKey)
    for (const [left, right] of [[0, 1], [1, 2], [2, 0]]) {
      const edge = keys[left] < keys[right] ? `${keys[left]}|${keys[right]}` : `${keys[right]}|${keys[left]}`
      edgeCounts.set(edge, (edgeCounts.get(edge) ?? 0) + 1)
    }
  }

  let boundaryEdges = 0
  let nonManifoldEdges = 0
  for (const useCount of edgeCounts.values()) {
    if (useCount === 1) boundaryEdges += 1
    else if (useCount !== 2) nonManifoldEdges += 1
  }

  return {
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    geometrySha256: sha256(bytes.subarray(80)),
    triangleCount,
    finite: true,
    degenerateTriangles,
    boundaryEdges,
    nonManifoldEdges,
    closed: triangleCount > 0 && degenerateTriangles === 0 && boundaryEdges === 0 && nonManifoldEdges === 0,
    signedVolumeMm3,
    positiveVolume: signedVolumeMm3 > EPSILON,
    bounds: {
      minX: min[0], minY: min[1], minZ: min[2],
      maxX: max[0], maxY: max[1], maxZ: max[2],
      width: max[0] - min[0], depth: max[1] - min[1], height: max[2] - min[2],
    },
  }
}

function pairwiseSpacingFailures(plate, spacingMm) {
  const failures = []
  for (let leftIndex = 0; leftIndex < plate.placements.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < plate.placements.length; rightIndex += 1) {
      const left = plate.placements[leftIndex]
      const right = plate.placements[rightIndex]
      const horizontalGap = Math.max(
        right.footprint.minX - left.footprint.maxX,
        left.footprint.minX - right.footprint.maxX,
      )
      const verticalGap = Math.max(
        right.footprint.minY - left.footprint.maxY,
        left.footprint.minY - right.footprint.maxY,
      )
      if (Math.max(horizontalGap, verticalGap) < spacingMm - EPSILON) {
        failures.push({ left: left.tileId, right: right.tileId, horizontalGap, verticalGap })
      }
    }
  }
  return failures
}

function platePlacementFailures(plate, printer) {
  const failures = []
  const minAllowed = printer.marginMm - EPSILON
  const maxXAllowed = printer.bedWidthMm - printer.marginMm + EPSILON
  const maxYAllowed = printer.bedDepthMm - printer.marginMm + EPSILON
  for (const placement of plate.placements) {
    const bounds = placement.footprint
    if (
      bounds.minX < minAllowed || bounds.minY < minAllowed ||
      bounds.maxX > maxXAllowed || bounds.maxY > maxYAllowed
    ) {
      failures.push({ tileId: placement.tileId, footprint: bounds })
    }
  }
  return failures
}

function assert(condition, failures, message) {
  if (!condition) failures.push(message)
}

await mkdir(outputRoot, { recursive: true })

const vite = await createServer({
  root,
  configFile: false,
  cacheDir: resolve(root, 'node_modules', '.vite-v2-export-validation'),
  appType: 'custom',
  server: { middlewareMode: true },
})

const report = {
  generatedAt: new Date().toISOString(),
  printer: PRINTER,
  familyCount: new Set(PRESETS.map((preset) => preset.overrides.design.family)).size,
  caseCount: PRESETS.length,
  families: [],
  failures: [],
}

try {
  const core = await vite.ssrLoadModule('/src/core/index.ts')
  const exporters = await vite.ssrLoadModule('/src/export/index.ts')

  for (const preset of PRESETS) {
    const familyDirectory = resolve(outputRoot, preset.slug)
    await mkdir(resolve(familyDirectory, 'stl'), { recursive: true })
    if (PDF_FAMILIES.has(preset.slug)) await mkdir(resolve(familyDirectory, 'pdf'), { recursive: true })

    const project = core.generateWallArt(preset.overrides)
    const repeatedProject = core.generateWallArt(preset.overrides)
    const packing = core.packWallArt(project)
    const repeatedPacking = core.packWallArt(repeatedProject)
    const failures = []

    assert(project.id === repeatedProject.id, failures, 'Repeated generation changed project ID.')
    assert(JSON.stringify(project.config) === JSON.stringify(repeatedProject.config), failures, 'Repeated generation changed normalized configuration.')
    assert(project.tiles.length === repeatedProject.tiles.length, failures, 'Repeated generation changed tile count.')
    assert(new Set(project.tiles.map((tile) => tile.id)).size === project.tiles.length, failures, 'Project contains duplicate tile IDs.')
    assert(JSON.stringify(packing) === JSON.stringify(repeatedPacking), failures, 'Repeated packing changed placement data.')
    assert(project.diagnostics.allTilesClosedManifold, failures, 'Project diagnostics report one or more non-closed tiles.')
    assert(project.diagnostics.fullMesh.closedManifold, failures, 'Combined full-art mesh is not closed manifold.')
    assert(project.diagnostics.fullMesh.outwardWinding, failures, 'Combined full-art mesh is not outward wound.')
    assert(packing.placementCount === project.tiles.length, failures, 'Packing placement count does not match tile count.')
    const packedTileIds = packing.plates.flatMap((plate) => plate.placements.map((placement) => placement.tileId))
    assert(new Set(packedTileIds).size === packedTileIds.length, failures, 'Packing contains duplicate tile placements.')
    assert(new Set(packedTileIds).size === project.tiles.length, failures, 'Packing does not cover every unique tile ID.')
    if (preset.slug === 'hex-canopy-mixed-textures') {
      const shapes = new Set(project.tiles.map((tile) => tile.shape))
      assert(shapes.size >= 3, failures, `Mixed hex validation produced only ${shapes.size} actual relief style(s).`)
      assert(!shapes.has('hex-mixed'), failures, "Mixed hex validation recorded the selector instead of each tile's actual relief style.")
    }

    const repeatedTilesById = new Map(repeatedProject.tiles.map((tile) => [tile.id, tile]))
    const partStats = []
    for (const tile of project.tiles) {
      const bytes = core.serializeBinaryStl(tile.mesh, tile.id)
      const repeatedTile = repeatedTilesById.get(tile.id)
      if (!repeatedTile) {
        failures.push(`Repeated generation omitted ${tile.id}.`)
        continue
      }
      const repeatedBytes = core.serializeBinaryStl(repeatedTile.mesh, repeatedTile.id)
      const stats = parseBinaryStl(bytes)
      assert(stats.sha256 === sha256(repeatedBytes), failures, `${tile.id}: serialized STL is not deterministic.`)
      assert(stats.closed, failures, `${tile.id}: exported STL is not closed.`)
      assert(stats.positiveVolume, failures, `${tile.id}: exported STL lacks positive signed volume.`)
      assert(Math.abs(stats.bounds.minZ) <= EPSILON, failures, `${tile.id}: exported STL does not rest at Z=0.`)
      assert(tile.diagnostics.closedManifold, failures, `${tile.id}: source mesh diagnostics are not closed manifold.`)
      assert(tile.diagnostics.outwardWinding, failures, `${tile.id}: source mesh winding is not outward.`)
      partStats.push({ tileId: tile.id, ...stats })
    }

    const repeatedPlatesById = new Map(repeatedPacking.plates.map((plate) => [plate.id, plate]))
    const plateStats = []
    for (const plate of packing.plates) {
      const placementFailures = platePlacementFailures(plate, packing.printer)
      const spacingFailures = pairwiseSpacingFailures(plate, packing.printer.spacingMm)
      assert(placementFailures.length === 0, failures, `${plate.id}: ${placementFailures.length} placement(s) exceed the usable bed.`)
      assert(spacingFailures.length === 0, failures, `${plate.id}: ${spacingFailures.length} placement pair(s) violate configured spacing.`)
      assert(plate.colorIndices.length === 1, failures, `${plate.id}: separate-colors packing mixed ${plate.colorIndices.length} color groups.`)

      const bytes = core.serializePackedPlateStl(project, plate, 'binary')
      const repeatedPlate = repeatedPlatesById.get(plate.id)
      if (!repeatedPlate) {
        failures.push(`Repeated packing omitted ${plate.id}.`)
        continue
      }
      const repeatedBytes = core.serializePackedPlateStl(repeatedProject, repeatedPlate, 'binary')
      const stats = parseBinaryStl(bytes)
      const expectedTriangleCount = plate.placements.reduce((total, placement) => {
        const tile = project.tiles.find((candidate) => candidate.id === placement.tileId)
        return total + (tile?.mesh.triangles.length ?? 0)
      }, 0)
      assert(stats.sha256 === sha256(repeatedBytes), failures, `${plate.id}: serialized plate STL is not deterministic.`)
      assert(stats.closed, failures, `${plate.id}: exported plate STL is not closed.`)
      assert(stats.positiveVolume, failures, `${plate.id}: exported plate STL lacks positive signed volume.`)
      assert(stats.triangleCount === expectedTriangleCount, failures, `${plate.id}: exported STL triangle count does not match its placed parts.`)
      assert(stats.bounds.minX >= -EPSILON && stats.bounds.minY >= -EPSILON, failures, `${plate.id}: STL extends below X/Y zero.`)
      assert(stats.bounds.maxX <= packing.printer.bedWidthMm + EPSILON, failures, `${plate.id}: STL exceeds bed width.`)
      assert(stats.bounds.maxY <= packing.printer.bedDepthMm + EPSILON, failures, `${plate.id}: STL exceeds bed depth.`)
      assert(stats.bounds.minZ >= -EPSILON, failures, `${plate.id}: STL extends below the build plate.`)
      plateStats.push({
        plateId: plate.id,
        placements: plate.placements.length,
        placementFailures,
        spacingFailures,
        ...stats,
      })
    }

    const fullArtBytes = core.serializeFullArtStl(project, 'binary')
    const repeatedFullArtBytes = core.serializeFullArtStl(repeatedProject, 'binary')
    const fullArtStats = parseBinaryStl(fullArtBytes)
    const legacyOracle = LEGACY_PROCEDURAL_ORACLES[preset.slug]
    if (legacyOracle) {
      assert(project.id === legacyOracle.currentProjectId, failures, `Current project ID changed from ${legacyOracle.currentProjectId} to ${project.id}.`)
      const legacyNamedBytes = binaryStlWithHeader(
        fullArtBytes,
        `${legacyOracle.legacyProjectId}-full-art-preview-aligned`,
      )
      const legacyCompatibleSha256 = sha256(legacyNamedBytes)
      assert(
        legacyCompatibleSha256 === legacyOracle.legacyFullArtSha256,
        failures,
        `Neutral full-art STL geometry changed from the legacy g5 payload (${legacyOracle.legacyFullArtSha256} after restoring its header) to ${legacyCompatibleSha256}.`,
      )
    }
    assert(fullArtStats.sha256 === sha256(repeatedFullArtBytes), failures, 'Full-art STL is not deterministic.')
    assert(fullArtStats.closed, failures, 'Full-art STL is not closed.')
    assert(fullArtStats.positiveVolume, failures, 'Full-art STL lacks positive signed volume.')

    const representativePart = partStats[0]
    const representativePlate = plateStats[0]
    if (representativePart) {
      const tile = project.tiles.find((candidate) => candidate.id === representativePart.tileId)
      await writeFile(resolve(familyDirectory, 'stl', `representative-part-${tile.id}.stl`), core.serializeBinaryStl(tile.mesh, tile.id))
    }
    if (representativePlate) {
      const plate = packing.plates.find((candidate) => candidate.id === representativePlate.plateId)
      await writeFile(resolve(familyDirectory, 'stl', `representative-${plate.id}.stl`), core.serializePackedPlateStl(project, plate, 'binary'))
    }

    const pdfs = []
    if (PDF_FAMILIES.has(preset.slug)) {
      const pdfDirectory = resolve(familyDirectory, 'pdf')
      const masterBytes = exporters.createMasterAssemblyPdfBytes(project)
      const a4Bytes = exporters.createTiledAssemblyPdfBytes(project, { paper: 'a4' })
      const letterBytes = exporters.createTiledAssemblyPdfBytes(project, { paper: 'letter' })
      await Promise.all([
        writeFile(resolve(pdfDirectory, 'master-1-to-1.pdf'), masterBytes),
        writeFile(resolve(pdfDirectory, 'tiled-a4.pdf'), a4Bytes),
        writeFile(resolve(pdfDirectory, 'tiled-letter.pdf'), letterBytes),
      ])
      const a4Layout = exporters.calculateTiledLayout(project, { paper: 'a4' })
      const letterLayout = exporters.calculateTiledLayout(project, { paper: 'letter' })
      pdfs.push(
        {
          file: 'master-1-to-1.pdf',
          bytes: masterBytes.byteLength,
          sha256: sha256(masterBytes),
          expectedPages: 1,
          expectedPageWidthMm: project.widthMm + 150,
          expectedPageHeightMm: 77 + Math.max(project.depthMm, 124),
        },
        {
          file: 'tiled-a4.pdf',
          bytes: a4Bytes.byteLength,
          sha256: sha256(a4Bytes),
          expectedPages: a4Layout.totalPageCount,
          expectedPageWidthMm: a4Layout.pageWidthMm,
          expectedPageHeightMm: a4Layout.pageHeightMm,
          layout: a4Layout,
        },
        {
          file: 'tiled-letter.pdf',
          bytes: letterBytes.byteLength,
          sha256: sha256(letterBytes),
          expectedPages: letterLayout.totalPageCount,
          expectedPageWidthMm: letterLayout.pageWidthMm,
          expectedPageHeightMm: letterLayout.pageHeightMm,
          layout: letterLayout,
        },
      )
    }

    const familyResult = {
      family: preset.slug,
      projectId: project.id,
      finishedSizeMm: [project.widthMm, project.depthMm],
      tiles: project.tiles.length,
      plates: packing.plates.length,
      individualStlsValidated: partStats.length,
      plateStlsValidated: plateStats.length,
      deterministic: failures.every((failure) => !failure.includes('deterministic') && !failure.includes('Repeated')),
      closedParts: partStats.filter((stats) => stats.closed).length,
      positiveVolumeParts: partStats.filter((stats) => stats.positiveVolume).length,
      closedPlates: plateStats.filter((stats) => stats.closed).length,
      positiveVolumePlates: plateStats.filter((stats) => stats.positiveVolume).length,
      placementSpacingFailures: plateStats.reduce((total, stats) => total + stats.spacingFailures.length, 0),
      placementBedFailures: plateStats.reduce((total, stats) => total + stats.placementFailures.length, 0),
      minPartVolumeMm3: Math.min(...partStats.map((stats) => stats.signedVolumeMm3)),
      maxPartBoundsMm: {
        width: Math.max(...partStats.map((stats) => stats.bounds.width)),
        depth: Math.max(...partStats.map((stats) => stats.bounds.depth)),
        height: Math.max(...partStats.map((stats) => stats.bounds.height)),
      },
      maxPlateBoundsMm: {
        width: Math.max(...plateStats.map((stats) => stats.bounds.width)),
        depth: Math.max(...plateStats.map((stats) => stats.bounds.depth)),
        height: Math.max(...plateStats.map((stats) => stats.bounds.height)),
      },
      fullArt: fullArtStats,
      representativePart,
      representativePlate,
      pdfs,
      failures,
    }
    report.families.push(familyResult)
    report.failures.push(...failures.map((failure) => `${preset.slug}: ${failure}`))
    console.log(`${preset.slug}: ${failures.length === 0 ? 'PASS' : `FAIL (${failures.length})`} - ${project.tiles.length} parts, ${packing.plates.length} plates`)
  }
} finally {
  await vite.close()
}

await writeFile(resolve(outputRoot, 'validation-results.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(`Validation result: ${report.failures.length === 0 ? 'PASS' : 'FAIL'}`)
console.log(`Wrote ${resolve(outputRoot, 'validation-results.json')}`)
if (report.failures.length > 0) {
  for (const failure of report.failures) console.error(`- ${failure}`)
  process.exitCode = 1
}
