import { describe, expect, it } from "vitest";
import {
  AnikiError,
  ConfigurationError,
  DuplicateToolError,
  MaxToolIterationsError,
  ProviderError,
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
