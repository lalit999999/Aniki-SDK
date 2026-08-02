import type { ProviderResponseError } from "../providers/errors.js";
import { redactFields } from "../logger/Logger.js";
import { truncate } from "../utils/string.js";

/**
 * The SDK-wide error taxonomy.
 *
 * Every error the public API can throw ultimately extends {@link AnikiError},
 * which carries a machine-readable `code` and an optional `cause` for wrapped
 * failures. This lets callers do a single `instanceof AnikiError` check to
 * catch anything the SDK raises, while still narrowing to a specific
 * subclass (e.g. {@link ToolNotFoundError}) when they need the extra
 * context it carries.
 */

/**
 * Every stable `code` literal in the core error taxonomy.
 *
 * Provider-layer errors (see `providers/errors.ts`) all share
 * `"PROVIDER_ERROR"`, already included below via {@link ProviderError}.
 * Useful for exhaustive `switch (error.code)` handling.
 */
export type ErrorCode =
  | "CONFIGURATION_ERROR"
  | "VALIDATION_ERROR"
  | "PROVIDER_ERROR"
  | "TOOL_DUPLICATE"
  | "TOOL_NOT_FOUND"
  | "TOOL_INPUT_VALIDATION"
  | "TOOL_OUTPUT_VALIDATION"
  | "TOOL_EXECUTION_FAILED"
  | "TOOL_TIMEOUT"
  | "TOOL_MAX_ITERATIONS"
  | "OUTPUT_PARSE_ERROR"
  | "OUTPUT_VALIDATION_ERROR"
  | "OUTPUT_PROCESSING_ERROR"
  | "STREAM_ERROR"
  | "STREAM_ABORTED"
  | "STREAM_ALREADY_CONSUMED"
  | "STREAMING_NOT_SUPPORTED"
  | "MIDDLEWARE_EXECUTION_FAILED"
  | "MIDDLEWARE_CONTRACT_VIOLATION"
  | "RETRY_EXHAUSTED"
  | "CACHE_ERROR";

/** The shape {@link AnikiError.toJSON} returns — safe to pass directly to a structured log sink. */
export interface AnikiErrorJson {
  /** This error's concrete class name, e.g. `"ToolNotFoundError"`. */
  readonly name: string;
  /** This error's stable, machine-readable code. */
  readonly code: string;
  /** This error's message. */
  readonly message: string;
  /** Structured context describing the failure, with sensitive fields redacted. */
  readonly context: Readonly<Record<string, unknown>>;
  /** The wrapped cause, flattened to just its name and message when one is present. */
  readonly cause?: { readonly name: string; readonly message: string };
}

/** Flattens an unknown `cause` to `{ name, message }`, never a stack or raw object. */
function causeToJson(cause: unknown): { name: string; message: string } {
  if (cause instanceof Error) {
    return { name: cause.name, message: cause.message };
  }
  return { name: "UnknownCause", message: String(cause) };
}

/**
 * Abstract base for every error the SDK throws.
 *
 * Never thrown directly — always via a concrete subclass. Subclasses set
 * `this.name` to their own class name and provide a `code` that stays
 * stable even if the class is renamed, so callers can branch on it safely.
 */
export abstract class AnikiError extends Error {
  /** A stable, machine-readable identifier for this error's failure mode. */
  abstract readonly code: ErrorCode;
  /** The original error or value this error wraps, when it was caused by one. */
  readonly cause?: unknown;
  /** Structured fields describing this failure (e.g. `toolName`, `attempts`), for logging without an `instanceof` chain. */
  readonly context: Readonly<Record<string, unknown>>;

  protected constructor(
    message: string,
    cause?: unknown,
    context?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    if (cause !== undefined) {
      this.cause = cause;
    }
    this.context = Object.freeze({ ...context });
    // Restores the prototype chain so `instanceof` works after downlevel
    // compilation to ES5-style class transpilation targets.
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace?.(this, new.target);
  }

