import { randomUUID } from "node:crypto";
import { Guard } from "../validation/Guard.js";

/** Options accepted by the {@link Context} constructor. */
export interface ContextOptions<TAgent = unknown, TInput = unknown> {
  /** The resolved agent this run executes against. */
  readonly agent: TAgent;
  /** The input driving this run (e.g. the user's message). */
  readonly input: TInput;
  /** Optional run id override; a UUID is generated when omitted. */
  readonly runId?: string;
}

/**
 * Per-run, request-scoped execution state.
 *
 * A fresh {@link Context} is created on every {@link Runner.run} call. It
 * carries the resolved agent, the current input, a generated run id, a start
 * timestamp, and a small typed data bag for cross-cutting concerns (e.g.
 * middleware). It lives only for the duration of a single run and has no
 * relationship to conversation history, which is {@link Session}'s job.
 *
 * @example
 * ```ts
 * const context = new Context({ agent, input: { message: "hi" } });
 * context.set("traceId", "abc-123");
 * context.get<string>("traceId");
 * ```
 */
export class Context<TAgent = unknown, TInput = unknown> {
  /** The resolved agent this run executes against. */
  readonly agent: TAgent;
  /** The input driving this run. */
  readonly input: TInput;
  /** Unique identifier for this run. */
  readonly runId: string;
  /** Timestamp marking when this run started. */
  readonly startedAt: Date;
  private readonly data = new Map<string, unknown>();

  /** Constructs a new run context. Throws {@link ValidationError} if a required field is missing. */
  constructor(options: ContextOptions<TAgent, TInput>) {
    Guard.assertDefined(options.agent, "Context.agent", "Pass the resolved Agent for this run.");
    Guard.assertDefined(options.input, "Context.input", "Pass the input driving this run.");

    this.agent = options.agent;
    this.input = options.input;
    this.runId = options.runId ?? randomUUID();
    this.startedAt = new Date();
  }

  /** Stores a value in this run's typed data bag under `key`. */
  set(key: string, value: unknown): void {
    this.data.set(key, value);
  }

  /** Retrieves a value previously stored via {@link set}, or `undefined` if absent. */
  get<T = unknown>(key: string): T | undefined {
    return this.data.get(key) as T | undefined;
  }

  /** Returns whether `key` has been set in this run's data bag. */
  has(key: string): boolean {
    return this.data.has(key);
  }
}
