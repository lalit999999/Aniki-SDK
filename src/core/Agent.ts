import { randomUUID } from "node:crypto";
import { z, type ZodTypeAny } from "zod";
import type { ProviderName } from "../config/Config.js";
import type { IProvider } from "../providers/AIProvider.js";
import { ProviderFactory } from "../providers/ProviderFactory.js";
import type { Tool } from "../tools/Tool.js";
import { ToolRegistry } from "../tools/ToolRegistry.js";
import { ValidationError } from "./errors.js";
import { InMemorySession, type ISession } from "./Session.js";
import { formatZodIssues } from "../utils/index.js";

const DEFAULT_MAX_TOOL_ITERATIONS = 5;

const agentSchema = z.object({
  name: z.string().min(1),
  instructions: z.string().min(1),
  model: z.string().min(1),
  maxToolIterations: z.number().int().positive().optional(),
});

/** Options accepted by the {@link Agent} constructor. */
export interface AgentOptions {
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
  /** The Zod schema the final response must validate against, if structured output is required. */
  readonly output?: ZodTypeAny;
  /** The tools this agent may call. Must have unique names — enforced at construction via {@link ToolRegistry}. */
  readonly tools?: readonly Tool[];
  /** The maximum number of tool-calling iterations {@link Runner} runs before throwing {@link MaxToolIterationsError}. Defaults to `5`. */
  readonly maxToolIterations?: number;
  // Real Middleware type lands in a later task; empty arrays are the expected default until then.
  readonly middleware?: readonly unknown[];
}

/**
 * A pure configuration container describing an AI agent.
 *
 * Agent never communicates with a provider directly — it only stores the
 * metadata, instructions, tools, output schema, model, middleware, session,
 * and provider that {@link Runner} later composes and orchestrates.
 *
 * @example
 * ```ts
 * const agent = new Agent({
 *   name: "Assistant",
 *   instructions: "You are a helpful assistant.",
 *   model: "gpt-5.5",
 *   provider: someProviderImplementingIProvider,
 * });
 * ```
 */
export class Agent {
  private readonly _name: string;
  private readonly _instructions: string;
  private readonly _model: string;
  private readonly _provider: IProvider;
  private readonly _session: ISession;
  private readonly _output: ZodTypeAny | undefined;
  private readonly _tools: readonly Tool[];
  private readonly _toolRegistry: ToolRegistry;
  private readonly _maxToolIterations: number;
  private readonly _middleware: readonly unknown[];

  /** Constructs an Agent. Throws {@link ValidationError} if the configuration is invalid. */
  constructor(options: AgentOptions) {
    const result = agentSchema.safeParse(options);
    if (!result.success) {
      throw new ValidationError(
        `Invalid Agent configuration: ${formatZodIssues(result.error.issues)}`,
      );
    }
    const provider =
      typeof options.provider === "string"
        ? ProviderFactory.create(options.provider)
        : options.provider;
    if (!provider || typeof provider.generate !== "function") {
      throw new ValidationError("Invalid Agent configuration: provider must implement IProvider");
    }

    this._name = result.data.name;
    this._instructions = result.data.instructions;
    this._model = result.data.model;
    this._provider = provider;
    this._session = options.session ?? new InMemorySession(randomUUID());
    this._output = options.output;
    this._tools = options.tools ?? [];
    this._toolRegistry = new ToolRegistry(this._tools);
    this._maxToolIterations = result.data.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
    this._middleware = options.middleware ?? [];
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
  get output(): ZodTypeAny | undefined {
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

  /** This agent's configured middleware. Empty until the Middleware task lands. */
  get middleware(): readonly unknown[] {
    return this._middleware;
  }
}
