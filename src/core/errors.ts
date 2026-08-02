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
 * Abstract base for every error the SDK throws.
 *
 * Never thrown directly — always via a concrete subclass. Subclasses set
 * `this.name` to their own class name and provide a `code` that stays
 * stable even if the class is renamed, so callers can branch on it safely.
 */
export abstract class AnikiError extends Error {
  /** A stable, machine-readable identifier for this error's failure mode. */
  abstract readonly code: string;
  /** The original error or value this error wraps, when it was caused by one. */
  readonly cause?: unknown;

  protected constructor(message: string, cause?: unknown) {
    super(message);
    if (cause !== undefined) {
      this.cause = cause;
    }
    Error.captureStackTrace?.(this, new.target);
  }
}

/** Thrown when SDK configuration input fails validation. */
export class ConfigurationError extends AnikiError {
  readonly code = "CONFIGURATION_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

/** Thrown when Agent, Context, Memory, or Session input fails validation. */
export class ValidationError extends AnikiError {
  readonly code = "VALIDATION_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/** Thrown by Runner when an injected provider fails or throws. */
export class ProviderError extends AnikiError {
  readonly code = "PROVIDER_ERROR";

  constructor(message: string, cause?: unknown) {
    super(message, cause);
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
  readonly code = "TOOL_DUPLICATE";
  /** The name that was already registered. */
  readonly toolName: string;

  constructor(toolName: string) {
    super(`A tool named "${toolName}" is already registered`);
    this.name = "DuplicateToolError";
    this.toolName = toolName;
  }
}

/** Thrown when the LLM (or a caller) requests a tool that is not registered. */
export class ToolNotFoundError extends ToolError {
  readonly code = "TOOL_NOT_FOUND";
  /** The name that could not be resolved. */
  readonly toolName: string;
  /** The id of the tool call that referenced this tool, when known. */
  readonly toolCallId?: string;

  constructor(toolName: string, toolCallId?: string) {
    super(`No tool named "${toolName}" is registered`);
    this.name = "ToolNotFoundError";
    this.toolName = toolName;
    if (toolCallId !== undefined) {
      this.toolCallId = toolCallId;
    }
  }
}

/** Thrown when the LLM's arguments for a tool call fail that tool's input schema. */
export class ToolInputValidationError extends ToolError {
  readonly code = "TOOL_INPUT_VALIDATION";
  /** The tool whose input schema rejected the arguments. */
  readonly toolName: string;
  /** The id of the tool call whose arguments were rejected, when known. */
  readonly toolCallId?: string;
  /** A human-readable description of the validation failures. */
  readonly issues: string;

  constructor(toolName: string, issues: string, toolCallId?: string) {
    super(`Input for tool "${toolName}" failed validation: ${issues}`);
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
  readonly code = "TOOL_OUTPUT_VALIDATION";
  /** The tool whose output schema rejected the return value. */
  readonly toolName: string;
  /** The id of the tool call whose result was rejected, when known. */
  readonly toolCallId?: string;
  /** A human-readable description of the validation failures. */
  readonly issues: string;

  constructor(toolName: string, issues: string, toolCallId?: string) {
    super(`Output of tool "${toolName}" failed validation: ${issues}`);
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
  readonly code = "TOOL_EXECUTION_FAILED";
  /** The tool whose execution threw. */
  readonly toolName: string;
  /** The id of the tool call that failed, when known. */
  readonly toolCallId?: string;

  constructor(toolName: string, cause: unknown, toolCallId?: string) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`Tool "${toolName}" threw during execution: ${reason}`, cause);
    this.name = "ToolExecutionError";
    this.toolName = toolName;
    if (toolCallId !== undefined) {
      this.toolCallId = toolCallId;
    }
  }
}

/** Thrown when a tool's `execute()` does not settle within its configured timeout. */
export class ToolTimeoutError extends ToolError {
  readonly code = "TOOL_TIMEOUT";
  /** The tool that timed out. */
  readonly toolName: string;
  /** The id of the tool call that timed out, when known. */
  readonly toolCallId?: string;
  /** The timeout, in milliseconds, that was exceeded. */
  readonly timeoutMs: number;

