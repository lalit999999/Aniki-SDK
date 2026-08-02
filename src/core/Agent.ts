import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ProviderName } from "../config/Config.js";
import type { IMiddleware } from "../middleware/Middleware.js";
import type { IProvider } from "../providers/AIProvider.js";
import { ProviderFactory } from "../providers/ProviderFactory.js";
import type { Tool } from "../tools/Tool.js";
import { ToolRegistry } from "../tools/ToolRegistry.js";
import { InMemorySession, type ISession } from "./Session.js";
import { Guard } from "../validation/Guard.js";

const DEFAULT_MAX_TOOL_ITERATIONS = 5;

const agentSchema = z.object({
  name: z.string().min(1),
  instructions: z.string().min(1),
  model: z.string().min(1),
  maxToolIterations: z.number().int().positive().optional(),
});

/** Options accepted by the {@link Agent} constructor. */
export interface AgentOptions<TOutput = undefined> {
  /** A short, human-readable name for this agent. */
  readonly name: string;
  /** The system instructions/persona guiding the agent's behavior. */
  readonly instructions: string;
  /** The model identifier to send requests to (e.g. `"gpt-5.5"`). */
  readonly model: string;
  /**
   * The LLM provider this agent's requests are executed against, either as
   * a constructed {@link IProvider} instance or the name of a registered
   * provider (e.g. `"openai"`) to resolve via {@link ProviderFactory}.
   */
  readonly provider: IProvider | ProviderName;
  /** The conversation session this agent reads and writes history to. Defaults to a fresh in-memory session. */
  readonly session?: ISession;
  /**
   * The Zod schema the final response must validate against. Setting this
   * infers `TOutput`, so `new Agent({ output: UserSchema })` yields an
   * `Agent<User>` whose {@link Runner} results carry a typed, validated
   * `output` field.
   */
  readonly output?: z.ZodType<TOutput>;
  /** The tools this agent may call. Must have unique names — enforced at construction via {@link ToolRegistry}. */
  readonly tools?: readonly Tool[];
  /** The maximum number of tool-calling iterations {@link Runner} runs before throwing {@link MaxToolIterationsError}. Defaults to `5`. */
  readonly maxToolIterations?: number;
  /** Middleware {@link Runner} runs around every provider round trip for this agent, after any Runner-level middleware. Must each implement {@link IMiddleware} — enforced at construction. Defaults to an empty array. */
  readonly middleware?: readonly IMiddleware[];
}

/**
 * A pure configuration container describing an AI agent.
 *
 * Agent never communicates with a provider directly — it only stores the
 * metadata, instructions, tools, output schema, model, middleware, session,
 * and provider that {@link Runner} later composes and orchestrates. It is
 * generic over `TOutput`, the type its structured `output` schema validates
 * to; an agent constructed with no `output` schema is `Agent<undefined>`,
 * so every existing call site keeps compiling unchanged.
 *
 * @example
 * ```ts
 * const agent = new Agent({
 *   name: "Assistant",
 *   instructions: "You are a helpful assistant.",
 *   model: "gpt-5.5",
 *   provider: someProviderImplementingIProvider,
 *   output: z.object({ email: z.string() }), // infers Agent<{ email: string }>
 * });
 * ```
 */
export class Agent<TOutput = undefined> {
  private readonly _name: string;
  private readonly _instructions: string;
  private readonly _model: string;
  private readonly _provider: IProvider;
  private readonly _session: ISession;
  private readonly _output: z.ZodType<TOutput> | undefined;
  private readonly _tools: readonly Tool[];
  private readonly _toolRegistry: ToolRegistry;
  private readonly _maxToolIterations: number;
  private readonly _middleware: readonly IMiddleware[];

  /** Constructs an Agent. Throws {@link ValidationError} if the configuration is invalid. */
  constructor(options: AgentOptions<TOutput>) {
    const result = Guard.fromZod(agentSchema.safeParse(options), "Invalid Agent configuration");
    const provider =
      typeof options.provider === "string"
        ? ProviderFactory.create(options.provider)
        : options.provider;
    Guard.assertImplements<IProvider>(
      provider,
      "Agent.provider",
      "IProvider",
      ["generate"],
      'Pass a provider instance (e.g. new OpenAIProvider(...)) or a registered provider name such as "openai".',
    );
    if (options.output !== undefined) {
      Guard.assertZodSchema(
        options.output,
        "Agent.output",
        "Pass a Zod schema, e.g. z.object({ ... }).",
      );
    }
    const middleware = options.middleware ?? [];
    Guard.assertArrayOf<IMiddleware>(
      middleware,
      (entry): entry is IMiddleware =>
        entry !== null &&
        typeof entry === "object" &&
        typeof (entry as IMiddleware).name === "string" &&
        (entry as IMiddleware).name.length > 0 &&
        typeof (entry as IMiddleware).execute === "function",
      "Agent.middleware",
      "Each entry must implement IMiddleware: a non-empty `name` and an `execute(request, next)` method.",
    );

    this._name = result.name;
    this._instructions = result.instructions;
    this._model = result.model;
    this._provider = provider;
    this._session = options.session ?? new InMemorySession(randomUUID());
    this._output = options.output;
    this._tools = options.tools ?? [];
    this._toolRegistry = new ToolRegistry(this._tools);
    this._maxToolIterations = result.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
    this._middleware = middleware;
  }

  /** This agent's name. */
  get name(): string {
    return this._name;
  }

  /** This agent's system instructions. */
  get instructions(): string {
    return this._instructions;
  }

  /** The model identifier this agent sends requests to. */
  get model(): string {
    return this._model;
  }

  /** The LLM provider this agent's requests are executed against. */
  get provider(): IProvider {
    return this._provider;
  }

  /** The conversation session this agent reads and writes history to. */
  get session(): ISession {
    return this._session;
  }

  /** The Zod schema the final response must validate against, if any. */
  get output(): z.ZodType<TOutput> | undefined {
    return this._output;
  }

  /** This agent's configured tools. */
  get tools(): readonly Tool[] {
    return this._tools;
  }

  /** The registry {@link Runner} resolves this agent's tool calls against. Built at construction time, so a duplicate tool name fails fast here rather than mid-run. */
  get toolRegistry(): ToolRegistry {
    return this._toolRegistry;
  }

  /** The maximum number of tool-calling iterations {@link Runner} runs before throwing {@link MaxToolIterationsError}. */
  get maxToolIterations(): number {
    return this._maxToolIterations;
  }

  /** This agent's configured middleware, run around every provider round trip after any Runner-level middleware. */
  get middleware(): readonly IMiddleware[] {
    return this._middleware;
  }
}
