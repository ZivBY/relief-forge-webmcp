'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { APP_BUILD_LABEL } from './build-info'
import { AssemblyPreview } from './components/AssemblyPreview'
import { DepthControls } from './components/DepthControls'
import { DepthPaintEditor } from './components/DepthPaintEditor'
import { GuideEditor, type GuideInteractionMode } from './components/GuideEditor'
import {
  MobilePreviewSizeControl,
  MobileWorkflowFooter,
  MobileWorkflowNavigator,
  useMobileEditorViewport,
} from './components/MobileWorkflowNavigator'
import { PlatePreview } from './components/PlatePreview'
import { PhotoCompositionPanel, type ApplyPhotoPayload } from './components/PhotoCompositionPanel'
import { RegionalDepthEditor } from './components/RegionalDepthEditor'
import { StartOverDialog } from './components/StartOverDialog'
import { WallArtViewer } from './components/WallArtViewer'
import {
  MAX_PRINTER_BED_DIMENSION_MM,
  MAX_PRINTER_MARGIN_MM,
  MAX_PRINTER_SPACING_MM,
  MIN_FINISHED_DIMENSION_MM,
  MIN_PRINTER_BED_DIMENSION_MM,
  MIN_PRINTER_MARGIN_MM,
  MIN_PRINTER_SPACING_MM,
  normalizePatternArms,
} from './control-boundaries'
import {
  INITIAL_CONTROL_HELP_INTERACTION_STATE,
  beginControlHelpTouch,
  canShowControlHelp,
  continueControlHelpWithPointer,
  resetControlHelpInteraction,
} from './control-help-interaction'
import {
  createWallArtConfig,
  DEFAULT_WALL_ART_CONFIG,
  MAX_FINISHED_DIMENSION_MM,
  MAX_GRID_COLUMNS,
  MAX_GRID_ROWS,
} from './core/config'
import { photoFamilyUsesDirection } from './core/composition'
import { generateWallArt } from './core/generate'
import { gridForPartSize } from './core/part-sizing'
import { createGuidePolyline, simplifyPolyline } from './core/guide-fields'
import type { NormalizedPoint } from './core/guide-fields'
import { resolveGuideEffects } from './core/guide-composition'
import { createGuidePresetGeometry, rebuildGuidePath } from './core/guide-presets'
import type { GuidePresetKind } from './core/guide-presets'
import { packWallArt } from './core/packing'
import {
  createDepthPaintFieldDescriptor,
  resolveDepthPaintFieldAsset,
  type DepthPaintFieldAsset,
} from './depth-paint/field'
import {
  clearDepthPaintFieldAssets,
  deleteDepthPaintFieldAsset,
  loadDepthPaintFieldAsset,
  saveDepthPaintFieldAsset,
} from './depth-paint/asset-store'
import {
  DEFAULT_MOBILE_PREVIEW_STATE,
  getMobileWorkflowEntry,
  getMobileWorkflowLocation,
  type MobilePreviewState,
  type MobileWorkflowLocation,
  type MobileWorkflowSectionId,
} from './mobile-workflow'
import {
  PhotoMutationGate,
  persistPhotoAssetForApply,
  removePhotoAssetWithRecipeSafety,
  type PhotoRemovalOutcome,
} from './photo/asset-lifecycle'
import {
  clearPhotoFieldAssets,
  deletePhotoFieldAsset,
  loadPhotoFieldAsset,
  savePhotoFieldAsset,
} from './photo/asset-store'
import { canStageExportSnapshot } from './export/snapshot-guard'
import {
  assertEmptyToolInput,
  createWallArtAction,
  setPrinterBedAction,
  shapeFabricationPackageResult,
  summarizeFabricationPlan,
  type PackingFailure,
  type WallArtActionResult,
} from './webmcp/actions'
import {
  registerReliefForgeTools,
  type ReliefForgeJsonValue,
  type ReliefForgeToolDispatcher,
  type ReliefForgeToolExecutionContext,
  type ReliefForgeToolInputs,
  type ReliefForgeToolName,
} from './webmcp/register'
import {
  LEGACY_PROJECT_STORAGE_KEY as LEGACY_STORAGE_KEY,
  PROJECT_STORAGE_KEY as STORAGE_KEY,
  persistFreshProjectConfig,
  startOverProject,
} from './start-over'
import type {
  ColorAssignmentMode,
  DesignConfig,
  DesignFamilyKind,
  DepthProfileConfig,
  FinishedSizeConfig,
  GuideCompositionConfig,
  GuideEffectOverrides,
  GuideLineConfig,
  GridConfig,
  PaletteConfig,
  PatternConfig,
  PatternKind,
  PhotoCompositionConfig,
  PhotoFieldAsset,
  PrinterConfig,
  SilhouetteKind,
  TileGeometryConfig,
  TileShapeKind,
  WallArtConfig,
} from './core/types'

type PreviewMode = 'model' | 'assembly' | 'plates'
type WorkflowStep = MobileWorkflowSectionId
type ExportState = 'idle' | 'master' | 'tiled' | 'package'
type NumericPrinterField = 'bedWidthMm' | 'bedDepthMm' | 'marginMm' | 'spacingMm'
type AgentToolsState = 'checking' | 'ready' | 'unavailable' | 'error'

interface PatternOption {
  kind: PatternKind
  label: string
  description: string
  glyph: string
}

interface FamilyOption {
  kind: DesignFamilyKind
  label: string
  description: string
  glyph: string
}

interface ShapeOption {
  kind: TileShapeKind
  label: string
  description: string
  glyph: string
}

interface PalettePreset {
  name: string
  colors: string[]
}

interface HelpTooltipState {
  text: string
  left: number
  top: number
  above: boolean
}

interface PreparedDownload {
  filename: string
  label: string
  projectId: string
  summary: string
  url: string
}

interface AgentPlanSnapshot extends WallArtActionResult {
  revision: number
}

function asWebMcpResult(value: unknown): ReliefForgeJsonValue {
  return JSON.parse(JSON.stringify(value)) as ReliefForgeJsonValue
}

const PRINTER_INPUT_IDS: Record<NumericPrinterField, string> = {
  bedWidthMm: 'printer-bed-width',
  bedDepthMm: 'printer-bed-depth',
  marginMm: 'printer-edge-margin',
  spacingMm: 'printer-part-spacing',
}

const PRINTER_INPUT_BOUNDS: Record<NumericPrinterField, { min: number; max: number }> = {
  bedWidthMm: { min: MIN_PRINTER_BED_DIMENSION_MM, max: MAX_PRINTER_BED_DIMENSION_MM },
  bedDepthMm: { min: MIN_PRINTER_BED_DIMENSION_MM, max: MAX_PRINTER_BED_DIMENSION_MM },
  marginMm: { min: MIN_PRINTER_MARGIN_MM, max: MAX_PRINTER_MARGIN_MM },
  spacingMm: { min: MIN_PRINTER_SPACING_MM, max: MAX_PRINTER_SPACING_MM },
}

const PATTERNS: PatternOption[] = [
  { kind: 'flat', label: 'Flat', description: 'No macro height variation or directional motion; variation and Guides stay independent.', glyph: '—' },
  { kind: 'wave', label: 'Vector tide', description: 'Directional bands with a calm, architectural rhythm.', glyph: '≈' },
  { kind: 'ripple', label: 'Halo field', description: 'Concentric rises that pull light toward a focal point.', glyph: '◎' },
  { kind: 'vortex', label: 'Spiral current', description: 'A rotational field with adjustable arms and energy.', glyph: '◉' },
  { kind: 'dunes', label: 'Drift lines', description: 'Seeded ridges with an organic wind-shaped flow.', glyph: '≋' },
  { kind: 'noise', label: 'Cloud grain', description: 'A continuous natural field with no obvious repeat.', glyph: '✣' },
  { kind: 'interference', label: 'Wave interference', description: 'Two detuned wave systems cross into slow beats and crisp intersections.', glyph: '≋' },
  { kind: 'liquid', label: 'Liquid terraces', description: 'Layer-aware flowing contour bands with printable stepped heights.', glyph: '∿' },
  { kind: 'fracture', label: 'Radial fracture', description: 'Seeded branching cracks radiate into a crystalline composition.', glyph: '✦' },
]

const FAMILIES: FamilyOption[] = [
  { kind: 'folded-flow', label: 'Folded flow', description: 'Directional creases across individually printable folded blocks.', glyph: '◇' },
  { kind: 'sampled-blocks', label: 'Block surface', description: 'Separate square columns sample one flowing global surface.', glyph: '▥' },
  { kind: 'triangular-current', label: 'Triangular current', description: 'A true equilateral lattice of directional sails or low facets.', glyph: '△' },
  { kind: 'polar-bloom', label: 'Polar bloom', description: 'True rings and radial sectors growing from a focal centre.', glyph: '✺' },
  { kind: 'cellular-crystal', label: 'Cellular crystal', description: 'Seeded Voronoi cells with irregular printable footprints.', glyph: '⬡' },
  { kind: 'hex-canopy', label: 'Sculpted hex tiles', description: 'Hexagonal pieces with a choice of raised pattern inside each one.', glyph: '⬢' },
  { kind: 'coral-cluster', label: 'Coral cluster', description: 'Dense organic pods, including open support-free ring forms.', glyph: '◌' },
  { kind: 'contour-relief', label: 'Contour relief', description: 'A continuous sculpted surface divided into bed-sized panels.', glyph: '≋' },
  { kind: 'silhouette-mosaic', label: 'Silhouette mosaic', description: 'Mixed block grammar cut into negative-space compositions.', glyph: '▦' },
]

const SHAPES_BY_FAMILY: Record<DesignFamilyKind, ShapeOption[]> = {
  'folded-flow': [
    { kind: 'folded-ridge', label: 'Folded ridge', description: 'Roof crease with two light-catching planes', glyph: '⌃' },
    { kind: 'twisted-prism', label: 'Twist block', description: 'Tapered cap with a controlled twist', glyph: '◇' },
    { kind: 'leaning-pyramid', label: 'Lean peak', description: 'Four directional triangular faces', glyph: '△' },
  ],
  'sampled-blocks': [
    { kind: 'surface-column', label: 'Surface column', description: 'Four sampled corners preserve the global flow', glyph: '▥' },
    { kind: 'planar-cap-column', label: 'Planar cap', description: 'One broad tilted plane per separate block', glyph: '▱' },
  ],
  'triangular-current': [
    { kind: 'triangle-sail', label: 'Triangle sail', description: 'Sharp directional peak on a triangular base', glyph: '◭' },
    { kind: 'triangle-plateau', label: 'Low facet', description: 'Broad triangular cap with gentler relief', glyph: '△' },
  ],
  'polar-bloom': [
    { kind: 'polar-petal', label: 'Tapered petal', description: 'Narrow raised cap and outward lean', glyph: '❯' },
    { kind: 'polar-wedge', label: 'Stepped sector', description: 'Broad top preserves the ring rhythm', glyph: '◔' },
  ],
  'cellular-crystal': [
    { kind: 'cell-crystal', label: 'Crystal cell', description: 'Sharp irregular tapered cell', glyph: '✦' },
    { kind: 'cell-plateau', label: 'Cell plateau', description: 'Broad cap and gentler transitions', glyph: '⬠' },
  ],
  'hex-canopy': [
    { kind: 'hex-folded-fan', label: 'Folded fan', description: 'Six crisp folded ridges spread from the centre', glyph: '✦' },
    { kind: 'hex-pinwheel', label: 'Pinwheel', description: 'Twisting radial petals create a rotating highlight', glyph: '✺' },
    { kind: 'hex-curved-sweep', label: 'Curved sweep', description: 'Nested arcs travel across the hexagonal face', glyph: '◒' },
    { kind: 'hex-wave-bands', label: 'Wave bands', description: 'Raised flowing bands cross the full tile', glyph: '≈' },
    { kind: 'hex-spike', label: 'Faceted peak', description: 'Six triangular faces meet at one raised point', glyph: '◆' },
    { kind: 'hex-mixed', label: 'Mixed set', description: 'Repeatably distributes all five reliefs by seed', glyph: '▦' },
    { kind: 'hex-petal', label: 'Directional cap', description: 'Broad tapered cap follows the overall flow', glyph: '⬡' },
  ],
  'coral-cluster': [
    { kind: 'ring-pod', label: 'Open pod', description: 'Hollow upright ring, support-free', glyph: '◉' },
    { kind: 'solid-pod', label: 'Bud pod', description: 'Elliptical tapered organic peak', glyph: '●' },
  ],
  'contour-relief': [
    { kind: 'relief-panel', label: 'Fluid panel', description: 'Continuous smooth sampled surface', glyph: '∿' },
    { kind: 'terraced-panel', label: 'Terraced panel', description: 'Quantized contour levels', glyph: '≋' },
  ],
  'silhouette-mosaic': [
    { kind: 'mixed-block', label: 'Mixed grammar', description: 'Ridges, twists and peaks together', glyph: '▦' },
    { kind: 'twisted-prism', label: 'Twist mosaic', description: 'One coherent twisted block language', glyph: '◇' },
    { kind: 'leaning-pyramid', label: 'Peak mosaic', description: 'Directional pyramids with negative space', glyph: '△' },
  ],
}

const SILHOUETTES: Array<{ kind: SilhouetteKind; label: string }> = [
  { kind: 'rectangle', label: 'Full field' },
  { kind: 'ellipse', label: 'Oval' },
  { kind: 'archipelago', label: 'Archipelago' },
  { kind: 'crescent', label: 'Crescent' },
  { kind: 'ring', label: 'Open ring' },
]

const COLOR_MODES: Array<{ mode: ColorAssignmentMode; label: string }> = [
  { mode: 'field-bands', label: 'Height bands' },
  { mode: 'radial', label: 'Radial rings' },
  { mode: 'rows', label: 'Flow stripes' },
  { mode: 'checker', label: 'Offset grid' },
  { mode: 'seeded-random', label: 'Seeded scatter' },
]

const WORKFLOW_STEPS: Array<{ id: WorkflowStep; number: string; label: string }> = [
  { id: 'shape', number: '01', label: 'Shape' },
  { id: 'color', number: '02', label: 'Color' },
  { id: 'build', number: '03', label: 'Build' },
  { id: 'export', number: '04', label: 'Export' },
]

const WORKFLOW_HEADINGS: Record<Exclude<WorkflowStep, 'shape'>, { eyebrow: string; title: string; description: string }> = {
  color: {
    eyebrow: 'MATERIAL STUDY',
    title: 'Compose the palette',
    description: 'Assign editable filament colors without changing the generated form.',
  },
  build: {
    eyebrow: 'FABRICATION CHECK',
    title: 'Prepare the build',
    description: 'Fit the exact parts to your printer and inspect digital geometry checks.',
  },
  export: {
    eyebrow: 'WORKSHOP HANDOFF',
    title: 'Export the piece',
    description: 'Build local fabrication files from this exact project state.',
  },
}

