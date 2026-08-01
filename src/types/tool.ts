/**
 * Provider-agnostic tool-calling contracts.
 *
 * These shapes are the SDK's internal, vendor-neutral representation of a
 * tool call and its result. No provider adapter's wire format (OpenAI
 * function-calling JSON, Gemini's `functionCall`, Anthropic's `tool_use`
 * blocks, ...) ever crosses this boundary directly — each provider
 * integration translates to and from these types at its own module edge.
 */

/**
 * A single invocation of a tool, as requested by the LLM.
 *
 * `arguments` is raw and unvalidated — exactly what the model produced —
 * until {@link Tool.parseInput} (or {@link ToolExecutor.execute}) checks it
 * against the tool's input schema.
 */
export interface ToolCall {
  /** A unique identifier for this call, used to correlate its result. */
  readonly id: string;
  /** The name of the tool being invoked. */
  readonly name: string;
  /** The raw, unvalidated arguments the model supplied for this call. */
  readonly arguments: Readonly<Record<string, unknown>>;
}

/**
 * The outcome of executing a single {@link ToolCall}.
 *
 * Exactly one of `output` (when `ok` is `true`) or `error` (when `ok` is
 * `false`) is meaningful; `error` is written to be readable by the LLM so it
 * can self-correct on the next turn.
 */
export interface ToolResult {
  /** The id of the {@link ToolCall} this result answers. */
  readonly toolCallId: string;
  /** The name of the tool that was executed. */
  readonly toolName: string;
  /** Whether execution completed successfully. */
  readonly ok: boolean;
  /** The tool's validated return value. Present when `ok` is `true`. */
  readonly output?: unknown;
  /** A human/LLM-readable failure description. Present when `ok` is `false`. */
  readonly error?: string;
  /** How long execution took, in milliseconds. */
  readonly durationMs: number;
}

/**
 * The vendor-neutral description of a tool a provider adapter translates
 * into its own wire format (OpenAI's `tools` array, Gemini's
 * `functionDeclarations`, etc.) when building a request.
 */
export interface ToolDefinition {
  /** The tool's unique name, as the model will refer to it. */
  readonly name: string;
  /** A description of what the tool does and when to use it. */
  readonly description: string;
  /** The tool's input shape, as JSON Schema. */
  readonly parameters: Readonly<Record<string, unknown>>;
}
