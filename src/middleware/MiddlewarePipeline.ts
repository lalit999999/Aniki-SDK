import { AnikiError, MiddlewareContractError, MiddlewareExecutionError } from "../core/errors.js";
import type { IMiddleware, MiddlewareNext, MiddlewareRequest, MiddlewareResponse } from "./Middleware.js";

/**
 * Composes an ordered list of {@link IMiddleware} into a single
 * {@link MiddlewareNext}, Express-style: each middleware's `execute` wraps
 * the next one in the list, down to a caller-supplied `terminal` handler
 * that performs the real provider call.
 *
 * Composition is deterministic index-based recursion — array order is
 * execution order, and an empty pipeline degenerates to calling `terminal`
 * directly, so wiring an empty `MiddlewarePipeline` into `Runner`
 * unconditionally never changes existing behavior. A middleware that calls
 * `next` more than once, or resolves without returning a
 * {@link MiddlewareResponse}, throws {@link MiddlewareContractError}. A
 * middleware whose `execute` throws is wrapped in
 * {@link MiddlewareExecutionError} naming it — unless the thrown value is
 * already an {@link AnikiError}, which passes through unchanged so
 * `Runner`'s existing `ProviderError` handling keeps working.
 *
 * @example
 * ```ts
 * const pipeline = new MiddlewarePipeline([loggingMiddleware, cacheMiddleware, retryMiddleware]);
 * const result = await pipeline.execute(request, (req) => provider.generate(req));
 * ```
 */
export class MiddlewarePipeline {
  private readonly middleware: IMiddleware[];

  /** Constructs a pipeline, optionally pre-populated with `middleware`, run in array order. */
  constructor(middleware: readonly IMiddleware[] = []) {
    this.middleware = [...middleware];
  }

  /** Appends `middleware` to the end of the pipeline. Returns `this` for chaining. */
  use(middleware: IMiddleware): this {
    this.middleware.push(middleware);
    return this;
  }

  /** Removes the first middleware named `name`. Returns whether one was found and removed. */
  remove(name: string): boolean {
    const index = this.middleware.findIndex((entry) => entry.name === name);
    if (index === -1) return false;
    this.middleware.splice(index, 1);
    return true;
  }

  /** Returns a snapshot of this pipeline's middleware, in execution order. */
  list(): readonly IMiddleware[] {
    return [...this.middleware];
  }

  /**
   * Runs `request` through every registered middleware, in order, ending at
   * `terminal`. See the class docs for error-handling and contract-violation
   * semantics.
   */
  execute(request: MiddlewareRequest, terminal: MiddlewareNext): Promise<MiddlewareResponse> {
    return this.invoke(0, request, terminal);
  }

  private async invoke(
    index: number,
    request: MiddlewareRequest,
    terminal: MiddlewareNext,
  ): Promise<MiddlewareResponse> {
    const middleware = this.middleware[index];
    if (!middleware) {
      return terminal(request);
    }

    let nextCalls = 0;
    const next: MiddlewareNext = (nextRequest) => {
      nextCalls += 1;
      if (nextCalls > 1) {
        throw new MiddlewareContractError(middleware.name, "called next() more than once");
      }
      return this.invoke(index + 1, nextRequest, terminal);
    };

    let result: MiddlewareResponse;
    try {
      result = await middleware.execute(request, next);
    } catch (cause) {
      if (cause instanceof AnikiError) {
        throw cause;
      }
      throw new MiddlewareExecutionError(middleware.name, cause);
    }

    if (result === undefined || result === null || typeof result.response !== "object") {
      throw new MiddlewareContractError(middleware.name, "resolved without returning a response");
    }

    return result;
  }
}