  /**
   * Serializes this error to a plain, structured-logging-safe object.
   *
   * `context` is passed through {@link redactFields} so secrets (API keys,
   * tokens, ...) never reach a log sink; `cause` is flattened to its name
   * and message only.
   *
   * @returns A JSON-safe snapshot of this error.
   * @example
   * ```ts
   * try {
   *   await runner.run(agent, { message: "hi" });
   * } catch (error) {
   *   if (isAnikiError(error)) logger.error("run failed", error.toJSON());
   * }
   * ```
   */
  toJSON(): AnikiErrorJson {
    const json: AnikiErrorJson = {
      name: this.name,
      code: this.code,
      message: this.message,
      context: redactFields(this.context),
    };
    return this.cause === undefined ? json : { ...json, cause: causeToJson(this.cause) };
  }

  /**
   * Narrows `value` to {@link AnikiError}.
   *
   * @param value - Any value, typically a `catch` binding.
   * @returns `true` when `value` is an instance of {@link AnikiError} or a subclass.
   * @example
   * ```ts
   * if (AnikiError.isAnikiError(error)) console.log(error.code);
   * ```
   */
  static isAnikiError(value: unknown): value is AnikiError {
    return value instanceof AnikiError;
  }
}

/**
 * Standalone form of {@link AnikiError.isAnikiError}, for callers who prefer
 * a free function over a static method reference.
 *
 * @param value - Any value, typically a `catch` binding.
 * @returns `true` when `value` is an instance of {@link AnikiError} or a subclass.
 */
export function isAnikiError(value: unknown): value is AnikiError {
  return AnikiError.isAnikiError(value);
}

/**
 * Narrows `value` to a {@link ProviderResponseError} (or subclass) whose
 * `retryable` flag is `true` — i.e. a provider failure a caller could
 * plausibly resolve by retrying the same request.
 *
 * @param value - Any value, typically a `catch` binding.
 * @returns `true` when `value` is a retryable provider error.
 * @example
 * ```ts
 * if (isRetryableError(error)) await retry();
 * ```
 */
export function isRetryableError(value: unknown): value is ProviderResponseError {
  if (!isAnikiError(value)) {
    return false;
  }
  // Duck-typed rather than `instanceof ProviderResponseError` so this file
  // never needs a runtime import of `providers/errors.ts`, which would
  // create a circular module dependency (that file already imports
  // `ProviderError` from here).
  const retryable = (value as AnikiError & { retryable?: unknown }).retryable;
  return retryable === true;
}

/** Thrown when SDK configuration input fails validation. */
export class ConfigurationError extends AnikiError {
  readonly code: ErrorCode = "CONFIGURATION_ERROR";

  constructor(message: string, context?: Readonly<Record<string, unknown>>) {
    super(message, undefined, context);
    this.name = "ConfigurationError";
  }
}

/** Thrown when Agent, Context, Memory, or Session input fails validation. */
export class ValidationError extends AnikiError {
  readonly code: ErrorCode = "VALIDATION_ERROR";

  constructor(message: string, context?: Readonly<Record<string, unknown>>) {
    super(message, undefined, context);
    this.name = "ValidationError";
  }
}

/** Thrown by Runner when an injected provider fails or throws. */
export class ProviderError extends AnikiError {
  readonly code: ErrorCode = "PROVIDER_ERROR";

  constructor(message: string, cause?: unknown, context?: Readonly<Record<string, unknown>>) {
    super(message, cause, context);
    this.name = "ProviderError";
  }
}

/**
 * Abstract base for every tool-system error.
 *
 * Never thrown directly. Each subclass carries only the context fields a
 * caller actually needs to react to (or log) that specific failure — see the
 * individual subclasses below.
 */
export abstract class ToolError extends AnikiError {}

/** Thrown by {@link ToolRegistry.register} when a tool name is already registered. */
export class DuplicateToolError extends ToolError {
  readonly code: ErrorCode = "TOOL_DUPLICATE";
  /** The name that was already registered. */
  readonly toolName: string;

