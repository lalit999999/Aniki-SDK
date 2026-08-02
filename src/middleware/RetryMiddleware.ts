import { z } from "zod";
import { ConfigurationError, RetryExhaustedError } from "../core/errors.js";
import type { ILogger } from "../logger/Logger.js";
import { ProviderResponseError, RateLimitError } from "../providers/errors.js";
import { formatZodIssues } from "../utils/index.js";
import { BaseMiddleware } from "./Middleware.js";
import type { MiddlewareNext, MiddlewareRequest, MiddlewareResponse } from "./Middleware.js";

/** Zod schema validating the numeric/boolean fields of {@link RetryMiddlewareOptions}. */
const retryMiddlewareOptionsSchema = z.object({
  maxAttempts: z.number().int().positive().optional(),
  initialDelayMs: z.number().int().nonnegative().optional(),
  maxDelayMs: z.number().int().nonnegative().optional(),
  backoffFactor: z.number().positive().optional(),
  jitter: z.boolean().optional(),
});

/** Options accepted by the {@link RetryMiddleware} constructor. */
export interface RetryMiddlewareOptions {
  /** The maximum number of provider attempts to make before giving up. Defaults to `3`. */
  readonly maxAttempts?: number;
  /** The base delay, in milliseconds, before the first retry. Defaults to `250`. */
  readonly initialDelayMs?: number;
  /** The ceiling every computed (or provider-reported) delay is clamped to. Defaults to `8000`. */
  readonly maxDelayMs?: number;
  /** The multiplier applied to the delay after each failed attempt. Defaults to `2`. */
  readonly backoffFactor?: number;
  /** Whether to apply full jitter (a random delay in `[0, computedDelay]`) instead of the raw computed delay. Defaults to `true`. */
  readonly jitter?: boolean;
  /** Overrides the default retry predicate. Defaults to retrying only a {@link ProviderResponseError} with `retryable === true`. */
  readonly isRetryable?: (error: unknown) => boolean;
  /** When supplied, each attempt (and its outcome) is logged through this logger. */
  readonly logger?: ILogger;
  /** Overrides how this middleware waits between attempts. Defaults to a real `setTimeout`-backed delay. Inject a fake to keep tests instant and deterministic. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/** The default retry predicate: retries only a {@link ProviderResponseError} the provider marked `retryable`. */
function defaultIsRetryable(error: unknown): boolean {
  return error instanceof ProviderResponseError && error.retryable;
}

/** The default `sleep` implementation: a real `setTimeout`-backed delay. */
function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Retries a provider round trip on transient failure.
 *
 * Sits closest to the provider in the default middleware order
 * (`Claude.md` §3.5), so each attempt is a real transport call. Only
 * transient failures are retried — by default, a {@link ProviderResponseError}
 * with `retryable === true` — everything else (validation errors, tool
 * errors, output errors, authentication/invalid-request/model-not-found
 * errors) rethrows immediately on the first attempt. A {@link RateLimitError}'s
 * `retryAfterSeconds`, when present, takes priority over the computed
 * backoff delay, clamped by `maxDelayMs`. Exhausting every attempt throws
 * {@link RetryExhaustedError} carrying the attempt count and the last
 * failure as `cause`.
 *
 * @example
 * ```ts
 * const middleware = new RetryMiddleware({ maxAttempts: 3, logger: new ConsoleLogger() });
 * ```
 */
export class RetryMiddleware extends BaseMiddleware {
  private readonly maxAttempts: number;
  private readonly initialDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly backoffFactor: number;
  private readonly jitter: boolean;
  private readonly isRetryablePredicate: (error: unknown) => boolean;
  private readonly logger: ILogger | undefined;
  private readonly sleepFn: (ms: number) => Promise<void>;

  /** Constructs a RetryMiddleware. Throws {@link ConfigurationError} if `options` fails validation. */
  constructor(options: RetryMiddlewareOptions = {}) {
    super("RetryMiddleware");

    const result = retryMiddlewareOptionsSchema.safeParse(options);
    if (!result.success) {
      throw new ConfigurationError(
        `Invalid RetryMiddleware configuration: ${formatZodIssues(result.error.issues)}`,
      );
    }

    this.maxAttempts = result.data.maxAttempts ?? 3;
    this.initialDelayMs = result.data.initialDelayMs ?? 250;
    this.maxDelayMs = result.data.maxDelayMs ?? 8000;
    this.backoffFactor = result.data.backoffFactor ?? 2;
    this.jitter = result.data.jitter ?? true;
    this.isRetryablePredicate = options.isRetryable ?? defaultIsRetryable;
    this.logger = options.logger;
    this.sleepFn = options.sleep ?? realSleep;
  }

  async execute(request: MiddlewareRequest, next: MiddlewareNext): Promise<MiddlewareResponse> {
    let attempt = 0;
    let lastError: unknown;

    while (attempt < this.maxAttempts) {
      attempt += 1;
      this.logger?.debug("Retry attempt starting", {
        runId: request.runId,
        attempt,
        maxAttempts: this.maxAttempts,
      });

      try {
        const result = await next(request);
        this.logger?.debug("Retry attempt succeeded", { runId: request.runId, attempt });
        return { ...result, attempts: attempt };
      } catch (error) {
        lastError = error;
        const retryable = this.isRetryablePredicate(error);
        this.logger?.warn("Retry attempt failed", {
          runId: request.runId,
          attempt,
          retryable,
          error: error instanceof Error ? error.message : String(error),
        });

        if (!retryable) {
          throw error;
        }
        if (attempt >= this.maxAttempts) {
          break;
        }

        const delayMs = this.computeDelayMs(attempt, error);
        await this.sleepFn(delayMs);
      }
    }

    this.logger?.error("Retry attempts exhausted", { runId: request.runId, attempts: attempt });
    throw new RetryExhaustedError(attempt, lastError);
  }

  private computeDelayMs(attempt: number, error: unknown): number {
    if (error instanceof RateLimitError && error.retryAfterSeconds !== undefined) {
      return Math.min(error.retryAfterSeconds * 1000, this.maxDelayMs);
    }

    const exponential = this.initialDelayMs * this.backoffFactor ** (attempt - 1);
    const capped = Math.min(exponential, this.maxDelayMs);
    return this.jitter ? Math.random() * capped : capped;
  }
}
