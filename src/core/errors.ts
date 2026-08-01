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