  constructor(toolName: string) {
    super(`A tool named "${toolName}" is already registered`, undefined, { toolName });
    this.name = "DuplicateToolError";
    this.toolName = toolName;
  }
}

/** Thrown when the LLM (or a caller) requests a tool that is not registered. */
export class ToolNotFoundError extends ToolError {
  readonly code: ErrorCode = "TOOL_NOT_FOUND";
  /** The name that could not be resolved. */
  readonly toolName: string;
  /** The id of the tool call that referenced this tool, when known. */
  readonly toolCallId?: string;

  constructor(toolName: string, toolCallId?: string) {
    super(`No tool named "${toolName}" is registered`, undefined, { toolName, toolCallId });
    this.name = "ToolNotFoundError";
    this.toolName = toolName;
    if (toolCallId !== undefined) {
      this.toolCallId = toolCallId;
    }
  }
}

/** Thrown when the LLM's arguments for a tool call fail that tool's input schema. */
export class ToolInputValidationError extends ToolError {
  readonly code: ErrorCode = "TOOL_INPUT_VALIDATION";
  /** The tool whose input schema rejected the arguments. */
  readonly toolName: string;
  /** The id of the tool call whose arguments were rejected, when known. */
  readonly toolCallId?: string;
  /** A human-readable description of the validation failures. */
  readonly issues: string;

  constructor(toolName: string, issues: string, toolCallId?: string) {
    super(`Input for tool "${toolName}" failed validation: ${issues}`, undefined, {
      toolName,
      toolCallId,
      issues,
    });
    this.name = "ToolInputValidationError";
    this.toolName = toolName;
    this.issues = issues;
    if (toolCallId !== undefined) {
      this.toolCallId = toolCallId;
    }
  }
}

/** Thrown when a tool's `execute()` return value fails that tool's output schema. */
export class ToolOutputValidationError extends ToolError {
  readonly code: ErrorCode = "TOOL_OUTPUT_VALIDATION";
  /** The tool whose output schema rejected the return value. */
  readonly toolName: string;
  /** The id of the tool call whose result was rejected, when known. */
  readonly toolCallId?: string;
  /** A human-readable description of the validation failures. */
  readonly issues: string;

  constructor(toolName: string, issues: string, toolCallId?: string) {
    super(`Output of tool "${toolName}" failed validation: ${issues}`, undefined, {
      toolName,
      toolCallId,
      issues,
    });
    this.name = "ToolOutputValidationError";
    this.toolName = toolName;
    this.issues = issues;
    if (toolCallId !== undefined) {
      this.toolCallId = toolCallId;
    }
  }
}

/** Thrown when a tool's `execute()` throws. Wraps the original failure in `cause`. */
export class ToolExecutionError extends ToolError {
  readonly code: ErrorCode = "TOOL_EXECUTION_FAILED";
  /** The tool whose execution threw. */
  readonly toolName: string;
  /** The id of the tool call that failed, when known. */
  readonly toolCallId?: string;

  constructor(toolName: string, cause: unknown, toolCallId?: string) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`Tool "${toolName}" threw during execution: ${reason}`, cause, {
      toolName,
      toolCallId,
    });
    this.name = "ToolExecutionError";
    this.toolName = toolName;
    if (toolCallId !== undefined) {
      this.toolCallId = toolCallId;
    }
  }
}

/** Thrown when a tool's `execute()` does not settle within its configured timeout. */
export class ToolTimeoutError extends ToolError {
  readonly code: ErrorCode = "TOOL_TIMEOUT";
  /** The tool that timed out. */
  readonly toolName: string;
  /** The id of the tool call that timed out, when known. */
  readonly toolCallId?: string;
  /** The timeout, in milliseconds, that was exceeded. */
  readonly timeoutMs: number;

  constructor(toolName: string, timeoutMs: number, toolCallId?: string) {
    super(`Tool "${toolName}" exceeded its ${timeoutMs}ms timeout`, undefined, {
      toolName,
      toolCallId,
      timeoutMs,
    });
    this.name = "ToolTimeoutError";
    this.toolName = toolName;
    this.timeoutMs = timeoutMs;
    if (toolCallId !== undefined) {
      this.toolCallId = toolCallId;
    }
  }
}