const PALETTES: PalettePreset[] = [
  { name: 'Sunlit linen', colors: ['#6f4e37', '#b77a52', '#dfb889', '#f1ddbd', '#fff8eb'] },
  { name: 'California clay', colors: ['#6b3028', '#a84c3d', '#d47755', '#e9ad81', '#f5dbc1'] },
  { name: 'Desert bloom', colors: ['#7d4937', '#bd6b4f', '#dc9875', '#d9aaad', '#f1d5c9'] },
  { name: 'Sage and sand', colors: ['#48534a', '#778475', '#aab39d', '#d1c3a4', '#eee4ca'] },
  { name: 'Mediterranean', colors: ['#173f5f', '#287a8b', '#63a7a0', '#edc67e', '#d97b5c'] },
  { name: 'Ocean glass', colors: ['#16445c', '#34788b', '#6cabb1', '#a8d2ca', '#e7eee1'] },
  { name: 'Orchid dusk', colors: ['#3d2948', '#72506d', '#a7778c', '#d8a3a2', '#f1d1be'] },
  { name: 'Burgundy blush', colors: ['#4b1f2d', '#7c3144', '#b55568', '#dd8f99', '#f2c9c4'] },
  { name: 'Citrus market', colors: ['#81421f', '#c9692d', '#e9a23b', '#f1cc65', '#7c9a63'] },
  { name: 'Nordic coast', colors: ['#334657', '#637789', '#93a5aa', '#c5c8c1', '#eee7dc'] },
  { name: 'Mineral neutral', colors: ['#302c2a', '#625b56', '#918a82', '#c6beb3', '#f1ece4'] },
  { name: 'High contrast', colors: ['#251c18', '#f7f0e5', '#bf553c', '#e4af44', '#356b78', '#7c557c'] },
]

const FAMILY_PRESETS: Record<DesignFamilyKind, {
  grid: Partial<GridConfig>
  tile: Partial<TileGeometryConfig>
  design: Partial<DesignConfig>
  pattern: Partial<PatternConfig>
}> = {
  'folded-flow': {
    grid: { columns: 12, rows: 8, tileSizeMm: 28, gapMm: 2 },
    tile: { shape: 'folded-ridge', reliefHeightMm: 22, leanRatio: 0.16 },
    design: { silhouette: 'rectangle', variation: 0.5 },
    pattern: { kind: 'wave', frequency: 1.1, angleDeg: 28 },
  },
  'sampled-blocks': {
    grid: { columns: 13, rows: 8, tileSizeMm: 29, gapMm: 2.2 },
    tile: { shape: 'surface-column', baseHeightMm: 2.4, reliefHeightMm: 32, leanRatio: 0 },
    design: { silhouette: 'rectangle', variation: 0.42 },
    pattern: { kind: 'dunes', frequency: 1.05, angleDeg: 24, noiseScale: 1.55 },
  },
  'triangular-current': {
    grid: { columns: 10, rows: 8, tileSizeMm: 34, gapMm: 2.2 },
    tile: { shape: 'triangle-sail', reliefHeightMm: 28, leanRatio: 0.18 },
    design: { silhouette: 'rectangle', variation: 0.55 },
    pattern: { kind: 'wave', frequency: 1.35, angleDeg: 18 },
  },
  'polar-bloom': {
    grid: { columns: 10, rows: 10, tileSizeMm: 32, gapMm: 2.4 },
    tile: { shape: 'polar-petal', reliefHeightMm: 30, leanRatio: 0.18 },
    design: { silhouette: 'ellipse', variation: 0.45, symmetry: 8 },
    pattern: { kind: 'ripple', frequency: 1.2, centerX: 0, centerY: 0 },
  },
  'cellular-crystal': {
    grid: { columns: 10, rows: 7, tileSizeMm: 34, gapMm: 2.5 },
    tile: { shape: 'cell-crystal', reliefHeightMm: 28, leanRatio: 0.12 },
    design: { silhouette: 'rectangle', variation: 0.7 },
    pattern: { kind: 'dunes', frequency: 1.05, noiseScale: 1.6 },
  },
  'hex-canopy': {
    grid: { columns: 5, rows: 3, tileSizeMm: 96, gapMm: 4 },
    tile: { shape: 'hex-mixed', reliefHeightMm: 28, leanRatio: 0.16 },
    design: { silhouette: 'ellipse', variation: 0.52 },
    pattern: { kind: 'vortex', frequency: 1.15, arms: 4 },
  },
  'coral-cluster': {
    grid: { columns: 14, rows: 8, tileSizeMm: 27, gapMm: 2 },
    tile: { shape: 'ring-pod', reliefHeightMm: 36, leanRatio: 0.12 },
    design: { silhouette: 'ellipse', variation: 0.84 },
    pattern: { kind: 'noise', frequency: 1, noiseScale: 2.2 },
  },
  'contour-relief': {
    grid: { columns: 4, rows: 3, tileSizeMm: 150, gapMm: 2 },
    tile: { shape: 'relief-panel', baseHeightMm: 2.4, reliefHeightMm: 48, leanRatio: 0 },
    design: { silhouette: 'rectangle', variation: 0.45, surfaceResolution: 20 },
    pattern: { kind: 'vortex', frequency: 0.72, arms: 3, centerX: -0.08, centerY: 0.04 },
  },
  'silhouette-mosaic': {
    grid: { columns: 16, rows: 10, tileSizeMm: 25, gapMm: 3 },
    tile: { shape: 'mixed-block', reliefHeightMm: 25, leanRatio: 0.18 },
    design: { silhouette: 'archipelago', variation: 0.78 },
    pattern: { kind: 'noise', frequency: 1.1, noiseScale: 1.7 },
  },
}

interface InitialConfigState {
  config: WallArtConfig
  notice?: string
}

