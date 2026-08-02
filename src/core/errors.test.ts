import { describe, expect, it } from "vitest";
import { RateLimitError } from "../providers/errors.js";
import {
  AnikiError,
  CacheError,
  ConfigurationError,
  DuplicateToolError,
  isAnikiError,
  isRetryableError,
  MaxToolIterationsError,
  MiddlewareContractError,
  MiddlewareError,
  MiddlewareExecutionError,
  OutputError,
  OutputParseError,
  OutputProcessingError,
  OutputValidationError,
  ProviderError,
  RetryExhaustedError,
  StreamAbortedError,
  StreamConsumedError,
  StreamError,
  StreamingNotSupportedError,
  ToolError,
  ToolExecutionError,
  ToolInputValidationError,
  ToolNotFoundError,
  ToolOutputValidationError,
  ToolTimeoutError,
  ValidationError,
} from "./errors.js";

describe("AnikiError retrofit", () => {
  it("ConfigurationError extends AnikiError, keeps its name and message", () => {
    const error = new ConfigurationError("bad config");

    expect(error).toBeInstanceOf(AnikiError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ConfigurationError");
    expect(error.message).toBe("bad config");
    expect(error.code).toBe("CONFIGURATION_ERROR");
  });

  it("ValidationError extends AnikiError, keeps its name and message", () => {
    const error = new ValidationError("bad input");

    expect(error).toBeInstanceOf(AnikiError);
    expect(error.name).toBe("ValidationError");
    expect(error.message).toBe("bad input");
    expect(error.code).toBe("VALIDATION_ERROR");
  });

  it("ProviderError extends AnikiError, keeps its name and message", () => {
    const error = new ProviderError("provider failed");

    expect(error).toBeInstanceOf(AnikiError);
    expect(error.name).toBe("ProviderError");
    expect(error.message).toBe("provider failed");
    expect(error.code).toBe("PROVIDER_ERROR");
  });
});

describe("ToolError hierarchy", () => {
  it("DuplicateToolError carries the colliding tool name", () => {
    const error = new DuplicateToolError("get_weather");

    expect(error).toBeInstanceOf(ToolError);
    expect(error).toBeInstanceOf(AnikiError);
    expect(error.name).toBe("DuplicateToolError");
    expect(error.code).toBe("TOOL_DUPLICATE");
    expect(error.toolName).toBe("get_weather");
    expect(error.message).toContain("get_weather");
  });

  it("ToolNotFoundError carries the tool name and optional tool call id", () => {
    const error = new ToolNotFoundError("get_weather", "call-1");

    expect(error).toBeInstanceOf(ToolError);
    expect(error.name).toBe("ToolNotFoundError");
    expect(error.code).toBe("TOOL_NOT_FOUND");
    expect(error.toolName).toBe("get_weather");
    expect(error.toolCallId).toBe("call-1");
  });

  it("ToolNotFoundError omits toolCallId when not given", () => {
    const error = new ToolNotFoundError("get_weather");

    expect(error.toolCallId).toBeUndefined();
  });

  it("ToolInputValidationError carries the formatted issues", () => {
    const error = new ToolInputValidationError("get_weather", "city: Required", "call-1");

    expect(error.name).toBe("ToolInputValidationError");
    expect(error.code).toBe("TOOL_INPUT_VALIDATION");
    expect(error.toolName).toBe("get_weather");
    expect(error.toolCallId).toBe("call-1");
    expect(error.issues).toBe("city: Required");
    expect(error.message).toContain("city: Required");
  });

  it("ToolOutputValidationError carries the formatted issues", () => {
    const error = new ToolOutputValidationError("get_weather", "tempC: Required");

    expect(error.name).toBe("ToolOutputValidationError");
    expect(error.code).toBe("TOOL_OUTPUT_VALIDATION");
    expect(error.issues).toBe("tempC: Required");
    expect(error.toolCallId).toBeUndefined();
  });

  it("ToolOutputValidationError carries the tool call id when given", () => {
    const error = new ToolOutputValidationError("get_weather", "tempC: Required", "call-1");

    expect(error.toolCallId).toBe("call-1");
    expect(error.context["toolCallId"]).toBe("call-1");
  });

  it("ToolExecutionError wraps the original thrown value as cause", () => {
    const cause = new Error("network exploded");
    const error = new ToolExecutionError("get_weather", cause, "call-1");

    expect(error.name).toBe("ToolExecutionError");
    expect(error.code).toBe("TOOL_EXECUTION_FAILED");
    expect(error.toolName).toBe("get_weather");
    expect(error.toolCallId).toBe("call-1");
    expect(error.cause).toBe(cause);
    expect(error.message).toContain("network exploded");
  });

  it("ToolExecutionError stringifies a non-Error cause", () => {
    const error = new ToolExecutionError("get_weather", "raw string failure");

    expect(error.cause).toBe("raw string failure");
    expect(error.message).toContain("raw string failure");
  });

  it("ToolTimeoutError carries the exceeded timeout", () => {
    const error = new ToolTimeoutError("get_weather", 5000, "call-1");

    expect(error.name).toBe("ToolTimeoutError");
    expect(error.code).toBe("TOOL_TIMEOUT");
    expect(error.timeoutMs).toBe(5000);
    expect(error.message).toContain("5000ms");
  });

  it("MaxToolIterationsError carries the configured ceiling", () => {
    const error = new MaxToolIterationsError(5);

    expect(error).toBeInstanceOf(ToolError);
    expect(error.name).toBe("MaxToolIterationsError");
    expect(error.code).toBe("TOOL_MAX_ITERATIONS");
    expect(error.maxIterations).toBe(5);
    expect(error.message).toContain("5");
  });
});

describe("OutputError hierarchy", () => {
  it("OutputParseError carries a truncated raw snippet and an optional cause", () => {
    const cause = new SyntaxError("Unexpected token");
    const error = new OutputParseError("No JSON payload found", "not json at all", cause);

    expect(error).toBeInstanceOf(OutputError);
    expect(error).toBeInstanceOf(AnikiError);
    expect(error.name).toBe("OutputParseError");
    expect(error.code).toBe("OUTPUT_PARSE_ERROR");
    expect(error.raw).toBe("not json at all");
    expect(error.cause).toBe(cause);
  });

  it("OutputParseError truncates raw text longer than 500 characters", () => {
    const longRaw = "x".repeat(600);
    const error = new OutputParseError("No JSON payload found", longRaw);

    expect(error.raw).toHaveLength(503);
    expect(error.raw.endsWith("...")).toBe(true);
  });

  it("OutputValidationError carries formatted issues and a truncated raw snippet", () => {
    const error = new OutputValidationError("email: Required", '{"name":"Lalit"}');

    expect(error).toBeInstanceOf(OutputError);
    expect(error.name).toBe("OutputValidationError");
    expect(error.code).toBe("OUTPUT_VALIDATION_ERROR");
    expect(error.issues).toBe("email: Required");
    expect(error.raw).toBe('{"name":"Lalit"}');
    expect(error.message).toContain("email: Required");
  });

  it("OutputProcessingError names the throwing processor and wraps its cause", () => {
    const cause = new Error("boom");
    const error = new OutputProcessingError("redactor", cause);

    expect(error).toBeInstanceOf(OutputError);
    expect(error.name).toBe("OutputProcessingError");
    expect(error.code).toBe("OUTPUT_PROCESSING_ERROR");
    expect(error.processorName).toBe("redactor");
    expect(error.cause).toBe(cause);
    expect(error.message).toContain("redactor");
    expect(error.message).toContain("boom");
  });

  it("OutputProcessingError stringifies a non-Error cause", () => {
    const error = new OutputProcessingError("redactor", "raw string failure");

    expect(error.cause).toBe("raw string failure");
    expect(error.message).toContain("raw string failure");
  });
});

describe("StreamError hierarchy", () => {
  it("StreamError is concrete and carries a wrapped cause", () => {
    const cause = new Error("socket hang up");
    const error = new StreamError("Stream transport failed", cause);

    expect(error).toBeInstanceOf(AnikiError);
    expect(error.name).toBe("StreamError");
    expect(error.code).toBe("STREAM_ERROR");
    expect(error.cause).toBe(cause);
  });

  it("StreamAbortedError carries the abort reason when given", () => {
    const error = new StreamAbortedError("user cancelled");

    expect(error).toBeInstanceOf(StreamError);
    expect(error.name).toBe("StreamAbortedError");
    expect(error.code).toBe("STREAM_ABORTED");
    expect(error.reason).toBe("user cancelled");
    expect(error.message).toContain("user cancelled");
  });

  it("StreamAbortedError omits reason when not given", () => {
    const error = new StreamAbortedError();

    expect(error.reason).toBeUndefined();
    expect(error.message).toBe("Stream aborted");
  });

  it("StreamConsumedError reports the one-shot violation", () => {
    const error = new StreamConsumedError();

    expect(error).toBeInstanceOf(StreamError);
    expect(error.name).toBe("StreamConsumedError");
    expect(error.code).toBe("STREAM_ALREADY_CONSUMED");
  });

  it("StreamingNotSupportedError carries the provider name and reason", () => {
    const error = new StreamingNotSupportedError("openai", "capabilities.streaming is false");

    expect(error).toBeInstanceOf(StreamError);
    expect(error.name).toBe("StreamingNotSupportedError");
    expect(error.code).toBe("STREAMING_NOT_SUPPORTED");
    expect(error.providerName).toBe("openai");
    expect(error.reason).toBe("capabilities.streaming is false");
    expect(error.message).toContain("openai");
  });
});

describe("MiddlewareError hierarchy", () => {
  it("MiddlewareExecutionError names the throwing middleware and wraps its cause", () => {
    const cause = new Error("boom");
    const error = new MiddlewareExecutionError("RetryMiddleware", cause);

    expect(error).toBeInstanceOf(MiddlewareError);
    expect(error).toBeInstanceOf(AnikiError);
    expect(error.name).toBe("MiddlewareExecutionError");
    expect(error.code).toBe("MIDDLEWARE_EXECUTION_FAILED");
    expect(error.middlewareName).toBe("RetryMiddleware");
    expect(error.cause).toBe(cause);
    expect(error.message).toContain("RetryMiddleware");
    expect(error.message).toContain("boom");
  });

  it("MiddlewareExecutionError stringifies a non-Error cause", () => {
    const error = new MiddlewareExecutionError("RetryMiddleware", "raw string failure");

    expect(error.cause).toBe("raw string failure");
    expect(error.message).toContain("raw string failure");
  });

  it("MiddlewareContractError names the offending middleware", () => {
    const error = new MiddlewareContractError("CacheMiddleware", "called next() twice");

    expect(error).toBeInstanceOf(MiddlewareError);
    expect(error.name).toBe("MiddlewareContractError");
    expect(error.code).toBe("MIDDLEWARE_CONTRACT_VIOLATION");
    expect(error.middlewareName).toBe("CacheMiddleware");
    expect(error.message).toContain("CacheMiddleware");
    expect(error.message).toContain("called next() twice");
  });

  it("RetryExhaustedError carries the attempt count and wraps the last failure", () => {
    const cause = new Error("rate limited");
    const error = new RetryExhaustedError(3, cause);

    expect(error).toBeInstanceOf(MiddlewareError);
    expect(error.name).toBe("RetryExhaustedError");
    expect(error.code).toBe("RETRY_EXHAUSTED");
    expect(error.attempts).toBe(3);
    expect(error.cause).toBe(cause);
    expect(error.message).toContain("3");
    expect(error.message).toContain("rate limited");
  });

  it("RetryExhaustedError stringifies a non-Error cause", () => {
    const error = new RetryExhaustedError(3, "raw string failure");

    expect(error.cause).toBe("raw string failure");
    expect(error.message).toContain("raw string failure");
  });

  it("CacheError carries the failing operation and wraps its cause", () => {
    const cause = new Error("disk full");
    const error = new CacheError("set", cause);

    expect(error).toBeInstanceOf(MiddlewareError);
    expect(error.name).toBe("CacheError");
    expect(error.code).toBe("CACHE_ERROR");
    expect(error.operation).toBe("set");
    expect(error.cause).toBe(cause);
    expect(error.message).toContain("set");
    expect(error.message).toContain("disk full");
  });

  it("CacheError stringifies a non-Error cause", () => {
    const error = new CacheError("get", "raw string failure");

    expect(error.cause).toBe("raw string failure");
    expect(error.message).toContain("raw string failure");
  });
});

describe("toJSON", () => {
  const cause = new Error("boom");

  const cases: readonly (readonly [string, AnikiError])[] = [
    ["ConfigurationError", new ConfigurationError("bad config")],
    ["ValidationError", new ValidationError("bad input")],
    ["ProviderError", new ProviderError("provider failed", cause)],
    ["DuplicateToolError", new DuplicateToolError("get_weather")],
    ["ToolNotFoundError", new ToolNotFoundError("get_weather", "call-1")],
    ["ToolInputValidationError", new ToolInputValidationError("get_weather", "city: Required")],
    ["ToolOutputValidationError", new ToolOutputValidationError("get_weather", "tempC: Required")],
    ["ToolExecutionError", new ToolExecutionError("get_weather", cause)],
    ["ToolTimeoutError", new ToolTimeoutError("get_weather", 5000)],
    ["MaxToolIterationsError", new MaxToolIterationsError(5)],
    ["OutputParseError", new OutputParseError("no json", "not json", cause)],
    ["OutputValidationError", new OutputValidationError("email: Required", '{"a":1}')],
    ["OutputProcessingError", new OutputProcessingError("redactor", cause)],
    ["StreamError", new StreamError("transport failed", cause)],
    ["StreamAbortedError", new StreamAbortedError("user cancelled")],
    ["StreamConsumedError", new StreamConsumedError()],
    ["StreamingNotSupportedError", new StreamingNotSupportedError("openai", "no streaming")],
    ["MiddlewareExecutionError", new MiddlewareExecutionError("RetryMiddleware", cause)],
    ["MiddlewareContractError", new MiddlewareContractError("CacheMiddleware", "called twice")],
    ["RetryExhaustedError", new RetryExhaustedError(3, cause)],
    ["CacheError", new CacheError("set", cause)],
  ];

  it.each(cases)("%s round-trips through toJSON()", (_label, error) => {
    const json = error.toJSON();

    expect(json.name).toBe(error.name);
    expect(json.code).toBe(error.code);
    expect(json.message).toBe(error.message);
    expect(json.context).toEqual(error.context);
    expect(json).not.toHaveProperty("stack");
  });

  it("flattens an Error cause to { name, message }, never a stack", () => {
    const error = new ProviderError("failed", new TypeError("nope"));

    const json = error.toJSON();

    expect(json.cause).toEqual({ name: "TypeError", message: "nope" });
    expect(json.cause).not.toHaveProperty("stack");
  });

  it("flattens a non-Error cause to a synthetic name and stringified message", () => {
    const error = new ToolExecutionError("get_weather", "raw string failure");

    const json = error.toJSON();

    expect(json.cause).toEqual({ name: "UnknownCause", message: "raw string failure" });
  });

  it("omits cause entirely when the error was not given one", () => {
    const error = new ConfigurationError("bad config");

    const json = error.toJSON();

    expect(json.cause).toBeUndefined();
    expect(json).not.toHaveProperty("cause");
  });

  it("redacts sensitive context fields, including nested ones", () => {
    const error = new ProviderError("failed", undefined, {
      apiKey: "sk-live-123",
      nested: { authorization: "Bearer xyz", safe: "ok" },
    });

    const json = error.toJSON();

    expect(json.context["apiKey"]).toBe("[redacted]");
    expect(json.context["nested"]).toEqual({ authorization: "[redacted]", safe: "ok" });
  });
});

describe("context", () => {
  it("defaults to a frozen empty object when no context is given", () => {
    const error = new ConfigurationError("bad config");

    expect(error.context).toEqual({});
    expect(Object.isFrozen(error.context)).toBe(true);
  });

  it("carries the fields a subclass populates", () => {
    const error = new ToolTimeoutError("get_weather", 5000, "call-1");

    expect(error.context).toEqual({ toolName: "get_weather", toolCallId: "call-1", timeoutMs: 5000 });
  });
});

describe("prototype chain", () => {
  it("survives being caught as a plain Error", () => {
    try {
      throw new ToolNotFoundError("get_weather");
    } catch (error) {
      expect(error).toBeInstanceOf(ToolNotFoundError);
      expect(error).toBeInstanceOf(ToolError);
      expect(error).toBeInstanceOf(AnikiError);
      expect(error).toBeInstanceOf(Error);
    }
  });
});

describe("isAnikiError", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a plain Error", new Error("plain")],
    ["a string", "not an error"],
    ["a number", 42],
  ])("returns false for %s", (_label, value) => {
    expect(isAnikiError(value)).toBe(false);
    expect(AnikiError.isAnikiError(value)).toBe(false);
  });

  it.each(
    [
      new ConfigurationError("x"),
      new ValidationError("x"),
      new ProviderError("x"),
      new DuplicateToolError("x"),
      new ToolNotFoundError("x"),
      new ToolInputValidationError("x", "y"),
      new ToolOutputValidationError("x", "y"),
      new ToolExecutionError("x", new Error("y")),
      new ToolTimeoutError("x", 1),
      new MaxToolIterationsError(1),
      new OutputParseError("x", "y"),
      new OutputValidationError("x", "y"),
      new OutputProcessingError("x", new Error("y")),
      new StreamError("x"),
      new StreamAbortedError(),
      new StreamConsumedError(),
      new StreamingNotSupportedError("x", "y"),
      new MiddlewareExecutionError("x", new Error("y")),
      new MiddlewareContractError("x", "y"),
      new RetryExhaustedError(1, new Error("y")),
      new CacheError("set", new Error("y")),
    ] as const,
  )("returns true for $name", (error) => {
    expect(isAnikiError(error)).toBe(true);
    expect(AnikiError.isAnikiError(error)).toBe(true);
  });
});

describe("isRetryableError", () => {
  it("returns true for a retryable ProviderResponseError (e.g. RateLimitError)", () => {
    const error = new RateLimitError("rate limited", "openai");

    expect(isRetryableError(error)).toBe(true);
  });

  it("returns false for a non-retryable AnikiError", () => {
    expect(isRetryableError(new ConfigurationError("bad config"))).toBe(false);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a plain Error", new Error("plain")],
  ])("returns false for %s", (_label, value) => {
    expect(isRetryableError(value)).toBe(false);
  });
});
