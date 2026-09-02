export type MobileWorkflowSectionId = 'shape' | 'color' | 'build' | 'export'

export type MobileWorkflowSubsectionId =
  | 'source'
  | 'form'
  | 'composition'
  | 'size-layout'
  | 'depth-profile'
  | 'local-depth'
  | 'guides'
  | 'palette'
  | 'mapping-review'
  | 'printer-bed'
  | 'geometry-plates'
  | 'preflight'
  | 'build-save'

export type ShapeMobileWorkflowSubsectionId =
  | 'source'
  | 'form'
  | 'composition'
  | 'size-layout'
  | 'depth-profile'
  | 'local-depth'
  | 'guides'

export type ColorMobileWorkflowSubsectionId = 'palette' | 'mapping-review'
export type BuildMobileWorkflowSubsectionId = 'printer-bed' | 'geometry-plates'
export type ExportMobileWorkflowSubsectionId = 'preflight' | 'build-save'

export interface MobileWorkflowSubsection {
  readonly id: MobileWorkflowSubsectionId
  readonly label: string
}

export interface MobileWorkflowSection {
  readonly id: MobileWorkflowSectionId
  readonly label: string
  readonly subsections: readonly MobileWorkflowSubsection[]
}

export type MobileWorkflowLocation =
  | Readonly<{
      sectionId: 'shape'
      subsectionId: ShapeMobileWorkflowSubsectionId
    }>
  | Readonly<{
      sectionId: 'color'
      subsectionId: ColorMobileWorkflowSubsectionId
    }>
  | Readonly<{
      sectionId: 'build'
      subsectionId: BuildMobileWorkflowSubsectionId
    }>
  | Readonly<{
      sectionId: 'export'
      subsectionId: ExportMobileWorkflowSubsectionId
    }>

export interface MobileWorkflowProgress {
  readonly section: MobileWorkflowSection
  readonly subsection: MobileWorkflowSubsection
  readonly sectionIndex: number
  readonly sectionTotal: number
  readonly subsectionIndex: number
  readonly subsectionTotal: number
  readonly overallIndex: number
  readonly overallTotal: number
  readonly previous: MobileWorkflowLocation | undefined
  readonly next: MobileWorkflowLocation | undefined
}

export const MOBILE_WORKFLOW_SECTIONS = [
  {
    id: 'shape',
    label: 'Shape',
    subsections: [
      { id: 'source', label: 'Source' },
      { id: 'form', label: 'Form' },
      { id: 'composition', label: 'Composition' },
      { id: 'size-layout', label: 'Size & Layout' },
      { id: 'depth-profile', label: 'Depth Profile' },
      { id: 'local-depth', label: 'Local Depth' },
      { id: 'guides', label: 'Guides' },
    ],
  },
  {
    id: 'color',
    label: 'Color',
    subsections: [
      { id: 'palette', label: 'Palette' },
      { id: 'mapping-review', label: 'Mapping & Review' },
    ],
  },
  {
    id: 'build',
    label: 'Build',
    subsections: [
      { id: 'printer-bed', label: 'Printer Bed' },
      { id: 'geometry-plates', label: 'Geometry & Plates' },
    ],
  },
  {
    id: 'export',
    label: 'Export',
    subsections: [
      { id: 'preflight', label: 'Preflight' },
      { id: 'build-save', label: 'Build & Save Files' },
    ],
  },
] as const satisfies readonly MobileWorkflowSection[]

const FLAT_MOBILE_WORKFLOW = MOBILE_WORKFLOW_SECTIONS.flatMap((section) =>
  section.subsections.map((subsection) => ({
    section,
    subsection,
    location: {
      sectionId: section.id,
      subsectionId: subsection.id,
    } as MobileWorkflowLocation,
  })),
)

function findWorkflowEntry(location: MobileWorkflowLocation) {
  const entry = FLAT_MOBILE_WORKFLOW.find(
    (candidate) =>
      candidate.location.sectionId === location.sectionId &&
      candidate.location.subsectionId === location.subsectionId,
  )

  if (!entry) {
    throw new Error(
      `Subsection "${location.subsectionId}" does not belong to section "${location.sectionId}".`,
    )
  }

  return entry
}

export function getMobileWorkflowEntry(
  sectionId: MobileWorkflowSectionId,
): MobileWorkflowLocation {
  const section = MOBILE_WORKFLOW_SECTIONS.find((candidate) => candidate.id === sectionId)

  if (!section) {
    throw new Error(`Unknown mobile workflow section "${sectionId}".`)
  }

  return {
    sectionId: section.id,
    subsectionId: section.subsections[0].id,
  } as MobileWorkflowLocation
}

export function getMobileWorkflowLocation(
  subsectionId: MobileWorkflowSubsectionId,
): MobileWorkflowLocation {
  const entry = FLAT_MOBILE_WORKFLOW.find(
    (candidate) => candidate.subsection.id === subsectionId,
  )

  if (!entry) {
    throw new Error(`Unknown mobile workflow subsection "${subsectionId}".`)
  }

  return entry.location
}

export function getMobileWorkflowProgress(
  location: MobileWorkflowLocation,
): MobileWorkflowProgress {
  const entry = findWorkflowEntry(location)
  const overallOffset = FLAT_MOBILE_WORKFLOW.indexOf(entry)
  const sectionOffset = MOBILE_WORKFLOW_SECTIONS.indexOf(entry.section)
  const subsections: readonly MobileWorkflowSubsection[] = entry.section.subsections
  const subsectionOffset = subsections.findIndex(
    (subsection) => subsection.id === entry.subsection.id,
  )

  return {
    section: entry.section,
    subsection: entry.subsection,
    sectionIndex: sectionOffset + 1,
    sectionTotal: MOBILE_WORKFLOW_SECTIONS.length,
    subsectionIndex: subsectionOffset + 1,
    subsectionTotal: entry.section.subsections.length,
    overallIndex: overallOffset + 1,
    overallTotal: FLAT_MOBILE_WORKFLOW.length,
    previous: FLAT_MOBILE_WORKFLOW[overallOffset - 1]?.location,
    next: FLAT_MOBILE_WORKFLOW[overallOffset + 1]?.location,
  }
}

export function getPreviousMobileWorkflowLocation(
  location: MobileWorkflowLocation,
): MobileWorkflowLocation | undefined {
  return getMobileWorkflowProgress(location).previous
}

export function getNextMobileWorkflowLocation(
  location: MobileWorkflowLocation,
): MobileWorkflowLocation | undefined {
  return getMobileWorkflowProgress(location).next
}

export function isMobileWorkflowLocation(value: unknown): value is MobileWorkflowLocation {
  if (!value || typeof value !== 'object') return false

  const candidate = value as {
    sectionId?: unknown
    subsectionId?: unknown
  }
  return FLAT_MOBILE_WORKFLOW.some(
    (entry) =>
      entry.location.sectionId === candidate.sectionId &&
      entry.location.subsectionId === candidate.subsectionId,
  )
}

export const MOBILE_PREVIEW_STATES = ['collapsed', 'compact', 'expanded'] as const

export type MobilePreviewState = (typeof MOBILE_PREVIEW_STATES)[number]

export const DEFAULT_MOBILE_PREVIEW_STATE: MobilePreviewState = 'compact'

export function getNextMobilePreviewState(state: MobilePreviewState): MobilePreviewState {
  const offset = MOBILE_PREVIEW_STATES.indexOf(state)
  return MOBILE_PREVIEW_STATES[(offset + 1) % MOBILE_PREVIEW_STATES.length]
}
