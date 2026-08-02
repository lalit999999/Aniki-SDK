import { z } from "zod";
import {
  ToolInputValidationError,
  ToolOutputValidationError,
  ValidationError,
} from "../core/errors.js";
import type { ToolDefinition } from "../types/tool.js";
import { formatZodIssues } from "../utils/index.js";

/** The pattern every tool name must match — the intersection of what major vendors accept. */
const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

const toolOptionsSchema = z.object({
  name: z
    .string()
    .regex(TOOL_NAME_PATTERN, "must match /^[a-zA-Z0-9_-]{1,64}$/ (letters, digits, _, -)"),
  description: z.string().min(1, "must be a non-empty string"),
  timeoutMs: z.number().int().positive().optional(),
  retries: z.number().int().nonnegative().optional(),
  cache: z.boolean().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Per-invocation context passed to a {@link Tool}'s `execute` function.
 *
 * Supplied by {@link ToolExecutor}, never constructed by a {@link Tool}
 * itself — this is how a well-behaved tool observes cancellation.
 */
export interface ToolContext {
  /** Aborted by {@link ToolExecutor} when this call's timeout elapses. */
  readonly signal?: AbortSignal;
  /** The id of the {@link ToolCall} currently being executed, when known. */
  readonly toolCallId?: string;
}

/** Options accepted by the {@link Tool} constructor. */
export interface ToolOptions<TInput, TOutput> {
  /** The tool's unique name, as the model will refer to it. Must match `/^[a-zA-Z0-9_-]{1,64}$/`. */
  readonly name: string;
  /** What the tool does and when to use it — the only signal the model has to choose it. */
  readonly description: string;
  /** The Zod schema arguments from the LLM are validated against. */
  readonly input: z.ZodType<TInput>;
  /** The Zod schema the return value of `execute` is validated against, if any. */
  readonly output?: z.ZodType<TOutput>;
  /** Performs the tool's work against already-validated input. */
  readonly execute: (input: TInput, context?: ToolContext) => Promise<TOutput> | TOutput;
  /** Maximum time `execute` may run, in milliseconds. Enforced by {@link ToolExecutor}, not here. */
  readonly timeoutMs?: number;
  /** Number of retries {@link ToolExecutor} attempts after an execution/timeout failure. */
  readonly retries?: number;
  /** Whether {@link ToolExecutor} may cache this tool's results. */
  readonly cache?: boolean;
  /** Free-form labels for categorizing or filtering tools. */
  readonly tags?: readonly string[];
  /** Free-form, caller-defined data carried alongside the tool. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * A pure, self-describing tool definition.
 *
 * `Tool` validates and describes itself — it never decides what happens
 * next. It has no knowledge of a registry, a provider, or the Runner, and
 * `timeoutMs`/`retries`/`cache` are only stored here; {@link ToolExecutor} is
 * what applies them. This separation is what makes a tool unit-testable
 * (via {@link Tool.run}) with zero LLM or executor involvement.
 *
 * @example
 * ```ts
 * const weatherTool = new Tool({
 *   name: "get_weather",
 *   description: "Get the current weather for a city.",
 *   input: z.object({ city: z.string() }),
 *   output: z.object({ tempC: z.number(), summary: z.string() }),
 *   execute: async ({ city }) => ({ tempC: 21, summary: `Clear skies in ${city}` }),
 * });
 *
 * await weatherTool.run({ city: "Gaya" }); // { tempC: 21, summary: "Clear skies in Gaya" }
 * ```
 */
export class Tool<TInput = unknown, TOutput = unknown> {
  private readonly _name: string;
  private readonly _description: string;
  private readonly _inputSchema: z.ZodType<TInput>;
  private readonly _outputSchema: z.ZodType<TOutput> | undefined;
  // Stored with an erased `unknown` parameter (rather than `TInput`) so that
  // heterogeneous `Tool<X, Y>` instances remain structurally assignable to
  // the single `Tool` type `ToolRegistry` stores them as — `TInput` used
  // contravariantly here would otherwise make every instantiation invariant.
  private readonly _execute: (input: unknown, context?: ToolContext) => Promise<TOutput> | TOutput;
  private readonly _timeoutMs: number | undefined;
  private readonly _retries: number | undefined;
  private readonly _cache: boolean | undefined;
  private readonly _tags: readonly string[];
  private readonly _metadata: Readonly<Record<string, unknown>>;

  /** Constructs a Tool. Throws {@link ValidationError} if the configuration is invalid. */
  constructor(options: ToolOptions<TInput, TOutput>) {
    const result = toolOptionsSchema.safeParse(options);
    if (!result.success) {
      throw new ValidationError(
        `Invalid Tool configuration: ${formatZodIssues(result.error.issues)}`,
      );
    }
    if (!(options.input instanceof z.ZodType)) {
      throw new ValidationError("Invalid Tool configuration: input must be a Zod schema");
    }
    if (options.output !== undefined && !(options.output instanceof z.ZodType)) {
      throw new ValidationError("Invalid Tool configuration: output must be a Zod schema");
    }
    if (typeof options.execute !== "function") {
      throw new ValidationError("Invalid Tool configuration: execute must be a function");
    }

    this._name = result.data.name;
    this._description = result.data.description;
    this._inputSchema = options.input;
    this._outputSchema = options.output;
    this._execute = options.execute as (
      input: unknown,
      context?: ToolContext,
    ) => Promise<TOutput> | TOutput;
    this._timeoutMs = result.data.timeoutMs;
    this._retries = result.data.retries;
    this._cache = result.data.cache;
    this._tags = options.tags ?? [];
    this._metadata = options.metadata ?? {};
  }

  /** This tool's unique name. */
  get name(): string {
    return this._name;
  }

  /** What this tool does and when to use it. */
  get description(): string {
    return this._description;
  }

  /** The Zod schema arguments are validated against before execution. */
  get inputSchema(): z.ZodType<TInput> {
    return this._inputSchema;
  }

  /** The Zod schema the return value is validated against, if any. */
  get outputSchema(): z.ZodType<TOutput> | undefined {
    return this._outputSchema;
  }

  /** The maximum time `execute` may run, in milliseconds, when configured. */
  get timeoutMs(): number | undefined {
    return this._timeoutMs;
  }

  /** The number of retries configured for this tool, when set. */
  get retries(): number | undefined {
    return this._retries;
  }

  /** Whether this tool's results may be cached, when configured. */
  get cache(): boolean | undefined {
    return this._cache;
  }

  /** Free-form labels attached to this tool. */
  get tags(): readonly string[] {
    return this._tags;
  }

  /** Free-form, caller-defined data attached to this tool. */
  get metadata(): Readonly<Record<string, unknown>> {
    return this._metadata;
  }

  /**
   * Validates `raw` against this tool's input schema.
   * Throws {@link ToolInputValidationError} on failure.
   */
  parseInput(raw: unknown): TInput {
    const result = this._inputSchema.safeParse(raw);
    if (!result.success) {
      throw new ToolInputValidationError(this._name, formatZodIssues(result.error.issues));
    }
    return result.data;
  }

  /**
   * Validates `raw` against this tool's output schema.
   * Passed through unchanged when no output schema was configured.
   * Throws {@link ToolOutputValidationError} on failure.
   */
  parseOutput(raw: unknown): TOutput {
    if (!this._outputSchema) {
      return raw as TOutput;
    }
    const result = this._outputSchema.safeParse(raw);
    if (!result.success) {
      throw new ToolOutputValidationError(this._name, formatZodIssues(result.error.issues));
    }
    return result.data;
  }

  /** Converts this tool's input schema into a provider-agnostic {@link ToolDefinition}. */
  toDefinition(): ToolDefinition {
    return {
      name: this._name,
      description: this._description,
      parameters: z.toJSONSchema(this._inputSchema),
    };
  }

  /**
   * Invokes the underlying `execute` function directly, with no input or
   * output validation and no timeout/retry.
   *
   * Intended for {@link ToolExecutor}, which validates input beforehand (so
   * it can attribute a validation failure without ever calling `execute`)
   * and applies its own timeout/retry around this call. Prefer {@link run}
   * outside of the executor.
   */
  invoke(input: TInput, context?: ToolContext): Promise<TOutput> {
    return Promise.resolve(
      context === undefined ? this._execute(input) : this._execute(input, context),
    );
  }

  /**
   * Validates `input`, executes the tool, and validates its output — with no
   * timeout, retry, or registry involvement. This is the "unit-test a tool
   * without an LLM" path; {@link ToolExecutor} is what adds timeout/retry
   * semantics for use inside the tool-calling loop.
   */
  async run(input: TInput): Promise<TOutput> {
    const parsedInput = this.parseInput(input);
    const rawOutput = await this.invoke(parsedInput);
    return this.parseOutput(rawOutput);
  }
}
