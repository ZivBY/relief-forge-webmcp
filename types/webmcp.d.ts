export {}

declare global {
  type WebMCPJsonPrimitive = string | number | boolean | null

  type WebMCPJsonValue =
    | WebMCPJsonPrimitive
    | WebMCPJsonValue[]
    | { [key: string]: WebMCPJsonValue }

  interface WebMCPToolAnnotations {
    readOnlyHint?: boolean
    [key: string]: WebMCPJsonValue | undefined
  }

  interface WebMCPToolExecutionOptions {
    signal?: AbortSignal
  }

  interface WebMCPToolDefinition<
    TInput extends Record<string, unknown> = Record<string, unknown>,
    TResult extends WebMCPJsonValue = WebMCPJsonValue,
  > {
    name: string
    description: string
    inputSchema: Readonly<Record<string, unknown>>
    annotations?: WebMCPToolAnnotations
    execute(
      input: TInput,
      options?: WebMCPToolExecutionOptions,
    ): TResult | Promise<TResult>
  }

  interface WebMCPToolRegistrationOptions {
    signal?: AbortSignal
    exposedTo?: readonly string[]
  }

  interface WebMCPModelContext {
    registerTool<
      TInput extends Record<string, unknown> = Record<string, unknown>,
      TResult extends WebMCPJsonValue = WebMCPJsonValue,
    >(
      tool: WebMCPToolDefinition<TInput, TResult>,
      options?: WebMCPToolRegistrationOptions,
    ): Promise<void>
  }

  interface Document {
    readonly modelContext?: WebMCPModelContext
  }
}