  constructor(toolName: string, timeoutMs: number, toolCallId?: string) {
    super(`Tool "${toolName}" exceeded its ${timeoutMs}ms timeout`);
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
  readonly code = "TOOL_MAX_ITERATIONS";
  /** The configured maximum number of tool-calling iterations that was reached. */
  readonly maxIterations: number;

  constructor(maxIterations: number) {
    super(
      `Exceeded the maximum of ${maxIterations} tool-calling iteration(s) without a final answer`,
    );
    this.name = "MaxToolIterationsError";
    this.maxIterations = maxIterations;
  }
}

/** Raw model text carried by an output error is truncated to this many characters. */
const MAX_RAW_SNIPPET_LENGTH = 500;

/** Truncates `raw` to {@link MAX_RAW_SNIPPET_LENGTH} characters so errors never carry unbounded model output. */
function truncateRaw(raw: string): string {
  return raw.length > MAX_RAW_SNIPPET_LENGTH ? `${raw.slice(0, MAX_RAW_SNIPPET_LENGTH)}...` : raw;
}

/**
 * Abstract base for every structured-output error.
 *
 * Never thrown directly — see {@link OutputParseError},
 * {@link OutputValidationError}, and {@link OutputProcessingError}.
 */
export abstract class OutputError extends AnikiError {}

/** Thrown when the model's raw text contains no extractable JSON payload, or that payload fails to parse. */
export class OutputParseError extends OutputError {
  readonly code = "OUTPUT_PARSE_ERROR";
  /** The raw model text that could not be parsed, truncated to {@link MAX_RAW_SNIPPET_LENGTH} characters. */
  readonly raw: string;

  constructor(message: string, raw: string, cause?: unknown) {
    super(message, cause);
    this.name = "OutputParseError";
    this.raw = truncateRaw(raw);
  }
}

/** Thrown when parsed JSON fails the agent's Zod output schema. */
export class OutputValidationError extends OutputError {
  readonly code = "OUTPUT_VALIDATION_ERROR";
  /** A human-readable description of the schema violations, via {@link formatZodIssues}. */
  readonly issues: string;
  /** The raw model text that produced the invalid payload, truncated to {@link MAX_RAW_SNIPPET_LENGTH} characters. */
  readonly raw: string;

  constructor(issues: string, raw: string) {
    super(`Structured output failed schema validation: ${issues}`);
    this.name = "OutputValidationError";
    this.issues = issues;
    this.raw = truncateRaw(raw);
  }
}

/** Thrown when a processor registered on an {@link OutputPipeline} throws. Wraps the original failure in `cause`. */
export class OutputProcessingError extends OutputError {
  readonly code = "OUTPUT_PROCESSING_ERROR";
  /** The name of the processor that threw. */
  readonly processorName: string;

  constructor(processorName: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(`Output processor "${processorName}" threw during processing: ${reason}`, cause);
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
  readonly code: string = "STREAM_ERROR";

  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "StreamError";
  }
}

/** Thrown when a stream's consumer calls `abort()`, or the caller-supplied `AbortSignal` fires. */
export class StreamAbortedError extends StreamError {
  readonly code = "STREAM_ABORTED";
  /** The caller-supplied reason for aborting, when given. */
  readonly reason?: string;

  constructor(reason?: string) {
    super(reason ? `Stream aborted: ${reason}` : "Stream aborted");
    this.name = "StreamAbortedError";
    if (reason !== undefined) {
      this.reason = reason;
    }
  }
}

/** Thrown when a {@link RunStream} is iterated, or its `result` awaited, more than once. */
export class StreamConsumedError extends StreamError {
  readonly code = "STREAM_ALREADY_CONSUMED";

  constructor() {
    super("This stream has already been consumed and cannot be read again");
    this.name = "StreamConsumedError";
  }
}

/** Thrown by {@link Runner.stream} when the agent's provider or configuration cannot support streaming. */
export class StreamingNotSupportedError extends StreamError {
  readonly code = "STREAMING_NOT_SUPPORTED";
  /** The name of the provider that could not stream this request. */
  readonly providerName: string;
  /** Why streaming is unavailable for this run. */
  readonly reason: string;

  constructor(providerName: string, reason: string) {
    super(`Provider "${providerName}" cannot stream this request: ${reason}`);
    this.name = "StreamingNotSupportedError";
    this.providerName = providerName;
    this.reason = reason;
  }
}
