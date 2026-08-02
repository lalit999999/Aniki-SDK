import { describe, expect, it, vi } from "vitest";
import { Context } from "../core/Context.js";
import type { ILogger, LogFields } from "../logger/Logger.js";
import type { ProviderResponse } from "../providers/AIProvider.js";
import type { MiddlewareNext, MiddlewareRequest } from "./Middleware.js";
import { LoggingMiddleware } from "./LoggerMiddleware.js";

function fakeLogger(): ILogger & { calls: { level: string; message: string; fields?: LogFields }[] } {
  const calls: { level: string; message: string; fields?: LogFields }[] = [];
  const record = (level: string, message: string, fields?: LogFields) =>
    calls.push(fields !== undefined ? { level, message, fields } : { level, message });
  return {
    calls,
    debug: (message, fields) => record("debug", message, fields),
    info: (message, fields) => record("info", message, fields),
    warn: (message, fields) => record("warn", message, fields),
    error: (message, fields) => record("error", message, fields),
    child(): ILogger {
      return this;
    },
  };
}

function makeRequest(overrides: Partial<MiddlewareRequest> = {}): MiddlewareRequest {
  return {
    runId: "run-1",
    agentName: "Assistant",
    model: "gpt-5.5",
    providerName: "openai",
    messages: [
      { role: "system", content: "be helpful" },
      { role: "user", content: "secret message body" },
    ],
    iteration: 1,
    context: new Context({ agent: {}, input: { message: "hi" } }),
    ...overrides,
  };
}

function makeResponse(overrides: Partial<ProviderResponse> = {}): ProviderResponse {
  return { content: "hello", model: "gpt-5.5", finishReason: "stop", ...overrides };
}

describe("LoggingMiddleware happy path", () => {
  it("logs LLM start and end at info by default", async () => {
    const logger = fakeLogger();
    const middleware = new LoggingMiddleware({ logger });
    const next: MiddlewareNext = async () => ({
      response: makeResponse(),
      fromCache: false,
      attempts: 1,
    });

    await middleware.execute(makeRequest(), next);

    expect(logger.calls).toHaveLength(2);
    expect(logger.calls[0]).toMatchObject({ level: "info", message: "LLM request started" });
    expect(logger.calls[0]?.fields).toMatchObject({
      runId: "run-1",
      agentName: "Assistant",
      model: "gpt-5.5",
      providerName: "openai",
      iteration: 1,
      messageCount: 2,
    });
    expect(logger.calls[1]).toMatchObject({ level: "info", message: "LLM request completed" });
    expect(logger.calls[1]?.fields).toMatchObject({
      fromCache: false,
      attempts: 1,
      finishReason: "stop",
    });
    expect(typeof logger.calls[1]?.fields?.durationMs).toBe("number");
  });

  it("does not include message content by default", async () => {
    const logger = fakeLogger();
    const middleware = new LoggingMiddleware({ logger });
    const next: MiddlewareNext = async () => ({
      response: makeResponse(),
      fromCache: false,
      attempts: 1,
    });

    await middleware.execute(makeRequest(), next);

    expect(logger.calls[0]?.fields?.messages).toBeUndefined();
    expect(logger.calls[1]?.fields?.content).toBeUndefined();
  });

  it("includes message and response content when logContent is true", async () => {
    const logger = fakeLogger();
    const middleware = new LoggingMiddleware({ logger, logContent: true });
    const next: MiddlewareNext = async () => ({
      response: makeResponse({ content: "the reply" }),
      fromCache: false,
      attempts: 1,
    });

    await middleware.execute(makeRequest(), next);

    expect(logger.calls[0]?.fields?.messages).toBeDefined();
    expect(logger.calls[1]?.fields?.content).toBe("the reply");
  });

  it("writes at the configured level instead of info", async () => {
    const logger = fakeLogger();
    const middleware = new LoggingMiddleware({ logger, level: "debug" });
    const next: MiddlewareNext = async () => ({
      response: makeResponse(),
      fromCache: false,
      attempts: 1,
    });

    await middleware.execute(makeRequest(), next);

    expect(logger.calls.every((call) => call.level === "debug")).toBe(true);
  });

  it("writes nothing at level silent", async () => {
    const logger = fakeLogger();
    const middleware = new LoggingMiddleware({ logger, level: "silent" });
    const next: MiddlewareNext = async () => ({
      response: makeResponse(),
      fromCache: false,
      attempts: 1,
    });

    await middleware.execute(makeRequest(), next);

    expect(logger.calls).toHaveLength(0);
  });
});

describe("LoggingMiddleware failure path", () => {
  it("logs the failure at error level and rethrows without swallowing", async () => {
    const logger = fakeLogger();
    const middleware = new LoggingMiddleware({ logger });
    const failure = new Error("provider exploded");
    const next: MiddlewareNext = vi.fn(async () => {
      throw failure;
    });

    await expect(middleware.execute(makeRequest(), next)).rejects.toBe(failure);

    const errorCall = logger.calls.find((call) => call.level === "error");
    expect(errorCall).toBeDefined();
    expect(errorCall?.message).toBe("LLM request failed");
    expect(errorCall?.fields?.error).toBe("provider exploded");
  });

  it("still logs failure at error level even when the configured level is silent", async () => {
    const logger = fakeLogger();
    const middleware = new LoggingMiddleware({ logger, level: "silent" });
    const failure = new Error("boom");
    const next: MiddlewareNext = async () => {
      throw failure;
    };

    await expect(middleware.execute(makeRequest(), next)).rejects.toBe(failure);

    expect(logger.calls).toHaveLength(1);
    expect(logger.calls[0]?.level).toBe("error");
  });
});