/** Thrown by {@link Runner} when a run exhausts its tool-calling iteration ceiling without a final answer. */
export class MaxToolIterationsError extends ToolError {
  readonly code: ErrorCode = "TOOL_MAX_ITERATIONS";
  /** The configured maximum number of tool-calling iterations that was reached. */
  readonly maxIterations: number;

  constructor(maxIterations: number) {
    super(
      `Exceeded the maximum of ${maxIterations} tool-calling iteration(s) without a final answer`,
      undefined,
      { maxIterations },
    );
    this.name = "MaxToolIterationsError";
    this.maxIterations = maxIterations;
  }
}

/** Raw model text carried by an output error is truncated to this many characters. */
const MAX_RAW_SNIPPET_LENGTH = 500;

/**
 * Abstract base for every structured-output error.
 *
 * Never thrown directly — see {@link OutputParseError},
 * {@link OutputValidationError}, and {@link OutputProcessingError}.
 */
export abstract class OutputError extends AnikiError {}

/** Thrown when the model's raw text contains no extractable JSON payload, or that payload fails to parse. */
export class OutputParseError extends OutputError {
  readonly code: ErrorCode = "OUTPUT_PARSE_ERROR";
  /** The raw model text that could not be parsed, truncated to {@link MAX_RAW_SNIPPET_LENGTH} characters. */
  readonly raw: string;

  constructor(message: string, raw: string, cause?: unknown) {
    const truncated = truncate(raw, MAX_RAW_SNIPPET_LENGTH);
    super(message, cause, { raw: truncated });
    this.name = "OutputParseError";
    this.raw = truncated;
  }
}

/** Thrown when parsed JSON fails the agent's Zod output schema. */
export class OutputValidationError extends OutputError {
  readonly code: ErrorCode = "OUTPUT_VALIDATION_ERROR";
  /** A human-readable description of the schema violations, via {@link formatZodIssues}. */
  readonly issues: string;
  /** The raw model text that produced the invalid payload, truncated to {@link MAX_RAW_SNIPPET_LENGTH} characters. */
  readonly raw: string;

  constructor(issues: string, raw: string) {
    const truncated = truncate(raw, MAX_RAW_SNIPPET_LENGTH);
    super(`Structured output failed schema validation: ${issues}`, undefined, {
      issues,
      raw: truncated,
    });
    this.name = "OutputValidationError";
    this.issues = issues;
    this.raw = truncated;
  }
}

/** Thrown when a processor registered on an {@link OutputPipeline} throws. Wraps the original failure in `cause`. */
export class OutputProcessingError extends OutputError {
  readonly code: ErrorCode = "OUTPUT_PROCESSING_ERROR";
  /** The name of the processor that threw. */
  readonly processorName: string;

  constructor(processorName: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`Output processor "${processorName}" threw during processing: ${reason}`, cause, {
      processorName,
    });
    this.name = "OutputProcessingError";
    this.processorName = processorName;
  }
}

/**
 * Thrown for a streaming transport or iteration failure.
 *
 * Concrete on its own — a foreign throw surfaced while consuming a stream is
 * wrapped directly as `StreamError` — and also the base for the more
 * specific {@link StreamAbortedError}, {@link StreamConsumedError}, and
 * {@link StreamingNotSupportedError}. `code` is typed as `string` (rather
 * than inferred as the `"STREAM_ERROR"` literal) precisely so those
 * subclasses can narrow it to their own stable identifier.
 */
export class StreamError extends AnikiError {
  readonly code: ErrorCode = "STREAM_ERROR";

  constructor(message: string, cause?: unknown, context?: Readonly<Record<string, unknown>>) {
    super(message, cause, context);
    this.name = "StreamError";
  }
}

/** Thrown when a stream's consumer calls `abort()`, or the caller-supplied `AbortSignal` fires. */
export class StreamAbortedError extends StreamError {
  readonly code: ErrorCode = "STREAM_ABORTED";
  /** The caller-supplied reason for aborting, when given. */
  readonly reason?: string;