function loadInitialConfig(): InitialConfigState {
  let saved: string | null
  try {
    saved = window.localStorage.getItem(STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_STORAGE_KEY)
  } catch {
    return {
      config: createWallArtConfig(),
      notice: 'Browser storage is unavailable. Changes will work in this session, but may not be restored after a reload.',
    }
  }

  if (!saved) return { config: createWallArtConfig() }

  try {
    return { config: createWallArtConfig(JSON.parse(saved) as Partial<WallArtConfig>) }
  } catch {
    return {
      config: createWallArtConfig(),
      notice: 'The saved project could not be read, so Relief Forge opened a safe default. You can continue working and save new changes.',
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function controlHelp(text: string) {
  return { 'data-help': text, 'aria-description': text }
}

function normalizeHex(value: string): string | undefined {
  const raw = value.trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(raw)) {
    return `#${raw.split('').map((character) => character.repeat(2)).join('')}`.toLowerCase()
  }
  return /^[0-9a-f]{6}$/i.test(raw) ? `#${raw.toLowerCase()}` : undefined
}

function formatMillimetres(value: number): string {
  return Number(value.toFixed(2)).toString()
}

function formatDimensionReadout(value: number): string {
  return value < 1 ? formatMillimetres(value) : value.toFixed(0)
}

function iconPath(name: 'cube' | 'plan' | 'bed' | 'download' | 'shuffle' | 'save' | 'check' | 'reset') {
  const paths = {
    cube: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m4.3 7.7 7.7 4.4 7.7-4.4M12 12v9"/></>,
    plan: <><path d="M4 4h16v16H4z"/><path d="M4 9h16M9 4v16M15 4v16M4 15h16"/></>,
    bed: <><path d="M3 6h18v12H3z"/><path d="M7 10h4v4H7zM14 9h4v6h-4zM6 21v-3m12 3v-3"/></>,
    download: <><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 18v3h16v-3"/></>,
    shuffle: <><path d="M4 7h3c5 0 5 10 10 10h3"/><path d="m17 14 3 3-3 3M4 17h3c2 0 3-1.5 4-3M14 7c1-1 2-2 3-2h3m-3-3 3 3-3 3"/></>,
    save: <><path d="M5 3h12l3 3v15H4V3h1Z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    reset: <><path d="M6 3h9l3 3v15H6Z"/><path d="M15 3v4h4M9 13h6M12 10v6"/></>,
  }
  return paths[name]
}

function Icon({ name }: { name: Parameters<typeof iconPath>[0] }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{iconPath(name)}</svg>
}

function App() {
  const isMobileEditorViewport = useMobileEditorViewport()
  const [initialConfig] = useState(loadInitialConfig)
  const [config, setConfig] = useState<WallArtConfig>(initialConfig.config)
  const [photoAssets, setPhotoAssets] = useState<Record<string, PhotoFieldAsset>>({})
  const [depthPaintAssets, setDepthPaintAssets] = useState<Record<string, DepthPaintFieldAsset>>({})
  const [depthPaintBusy, setDepthPaintBusy] = useState(false)
  const [depthPaintRestoreState, setDepthPaintRestoreState] = useState<'idle' | 'loading' | 'missing'>('idle')
  const [workflowStep, setWorkflowStep] = useState<WorkflowStep>('shape')
  const [mobileWorkflowLocation, setMobileWorkflowLocation] = useState<MobileWorkflowLocation>(
    () => getMobileWorkflowEntry('shape'),
  )
  const [mobilePreviewState, setMobilePreviewState] = useState<MobilePreviewState>(
    DEFAULT_MOBILE_PREVIEW_STATE,
  )
  const [previewMode, setPreviewMode] = useState<PreviewMode>('model')
  const [selectedTileId, setSelectedTileId] = useState<string>()
  const [selectedPlateIndex, setSelectedPlateIndex] = useState(1)
  const [exportState, setExportState] = useState<ExportState>('idle')
  const [agentToolsState, setAgentToolsState] = useState<AgentToolsState>('checking')
  const [notice, setNotice] = useState<string | undefined>(initialConfig.notice)
  const [preparedDownload, setPreparedDownload] = useState<PreparedDownload>()
  const [sizeDraft, setSizeDraft] = useState({
    width: config.finishedSize.widthMm === undefined ? '' : formatMillimetres(config.finishedSize.widthMm),
    height: config.finishedSize.heightMm === undefined ? '' : formatMillimetres(config.finishedSize.heightMm),
  })
  const [printerDraft, setPrinterDraft] = useState<Record<NumericPrinterField, string>>(() => ({
    bedWidthMm: formatMillimetres(config.printer.bedWidthMm),
    bedDepthMm: formatMillimetres(config.printer.bedDepthMm),
    marginMm: formatMillimetres(config.printer.marginMm),
    spacingMm: formatMillimetres(config.printer.spacingMm),
  }))
  const [hexDrafts, setHexDrafts] = useState(() => config.palette.colors.map((color) => color.toUpperCase()))
  const [helpTooltip, setHelpTooltip] = useState<HelpTooltipState>()
  const [guideWorkspaceOpen, setGuideWorkspaceOpen] = useState(false)
  const [guideMode, setGuideMode] = useState<GuideInteractionMode>('select')
  const [selectedGuideId, setSelectedGuideId] = useState<string>()
  const [startOverOpen, setStartOverOpen] = useState(false)
  const [startOverError, setStartOverError] = useState<string>()
  const [startOverBusy, setStartOverBusy] = useState(false)
  const [editorSessionVersion, setEditorSessionVersion] = useState(0)
  const activeHelpControl = useRef<HTMLElement | null>(null)
  const controlHelpInteraction = useRef(INITIAL_CONTROL_HELP_INTERACTION_STATE)
  const shapeInspectorHeadingRef = useRef<HTMLDivElement | null>(null)
  const prepareInspectorHeadingRef = useRef<HTMLDivElement | null>(null)
  const mobileSubsectionHeadingRef = useRef<HTMLParagraphElement | null>(null)
  const currentProjectIdRef = useRef<string | undefined>(undefined)
  const configRevisionRef = useRef(0)
  const renderedConfigRevisionRef = useRef(0)
  const configRef = useRef(config)
  const agentPlanRef = useRef<AgentPlanSnapshot | null>(null)
  const agentDispatcherRef = useRef<ReliefForgeToolDispatcher>((async () => {
    throw new Error('Relief Forge agent tools are still initializing.')
  }) as ReliefForgeToolDispatcher)
  const photoMutationGateRef = useRef(new PhotoMutationGate())
  const depthPaintMutationRef = useRef(0)
  const pendingDepthPaintShaRef = useRef<string | undefined>(undefined)
  const agentExportInProgressRef = useRef(false)
  configRef.current = config

  const result = useMemo(() => {
    let project: ReturnType<typeof generateWallArt>
    try {
      project = generateWallArt(config, {
        photoFields: photoAssets,
        depthPaintFields: depthPaintAssets,
      })
    } catch (error) {
      return {
        project: null,
        packing: null,
        error: error instanceof Error ? error.message : 'Unable to generate this design.',
      }
    }
    try {
      const packing = packWallArt(project, config.printer)
      return { project, packing, error: undefined }
    } catch (error) {
      return {
        project,
        packing: null,
        error: error instanceof Error ? `Printer packing needs attention: ${error.message}` : 'Unable to pack this design for the configured printer.',
      }
    }
  }, [config, photoAssets, depthPaintAssets])

  const { project, packing } = result
  const geometryReady = Boolean(
    project &&
    project.tiles.length > 0 &&
    project.diagnostics.allTilesClosedManifold,
  )
  const currentFamily = FAMILIES.find((item) => item.kind === config.design.family) ?? FAMILIES[0]
  const availableShapes = SHAPES_BY_FAMILY[config.design.family]
  const currentShape = availableShapes.find((item) => item.kind === config.tile.shape) ?? availableShapes[0]
  const selectedTile = project?.tiles.find((tile) => tile.id === selectedTileId)
  const selectedGuide = config.guides.lines.find((line) => line.id === selectedGuideId)
  const maxHeight = project ? Math.max(...project.tiles.map((tile) => tile.heightMm)) : 0
  const solidVolumeCm3 = project ? project.diagnostics.fullMesh.volumeMm3 / 1_000 : 0
  const currentPackingFailure: PackingFailure | undefined = project && !packing && result.error
    ? {
        code: 'packing_failed',
        message: result.error,
        usableWidthMm: config.printer.bedWidthMm - config.printer.marginMm * 2,
        usableDepthMm: config.printer.bedDepthMm - config.printer.marginMm * 2,
      }
    : undefined
  agentPlanRef.current = project
    ? {
        config: project.config,
        project,
        packing: packing ?? undefined,
        packingError: currentPackingFailure,
        summary: summarizeFabricationPlan(project, packing ?? undefined, currentPackingFailure),
        revision: configRevisionRef.current,
      }
    : null
  const guideDrawingEnabled = guideWorkspaceOpen && guideMode === 'draw'
  const activePhoto = config.source.kind === 'photo' ? config.source.photo : undefined
  const activePhotoAsset = activePhoto ? photoAssets[activePhoto.assetSha256] : undefined
  const activeDepthPaint = config.localDepth.paint
  const storedDepthPaintAsset = activeDepthPaint
    ? depthPaintAssets[activeDepthPaint.descriptor.assetSha256]
    : undefined
  const activeDepthPaintAsset = depthPaintRestoreState === 'missing'
    ? undefined
    : storedDepthPaintAsset
  const naturalArtWidth = config.grid.columns * config.grid.tileSizeMm + Math.max(0, config.grid.columns - 1) * config.grid.gapMm
  const naturalArtDepth = config.grid.rows * config.grid.tileSizeMm + Math.max(0, config.grid.rows - 1) * config.grid.gapMm
  const photoArtAspectRatio = (project?.widthMm ?? config.finishedSize.widthMm ?? naturalArtWidth) /
    (project?.depthMm ?? config.finishedSize.heightMm ?? naturalArtDepth)
  const paletteLimit = config.source.kind === 'photo' ? 10 : 12
  const requiresFabricationPackage = config.source.kind === 'photo' || Boolean(activeDepthPaint)
  const exportGeometryReady = geometryReady && !depthPaintBusy && depthPaintRestoreState !== 'loading'
  const hasSignedLocalDepth = config.localDepth.masks.some(
    (mask) => mask.enabled && mask.strengthMm !== 0,
  ) || Boolean(activeDepthPaint?.enabled) || config.guides.lines.some(
    (line) => (line.effects?.heightDeltaMm ?? config.guides.heightDeltaMm) !== 0,
  )
  const minimumObjectDepthMm = config.tile.baseHeightMm
  const maximumObjectDepthMm = config.tile.baseHeightMm + config.tile.reliefHeightMm
  const depthLimitPartCount = hasSignedLocalDepth && project
    ? project.tiles.filter((tile) => (
        Math.abs(tile.heightMm - minimumObjectDepthMm) < 1e-8 ||
        Math.abs(tile.heightMm - maximumObjectDepthMm) < 1e-8
      )).length
    : 0

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
    } catch {
      setNotice('This design is still usable, but browser storage could not save it. Keep this tab open and export before reloading.')
    }
  }, [config])

  useEffect(() => {
    const sha256 = config.source.kind === 'photo' ? config.source.photo?.assetSha256 : undefined
    if (!sha256 || photoAssets[sha256]) return
    let cancelled = false
    void loadPhotoFieldAsset(sha256)
      .then((asset) => {
        if (cancelled) return
        if (!asset) {
          setNotice('This project references a local photo that is no longer available. Re-upload the image to recover it; Relief Forge will not silently replace it with a procedural field.')
          return
        }
        setPhotoAssets((current) => ({ ...current, [asset.sha256]: asset }))
      })
      .catch((error) => {
        if (!cancelled) setNotice(error instanceof Error ? error.message : 'The saved photo field could not be restored.')
      })
    return () => { cancelled = true }
  }, [config.source, photoAssets])

  useEffect(() => {
    const descriptor = config.localDepth.paint?.descriptor
    const sha256 = descriptor?.assetSha256
    if (!descriptor || !sha256) {
      setDepthPaintRestoreState('idle')
      return
    }
    const cachedAsset = depthPaintAssets[sha256]
    if (cachedAsset) {
      try {
        resolveDepthPaintFieldAsset(descriptor, { [sha256]: cachedAsset })
        setDepthPaintRestoreState('idle')
      } catch (error) {
        setDepthPaintRestoreState('missing')
        setNotice(error instanceof Error ? error.message : 'The saved depth-paint field does not match its project descriptor.')
      }
      return
    }
    let cancelled = false
    setDepthPaintRestoreState('loading')
    void loadDepthPaintFieldAsset(sha256)
      .then((asset) => {
        if (cancelled) return
        if (!asset) {
          setDepthPaintRestoreState('missing')
          setNotice('This project references a local depth-paint field that is no longer available. Relief Forge will not silently replace it; remove the broken reference or restore the portable project bytes.')
          return
        }
        const resolvedAsset = resolveDepthPaintFieldAsset(descriptor, { [asset.sha256]: asset })
        setDepthPaintAssets((current) => ({ ...current, [resolvedAsset.sha256]: resolvedAsset }))
        setDepthPaintRestoreState('idle')
      })
      .catch((error) => {
        if (cancelled) return
        setDepthPaintRestoreState('missing')
        setNotice(error instanceof Error ? error.message : 'The saved depth-paint field could not be restored.')
      })
    return () => { cancelled = true }
  }, [
    config.localDepth.paint?.descriptor.assetSha256,
    config.localDepth.paint?.descriptor.canonicalHeight,
    config.localDepth.paint?.descriptor.canonicalWidth,
    config.localDepth.paint?.descriptor.unitsPerMm,
    config.localDepth.paint?.descriptor.version,
    depthPaintAssets,
  ])

  useEffect(() => {
    if (selectedGuideId && !config.guides.lines.some((line) => line.id === selectedGuideId)) {
      setSelectedGuideId(undefined)
      setGuideMode('select')
    }
  }, [config.guides.lines, selectedGuideId])

  useEffect(() => {
    if (!isMobileEditorViewport) return
    const guidesActive = mobileWorkflowLocation.subsectionId === 'guides'
    setGuideWorkspaceOpen(guidesActive)
    setGuideMode('select')
    if (guidesActive) setPreviewMode('model')
  }, [isMobileEditorViewport, mobileWorkflowLocation.subsectionId])

  useLayoutEffect(() => {
    currentProjectIdRef.current = project?.id
    renderedConfigRevisionRef.current = configRevisionRef.current
  }, [config, project?.id])

  useEffect(() => () => {
    if (preparedDownload) URL.revokeObjectURL(preparedDownload.url)
  }, [preparedDownload])

  useEffect(() => {
    setPreparedDownload((current) => (
      current && current.projectId !== project?.id ? undefined : current
    ))
  }, [project?.id])

  useEffect(() => {
    if (!packing?.plates.some((plate) => plate.index === selectedPlateIndex)) {
      setSelectedPlateIndex(packing?.plates[0]?.index ?? 1)
    }
  }, [packing, selectedPlateIndex])

  useEffect(() => {
    if (!project) return
    const activeId = document.activeElement?.id
    setSizeDraft((current) => ({
      width: activeId === 'finished-width' ? current.width : formatMillimetres(project.widthMm),
      height: activeId === 'finished-height' ? current.height : formatMillimetres(project.depthMm),
    }))
  }, [project?.widthMm, project?.depthMm])

  useEffect(() => {
    const activeId = document.activeElement?.id
    setPrinterDraft((current) => ({
      bedWidthMm: activeId === PRINTER_INPUT_IDS.bedWidthMm ? current.bedWidthMm : formatMillimetres(config.printer.bedWidthMm),
      bedDepthMm: activeId === PRINTER_INPUT_IDS.bedDepthMm ? current.bedDepthMm : formatMillimetres(config.printer.bedDepthMm),
      marginMm: activeId === PRINTER_INPUT_IDS.marginMm ? current.marginMm : formatMillimetres(config.printer.marginMm),
      spacingMm: activeId === PRINTER_INPUT_IDS.spacingMm ? current.spacingMm : formatMillimetres(config.printer.spacingMm),
    }))
  }, [
    config.printer.bedWidthMm,
    config.printer.bedDepthMm,
    config.printer.marginMm,
    config.printer.spacingMm,
  ])

  useEffect(() => {
    setHexDrafts((current) => config.palette.colors.map((color, index) => (
      normalizeHex(current[index] ?? '') === color.toLowerCase()
        ? current[index]
        : color.toUpperCase()
    )))
  }, [config.palette.colors])

  const commit = (next: WallArtConfig) => {
    try {
      const normalized = createWallArtConfig(next)
      configRevisionRef.current += 1
      configRef.current = normalized
      agentPlanRef.current = null
      setConfig(normalized)
      setNotice(undefined)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'That value is not valid.')
    }
  }

  const setGrid = (patch: Partial<GridConfig>) => commit({ ...config, grid: { ...config.grid, ...patch } })
  const setPartSize = (partSizeMm: number) => {
    // A fitted camera necessarily hides a natural-layout scale change. Lock the
    // currently visible artwork bounds on the first edit so this control can
    // change physical part footprint/density without resizing the whole piece.
    const sizingConfig: WallArtConfig = project ? {
      ...config,
      finishedSize: {
        ...config.finishedSize,
        widthMm: config.finishedSize.widthMm ?? project.widthMm,
        heightMm: config.finishedSize.heightMm ?? project.depthMm,
      },
    } : config
    commit({
      ...sizingConfig,
      grid: gridForPartSize(sizingConfig, partSizeMm),
    })
  }
  const setDesign = (patch: Partial<DesignConfig>) => commit({ ...config, design: { ...config.design, ...patch } })
  const setTile = (patch: Partial<TileGeometryConfig>) => commit({ ...config, tile: { ...config.tile, ...patch } })
  const setPattern = (patch: Partial<PatternConfig>) => {
    const pattern = { ...config.pattern, ...patch }
    if (patch.kind !== undefined) {
      pattern.arms = normalizePatternArms(patch.kind, pattern.arms)
    }
    commit({ ...config, pattern })
  }
  const setPalette = (patch: Partial<PaletteConfig>) => commit({ ...config, palette: { ...config.palette, ...patch } })
  const setPrinter = (patch: Partial<PrinterConfig>) => commit({ ...config, printer: { ...config.printer, ...patch } })
  const setFinishedSize = (patch: Partial<FinishedSizeConfig>) => commit({
    ...config,
    finishedSize: { ...config.finishedSize, ...patch },
  })
  const setGuides = (patch: Partial<GuideCompositionConfig>) => commit({
    ...config,
    guides: { ...config.guides, ...patch },
  })
  const setDepthProfile = (patch: Partial<DepthProfileConfig>) => commit({
    ...config,
    depthProfile: { ...config.depthProfile, ...patch },
  })
  const setRegionalDepthMasks = (masks: WallArtConfig['localDepth']['masks']) => commit({
    ...config,
    localDepth: { ...config.localDepth, masks },
  })

  const commitDepthPaintAsset = async (asset: DepthPaintFieldAsset): Promise<void> => {
    const mutation = depthPaintMutationRef.current + 1
    depthPaintMutationRef.current = mutation
    pendingDepthPaintShaRef.current = asset.sha256
    setPreparedDownload(undefined)
    setDepthPaintBusy(true)
    try {
      await saveDepthPaintFieldAsset(asset)
      if (depthPaintMutationRef.current !== mutation) {
        const referencedSha = configRef.current.localDepth.paint?.descriptor.assetSha256
        if (
          asset.sha256 !== referencedSha &&
          asset.sha256 !== pendingDepthPaintShaRef.current
        ) {
          await deleteDepthPaintFieldAsset(asset.sha256).catch(() => undefined)
        }
        return
      }

      const current = configRef.current
      const previousSha = current.localDepth.paint?.descriptor.assetSha256
      const next = createWallArtConfig({
        ...current,
        localDepth: {
          ...current.localDepth,
          paint: {
            enabled: current.localDepth.paint?.enabled ?? true,
            descriptor: createDepthPaintFieldDescriptor(asset),
          },
        },
      })
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        if (asset.sha256 !== previousSha) {
          await deleteDepthPaintFieldAsset(asset.sha256).catch(() => undefined)
        }
        throw new Error('Browser storage could not save the new depth-paint recipe, so Relief Forge kept the prior field active and did not risk a broken reload.')
      }

      setDepthPaintAssets((currentAssets) => ({
        ...currentAssets,
        [asset.sha256]: asset,
      }))
      configRevisionRef.current += 1
      configRef.current = next
      setConfig(next)
      setDepthPaintRestoreState('idle')

      let cleanupWarning = ''
      if (previousSha && previousSha !== asset.sha256) {
        try {
          await deleteDepthPaintFieldAsset(previousSha)
          setDepthPaintAssets((currentAssets) => {
            const nextAssets = { ...currentAssets }
            delete nextAssets[previousSha]
            return nextAssets
          })
        } catch {
          cleanupWarning = ' The previous field was retained in this Site\'s local storage because cleanup failed.'
        }
      }
      if (depthPaintMutationRef.current === mutation) {
        setNotice(`Depth paint saved and applied to the live object.${cleanupWarning}`)
      }
    } catch (error) {
      if (depthPaintMutationRef.current === mutation) {
        setNotice(error instanceof Error ? error.message : 'The depth-paint field could not be saved.')
      }
      throw error
    } finally {
      if (depthPaintMutationRef.current === mutation) {
        pendingDepthPaintShaRef.current = undefined
        setDepthPaintBusy(false)
      }
    }
  }

  const setDepthPaintEnabled = (enabled: boolean) => {
    const current = configRef.current
    if (!current.localDepth.paint) return
    commit({
      ...current,
      localDepth: {
        ...current.localDepth,
        paint: { ...current.localDepth.paint, enabled },
      },
    })
  }

  const removeDepthPaint = async (): Promise<boolean> => {
    const mutation = depthPaintMutationRef.current + 1
    depthPaintMutationRef.current = mutation
    const current = configRef.current
    const sha256 = current.localDepth.paint?.descriptor.assetSha256
    pendingDepthPaintShaRef.current = sha256
    setPreparedDownload(undefined)
    setDepthPaintBusy(true)
    if (!sha256) {
      pendingDepthPaintShaRef.current = undefined
      setDepthPaintBusy(false)
      setNotice('No retained depth-paint field needed removal.')
      return true
    }
    const next = createWallArtConfig({
      ...current,
      localDepth: { ...current.localDepth, paint: undefined },
    })
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      pendingDepthPaintShaRef.current = undefined
      setDepthPaintBusy(false)
      setNotice('Browser storage is unavailable, so Relief Forge did not delete the field and risk restoring a broken recipe. Clear this Site\'s stored data to remove it manually.')
      return false
    }

    configRevisionRef.current += 1
    configRef.current = next
    setConfig(next)
    setDepthPaintRestoreState('idle')
    try {
      await deleteDepthPaintFieldAsset(sha256)
      setDepthPaintAssets((currentAssets) => {
        const nextAssets = { ...currentAssets }
        delete nextAssets[sha256]
        return nextAssets
      })
      setNotice('The canonical depth-paint field was removed from this device. Regional masks and the global depth profile remain active.')
    } catch (error) {
      const detail = error instanceof Error ? ` ${error.message}` : ''
      setNotice(`The depth-paint recipe was removed, but its unreferenced bytes could not be deleted from this Site\'s local storage.${detail}`)
    } finally {
      if (depthPaintMutationRef.current === mutation) {
        pendingDepthPaintShaRef.current = undefined
        setDepthPaintBusy(false)
      }
    }
    return true
  }

  const applyPhotoCompositionUnlocked = async ({
    asset,
    analysis,
    mapping,
    useRecommendedGeometry,
  }: ApplyPhotoPayload) => {
    const startingConfigRevision = configRevisionRef.current
    if (mapping.colorMode === 'current-palette' && config.palette.colors.length > 10) {
      throw new Error('Photo compositions support at most 10 current filament colors.')
    }
    const recommendation = analysis.recommendation
    const selectedPhotoFamily = useRecommendedGeometry
      ? recommendation.family
      : config.design.family
    const effectiveMapping = photoFamilyUsesDirection(selectedPhotoFamily)
      ? mapping
      : { ...mapping, directionMode: 'off' as const, directionStrength: 0 }
    const photo: PhotoCompositionConfig = {
      ...effectiveMapping,
      assetSha256: asset.sha256,
      canonicalWidth: asset.width,
      canonicalHeight: asset.height,
    }
    const preset = FAMILY_PRESETS[recommendation.family]
    const targetWidthMm = project?.widthMm ?? config.finishedSize.widthMm ?? naturalArtWidth
    const targetHeightMm = project?.depthMm ?? config.finishedSize.heightMm ?? naturalArtDepth
    const recommendedGapMm = preset.grid.gapMm ?? config.grid.gapMm
    const recommendedTileSizeMm = Math.max(
      1,
      (targetWidthMm - recommendedGapMm * Math.max(0, recommendation.columns - 1)) /
        recommendation.columns,
    )
    const next = createWallArtConfig({
      ...config,
      source: { kind: 'photo', photo },
      finishedSize: useRecommendedGeometry
        ? { widthMm: targetWidthMm, heightMm: targetHeightMm, lockAspect: true }
        : config.finishedSize,
      design: useRecommendedGeometry
        ? {
            ...config.design,
            ...preset.design,
            family: recommendation.family,
            silhouette: 'rectangle',
            variation: 0,
          }
        : config.design,
      grid: useRecommendedGeometry
        ? {
            ...config.grid,
            ...preset.grid,
            columns: recommendation.columns,
            rows: recommendation.rows,
            tileSizeMm: recommendedTileSizeMm,
          }
        : config.grid,
      tile: useRecommendedGeometry
        ? { ...config.tile, ...preset.tile, shape: recommendation.shape }
        : config.tile,
      pattern: useRecommendedGeometry
        ? { ...config.pattern, ...preset.pattern, kind: 'flat' }
        : config.pattern,
      palette: effectiveMapping.colorMode === 'auto-palette'
        ? {
            ...config.palette,
            colors: analysis.palette,
            mode: 'field-bands',
            offset: 0,
            reverse: false,
          }
        : {
            ...config.palette,
            colors: [...config.palette.colors],
          },
    })
    const previousSha256 = config.source.kind === 'photo'
      ? config.source.photo?.assetSha256
      : undefined
    await persistPhotoAssetForApply({
      asset,
      previousSha256,
      startingConfigRevision,
      currentConfigRevision: () => configRevisionRef.current,
      save: savePhotoFieldAsset,
      remove: deletePhotoFieldAsset,
    })
    const storedAsset = { ...asset, rgba8: asset.rgba8.slice() }
    let recipePersisted = true
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      recipePersisted = false
    }
    setPhotoAssets((current) => ({ ...current, [storedAsset.sha256]: storedAsset }))
    configRevisionRef.current += 1
    const appliedConfigRevision = configRevisionRef.current
    configRef.current = next
    setConfig(next)
    setSelectedTileId(undefined)
    setPreviewMode('model')
    let cleanupWarning = ''
    if (recipePersisted && previousSha256 && previousSha256 !== storedAsset.sha256) {
      try {
        await deletePhotoFieldAsset(previousSha256)
        setPhotoAssets((current) => {
          const assets = { ...current }
          delete assets[previousSha256]
          return assets
        })
      } catch {
        cleanupWarning = ' The previous canonical field could not be removed; clear this Site\'s local storage to delete it.'
      }
    } else if (!recipePersisted) {
      cleanupWarning = ' Browser storage could not save this replacement, so the prior canonical field was retained for safe reload recovery.'
    }
    if (configRevisionRef.current === appliedConfigRevision) {
      setNotice(`Photo composition applied with ${next.palette.colors.length} key color${next.palette.colors.length === 1 ? '' : 's'} and ${useRecommendedGeometry ? `${recommendation.family} / ${recommendation.shape}` : 'the current geometry'}.${cleanupWarning}`)
    }
  }

  const applyPhotoComposition = async (payload: ApplyPhotoPayload) => {
    await photoMutationGateRef.current.run(() => applyPhotoCompositionUnlocked(payload))
  }

  const updatePhotoComposition = (patch: Partial<PhotoCompositionConfig>) => {
    if (config.source.kind !== 'photo' || !config.source.photo) return
    commit({
      ...config,
      source: {
        kind: 'photo',
        photo: { ...config.source.photo, ...patch },
      },
    })
  }

  const useProceduralComposition = () => {
    if (config.source.kind === 'procedural') return
    commit({ ...config, source: { kind: 'procedural' } })
  }

  const removePhotoCompositionUnlocked = async (): Promise<PhotoRemovalOutcome> => {
    const sha256 = config.source.kind === 'photo' ? config.source.photo?.assetSha256 : undefined
    if (!sha256) {
      return {
        proceduralActive: true,
        removedFromDevice: false,
        status: 'No active canonical photo field needed removal. Procedural composition is active.',
      }
    }
    const proceduralConfig = createWallArtConfig({ ...config, source: { kind: 'procedural' } })
    const outcome = await removePhotoAssetWithRecipeSafety({
      sha256,
      persistProceduralRecipe: () => {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(proceduralConfig))
      },
      activateProceduralRecipe: () => {
        configRevisionRef.current += 1
        configRef.current = proceduralConfig
        setConfig(proceduralConfig)
      },
      remove: deletePhotoFieldAsset,
    })
    if (outcome.removedFromDevice) {
      setPhotoAssets((current) => {
        const next = { ...current }
        delete next[sha256]
        return next
      })
    }
    setNotice(outcome.status)
    return outcome
  }

  const removePhotoComposition = async (): Promise<PhotoRemovalOutcome> => {
    return photoMutationGateRef.current.run(removePhotoCompositionUnlocked)
  }

  const setPrinterDraftValue = (field: NumericPrinterField, draft: string) => {
    setPrinterDraft((current) => ({ ...current, [field]: draft }))
    const value = Number(draft)
    const { min, max } = PRINTER_INPUT_BOUNDS[field]
    if (!Number.isFinite(value) || value < min || value > max) return
    setPrinter({ [field]: value })
  }

  const restorePrinterDraft = (field: NumericPrinterField) => {
    const value = Number(printerDraft[field])
    const current = config.printer[field]
    const { min, max } = PRINTER_INPUT_BOUNDS[field]
    if (!Number.isFinite(value)) {
      setPrinterDraft((drafts) => ({ ...drafts, [field]: formatMillimetres(current) }))
      setNotice(`Enter a number from ${min} through ${max} millimetres.`)
      return
    }
    const bounded = clamp(value, min, max)
    setPrinterDraft((drafts) => ({ ...drafts, [field]: formatMillimetres(bounded) }))
    if (bounded !== current) setPrinter({ [field]: bounded })
    if (bounded !== value) {
      setNotice(`This printer setting was limited to the supported ${min}–${max} mm range.`)
    }
  }

  const nextGuideId = () => {
    const used = new Set(config.guides.lines.map((line) => line.id))
    let ordinal = 1
    while (used.has(`guide-${String(ordinal).padStart(2, '0')}`)) ordinal += 1
    return `guide-${String(ordinal).padStart(2, '0')}`
  }

  const snapshotGuideEffects = (): Required<GuideEffectOverrides> => ({
    influenceRadius: config.guides.influenceRadius,
    followStrength: config.guides.followStrength,
    centerPull: config.guides.centerPull,
    heightDeltaMm: config.guides.heightDeltaMm,
    directionMode: 'toward',
  })

  const replaceGuide = (guideId: string, replacement: GuideLineConfig) => {
    setGuides({
      lines: config.guides.lines.map((line) => line.id === guideId ? replacement : line),
    })
  }

  const handleGuideDrawn = (rawPoints: readonly NormalizedPoint[]) => {
    if (config.guides.lines.length >= 32) {
      setGuideMode('select')
      setNotice('This project already has the maximum of 32 guide lines.')
      return
    }
    try {
      let tolerance = 0.018
      let controlPoints = simplifyPolyline(rawPoints, tolerance)
      while (controlPoints.length > 32) {
        tolerance *= 1.35
        controlPoints = simplifyPolyline(rawPoints, tolerance)
      }
      const sampled = rebuildGuidePath(controlPoints, false, 'smooth')
      const guide = createGuidePolyline(nextGuideId(), sampled)
      const ordinal = guide.id.replace('guide-', '')
      setGuides({
        lines: [
          ...config.guides.lines,
          {
            id: guide.id,
            name: `Guide ${ordinal}`,
            closed: guide.closed,
            points: guide.points.map((point) => ({ x: point.x, y: point.y })),
            controlPoints: controlPoints.map((point) => ({ ...point })),
            interpolation: 'smooth',
            templateKind: 'freehand',
            effects: snapshotGuideEffects(),
          },
        ],
      })
      setSelectedGuideId(guide.id)
      setGuideMode('edit')
      setNotice(`Guide ${ordinal} added. Drag a handle to mold it, or click the line to place another handle.`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'That guide line could not be added.')
    }
  }

  const openGuideWorkspace = () => {
    selectWorkflowStep(
      'shape',
      isMobileEditorViewport,
      isMobileEditorViewport ? getMobileWorkflowLocation('guides') : undefined,
    )
    setPreviewMode('model')
    setGuideWorkspaceOpen(true)
    setGuideMode('select')
  }

  const toggleGuideWorkspace = () => {
    if (guideWorkspaceOpen) {
      if (isMobileEditorViewport) {
        selectWorkflowStep('shape', true)
        return
      }
      setGuideWorkspaceOpen(false)
      setGuideMode('select')
    } else {
      openGuideWorkspace()
    }
  }

  const changeGuideMode = (mode: GuideInteractionMode) => {
    setPreviewMode('model')
    setGuideWorkspaceOpen(true)
    setGuideMode(mode)
  }

  const addGuidePreset = (kind: GuidePresetKind) => {
    if (!project || config.guides.lines.length >= 32) {
      setNotice(config.guides.lines.length >= 32
        ? 'This project already has the maximum of 32 guide lines.'
        : 'Resolve the current geometry warning before placing a guide shape.')
      return
    }
    try {
      const preset = createGuidePresetGeometry(kind, {
        widthMm: project.widthMm,
        depthMm: project.depthMm,
      })
      const id = nextGuideId()
      const line: GuideLineConfig = {
        id,
        name: `${preset.label} ${id.replace('guide-', '')}`,
        closed: preset.closed,
        points: preset.points.map((point) => ({ ...point })),
        controlPoints: preset.controlPoints.map((point) => ({ ...point })),
        interpolation: preset.curve,
        templateKind: preset.kind,
        effects: snapshotGuideEffects(),
      }
      setGuides({ lines: [...config.guides.lines, line] })
      setSelectedGuideId(id)
      setGuideMode('edit')
      setNotice(`${preset.label} guide added. Its shape and effects are independent from every other guide.`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'That guide shape could not be added.')
    }
  }

  const deleteNewestGuide = () => {
    if (config.guides.lines.length === 0) return
    const newest = config.guides.lines[config.guides.lines.length - 1]
    setGuides({ lines: config.guides.lines.slice(0, -1) })
    if (selectedGuideId === newest.id) setSelectedGuideId(undefined)
    setNotice(`${newest.name ?? newest.id} removed.`)
  }

  const clearGuides = () => {
    if (config.guides.lines.length === 0) return
    setGuides({ lines: [] })
    setSelectedGuideId(undefined)
    setGuideMode('select')
    setNotice('All guide lines removed.')
  }

  const updateSelectedGuideEffects = (patch: GuideEffectOverrides) => {
    if (!selectedGuide) return
    replaceGuide(selectedGuide.id, {
      ...selectedGuide,
      effects: {
        ...resolveGuideEffects(config.guides, selectedGuide),
        ...patch,
      },
    })
  }

  const renameSelectedGuide = (name: string) => {
    if (!selectedGuide) return
    replaceGuide(selectedGuide.id, {
      ...selectedGuide,
      name: name.trim() ? name.slice(0, 80) : undefined,
    })
  }

  const reverseSelectedGuide = () => {
    if (!selectedGuide) return
    try {
      const controlPoints = selectedGuide.controlPoints?.map((point) => ({ ...point })).reverse()
      const points = controlPoints
        ? rebuildGuidePath(
            controlPoints,
            selectedGuide.closed,
            selectedGuide.interpolation ?? 'linear',
          )
        : selectedGuide.points.map((point) => ({ ...point })).reverse()
      replaceGuide(selectedGuide.id, { ...selectedGuide, controlPoints, points })
      setNotice(`${selectedGuide.name ?? selectedGuide.id} direction reversed.`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'That guide direction could not be reversed.')
    }
  }

  const deleteSelectedGuide = () => {
    if (!selectedGuide) return
    const index = config.guides.lines.findIndex((line) => line.id === selectedGuide.id)
    const lines = config.guides.lines.filter((line) => line.id !== selectedGuide.id)
    setGuides({ lines })
    setSelectedGuideId(lines[Math.min(index, lines.length - 1)]?.id)
    if (lines.length === 0) setGuideMode('select')
    setNotice(`${selectedGuide.name ?? selectedGuide.id} removed.`)
  }

  const resetSelectedGuideEffects = () => {
    if (!selectedGuide) return
    replaceGuide(selectedGuide.id, {
      ...selectedGuide,
      effects: {
        influenceRadius: DEFAULT_WALL_ART_CONFIG.guides.influenceRadius,
        followStrength: DEFAULT_WALL_ART_CONFIG.guides.followStrength,
        centerPull: DEFAULT_WALL_ART_CONFIG.guides.centerPull,
        heightDeltaMm: DEFAULT_WALL_ART_CONFIG.guides.heightDeltaMm,
        directionMode: 'toward',
      },
    })
    setNotice(`${selectedGuide.name ?? selectedGuide.id} effects reset.`)
  }

  const updateGuideControlPoints = (
    guideId: string,
    controlPoints: readonly NormalizedPoint[],
  ) => {
    const line = config.guides.lines.find((candidate) => candidate.id === guideId)
    if (!line) return
    try {
      const copiedControls = controlPoints.map((point) => ({ ...point }))
      const points = rebuildGuidePath(
        copiedControls,
        line.closed,
        line.interpolation ?? 'linear',
      )
      replaceGuide(guideId, { ...line, controlPoints: copiedControls, points })
      setNotice(`${line.name ?? line.id} reshaped.`)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'That guide edit could not be applied.')
    }
  }

  const selectFamily = (family: DesignFamilyKind) => {
    const preset = FAMILY_PRESETS[family]
    commit({
      ...config,
      design: { ...config.design, ...preset.design, family },
      grid: { ...config.grid, ...preset.grid },
      tile: { ...config.tile, ...preset.tile },
      pattern: { ...config.pattern, ...preset.pattern },
    })
    setSelectedTileId(undefined)
    setPreviewMode('model')
  }

  const setTargetDimension = (axis: 'width' | 'height', draft: string) => {
    setSizeDraft((current) => ({ ...current, [axis]: draft }))
    const target = Number(draft)
    const currentWidth = project?.widthMm ?? config.finishedSize.widthMm
    const currentHeight = project?.depthMm ?? config.finishedSize.heightMm
    if (
      !Number.isFinite(target) ||
      target < MIN_FINISHED_DIMENSION_MM ||
      currentWidth === undefined ||
      currentHeight === undefined
    ) return

    if (target > MAX_FINISHED_DIMENSION_MM) {
      setNotice(`Finished dimensions cannot exceed ${MAX_FINISHED_DIMENSION_MM.toLocaleString()} mm.`)
      return
    }

    const ratio = currentWidth / currentHeight
    if (axis === 'width') {
      const nextHeight = config.finishedSize.lockAspect ? target / ratio : currentHeight
      if (nextHeight < MIN_FINISHED_DIMENSION_MM || nextHeight > MAX_FINISHED_DIMENSION_MM) {
        setSizeDraft({ width: formatMillimetres(currentWidth), height: formatMillimetres(currentHeight) })
        setNotice(`Keeping this aspect ratio would put a finished dimension outside the supported ${MIN_FINISHED_DIMENSION_MM}–${MAX_FINISHED_DIMENSION_MM.toLocaleString()} mm range.`)
        return
      }
      setFinishedSize({ widthMm: target, heightMm: nextHeight })
      if (config.finishedSize.lockAspect) {
        setSizeDraft({ width: draft, height: formatMillimetres(nextHeight) })
      }
    } else {
      const nextWidth = config.finishedSize.lockAspect ? target * ratio : currentWidth
      if (nextWidth < MIN_FINISHED_DIMENSION_MM || nextWidth > MAX_FINISHED_DIMENSION_MM) {
        setSizeDraft({ width: formatMillimetres(currentWidth), height: formatMillimetres(currentHeight) })
        setNotice(`Keeping this aspect ratio would put a finished dimension outside the supported ${MIN_FINISHED_DIMENSION_MM}–${MAX_FINISHED_DIMENSION_MM.toLocaleString()} mm range.`)
        return
      }
      setFinishedSize({ widthMm: nextWidth, heightMm: target })
      if (config.finishedSize.lockAspect) {
        setSizeDraft({ width: formatMillimetres(nextWidth), height: draft })
      }
    }
  }

  const restoreValidDimension = (axis: 'width' | 'height') => {
    const draft = sizeDraft[axis]
    if (
      Number.isFinite(Number(draft)) &&
      Number(draft) >= MIN_FINISHED_DIMENSION_MM &&
      Number(draft) <= MAX_FINISHED_DIMENSION_MM
    ) return
    const fallback = axis === 'width'
      ? project?.widthMm ?? config.finishedSize.widthMm
      : project?.depthMm ?? config.finishedSize.heightMm
    if (fallback === undefined) {
      setNotice('Resolve the current geometry warning before editing finished size.')
      return
    }
    setSizeDraft((current) => ({
      ...current,
      [axis]: formatMillimetres(fallback),
    }))
    setNotice(`Finished dimensions must be between ${MIN_FINISHED_DIMENSION_MM} and ${MAX_FINISHED_DIMENSION_MM.toLocaleString()} millimetres.`)
  }

  const resetFinishedSize = () => {
    setFinishedSize({ widthMm: undefined, heightMm: undefined })
    setNotice('Finished size reset to the geometry system’s natural bounds.')
  }

  const randomizeSeed = () => commit({ ...config, seed: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}` })

  const activateFreshProject = (freshConfig: WallArtConfig) => {
    configRevisionRef.current += 1
    depthPaintMutationRef.current += 1
    pendingDepthPaintShaRef.current = undefined
    configRef.current = freshConfig
    agentPlanRef.current = null
    setConfig(freshConfig)
    setPhotoAssets({})
    setDepthPaintAssets({})
    setDepthPaintRestoreState('idle')
    setWorkflowStep('shape')
    setMobileWorkflowLocation(getMobileWorkflowEntry('shape'))
    setMobilePreviewState(DEFAULT_MOBILE_PREVIEW_STATE)
    setPreviewMode('model')
    setSelectedTileId(undefined)
    setSelectedPlateIndex(1)
    setExportState('idle')
    setPreparedDownload(undefined)
    setSizeDraft({ width: '', height: '' })
    setPrinterDraft({
      bedWidthMm: formatMillimetres(freshConfig.printer.bedWidthMm),
      bedDepthMm: formatMillimetres(freshConfig.printer.bedDepthMm),
      marginMm: formatMillimetres(freshConfig.printer.marginMm),
      spacingMm: formatMillimetres(freshConfig.printer.spacingMm),
    })
    setHexDrafts(freshConfig.palette.colors.map((color) => color.toUpperCase()))
    activeHelpControl.current = null
    controlHelpInteraction.current = resetControlHelpInteraction()
    setHelpTooltip(undefined)
    setGuideWorkspaceOpen(false)
    setGuideMode('select')
    setSelectedGuideId(undefined)
    setNotice(undefined)
    setEditorSessionVersion((current) => current + 1)
  }

  const startOver = async () => {
    if (startOverBusy || exportState !== 'idle' || depthPaintBusy) return

    setStartOverBusy(true)
    setStartOverError(undefined)
    setDepthPaintBusy(true)
    try {
      const outcome = await photoMutationGateRef.current.run(() => startOverProject({
        persistFreshConfig: (freshConfig) => {
          persistFreshProjectConfig(window.localStorage, freshConfig)
        },
        activateFreshConfig: activateFreshProject,
        clearPhotoFields: clearPhotoFieldAssets,
        clearDepthPaintFields: clearDepthPaintFieldAssets,
      }))
      setStartOverOpen(false)
      setNotice(outcome.cleanupFailures.length > 0
        ? `A fresh project is active, but Relief Forge could not delete unreferenced ${outcome.cleanupFailures.join(' and ')} from this browser. Clear this Site's stored data to remove them manually.`
        : 'Fresh project started. The previous design and its locally stored photo and depth-paint fields were removed from this browser.')
    } catch (error) {
      setStartOverError(error instanceof Error && error.message.startsWith('Another photo source change')
        ? error.message
        : 'Relief Forge could not safely start over because browser storage is unavailable. Your current project and its local fields were kept intact.')
    } finally {
      setDepthPaintBusy(false)
      setStartOverBusy(false)
    }
  }

  const stageDownload = (
    blob: Blob,
    filename: string,
    label: string,
    projectSnapshot: NonNullable<typeof project>,
    configRevisionSnapshot: number,
  ): PreparedDownload | undefined => {
    if (!canStageExportSnapshot({
      expectedProjectId: projectSnapshot.id,
      currentProjectId: currentProjectIdRef.current,
      expectedConfigRevision: configRevisionSnapshot,
      currentConfigRevision: configRevisionRef.current,
      depthPaintPersistencePending: pendingDepthPaintShaRef.current !== undefined,
    })) {
      setNotice(`The design changed while ${label.toLowerCase()} was building. No stale download was offered. Build it again for ${currentProjectIdRef.current ?? 'the current project'}.`)
      return undefined
    }
    const prepared = {
      filename,
      label,
      projectId: projectSnapshot.id,
      summary: `${projectSnapshot.config.design.family} · ${projectSnapshot.config.tile.shape} · ${projectSnapshot.config.grid.columns} × ${projectSnapshot.config.grid.rows} · ${projectSnapshot.tiles.length} parts · ${projectSnapshot.widthMm.toFixed(1)} × ${projectSnapshot.depthMm.toFixed(1)} mm`,
      url: URL.createObjectURL(blob),
    }
    setPreparedDownload(prepared)
    setNotice(`${label} built for ${projectSnapshot.id}. Click the highlighted Save file now link; your browser will save it to its configured download location or ask where to put it.`)
    return prepared
  }

  const saveProject = () => {
    if (!project || !exportGeometryReady || pendingDepthPaintShaRef.current !== undefined) return
    if (project.config.source.kind === 'photo' || project.config.localDepth.paint) {
      setNotice('This project uses retained canonical field bytes. Build the fabrication package below so the exact recipe and its photo/depth-paint assets stay together; a JSON-only file would be incomplete.')
      return
    }
    stageDownload(
      new Blob([JSON.stringify({ ...project, packing }, null, 2)], { type: 'application/json' }),
      `${project.id}.json`,
      'Project recipe',
      project,
      configRevisionRef.current,
    )
  }

  const runExport = async (kind: Exclude<ExportState, 'idle'>) => {
    if (!project || !exportGeometryReady || pendingDepthPaintShaRef.current !== undefined || (kind === 'package' && !packing)) return
    const projectSnapshot = project
    const packingSnapshot = packing
    const configRevisionSnapshot = configRevisionRef.current
    setExportState(kind)
    setNotice(undefined)
    try {
      const exports = await import('./export')
      if (kind === 'master') {
        stageDownload(exports.createMasterAssemblyPdf(projectSnapshot), `${projectSnapshot.id}-assembly-master.pdf`, '1:1 assembly PDF', projectSnapshot, configRevisionSnapshot)
      } else if (kind === 'tiled') {
        stageDownload(exports.createTiledAssemblyPdf(projectSnapshot, { paper: 'letter', overlapMm: 10 }), `${projectSnapshot.id}-assembly-letter.pdf`, 'Letter assembly PDF', projectSnapshot, configRevisionSnapshot)
      } else {
        if (!packingSnapshot) throw new Error('Resolve the printer packing warning before building the fabrication package.')
        const blob = await exports.createFabricationPackage(projectSnapshot, packingSnapshot, { includeA4: true, includeLetter: true })
        stageDownload(blob, `${projectSnapshot.id}-fabrication-package.zip`, 'Fabrication package', projectSnapshot, configRevisionSnapshot)
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Export failed.')
    } finally {
      setExportState('idle')
    }
  }

  const updateColor = (index: number, color: string) => {
    const colors = [...config.palette.colors]
    colors[index] = color
    setPalette({ colors })
  }

  const updateHexDraft = (index: number, draft: string) => {
    const nextDrafts = [...hexDrafts]
    nextDrafts[index] = draft.toUpperCase()
    setHexDrafts(nextDrafts)
    const normalized = normalizeHex(draft)
    if (normalized) updateColor(index, normalized)
  }

  const commitHexDraft = (index: number) => {
    const normalized = normalizeHex(hexDrafts[index] ?? '')
    if (!normalized) {
      const nextDrafts = [...hexDrafts]
      nextDrafts[index] = config.palette.colors[index].toUpperCase()
      setHexDrafts(nextDrafts)
      setNotice(`Color ${index + 1} needs a valid 3- or 6-digit HEX value.`)
      return
    }
    updateColor(index, normalized)
    setHexDrafts((current) => current.map((draft, colorIndex) => colorIndex === index ? normalized.toUpperCase() : draft))
  }

  const removeColor = (index: number) => {
    if (config.palette.colors.length <= 2) return
    setPalette({ colors: config.palette.colors.filter((_, colorIndex) => colorIndex !== index) })
  }

  const addColor = () => {
    if (config.palette.colors.length >= paletteLimit) return
    setPalette({ colors: [...config.palette.colors, '#c9815b'] })
  }

  const showControlHelp = (eventTarget: EventTarget | null) => {
    if (!canShowControlHelp(controlHelpInteraction.current)) return
    const element = eventTarget instanceof Element
      ? eventTarget.closest<HTMLElement>('[data-help], button, input, select, [role="button"], [tabindex]:not([tabindex="-1"])')
      : null
    if (!element) return
    const text = element.dataset.help
      ?? element.getAttribute('aria-description')
      ?? element.getAttribute('aria-label')
      ?? element.getAttribute('title')
      ?? element.textContent?.trim()
    if (!text) return
    const rect = element.getBoundingClientRect()
    activeHelpControl.current = element
    setHelpTooltip({
      text: text.replace(/\s+/g, ' '),
      left: Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - 304)),
      top: rect.bottom > window.innerHeight - 120 ? rect.top - 8 : rect.bottom + 8,
      above: rect.bottom > window.innerHeight - 120,
    })
  }

  const hideControlHelp = (relatedTarget: EventTarget | null) => {
    if (relatedTarget instanceof Node && activeHelpControl.current?.contains(relatedTarget)) return
    activeHelpControl.current = null
    setHelpTooltip(undefined)
  }

  const dismissControlHelpOnTouch = () => {
    const transition = beginControlHelpTouch(helpTooltip !== undefined)
    controlHelpInteraction.current = transition.state
    if (!transition.dismiss) return
    activeHelpControl.current = null
    setHelpTooltip(undefined)
  }

  const continueControlHelpWithMousePointer = (pointerType: string) => {
    controlHelpInteraction.current = continueControlHelpWithPointer(
      controlHelpInteraction.current,
      pointerType,
    )
  }

  const selectWorkflowStep = (
    nextStep: WorkflowStep,
    focusInspector = false,
    requestedMobileLocation?: MobileWorkflowLocation,
  ) => {
    activeHelpControl.current = null
    setHelpTooltip(undefined)
    setWorkflowStep(nextStep)
    const nextMobileLocation = requestedMobileLocation ?? getMobileWorkflowEntry(nextStep)
    if (isMobileEditorViewport) {
      const guidesActive = nextMobileLocation.subsectionId === 'guides'
      setMobileWorkflowLocation(nextMobileLocation)
      setGuideWorkspaceOpen(guidesActive)
      setGuideMode('select')
      if (guidesActive) setPreviewMode('model')
    } else if (nextStep !== 'shape') {
      setGuideWorkspaceOpen(false)
      setGuideMode('select')
    }
    if (focusInspector || isMobileEditorViewport) {
      window.requestAnimationFrame(() => {
        if (isMobileEditorViewport) {
          const heading = mobileSubsectionHeadingRef.current
          heading?.focus({ preventScroll: true })
          heading?.scrollIntoView({ block: 'start' })
          return
        }
        const heading = nextStep === 'shape'
          ? shapeInspectorHeadingRef.current
          : prepareInspectorHeadingRef.current
        heading?.focus()
      })
    }
  }

  const navigateMobileWorkflow = (location: MobileWorkflowLocation) => {
    selectWorkflowStep(location.sectionId, true, location)
  }

  const selectPreviewMode = (nextMode: PreviewMode) => {
    if (isMobileEditorViewport && mobileWorkflowLocation.subsectionId === 'guides') {
      selectWorkflowStep('shape', true)
    } else {
      setGuideWorkspaceOpen(false)
      setGuideMode('select')
    }
    setPreviewMode(nextMode)
  }

  const waitForVisibleState = (
    predicate: () => boolean,
    signal: AbortSignal | undefined,
    failureMessage: string,
  ): Promise<void> => new Promise((resolve, reject) => {
    const startedAt = performance.now()
    let frame = 0
    const cleanUp = () => {
      if (frame) window.cancelAnimationFrame(frame)
      signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      cleanUp()
      reject(new Error('The agent tool call was cancelled.'))
    }
    const check = () => {
      if (signal?.aborted) {
        onAbort()
        return
      }
      if (predicate()) {
        cleanUp()
        resolve()
        return
      }
      if (performance.now() - startedAt > 5_000) {
        cleanUp()
        reject(new Error(failureMessage))
        return
      }
      frame = window.requestAnimationFrame(check)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    frame = window.requestAnimationFrame(check)
  })

  const currentAgentPlan = (): AgentPlanSnapshot => {
    const plan = agentPlanRef.current
    if (
      !plan
      || plan.revision !== configRevisionRef.current
      || plan.project.id !== currentProjectIdRef.current
    ) {
      throw new Error('The visible geometry is still updating. Wait for Relief Forge to finish, then try again.')
    }
    return plan
  }

  const dispatchAgentTool = async (
    name: ReliefForgeToolName,
    input: ReliefForgeToolInputs[ReliefForgeToolName],
    context: ReliefForgeToolExecutionContext,
  ): Promise<ReliefForgeJsonValue> => {
    if (context.signal?.aborted) throw new Error('The agent tool call was cancelled.')

    if (name === 'relief_forge_create_wall_art') {
      const action = createWallArtAction(input, configRef.current)
      activateFreshProject(action.config)
      const revision = configRevisionRef.current
      currentProjectIdRef.current = action.project.id
      agentPlanRef.current = { ...action, revision }
      setNotice(`Agent created ${action.project.id}: ${action.summary.finishedSizeMm.width.toFixed(1)} × ${action.summary.finishedSizeMm.height.toFixed(1)} mm, ${action.summary.partCount} printable parts.`)
      await waitForVisibleState(
        () => renderedConfigRevisionRef.current >= revision
          && Boolean(document.body.textContent?.includes(action.project.id)),
        context.signal,
        'The configured wall art did not become visible in time.',
      )
      return asWebMcpResult(action.summary)
    }

    if (name === 'relief_forge_set_printer_bed') {
      const action = setPrinterBedAction(input, configRef.current, {
        photoFields: photoAssets,
        depthPaintFields: depthPaintAssets,
      })
      configRevisionRef.current += 1
      const revision = configRevisionRef.current
      configRef.current = action.config
      currentProjectIdRef.current = action.project.id
      agentPlanRef.current = { ...action, revision }
      setConfig(action.config)
      setPreparedDownload(undefined)
      setPrinterDraft({
        bedWidthMm: formatMillimetres(action.config.printer.bedWidthMm),
        bedDepthMm: formatMillimetres(action.config.printer.bedDepthMm),
        marginMm: formatMillimetres(action.config.printer.marginMm),
        spacingMm: formatMillimetres(action.config.printer.spacingMm),
      })
      setSelectedPlateIndex(1)
      selectWorkflowStep('build')
      setPreviewMode('plates')
      setNotice(action.summary.digitalFit.status === 'fits'
        ? `Agent packed ${action.summary.partCount} parts across ${action.summary.digitalFit.plateCount} plates for the requested bed.`
        : `The requested printer settings are visible, but packing needs attention: ${action.packingError?.message ?? 'not every part fits.'}`)
      await waitForVisibleState(
        () => renderedConfigRevisionRef.current >= revision
          && Boolean(document.body.textContent?.includes(action.project.id)),
        context.signal,
        'The printer configuration did not become visible in time.',
      )
      return asWebMcpResult(action.summary)
    }

    if (name === 'relief_forge_inspect_fabrication_plan') {
      assertEmptyToolInput(input)
      return asWebMcpResult(currentAgentPlan().summary)
    }

    assertEmptyToolInput(input)
    const plan = currentAgentPlan()
    if (!plan.packing || plan.packingError) {
      throw new Error('Resolve the visible printer packing warning before preparing the fabrication package.')
    }
    if (
      plan.project.tiles.length === 0
      || !plan.project.diagnostics.allTilesClosedManifold
      || !plan.project.diagnostics.fullMesh.closedManifold
      || !plan.project.diagnostics.fullMesh.outwardWinding
    ) {
      throw new Error('Resolve the visible digital geometry warning before preparing the fabrication package.')
    }
    if (
      depthPaintBusy
      || depthPaintRestoreState === 'loading'
      || pendingDepthPaintShaRef.current !== undefined
    ) {
      throw new Error('Wait for the current depth-paint asset to finish saving or restoring before preparing the fabrication package.')
    }
    if (exportState !== 'idle' || agentExportInProgressRef.current) {
      throw new Error('A fabrication export is already in progress. Wait for it to finish before preparing another package.')
    }
    const projectSnapshot = plan.project
    const packingSnapshot = plan.packing
    const revisionSnapshot = plan.revision
    agentExportInProgressRef.current = true
    setExportState('package')
    setPreparedDownload(undefined)
    selectWorkflowStep(
      'export',
      false,
      isMobileEditorViewport ? getMobileWorkflowLocation('build-save') : undefined,
    )
    setNotice(`Agent is building the fabrication package for ${projectSnapshot.id}.`)
    try {
      const exports = await import('./export')
      if (context.signal?.aborted) throw new Error('The agent tool call was cancelled.')
      const blob = await exports.createFabricationPackage(
        projectSnapshot,
        packingSnapshot,
        { includeA4: true, includeLetter: true },
      )
      if (context.signal?.aborted) throw new Error('The agent tool call was cancelled.')
      const filename = `${projectSnapshot.id}-fabrication-package.zip`
      const staged = stageDownload(
        blob,
        filename,
        'Fabrication package',
        projectSnapshot,
        revisionSnapshot,
      )
      if (!staged) throw new Error('The design changed during export, so no stale download was offered.')
      await waitForVisibleState(
        () => document.querySelector<HTMLAnchorElement>('a.prepared-download')?.download === filename,
        context.signal,
        'The fabrication package finished, but its Save file now link did not become visible in time.',
      )
      return asWebMcpResult(shapeFabricationPackageResult(plan, {
        fileName: filename,
        byteLength: blob.size,
        saveLinkReady: true,
      }))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Fabrication package preparation failed.')
      throw error
    } finally {
      agentExportInProgressRef.current = false
      setExportState('idle')
    }
  }

  agentDispatcherRef.current = dispatchAgentTool as ReliefForgeToolDispatcher

  useEffect(() => {
    const registration = registerReliefForgeTools(agentDispatcherRef)
    if (!registration.supported) {
      setAgentToolsState('unavailable')
      return registration.dispose
    }
    let active = true
    setAgentToolsState('checking')
    void registration.ready.then(
      () => { if (active) setAgentToolsState('ready') },
      () => { if (active) setAgentToolsState('error') },
    )
    return () => {
      active = false
      registration.dispose()
    }
  }, [])

  const workflowHeading = workflowStep === 'shape' ? undefined : WORKFLOW_HEADINGS[workflowStep]

  return (
    <div
      className="app-shell app-shell--gallery"
      aria-busy={startOverBusy}
      onMouseOver={(event) => showControlHelp(event.target)}
      onMouseOut={(event) => hideControlHelp(event.relatedTarget)}
      onFocusCapture={(event) => showControlHelp(event.target)}
      onBlurCapture={(event) => hideControlHelp(event.relatedTarget)}
      onTouchStartCapture={dismissControlHelpOnTouch}
      onPointerOverCapture={(event) => continueControlHelpWithMousePointer(event.pointerType)}
      onPointerDownCapture={(event) => {
        continueControlHelpWithMousePointer(event.pointerType)
      }}
      onKeyDownCapture={() => {
        controlHelpInteraction.current = resetControlHelpInteraction()
      }}
    >
      <header className="topbar material-topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>
          <div><strong>RELIEF FORGE</strong><small>PARAMETRIC WALL ART STUDIO</small></div>
        </div>
        <div className="project-identity">
          <span className="eyebrow">CURRENT PROJECT</span>
          <strong>{currentFamily.label}</strong>
          <span>{project?.id ?? 'INVALID'}</span>
        </div>
        <nav className="workflow-journey" aria-label="Project workflow">
          {WORKFLOW_STEPS.map((step, index) => (
            <button
              {...controlHelp(`${step.label} workspace. Switching workspaces changes only the visible controls; it does not alter the object.`)}
              key={step.id}
              type="button"
              className={workflowStep === step.id ? 'is-active' : ''}
              aria-current={workflowStep === step.id ? 'step' : undefined}
              onClick={() => selectWorkflowStep(step.id)}
            >
              <span>{step.number}</span>
              <strong>{step.label}</strong>
              {index < WORKFLOW_STEPS.length - 1 && <i aria-hidden="true" />}
            </button>
          ))}
        </nav>
        <div className="topbar-actions">
          <span className="local-badge" data-agent-tools={agentToolsState} aria-live="polite">
            <i />{
              agentToolsState === 'ready'
                ? '4 AGENT TOOLS READY'
                : agentToolsState === 'unavailable'
                  ? 'MANUAL MODE · WEBMCP UNAVAILABLE'
                  : agentToolsState === 'error'
                    ? 'AGENT TOOLS NEED ATTENTION'
                    : 'CONNECTING AGENT TOOLS'
            } · {APP_BUILD_LABEL}
          </span>
          <button {...controlHelp('Create a new deterministic variation while keeping every other design setting unchanged.')} className="button button--ghost" type="button" onClick={randomizeSeed}><Icon name="shuffle" />New seed</button>
          <button
            {...controlHelp('Reset the entire project to Relief Forge defaults, including design settings, guides, colors, printer settings, imported photo data, and depth painting. Downloaded files stay unchanged. A confirmation appears first.')}
            aria-label={startOverBusy ? 'Starting over' : 'Start over'}
            className="button button--ghost button--danger"
            type="button"
            onClick={() => {
              activeHelpControl.current = null
              setHelpTooltip(undefined)
              setStartOverError(undefined)
              setStartOverOpen(true)
            }}
            disabled={startOverBusy || exportState !== 'idle' || depthPaintBusy}
          ><Icon name="reset" />{startOverBusy ? 'Starting over…' : 'Start over'}</button>
          <button
            {...controlHelp(requiresFabricationPackage
              ? 'Build the complete fabrication package with every retained canonical field, then open Export so the prepared Save file now link is visible.'
              : 'Build a JSON recipe for this exact design and print packing, then open Export so the prepared Save file now link is visible.')}
            className="button button--ghost"
            type="button"
            onClick={() => {
              selectWorkflowStep(
                'export',
                false,
                isMobileEditorViewport ? getMobileWorkflowLocation('build-save') : undefined,
              )
              if (requiresFabricationPackage) void runExport('package')
              else saveProject()
            }}
            disabled={!exportGeometryReady || (requiresFabricationPackage && (!packing || exportState !== 'idle'))}
          ><Icon name="save" />{requiresFabricationPackage ? (exportState === 'package' ? 'Building package…' : 'Build full package') : 'Build project file'}</button>
        </div>
      </header>

      <main key={`editor-${editorSessionVersion}`} className="studio-grid material-studio">
        <nav className="workspace-rail" aria-label="Preview tools">
          <button {...controlHelp('Inspect the exact generated solids in the interactive 3D viewer.')} type="button" className={previewMode === 'model' && !guideWorkspaceOpen ? 'is-active' : ''} aria-pressed={previewMode === 'model' && !guideWorkspaceOpen} onClick={() => selectPreviewMode('model')}><Icon name="cube" /><span>Model</span></button>
          <button {...controlHelp('Open the guide workspace to draw, shape, select, and independently tune every guide.')} type="button" className={guideWorkspaceOpen ? 'is-active is-drawing' : ''} aria-pressed={guideWorkspaceOpen} onClick={toggleGuideWorkspace}><span className="workspace-rail__glyph" aria-hidden="true">✎</span><span>Guides</span></button>
          <button {...controlHelp('Inspect the full-size placement map, stable part IDs, orientation marks, and rulers.')} type="button" className={previewMode === 'assembly' ? 'is-active' : ''} aria-pressed={previewMode === 'assembly'} onClick={() => selectPreviewMode('assembly')}><Icon name="plan" /><span>Assembly</span></button>
          <button {...controlHelp('Inspect how exact printable parts are grouped and packed onto the configured printer bed.')} type="button" className={previewMode === 'plates' ? 'is-active' : ''} aria-pressed={previewMode === 'plates'} onClick={() => selectPreviewMode('plates')}><Icon name="bed" /><span>Plates</span></button>
        </nav>

        <aside className={`control-panel material-inspector material-inspector--shape${guideWorkspaceOpen ? ' material-inspector--guides' : ''}`} aria-label={guideWorkspaceOpen ? 'Guide controls' : 'Shape controls'} hidden={workflowStep !== 'shape'}>
          <div ref={shapeInspectorHeadingRef} tabIndex={-1} className="panel-heading material-inspector__heading"><span className="step-number">01</span><div><span className="eyebrow">{guideWorkspaceOpen ? 'GUIDE STUDIO' : 'FORM STUDY'}</span><h1>{guideWorkspaceOpen ? 'Mold the composition' : 'Shape the field'}</h1><p>{guideWorkspaceOpen ? 'Select one guide at a time to reshape its path and tune its local effect.' : 'Compose the exact printable geometry while the live object remains in view.'}</p></div></div>

          {isMobileEditorViewport && workflowStep === 'shape' && (
            <MobileWorkflowNavigator
              idPrefix="mobile-shape-workflow"
              location={mobileWorkflowLocation}
              onNavigate={navigateMobileWorkflow}
              headingRef={mobileSubsectionHeadingRef}
            />
          )}

          {!guideWorkspaceOpen && (
            <div
              data-mobile-subsection="source"
              data-mobile-active={mobileWorkflowLocation.subsectionId === 'source' ? 'true' : undefined}
            >
              <PhotoCompositionPanel
                activeAsset={activePhotoAsset}
                activePhoto={activePhoto}
                artAspectRatio={photoArtAspectRatio}
                currentPalette={config.palette.colors}
                currentFamily={config.design.family}
                currentGeometryLabel={`${currentFamily.label} · ${currentShape.label}`}
                onApplyPhoto={applyPhotoComposition}
                onUpdatePhoto={updatePhotoComposition}
                onUseProcedural={useProceduralComposition}
                onRemovePhoto={removePhotoComposition}
              />
            </div>
          )}

          <section
            className="control-section"
            data-mobile-subsection="form"
            data-mobile-active={mobileWorkflowLocation.subsectionId === 'form' ? 'true' : undefined}
          >
            <div className="section-title"><h2>Geometry system</h2><span>{FAMILIES.length} topologies</span></div>
            <div className="pattern-grid">
              {FAMILIES.map((option) => (
                <button {...controlHelp(`${option.label}: ${option.description} Selecting it changes the actual printable topology.`)} key={option.kind} type="button" className={`pattern-card family-card ${config.design.family === option.kind ? 'is-active' : ''}`} onClick={() => selectFamily(option.kind)} aria-pressed={config.design.family === option.kind}>
                  <span className="pattern-glyph">{option.glyph}</span><strong>{option.label}</strong><small>{option.description}</small>
                </button>
              ))}
            </div>
            <p className="field-note">Each system changes the actual layout and printable part geometry—not just its colors.</p>
          </section>

          <section
            className="control-section"
            data-mobile-subsection="form"
            data-mobile-active={mobileWorkflowLocation.subsectionId === 'form' ? 'true' : undefined}
          >
            <div className="section-title"><h2>{config.design.family === 'hex-canopy' ? 'Inside each hexagon' : 'Part surface'}</h2><span>{config.design.family === 'hex-canopy' ? 'printable relief' : `${availableShapes.length} styles`}</span></div>
            <div className={`shape-selector${config.design.family === 'hex-canopy' ? ' shape-selector--hex' : ''}`} role="group" aria-label={config.design.family === 'hex-canopy' ? 'Surface relief inside each hexagon' : 'Printable part surface'}>
              {availableShapes.map((shape) => (
                <button {...controlHelp(`${shape.label}: ${shape.description}. ${config.design.family === 'hex-canopy' ? 'This changes the real printable top surface while the outside outline stays hexagonal.' : 'This changes the cross-section and top surface of each printable part.'}`)} key={shape.kind} type="button" onClick={() => setTile({ shape: shape.kind })} className={config.tile.shape === shape.kind ? 'is-active' : ''} aria-pressed={config.tile.shape === shape.kind}>
                  <span className="shape-glyph">{shape.glyph}</span><strong>{shape.label}</strong><small>{shape.description}</small>
                </button>
              ))}
            </div>
          </section>

          <section
            className="control-section"
            data-mobile-subsection="composition"
            data-mobile-active={mobileWorkflowLocation.subsectionId === 'composition' ? 'true' : undefined}
          >
            <div className="section-title"><h2>Overall flow</h2><span>across all tiles</span></div>
            <div className="pattern-grid pattern-grid--compact">
              {PATTERNS.map((option) => (
                <button {...controlHelp(`${option.label}: ${option.description} This sets the overall height and direction behavior across the whole composition.`)} key={option.kind} type="button" aria-label={option.label} className={`pattern-card pattern-card--compact${option.kind === 'flat' ? ' pattern-card--flat' : ''}${config.pattern.kind === option.kind ? ' is-active' : ''}`} onClick={() => setPattern({ kind: option.kind })} aria-pressed={config.pattern.kind === option.kind}>
                  <span className="pattern-glyph" aria-hidden="true">{option.glyph}</span><strong>{option.label}</strong><small>{option.description}</small>
                </button>
              ))}
            </div>
            {config.pattern.kind === 'flat' && <p className="field-note">Flat removes overall height variation and directional motion. Seeded variation, part form, and Guides still apply.</p>}
          </section>

          <section
            className="control-section"
            data-mobile-subsection="composition"
            data-mobile-active={mobileWorkflowLocation.subsectionId === 'composition' ? 'true' : undefined}
          >
            <div className="section-title"><h2>Artwork outline</h2><span>full wall piece</span></div>
            <div className="segmented-control segmented-control--wrap" role="group" aria-label="Artwork silhouette">
              {SILHOUETTES.map((silhouette) => (
                <button {...controlHelp(`${silhouette.label} controls the outer boundary and negative space of the assembled artwork.`)} type="button" key={silhouette.kind} className={config.design.silhouette === silhouette.kind ? 'is-active' : ''} aria-pressed={config.design.silhouette === silhouette.kind} onClick={() => setDesign({ silhouette: silhouette.kind })}>{silhouette.label}</button>
              ))}
            </div>
          </section>

          <section
            className="control-section"
            data-mobile-subsection="size-layout"
            data-mobile-active={mobileWorkflowLocation.subsectionId === 'size-layout' ? 'true' : undefined}
          >
            <div className="section-title"><h2>Finished size</h2><span>exact export bounds</span></div>
            <div className="field-pair">
              <label {...controlHelp(`Enter a finished width up to ${MAX_FINISHED_DIMENSION_MM.toLocaleString()} millimetres. The exported XY geometry is scaled to this exact bound; relief height is unchanged.`)}><span>Width</span><div className="number-input"><input id="finished-width" aria-label="Exact finished artwork width in millimetres" aria-description={`Enter a finished width from ${MIN_FINISHED_DIMENSION_MM} through ${MAX_FINISHED_DIMENSION_MM.toLocaleString()} millimetres. Exported geometry is scaled to this exact X bound.`} type="number" min={MIN_FINISHED_DIMENSION_MM} max={MAX_FINISHED_DIMENSION_MM} step="any" value={sizeDraft.width} onChange={(event) => setTargetDimension('width', event.target.value)} onBlur={() => restoreValidDimension('width')}/><em>mm</em></div></label>
              <label {...controlHelp(`Enter a finished height up to ${MAX_FINISHED_DIMENSION_MM.toLocaleString()} millimetres. The exported XY geometry is scaled to this exact bound; relief height is unchanged.`)}><span>Height</span><div className="number-input"><input id="finished-height" aria-label="Exact finished artwork height in millimetres" aria-description={`Enter a finished height from ${MIN_FINISHED_DIMENSION_MM} through ${MAX_FINISHED_DIMENSION_MM.toLocaleString()} millimetres. Exported geometry is scaled to this exact Y bound.`} type="number" min={MIN_FINISHED_DIMENSION_MM} max={MAX_FINISHED_DIMENSION_MM} step="any" value={sizeDraft.height} onChange={(event) => setTargetDimension('height', event.target.value)} onBlur={() => restoreValidDimension('height')}/><em>mm</em></div></label>
            </div>
            <label {...controlHelp('When enabled, changing width also changes height—and vice versa—to preserve the current aspect ratio. Turn it off for independent dimensions.')} className="toggle-row toggle-row--compact"><span><b>Lock aspect ratio</b><small>Scale both dimensions together</small></span><input aria-label="Lock finished size aspect ratio" aria-description="Preserves the current width-to-height ratio when either finished dimension changes." type="checkbox" checked={config.finishedSize.lockAspect} onChange={(event) => setFinishedSize({ lockAspect: event.target.checked })}/><i /></label>
            <button {...controlHelp('Remove the custom finished-size transform and return to this geometry system’s natural generated bounds.')} className="text-button size-reset" type="button" onClick={resetFinishedSize}>Use natural generated size</button>
            <div className="field-pair field-pair--compact">
              <label {...controlHelp('Set the number of generated parts or cells across the composition. Finished width remains exact when a custom size is active.')}><span>Across</span><div className="number-input"><input aria-label="Parts across" aria-description="Controls horizontal design density while custom finished width stays fixed." type="number" min="1" max={MAX_GRID_COLUMNS} value={config.grid.columns} onChange={(event) => { const value = event.currentTarget.valueAsNumber; if (Number.isFinite(value)) setGrid({ columns: clamp(value, 1, MAX_GRID_COLUMNS) }) }}/><em>pcs</em></div></label>
              <label {...controlHelp('Set the number of generated parts or cells down the composition. Finished height remains exact when a custom size is active.')}><span>Down</span><div className="number-input"><input aria-label="Parts down" aria-description="Controls vertical design density while custom finished height stays fixed." type="number" min="1" max={MAX_GRID_ROWS} value={config.grid.rows} onChange={(event) => { const value = event.currentTarget.valueAsNumber; if (Number.isFinite(value)) setGrid({ rows: clamp(value, 1, MAX_GRID_ROWS) }) }}/><em>pcs</em></div></label>
            </div>
          </section>

          <section
            className="control-section"
            data-mobile-subsection="size-layout"
            data-mobile-active={mobileWorkflowLocation.subsectionId === 'size-layout' ? 'true' : undefined}
          >
            <div className="section-title"><h2>Geometry</h2></div>
            <label {...controlHelp('Controls the physical XY size of each printable part or relief panel. The current finished artwork bounds stay fixed while smaller parts create more cells and larger parts create fewer cells.')} className="slider-field"><span><b>{config.design.family === 'contour-relief' ? 'Panel size' : config.design.family === 'hex-canopy' ? 'Hex size' : 'Part size'}</b><output>{config.grid.tileSizeMm.toFixed(0)} mm</output></span><input aria-label={config.design.family === 'hex-canopy' ? 'Hexagon size' : 'Part size'} aria-description="Controls physical part size; current finished artwork bounds stay fixed while grid density adjusts." type="range" min="16" max={config.design.family === 'contour-relief' || config.design.family === 'hex-canopy' ? 240 : 90} step="1" value={config.grid.tileSizeMm} onChange={(event) => setPartSize(Number(event.target.value))}/></label>
            <label {...controlHelp('Sets the intended empty spacing between neighbouring parts in the natural layout.')} className="slider-field"><span><b>Part gap</b><output>{config.grid.gapMm.toFixed(1)} mm</output></span><input aria-label="Artwork part gap" aria-description="Controls natural empty spacing between neighbouring assembled parts." type="range" min="0.6" max="8" step="0.2" value={config.grid.gapMm} onChange={(event) => setGrid({ gapMm: Number(event.target.value) })}/></label>
            {config.pattern.kind !== 'flat' && <label {...controlHelp('Changes how many waves, rings, or field features cross the composition. Higher values create tighter repetition.')} className="slider-field"><span><b>Field frequency</b><output>{config.pattern.frequency.toFixed(2)}</output></span><input aria-label="Composition field frequency" aria-description="Higher values create more tightly repeated field features." type="range" min="0.2" max="3.5" step="0.05" value={config.pattern.frequency} onChange={(event) => setPattern({ frequency: Number(event.target.value) })}/></label>}
            <label {...controlHelp('Adds deterministic irregularity to positions, scales, or heights. Zero is orderly; 100 percent is the strongest supported variation.')} className="slider-field"><span><b>Seeded variation</b><output>{Math.round(config.design.variation * 100)}%</output></span><input aria-label="Seeded geometric variation" aria-description="Controls deterministic geometric irregularity from zero to full strength." type="range" min="0" max="1" step="0.02" value={config.design.variation} onChange={(event) => setDesign({ variation: Number(event.target.value) })}/></label>
            {config.design.family === 'polar-bloom' && <label {...controlHelp('Sets the number of repeated sectors around the radial centre.')} className="slider-field"><span><b>Radial symmetry</b><output>{config.design.symmetry}</output></span><input aria-label="Radial symmetry sectors" aria-description="Controls how many sectors repeat around the centre." type="range" min="3" max="16" step="1" value={config.design.symmetry} onChange={(event) => setDesign({ symmetry: Number(event.target.value) })}/></label>}
            {config.design.family === 'contour-relief' && <label {...controlHelp('Sets surface sampling density per panel. More samples improve detail but create larger meshes and slower exports.')} className="slider-field"><span><b>Surface detail</b><output>{config.design.surfaceResolution} × {config.design.surfaceResolution}</output></span><input aria-label="Relief surface sampling detail" aria-description="Higher sampling increases surface detail, mesh size, and export time." type="range" min="5" max="24" step="1" value={config.design.surfaceResolution} onChange={(event) => setDesign({ surfaceResolution: Number(event.target.value) })}/></label>}
            {config.pattern.kind === 'vortex' && <label {...controlHelp('Sets how many spiral arms rotate around the vortex centre.')} className="slider-field"><span><b>Spiral arms</b><output>{config.pattern.arms}</output></span><input aria-label="Number of spiral arms" aria-description="Controls how many arms form the vortex composition." type="range" min="1" max="8" step="1" value={config.pattern.arms} onChange={(event) => setPattern({ arms: Number(event.target.value) })}/></label>}
            {(config.pattern.kind === 'interference' || config.pattern.kind === 'liquid' || config.pattern.kind === 'fracture') && <label {...controlHelp(config.pattern.kind === 'fracture' ? 'Sets the number of main crack arms before deterministic branches are added.' : config.pattern.kind === 'liquid' ? 'Sets the target number of stepped liquid bands; the result stays aligned to 0.2 mm layer increments.' : 'Changes the angular separation of the two interfering wave systems and therefore the scale of their beat structure.')} className="slider-field"><span><b>{config.pattern.kind === 'fracture' ? 'Fracture arms' : config.pattern.kind === 'liquid' ? 'Terrace bands' : 'Beat structure'}</b><output>{config.pattern.arms}</output></span><input aria-label="Pattern structure count" aria-description="Adjusts the repeated structure used by this composition field." type="range" min="3" max="12" step="1" value={config.pattern.arms} onChange={(event) => setPattern({ arms: Number(event.target.value) })}/></label>}
            {(config.pattern.kind === 'dunes' || config.pattern.kind === 'noise') && <label {...controlHelp('Controls the scale of seeded organic features. Lower values are broad and calm; higher values are smaller and busier.')} className="slider-field"><span><b>Noise field scale</b><output>{config.pattern.noiseScale.toFixed(1)}</output></span><input aria-label="Noise field scale" aria-description="Controls whether organic features are broad or tightly detailed." type="range" min="0.5" max="5" step="0.1" value={config.pattern.noiseScale} onChange={(event) => setPattern({ noiseScale: Number(event.target.value) })}/></label>}
            {config.tile.shape === 'twisted-prism' && <label {...controlHelp('Rotates the top face relative to the base, creating more or less torsion in each block.')} className="slider-field"><span><b>Cap twist</b><output>{config.tile.twistDeg.toFixed(0)}°</output></span><input aria-label="Twisted prism cap angle" aria-description="Rotates each prism’s top face relative to its base." type="range" min="0" max="65" step="1" value={config.tile.twistDeg} onChange={(event) => setTile({ twistDeg: Number(event.target.value) })}/></label>}
          </section>

          <div
            data-mobile-subsection="depth-profile"
            data-mobile-active={mobileWorkflowLocation.subsectionId === 'depth-profile' ? 'true' : undefined}
            data-mobile-depth-mount="depth-profile"
            hidden={guideWorkspaceOpen}
          >
            <DepthControls
              tile={config.tile}
              profile={config.depthProfile}
              clippedPartCount={depthLimitPartCount}
              selectedPartHeightMm={selectedTile?.heightMm}
              estimatedVolumeCm3={solidVolumeCm3}
              onTileChange={setTile}
              onProfileChange={setDepthProfile}
            />
          </div>

          <div
            data-mobile-subsection="local-depth"
            data-mobile-active={mobileWorkflowLocation.subsectionId === 'local-depth' ? 'true' : undefined}
            data-mobile-depth-mount="local-depth"
            hidden={guideWorkspaceOpen}
          >
            <RegionalDepthEditor
              masks={config.localDepth.masks}
              artAspectRatio={photoArtAspectRatio}
              onChange={setRegionalDepthMasks}
            />
            <DepthPaintEditor
              asset={activeDepthPaintAsset}
              artAspectRatio={photoArtAspectRatio}
              enabled={activeDepthPaint?.enabled ?? false}
              busy={depthPaintBusy || depthPaintRestoreState === 'loading'}
              missingAsset={Boolean(activeDepthPaint && !activeDepthPaintAsset && depthPaintRestoreState === 'missing')}
              restoringAsset={Boolean(activeDepthPaint && !activeDepthPaintAsset && depthPaintRestoreState === 'loading')}
              onEnabledChange={setDepthPaintEnabled}
              onCommit={commitDepthPaintAsset}
              onRemove={removeDepthPaint}
            />
          </div>

          <div
            className="mobile-subsection-shell"
            data-mobile-subsection="guides"
            data-mobile-active={mobileWorkflowLocation.subsectionId === 'guides' ? 'true' : undefined}
          >
            <GuideEditor
              guides={config.guides}
              selectedGuideId={selectedGuideId}
              mode={guideMode}
              artWidthMm={project?.widthMm ?? 1}
              artDepthMm={project?.depthMm ?? 1}
              centerPullSupported={config.design.family === 'triangular-current'}
              onModeChange={changeGuideMode}
              onSelectGuide={setSelectedGuideId}
              onAddPreset={addGuidePreset}
              onUpdateSelectedEffects={updateSelectedGuideEffects}
              onRenameSelected={renameSelectedGuide}
              onReverseSelected={reverseSelectedGuide}
              onDeleteSelected={deleteSelectedGuide}
              onResetSelectedEffects={resetSelectedGuideEffects}
              onDeleteNewest={deleteNewestGuide}
              onClearAll={clearGuides}
              onUpdateDefaults={(patch) => setGuides(patch)}
            />
          </div>

          <section
            className="control-section"
            data-mobile-subsection="composition"
            data-mobile-active={mobileWorkflowLocation.subsectionId === 'composition' ? 'true' : undefined}
          >
            <div className="section-title"><h2>Seed</h2><button {...controlHelp('Generate a different repeatable variation without changing the design controls.')} type="button" className="text-button" onClick={randomizeSeed}>Randomize</button></div>
            <input {...controlHelp('Enter any word or number. Reusing the same seed with the same settings regenerates identical geometry.')} className="text-input" value={String(config.seed)} onChange={(event) => commit({ ...config, seed: event.target.value })} aria-label="Deterministic pattern seed" />
            <p className="field-note">The same seed and settings always regenerate the same parts.</p>
          </section>
          {isMobileEditorViewport && workflowStep === 'shape' && (
            <MobileWorkflowFooter
              location={mobileWorkflowLocation}
              onNavigate={navigateMobileWorkflow}
            />
          )}
          <div className="material-inspector__footer material-inspector__footer--desktop">
            <span>Shape is set</span>
            <button type="button" onClick={() => selectWorkflowStep('color', true)}>Continue to color <span aria-hidden="true">→</span></button>
          </div>
        </aside>

        <section
          className="preview-panel"
          aria-label="Design preview"
          data-mobile-preview-state={mobilePreviewState}
        >
          <div className="preview-topline">
            <div className="canvas-context">
              <span className="eyebrow">{previewMode === 'model' ? 'LIVE OBJECT' : previewMode === 'assembly' ? 'ASSEMBLY DRAWING' : 'PLATE LAYOUT'}</span>
              <strong>{currentFamily.label} · {currentShape.label}</strong>
              <small>{project?.id ?? 'INVALID'}</small>
            </div>
            <div className="dimension-readout"><span>{project ? `${formatDimensionReadout(project.widthMm)} × ${formatDimensionReadout(project.depthMm)} mm` : 'SIZE UNAVAILABLE'}</span><i />{project?.tiles.length ?? 0} PARTS</div>
            {isMobileEditorViewport && (
              <MobilePreviewSizeControl
                state={mobilePreviewState}
                onStateChange={setMobilePreviewState}
              />
            )}
          </div>

          <div className={`preview-stage preview-stage--${previewMode}`}>
            {previewMode === 'model' && <WallArtViewer
              project={project}
              backgroundColor="#f1e6d7"
              initialView={guideWorkspaceOpen ? 'top' : 'isometric'}
              guideLines={config.guides.lines}
              guideMode={guideWorkspaceOpen ? guideMode : 'select'}
              selectedGuideId={guideWorkspaceOpen ? selectedGuideId : undefined}
              onGuideDrawn={handleGuideDrawn}
              onGuideSelected={setSelectedGuideId}
              onGuideControlPointsChanged={updateGuideControlPoints}
            />}
            {previewMode === 'assembly' && <AssemblyPreview project={project} selectedTileId={selectedTileId} onSelectTile={setSelectedTileId} showLabels showOrientation showRulers />}
            {previewMode === 'plates' && <PlatePreview packing={packing} selectedPlateIndex={selectedPlateIndex} onSelectedPlateIndexChange={setSelectedPlateIndex} selectedTileId={selectedTileId} onSelectTile={setSelectedTileId} showLabels />}
            {result.error && <div className="error-state"><strong>That combination cannot be built.</strong><p>{result.error}</p></div>}
          </div>

          <div className="preview-caption">
            <div><span className="status-dot" /><strong>LIVE GEOMETRY</strong><span>{guideDrawingEnabled ? 'DRAW MODE · drag across the top view to add a guide' : guideWorkspaceOpen && guideMode === 'edit' ? 'EDIT MODE · drag handles or click the selected line to add one' : 'Drag to orbit · wheel to zoom · all dimensions in millimetres'}</span></div>
            <div>{geometryReady ? <><Icon name="check" />All solids manifold</> : 'Geometry needs attention'}</div>
          </div>
        </section>

        <aside className="build-panel material-inspector material-inspector--prepare" aria-label={`${workflowStep} controls`} hidden={workflowStep === 'shape'}>
          <div ref={prepareInspectorHeadingRef} tabIndex={-1} className="panel-heading material-inspector__heading">
            <span className="step-number">{WORKFLOW_STEPS.find((step) => step.id === workflowStep)?.number}</span>
            <div><span className="eyebrow">{workflowHeading?.eyebrow}</span><h2>{workflowHeading?.title}</h2><p>{workflowHeading?.description}</p></div>
          </div>

          {isMobileEditorViewport && workflowStep !== 'shape' && (
            <MobileWorkflowNavigator
              idPrefix="mobile-prepare-workflow"
              location={mobileWorkflowLocation}
              onNavigate={navigateMobileWorkflow}
              headingRef={mobileSubsectionHeadingRef}
            />
          )}

          <section
            className="control-section control-section--right"
            hidden={workflowStep !== 'color'}
            data-mobile-subsection="palette"
            data-mobile-active={mobileWorkflowLocation.subsectionId === 'palette' ? 'true' : undefined}
          >
            <div className="section-title"><h2>Palette</h2><span>{config.palette.colors.length} filaments</span></div>
            <select {...controlHelp('Choose a starting color collection. Every swatch remains editable, so selecting a preset never locks the palette.')} className="select-input" aria-label="Palette preset" value={PALETTES.find((palette) => palette.colors.join() === config.palette.colors.join())?.name ?? ''} onChange={(event) => { const preset = PALETTES.find((item) => item.name === event.target.value); if (preset) setPalette({ colors: preset.colors }) }}>
              <option value="">Custom palette</option>{PALETTES.map((palette) => <option key={palette.name}>{palette.name}</option>)}
            </select>
            <div className="palette-strip" aria-label="Current palette">{config.palette.colors.map((color, index) => <span key={`${color}-${index}`} style={{ background: color }} />)}</div>
            <div className="color-list">
              {config.palette.colors.map((color, index) => (
                <div className="color-row" key={index}>
                  <label {...controlHelp(`Open the visual color picker for filament color ${index + 1}.`)} style={{ background: color }}><input type="color" value={color} onChange={(event) => updateColor(index, event.target.value)} aria-label={`Choose filament color ${index + 1}`} aria-description="Opens the visual color picker; the exact HEX value can also be typed beside it." /></label>
                  <span><b>COLOR {String(index + 1).padStart(2, '0')}</b><small>{project?.tiles.filter((tile) => tile.colorIndex === index).length ?? 0} parts</small></span>
                  <input
                    {...controlHelp(`Type an exact HEX color for filament ${index + 1}. Both #RGB and #RRGGBB formats are accepted.`)}
                    className="hex-color-input"
                    aria-label={`HEX code for filament color ${index + 1}`}
                    aria-invalid={!normalizeHex(hexDrafts[index] ?? '')}
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={7}
                    value={hexDrafts[index] ?? color.toUpperCase()}
                    onChange={(event) => updateHexDraft(index, event.target.value)}
                    onBlur={() => commitHexDraft(index)}
                    onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
                  />
                  <button {...controlHelp(`Remove filament color ${index + 1}. At least two colors are kept so mappings remain meaningful.`)} type="button" onClick={() => removeColor(index)} disabled={config.palette.colors.length <= 2} aria-label={`Remove color ${index + 1}`}>×</button>
                </div>
              ))}
            </div>
            <button {...controlHelp(`Add another independently editable filament color. Up to ${paletteLimit} colors can be used in this composition.`)} className="add-color" type="button" onClick={addColor} disabled={config.palette.colors.length >= paletteLimit}>+ Add filament color</button>
          </section>

          <section
            className="control-section control-section--right"
            hidden={workflowStep !== 'color'}
            data-mobile-subsection="mapping-review"
            data-mobile-active={mobileWorkflowLocation.subsectionId === 'mapping-review' ? 'true' : undefined}
          >
            <div className="section-title"><h2>Mapping &amp; review</h2><span>part color assignment</span></div>
            <label {...controlHelp('Choose how parts are assigned to palette colors: by height, radius, row, grid position, or deterministic scatter.')} className="select-field"><span>Color mapping</span><select aria-label="Artwork color mapping method" aria-description="Controls how generated parts are assigned to the palette colors." value={config.palette.mode} onChange={(event) => setPalette({ mode: event.target.value as ColorAssignmentMode })}>{COLOR_MODES.map((mode) => <option value={mode.mode} key={mode.mode}>{mode.label}</option>)}</select></label>
          </section>

          <section
            className="control-section control-section--right"
            hidden={workflowStep !== 'build'}
            data-mobile-subsection="printer-bed"
            data-mobile-active={mobileWorkflowLocation.subsectionId === 'printer-bed' ? 'true' : undefined}
          >
            <div className="section-title"><h2>Printer bed</h2><span>usable area aware</span></div>
            <div className="field-pair field-pair--compact">
              <label {...controlHelp('Enter the printable X width of your actual printer bed. This controls automatic plate packing.')}><span>Width</span><div className="number-input"><input id={PRINTER_INPUT_IDS.bedWidthMm} aria-label="Printer bed width in millimetres" aria-description="Used to pack every part inside the printer’s usable X area." type="number" min={MIN_PRINTER_BED_DIMENSION_MM} max={MAX_PRINTER_BED_DIMENSION_MM} value={printerDraft.bedWidthMm} onChange={(event) => setPrinterDraftValue('bedWidthMm', event.target.value)} onBlur={() => restorePrinterDraft('bedWidthMm')}/><em>mm</em></div></label>
              <label {...controlHelp('Enter the printable Y depth of your actual printer bed. This controls automatic plate packing.')}><span>Depth</span><div className="number-input"><input id={PRINTER_INPUT_IDS.bedDepthMm} aria-label="Printer bed depth in millimetres" aria-description="Used to pack every part inside the printer’s usable Y area." type="number" min={MIN_PRINTER_BED_DIMENSION_MM} max={MAX_PRINTER_BED_DIMENSION_MM} value={printerDraft.bedDepthMm} onChange={(event) => setPrinterDraftValue('bedDepthMm', event.target.value)} onBlur={() => restorePrinterDraft('bedDepthMm')}/><em>mm</em></div></label>
            </div>
            <div className="field-pair field-pair--compact">
              <label {...controlHelp('Reserves an unused safety border around every packed plate. Match any exclusion zone in your slicer profile.')}><span>Edge margin</span><div className="number-input"><input id={PRINTER_INPUT_IDS.marginMm} aria-label="Printer plate edge margin" aria-description="Leaves this safety border unused around every packed plate." type="number" min={MIN_PRINTER_MARGIN_MM} max={MAX_PRINTER_MARGIN_MM} step="0.5" value={printerDraft.marginMm} onChange={(event) => setPrinterDraftValue('marginMm', event.target.value)} onBlur={() => restorePrinterDraft('marginMm')}/><em>mm</em></div></label>
              <label {...controlHelp('Sets the minimum XY clearance between separate parts on a print plate.')}><span>Part spacing</span><div className="number-input"><input id={PRINTER_INPUT_IDS.spacingMm} aria-label="Minimum spacing between packed parts" aria-description="Maintains this XY clearance between separate parts on a plate." type="number" min={MIN_PRINTER_SPACING_MM} max={MAX_PRINTER_SPACING_MM} step="0.5" value={printerDraft.spacingMm} onChange={(event) => setPrinterDraftValue('spacingMm', event.target.value)} onBlur={() => restorePrinterDraft('spacingMm')}/><em>mm</em></div></label>
            </div>
            <label {...controlHelp('When enabled, packing never mixes different filament colors on one plate, making single-color printing and file identification easier.')} className="toggle-row"><span><b>Separate colors</b><small>Start each filament on a clean plate</small></span><input aria-label="Pack each filament color onto separate plates" aria-description="Prevents different palette colors from sharing a print plate." type="checkbox" checked={config.printer.separateColors} onChange={(event) => setPrinter({ separateColors: event.target.checked })}/><i /></label>
          </section>

          <section
            className="build-summary"
            hidden={workflowStep !== 'build'}
            data-mobile-subsection="geometry-plates"
            data-mobile-active={mobileWorkflowLocation.subsectionId === 'geometry-plates' ? 'true' : undefined}
          >
            <div className="section-title"><h2>Digital geometry</h2><span className={geometryReady ? 'pass-label' : 'fail-label'}>{geometryReady ? 'MESH PASS' : 'CHECK'}</span></div>
            <dl>
              <div><dt>Closed manifold parts</dt><dd>{project?.diagnostics.closedTileCount ?? 0} / {project?.diagnostics.tileCount ?? 0}</dd></div>
              <div><dt>Finished field</dt><dd>{project ? `${formatDimensionReadout(project.widthMm)} × ${formatDimensionReadout(project.depthMm)} mm` : 'Unavailable'}</dd></div>
              <div><dt>Relief height</dt><dd>{maxHeight.toFixed(1)} mm max</dd></div>
              <div><dt>Print plates</dt><dd>{packing?.plates.length ?? 0}</dd></div>
              <div><dt>Solid mesh volume</dt><dd>{solidVolumeCm3.toFixed(1)} cm³</dd></div>
            </dl>
            {selectedTile && <div className="selected-part"><span style={{ background: selectedTile.color }} /><div><small>SELECTED PART</small><strong>{selectedTile.id}</strong><em>Row {selectedTile.row + 1} · Column {selectedTile.column + 1} · {selectedTile.heightMm.toFixed(1)} mm</em></div></div>}
            <p className="warning-note">Bed fit and mesh closure are computed here. Slice the exported plate with your real printer profile before printing; physical fit and finish are not certified by this badge.</p>
            {project && project.tiles.length > 500 && <p className="warning-note">Large project: exports may take a few seconds and create many individual files.</p>}
          </section>

          <section
            className="control-section control-section--right"
            hidden={workflowStep !== 'export'}
            data-mobile-subsection="preflight"
            data-mobile-active={mobileWorkflowLocation.subsectionId === 'preflight' ? 'true' : undefined}
          >
            <div className="section-title"><h2>Preflight</h2><span>{project?.id ?? 'no project'}</span></div>
            <p className="warning-note" {...controlHelp('Bambu Studio treats portable 3MF color as requested color intent, then asks you to map it to a physically loaded spool. Import a color-labelled plate as a model, keep its color data, and decline auto-arrange so the validated packing stays unchanged.')}>
              Bambu Studio: import a file from <strong>3mf/plates</strong> as a model, keep color data, map the shown HEX color to your loaded filament, and decline auto-arrange.
            </p>
            <p className="privacy-note"><i />Design geometry and generated files stay in this browser. This challenge build has no analytics, feedback collection, or remote project storage.</p>
          </section>

          <section
            className="export-section"
            hidden={workflowStep !== 'export'}
            data-mobile-subsection="build-save"
            data-mobile-active={mobileWorkflowLocation.subsectionId === 'build-save' ? 'true' : undefined}
          >
            <div className="section-title"><h2>Build &amp; save files</h2><span>{project?.id ?? 'no project'}</span></div>
            <button {...controlHelp(requiresFabricationPackage ? 'Projects with retained photo or depth-paint bytes need the fabrication package so every canonical field and the recipe stay together.' : 'Build a portable JSON recipe for this exact design and print packing. A separate Save file link appears after it is prepared.')} className="project-recipe-action" type="button" onClick={saveProject} disabled={!exportGeometryReady || requiresFabricationPackage}><span><Icon name="save" /></span><div><strong>{requiresFabricationPackage ? 'Complete recipe is in the package' : 'Build project recipe'}</strong><small>{requiresFabricationPackage ? 'Canonical fields + controls stay portable together' : 'Editable JSON · exact current settings'}</small></div><em>{requiresFabricationPackage ? 'ZIP' : 'JSON'}</em></button>
            <button {...controlHelp('Build the complete local fabrication ZIP for the exact current project. When building finishes, use the separate Save file link so the browser cannot silently block the download.')} className="export-primary" type="button" disabled={!exportGeometryReady || !packing || exportState !== 'idle'} onClick={() => runExport('package')}><span><Icon name="download" /></span><div><strong>{exportState === 'package' ? 'Building package…' : 'Build fabrication package'}</strong><small>Exact current project · 3MF · STL · PDF · manifest</small></div><em>BUILD</em></button>
            {preparedDownload && !depthPaintBusy && preparedDownload.projectId === project?.id && (
              <a
                {...controlHelp(`Save ${preparedDownload.filename}. This direct user click avoids browsers silently blocking a generated file after a long build.`)}
                className="prepared-download"
                href={preparedDownload.url}
                download={preparedDownload.filename}
                onClick={() => setNotice(`Saving ${preparedDownload.filename}. Find this exact filename in your browser's configured download location.`)}
              >
                <span><Icon name="save" /></span>
                <div><strong>Save file now</strong><small>{preparedDownload.filename}</small><small>{preparedDownload.summary}</small></div>
                <em>{preparedDownload.label}</em>
              </a>
            )}
            <div className="export-secondary">
              <button {...controlHelp('Build a single-page vector assembly map at true physical scale for a roll or large-format printer. Then use Save file now.')} type="button" disabled={!exportGeometryReady || exportState !== 'idle'} onClick={() => runExport('master')}><strong>Build 1:1 master PDF</strong><small>Vector roll-print layout</small></button>
              <button {...controlHelp('Build a home-printer assembly packet split across US Letter pages with 10 mm overlaps and registration marks. Then use Save file now.')} type="button" disabled={!exportGeometryReady || exportState !== 'idle'} onClick={() => runExport('tiled')}><strong>Build Letter tiled PDF</strong><small>10 mm overlap + marks</small></button>
            </div>
          </section>
          {isMobileEditorViewport && workflowStep !== 'shape' && (
            <MobileWorkflowFooter
              location={mobileWorkflowLocation}
              onNavigate={navigateMobileWorkflow}
            />
          )}
          <div className="material-inspector__footer material-inspector__footer--desktop">
            <button className="material-inspector__back" type="button" onClick={() => selectWorkflowStep(workflowStep === 'color' ? 'shape' : workflowStep === 'build' ? 'color' : 'build', true)}><span aria-hidden="true">←</span> Back</button>
            {workflowStep !== 'export' && <button type="button" onClick={() => selectWorkflowStep(workflowStep === 'color' ? 'build' : 'export', true)}>Continue to {workflowStep === 'color' ? 'build' : 'export'} <span aria-hidden="true">→</span></button>}
          </div>
        </aside>
      </main>
      {notice && <div className="notice material-notice" role="status"><span>{notice}</span><button type="button" aria-label="Dismiss status message" onClick={() => setNotice(undefined)}>×</button></div>}
      <StartOverDialog
        busy={startOverBusy}
        error={startOverError}
        open={startOverOpen}
        onCancel={() => {
          if (startOverBusy) return
          setStartOverError(undefined)
          setStartOverOpen(false)
        }}
        onConfirm={() => { void startOver() }}
      />
      {helpTooltip && (
        <div
          id="control-help-tooltip"
          className={`control-help-tooltip${helpTooltip.above ? ' control-help-tooltip--above' : ''}`}
          role="tooltip"
          style={{ left: helpTooltip.left, top: helpTooltip.top }}
        >
          {helpTooltip.text}
        </div>
      )}
    </div>
  )
}

export default App
