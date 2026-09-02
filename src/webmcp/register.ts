export const RELIEF_FORGE_TOOL_NAMES = [
  'relief_forge_create_wall_art',
  'relief_forge_set_printer_bed',
  'relief_forge_inspect_fabrication_plan',
  'relief_forge_prepare_fabrication_package',
] as const

export type ReliefForgeToolName = (typeof RELIEF_FORGE_TOOL_NAMES)[number]

export interface CreateWallArtToolInput {
  preset: 'topographic-terraces' | 'topographic-mosaic'
  width: number
  height?: number
  unit: 'mm' | 'in'
  depthMm: number
  seed?: string
}

export interface SetPrinterBedToolInput {
  bedWidthMm: number
  bedDepthMm: number
  marginMm?: number
  spacingMm?: number
  allowRotate90?: boolean
  separateColors?: boolean
}

export type EmptyToolInput = Record<string, never>

export interface ReliefForgeToolInputs {
  relief_forge_create_wall_art: CreateWallArtToolInput
  relief_forge_set_printer_bed: SetPrinterBedToolInput
  relief_forge_inspect_fabrication_plan: EmptyToolInput
  relief_forge_prepare_fabrication_package: EmptyToolInput
}

export type ReliefForgeJsonPrimitive = string | number | boolean | null

export type ReliefForgeJsonValue =
  | ReliefForgeJsonPrimitive
  | ReliefForgeJsonValue[]
  | { [key: string]: ReliefForgeJsonValue }

export interface ReliefForgeToolExecutionContext {
  signal?: AbortSignal
}

export interface ReliefForgeToolDispatcher {
  <Name extends ReliefForgeToolName>(
    name: Name,
    input: ReliefForgeToolInputs[Name],
    context: ReliefForgeToolExecutionContext,
  ): ReliefForgeJsonValue | Promise<ReliefForgeJsonValue>
}

/**
 * Keep this ref stable while the app is mounted and replace `current` whenever
 * the live app state changes. Registered WebMCP callbacks dereference it for
 * every invocation, so they never capture a stale React render.
 */
export interface ReliefForgeToolDispatcherRef {
  current: ReliefForgeToolDispatcher
}

export interface ReliefForgeToolsRegistration {
  readonly supported: boolean
  readonly ready: Promise<void>
  updateDispatcher(dispatcherRef: ReliefForgeToolDispatcherRef): void
  dispose(): void
}

export const CREATE_WALL_ART_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    preset: {
      type: 'string',
      enum: ['topographic-terraces', 'topographic-mosaic'],
      description: 'The deterministic Relief Forge design recipe to apply. Use topographic-mosaic for a denser 12 by 8 field of smaller panels.',
    },
    width: {
      type: 'number',
      exclusiveMinimum: 0,
      maximum: 10_000,
      description: 'Exact finished artwork width, measured in the selected unit.',
    },
    height: {
      type: 'number',
      exclusiveMinimum: 0,
      maximum: 10_000,
      description: 'Optional exact finished artwork height in the selected unit. Omit to preserve the preset 3:2 width-to-height ratio.',
    },
    unit: {
      type: 'string',
      enum: ['mm', 'in'],
      description: 'Physical unit used by width and height.',
    },
    depthMm: {
      type: 'number',
      minimum: 3,
      maximum: 80,
      description: 'Requested maximum physical object depth in millimetres.',
    },
    seed: {
      type: 'string',
      minLength: 1,
      maxLength: 128,
      description: 'Optional deterministic seed. Omit it to use the reproducible public demo seed; reuse an explicit seed with the same settings to reproduce the same geometry.',
    },
  },
  required: ['preset', 'width', 'unit', 'depthMm'],
  additionalProperties: false,
} as const

export const SET_PRINTER_BED_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    bedWidthMm: {
      type: 'number',
      minimum: 80,
      maximum: 1_000,
      description: 'Full rectangular printer-bed width in millimetres, before reserving the edge margin.',
    },
    bedDepthMm: {
      type: 'number',
      minimum: 80,
      maximum: 1_000,
      description: 'Full rectangular printer-bed depth in millimetres, before reserving the edge margin.',
    },
    marginMm: {
      type: 'number',
      minimum: 0,
      maximum: 30,
      description: 'Safety margin reserved around every bed edge in millimetres.',
    },
    spacingMm: {
      type: 'number',
      minimum: 1,
      maximum: 20,
      description: 'Minimum XY clearance between packed parts in millimetres.',
    },
    allowRotate90: {
      type: 'boolean',
      description: 'Whether packing may rotate parts by 90 degrees.',
    },
    separateColors: {
      type: 'boolean',
      description: 'Whether differently colored parts must be assigned to separate plates.',
    },
  },
  required: ['bedWidthMm', 'bedDepthMm'],
  additionalProperties: false,
} as const

export const EMPTY_TOOL_INPUT_SCHEMA = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const

interface SharedRegistration {
  controller: AbortController
  dispatcherRef: ReliefForgeToolDispatcherRef
  ownerCount: number
  teardownGeneration: number
  ready: Promise<void>
}

const registrations = new WeakMap<WebMCPModelContext, SharedRegistration>()

function dispatchTool<Name extends ReliefForgeToolName>(
  state: SharedRegistration,
  name: Name,
  input: ReliefForgeToolInputs[Name],
  options?: WebMCPToolExecutionOptions,
): ReliefForgeJsonValue | Promise<ReliefForgeJsonValue> {
  return state.dispatcherRef.current(name, input, { signal: options?.signal })
}

