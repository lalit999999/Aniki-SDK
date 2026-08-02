import type { Context } from "../core/Context.js";
import type { RunInput } from "../core/Runner.js";
import type { ProviderResponse } from "../providers/AIProvider.js";
import type { Message, ToolDefinition } from "../types/index.js";

/**
 * The middleware contract and its request/response envelope.
 *
 * Middleware wraps a single provider round trip — **not** the whole of
 * {@link Runner.run} — so it composes safely with the tool loop: each
 * iteration gets its own middleware pass, retries never replay
 * `session.addMessage()`, and cache keys stay meaningful (see `Claude.md`
 * §3.3 for the full rationale). A pipeline of middleware executes in array
 * order around a terminal handler that performs the actual provider call;
 * see `MiddlewarePipeline.ts`.
 */

/** The (read-only) request a middleware pipeline executes around a single provider round trip. */
export interface MiddlewareRequest {
  /** The id of the run this request belongs to. */
  readonly runId: string;
  /** The name of the agent issuing this request. */
  readonly agentName: string;
  /** The model identifier this request targets. */
  readonly model: string;
  /** The name of the provider this request targets. */
  readonly providerName: string;
  /** The conversation history plus the current turn, as it will be sent to the provider. */
  readonly messages: readonly Message[];
  /** The tools available to the model for this request, when the agent has any. */
  readonly tools?: readonly ToolDefinition[];
  /** Which tool-loop iteration this request belongs to, starting at `1`. */
  readonly iteration: number;
  /** The run's execution context, for middleware that needs cross-cutting state (e.g. a trace id) via its `get`/`set`/`has` data bag. */
  readonly context: Context<unknown, RunInput>;
}

/** The response a middleware pipeline (or its terminal provider call) resolves with. */
export interface MiddlewareResponse {
  /** The normalized provider response for this round trip. */
  readonly response: ProviderResponse;
  /** Whether `response` was served from a cache instead of a real provider call. */
  readonly fromCache: boolean;
  /** How many provider attempts it took to produce `response` (`1` unless a retrying middleware ran). */
  readonly attempts: number;
}

/** Invokes the next middleware in the pipeline (or the terminal provider call, for the last one). */
export type MiddlewareNext = (request: MiddlewareRequest) => Promise<MiddlewareResponse>;

/**
 * The contract every middleware implements.
 *
 * A middleware inspects (and may act around) a single provider round trip
 * by calling `next(request)` — optionally with a modified `request` — and
 * awaiting its result, or by short-circuiting entirely (e.g. a cache hit)
 * without calling `next` at all. Exactly one call to `next` per invocation
 * is permitted; {@link MiddlewarePipeline} enforces this and throws
 * {@link MiddlewareContractError} otherwise. Prefer extending
 * {@link BaseMiddleware} over implementing this interface directly.
 */
export interface IMiddleware {
  /** A human-readable name for this middleware, used to attribute errors and log records to it. */
  readonly name: string;
  /** Executes this middleware's behavior around `next`, the rest of the pipeline. */
  execute(request: MiddlewareRequest, next: MiddlewareNext): Promise<MiddlewareResponse>;
}

/**
 * A convenience base class for custom middleware.
 *
 * Implements the mechanical parts of {@link IMiddleware} (storing `name`)
 * so a custom middleware needs only to extend this class and implement
 * {@link execute} — no other SDK internals need to be touched.
 *
 * @example
 * ```ts
 * class TimingHeaderMiddleware extends BaseMiddleware {
 *   constructor() { super("TimingHeaderMiddleware"); }
 *   async execute(request: MiddlewareRequest, next: MiddlewareNext) {
 *     const start = Date.now();
 *     const result = await next(request);
 *     console.log(`${request.model} took ${Date.now() - start}ms`);
 *     return result;
 *   }
 * }
 * ```
 */
export abstract class BaseMiddleware implements IMiddleware {
  readonly name: string;

  protected constructor(name: string) {
    this.name = name;
  }

  abstract execute(request: MiddlewareRequest, next: MiddlewareNext): Promise<MiddlewareResponse>;
}
