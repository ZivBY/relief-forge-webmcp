import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  CREATE_WALL_ART_INPUT_SCHEMA,
  EMPTY_TOOL_INPUT_SCHEMA,
  RELIEF_FORGE_TOOL_NAMES,
  SET_PRINTER_BED_INPUT_SCHEMA,
  registerReliefForgeTools,
  type ReliefForgeToolDispatcher,
  type ReliefForgeToolDispatcherRef,
} from './register'

interface RegisteredTool {
  tool: WebMCPToolDefinition
  options?: WebMCPToolRegistrationOptions
}

function mockModelContext() {
  const registrations: RegisteredTool[] = []
  const modelContext: WebMCPModelContext = {
    registerTool: vi.fn(async (tool, options) => {
      registrations.push({
        tool: tool as WebMCPToolDefinition,
        options,
      })
    }),
  }

  vi.stubGlobal('document', { modelContext })
  return { modelContext, registrations }
}

function dispatcherRef(
  dispatcher: ReliefForgeToolDispatcher = vi.fn(async (name) => ({ name })),
): ReliefForgeToolDispatcherRef {
  return { current: dispatcher }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Relief Forge WebMCP registration', () => {
  it('is a supported-feature no-op outside a WebMCP document', async () => {
    vi.stubGlobal('document', {})
    const registration = registerReliefForgeTools(dispatcherRef())

    expect(registration.supported).toBe(false)
    await expect(registration.ready).resolves.toBeUndefined()
    expect(() => registration.dispose()).not.toThrow()
  })

  it('registers exactly four narrow imperative tools on document.modelContext', async () => {
    const { modelContext, registrations } = mockModelContext()
    const registration = registerReliefForgeTools(dispatcherRef())
    await registration.ready

    expect(registration.supported).toBe(true)
    expect(modelContext.registerTool).toHaveBeenCalledTimes(4)
    expect(registrations.map(({ tool }) => tool.name)).toEqual(RELIEF_FORGE_TOOL_NAMES)
    expect(registrations.map(({ tool }) => tool.inputSchema)).toEqual([
      CREATE_WALL_ART_INPUT_SCHEMA,
      SET_PRINTER_BED_INPUT_SCHEMA,
      EMPTY_TOOL_INPUT_SCHEMA,
      EMPTY_TOOL_INPUT_SCHEMA,
    ])
    expect(registrations.map(({ tool }) => tool.annotations?.readOnlyHint)).toEqual([
      false,
      false,
      true,
      false,
    ])
    expect(registrations.every(({ options }) => options?.signal instanceof AbortSignal)).toBe(true)

    expect(CREATE_WALL_ART_INPUT_SCHEMA.required).toEqual([
      'preset',
      'width',
      'unit',
      'depthMm',
    ])
    expect(CREATE_WALL_ART_INPUT_SCHEMA.additionalProperties).toBe(false)
    expect(SET_PRINTER_BED_INPUT_SCHEMA.required).toEqual(['bedWidthMm', 'bedDepthMm'])
    expect(SET_PRINTER_BED_INPUT_SCHEMA.additionalProperties).toBe(false)

    registration.dispose()
    await Promise.resolve()
  })

  it('dereferences the live dispatcher and forwards invocation cancellation', async () => {
    const { registrations } = mockModelContext()
    const firstDispatcher = vi.fn(async () => ({ version: 'first' }))
    const ref = dispatcherRef(firstDispatcher)
    const registration = registerReliefForgeTools(ref)
    await registration.ready

    const secondDispatcher = vi.fn(async () => ({ version: 'second' }))
    ref.current = secondDispatcher
    const executionController = new AbortController()
    const createTool = registrations[0].tool
    const input = {
      preset: 'topographic-terraces',
      width: 36,
      unit: 'in',
      depthMm: 20,
      seed: 'challenge-demo',
    }

    await expect(createTool.execute(input, {
      signal: executionController.signal,
    })).resolves.toEqual({ version: 'second' })
    expect(firstDispatcher).not.toHaveBeenCalled()
    expect(secondDispatcher).toHaveBeenCalledWith(
      'relief_forge_create_wall_art',
      input,
      { signal: executionController.signal },
    )

    registration.dispose()
    await Promise.resolve()
  })

  it('shares one tool set across React Strict Mode mount probes', async () => {
    const { modelContext, registrations } = mockModelContext()
    const first = registerReliefForgeTools(dispatcherRef())
    first.dispose()

    const secondDispatcher = vi.fn(async () => ({ version: 'remount' }))
    const second = registerReliefForgeTools(dispatcherRef(secondDispatcher))
    await second.ready
    await Promise.resolve()

    expect(modelContext.registerTool).toHaveBeenCalledTimes(4)
    expect(registrations[0].options?.signal?.aborted).toBe(false)

    await registrations[2].tool.execute({})
    expect(secondDispatcher).toHaveBeenCalledWith(
      'relief_forge_inspect_fabrication_plan',
      {},
      { signal: undefined },
    )

    second.dispose()
    await Promise.resolve()
    expect(registrations[0].options?.signal?.aborted).toBe(true)
  })

  it('aborts all partial registrations when the browser rejects a tool', async () => {
    const signals: AbortSignal[] = []
    let attempt = 0
    const modelContext: WebMCPModelContext = {
      registerTool: vi.fn(async (_tool, options) => {
        attempt += 1
        if (options?.signal) signals.push(options.signal)
        if (attempt === 2) throw new DOMException('Blocked', 'NotAllowedError')
      }),
    }
    vi.stubGlobal('document', { modelContext })

    const registration = registerReliefForgeTools(dispatcherRef())
    await expect(registration.ready).rejects.toMatchObject({ name: 'NotAllowedError' })
    expect(signals).toHaveLength(4)
    expect(signals.every((signal) => signal.aborted)).toBe(true)
  })
})