function toolDefinitions(state: SharedRegistration): WebMCPToolDefinition[] {
  return [
    {
      name: 'relief_forge_create_wall_art',
      description: 'Create or replace the live Relief Forge design using a deterministic topographic preset, an exact finished size, and a maximum object depth. Choose topographic-terraces for 12 broad panels or topographic-mosaic for 96 smaller panels with richer contour sampling. Updates the visible design and recomputes fabrication geometry.',
      inputSchema: CREATE_WALL_ART_INPUT_SCHEMA,
      annotations: { readOnlyHint: false },
      execute: (input, options) => dispatchTool(
        state,
        'relief_forge_create_wall_art',
        input as unknown as CreateWallArtToolInput,
        options,
      ),
    },
    {
      name: 'relief_forge_set_printer_bed',
      description: 'Set the full rectangular printer-bed dimensions and packing clearances for the live Relief Forge design. The edge margin is subtracted from all four sides. Updates the visible print-plate layout and fit result.',
      inputSchema: SET_PRINTER_BED_INPUT_SCHEMA,
      annotations: { readOnlyHint: false },
      execute: (input, options) => dispatchTool(
        state,
        'relief_forge_set_printer_bed',
        input as unknown as SetPrinterBedToolInput,
        options,
      ),
    },
    {
      name: 'relief_forge_inspect_fabrication_plan',
      description: 'Read the exact current Relief Forge design and computed fabrication plan, including dimensions, depth, part and plate counts, printer-bed fit, and digital mesh checks. Makes no changes.',
      inputSchema: EMPTY_TOOL_INPUT_SCHEMA,
      annotations: { readOnlyHint: true },
      execute: (input, options) => dispatchTool(
        state,
        'relief_forge_inspect_fabrication_plan',
        input as EmptyToolInput,
        options,
      ),
    },
    {
      name: 'relief_forge_prepare_fabrication_package',
      description: 'Build the complete fabrication ZIP for the exact current Relief Forge design and expose a visible Save link for the user. The package includes printable STL and 3MF files, assembly PDFs, the recipe, and manifests; it does not start a print or silently download files.',
      inputSchema: EMPTY_TOOL_INPUT_SCHEMA,
      annotations: { readOnlyHint: false },
      execute: (input, options) => dispatchTool(
        state,
        'relief_forge_prepare_fabrication_package',
        input as EmptyToolInput,
        options,
      ),
    },
  ]
}

function unsupportedRegistration(): ReliefForgeToolsRegistration {
  return {
    supported: false,
    ready: Promise.resolve(),
    updateDispatcher: () => undefined,
    dispose: () => undefined,
  }
}

function createSharedRegistration(
  modelContext: WebMCPModelContext,
  dispatcherRef: ReliefForgeToolDispatcherRef,
): SharedRegistration {
  const state: SharedRegistration = {
    controller: new AbortController(),
    dispatcherRef,
    ownerCount: 1,
    teardownGeneration: 0,
    ready: Promise.resolve(),
  }

  registrations.set(modelContext, state)

  state.ready = Promise.all(
    toolDefinitions(state).map((tool) => Promise.resolve().then(() => (
      modelContext.registerTool(tool, { signal: state.controller.signal })
    ))),
  ).then(
    () => undefined,
    (error: unknown) => {
      state.controller.abort(error)
      if (registrations.get(modelContext) === state) {
        registrations.delete(modelContext)
      }
      throw error
    },
  )

  // A consumer can await `ready`, but registration failures must not become an
  // unhandled rejection if a browser rejects WebMCP at the permissions layer.
  void state.ready.catch(() => undefined)

  return state
}

function registrationHandle(
  modelContext: WebMCPModelContext,
  state: SharedRegistration,
): ReliefForgeToolsRegistration {
  let disposed = false

  return {
    supported: true,
    ready: state.ready,
    updateDispatcher(dispatcherRef) {
      if (!disposed && registrations.get(modelContext) === state) {
        state.dispatcherRef = dispatcherRef
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      state.ownerCount = Math.max(0, state.ownerCount - 1)
      if (state.ownerCount !== 0) return

      const teardownGeneration = ++state.teardownGeneration
      queueMicrotask(() => {
        if (
          state.ownerCount !== 0 ||
          state.teardownGeneration !== teardownGeneration ||
          registrations.get(modelContext) !== state
        ) {
          return
        }
        state.controller.abort()
        registrations.delete(modelContext)
      })
    },
  }
}

/**
 * Register Relief Forge's tools on the current top-level document.
 *
 * Unsupported browsers receive a harmless no-op handle. Multiple callers on
 * the same document share one registration, and teardown is deferred by one
 * microtask so React Strict Mode's development remount cannot create duplicate
 * tool names.
 */
export function registerReliefForgeTools(
  dispatcherRef: ReliefForgeToolDispatcherRef,
): ReliefForgeToolsRegistration {
  if (
    typeof document === 'undefined' ||
    typeof document.modelContext?.registerTool !== 'function'
  ) {
    return unsupportedRegistration()
  }

  const modelContext = document.modelContext
  const existing = registrations.get(modelContext)
  if (existing && !existing.controller.signal.aborted) {
    existing.ownerCount += 1
    existing.teardownGeneration += 1
    existing.dispatcherRef = dispatcherRef
    return registrationHandle(modelContext, existing)
  }

  return registrationHandle(
    modelContext,
    createSharedRegistration(modelContext, dispatcherRef),
  )
}