  constructor(reason?: string) {
    super(reason ? `Stream aborted: ${reason}` : "Stream aborted", undefined, { reason });
    this.name = "StreamAbortedError";
    if (reason !== undefined) {
      this.reason = reason;
    }
  }
}

/** Thrown when a {@link RunStream} is iterated, or its `result` awaited, more than once. */
export class StreamConsumedError extends StreamError {
  readonly code: ErrorCode = "STREAM_ALREADY_CONSUMED";

  constructor() {
    super("This stream has already been consumed and cannot be read again");
    this.name = "StreamConsumedError";
  }
}

/** Thrown by {@link Runner.stream} when the agent's provider or configuration cannot support streaming. */
export class StreamingNotSupportedError extends StreamError {
  readonly code: ErrorCode = "STREAMING_NOT_SUPPORTED";
  /** The name of the provider that could not stream this request. */
  readonly providerName: string;
  /** Why streaming is unavailable for this run. */
  readonly reason: string;

  constructor(providerName: string, reason: string) {
    super(`Provider "${providerName}" cannot stream this request: ${reason}`, undefined, {
      providerName,
      reason,
    });
    this.name = "StreamingNotSupportedError";
    this.providerName = providerName;
    this.reason = reason;
  }
}

/**
 * Abstract base for every middleware-system error.
 *
 * Never thrown directly — see {@link MiddlewareExecutionError},
 * {@link MiddlewareContractError}, {@link RetryExhaustedError}, and
 * {@link CacheError}.
 */
export abstract class MiddlewareError extends AnikiError {}

/** Thrown by {@link MiddlewarePipeline} when a middleware's `execute()` throws. Wraps the original failure in `cause`. */
export class MiddlewareExecutionError extends MiddlewareError {
  readonly code: ErrorCode = "MIDDLEWARE_EXECUTION_FAILED";
  /** The name of the middleware whose `execute()` threw. */
  readonly middlewareName: string;

  constructor(middlewareName: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`Middleware "${middlewareName}" threw during execution: ${reason}`, cause, {
      middlewareName,
    });
    this.name = "MiddlewareExecutionError";
    this.middlewareName = middlewareName;
  }
}

/** Thrown by {@link MiddlewarePipeline} when a middleware calls `next()` more than once, or resolves without returning a response. */
export class MiddlewareContractError extends MiddlewareError {
  readonly code: ErrorCode = "MIDDLEWARE_CONTRACT_VIOLATION";
  /** The name of the middleware that violated the pipeline contract. */
  readonly middlewareName: string;

  constructor(middlewareName: string, message: string) {
    super(`Middleware "${middlewareName}" violated the pipeline contract: ${message}`, undefined, {
      middlewareName,
    });
    this.name = "MiddlewareContractError";
    this.middlewareName = middlewareName;
  }
}

/** Thrown by {@link RetryMiddleware} when every configured attempt has been consumed without success. Wraps the last failure in `cause`. */
export class RetryExhaustedError extends MiddlewareError {
  readonly code: ErrorCode = "RETRY_EXHAUSTED";
  /** The number of attempts made before giving up. */
  readonly attempts: number;

  constructor(attempts: number, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`Exhausted ${attempts} retry attempt(s); last failure: ${reason}`, cause, { attempts });
    this.name = "RetryExhaustedError";
    this.attempts = attempts;
  }
}

/** Thrown by {@link CacheMiddleware} when its underlying {@link ICacheStore} throws during a read or write. Wraps the original failure in `cause`. */
export class CacheError extends MiddlewareError {
  readonly code: ErrorCode = "CACHE_ERROR";
  /** Which cache operation failed. */
  readonly operation: "get" | "set" | "delete";

  constructor(operation: "get" | "set" | "delete", cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`Cache "${operation}" operation failed: ${reason}`, cause, { operation });
    this.name = "CacheError";
    this.operation = operation;
  }
}
