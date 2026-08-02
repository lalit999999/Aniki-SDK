import { describe, expect, it, vi } from "vitest";
import { Context } from "../core/Context.js";
import { ConfigurationError, RetryExhaustedError, ValidationError } from "../core/errors.js";
import type { ProviderResponse } from "../providers/AIProvider.js";
import { AuthenticationError, ProviderConnectionError, RateLimitError } from "../providers/errors.js";
import type { MiddlewareNext, MiddlewareRequest } from "./Middleware.js";
import { RetryMiddleware } from "./RetryMiddleware.js";

function makeRequest(): MiddlewareRequest {
  return {
    runId: "run-1",
    agentName: "Assistant",
    model: "gpt-5.5",
    providerName: "openai",
    messages: [{ role: "user", content: "hi" }],
    iteration: 1,
    context: new Context({ agent: {}, input: { message: "hi" } }),
  };
}

function makeResponse(overrides: Partial<ProviderResponse> = {}): ProviderResponse {
  return { content: "hello", model: "gpt-5.5", ...overrides };
}

function fakeSleep() {
  const delays: number[] = [];
  const sleep = async (ms: number) => {
    delays.push(ms);
  };
  return { sleep, delays };
}

describe("RetryMiddleware validation", () => {
  it("throws ConfigurationError for a non-positive maxAttempts", () => {
    expect(() => new RetryMiddleware({ maxAttempts: 0 })).toThrow(ConfigurationError);
  });

  it("throws ConfigurationError for a negative backoffFactor", () => {
    expect(() => new RetryMiddleware({ backoffFactor: -1 })).toThrow(ConfigurationError);
  });
});

describe("RetryMiddleware retry predicate", () => {
  it("retries a RateLimitError (retryable ProviderResponseError)", async () => {
    const { sleep } = fakeSleep();
    const middleware = new RetryMiddleware({ maxAttempts: 3, sleep, jitter: false });
    let calls = 0;
    const next: MiddlewareNext = async () => {
      calls += 1;
      if (calls < 2) throw new RateLimitError("slow down", "openai");
      return { response: makeResponse(), fromCache: false, attempts: 1 };
    };

    const result = await middleware.execute(makeRequest(), next);

    expect(calls).toBe(2);
    expect(result.attempts).toBe(2);
  });

  it("does not retry a ValidationError", async () => {
    const { sleep } = fakeSleep();
    const middleware = new RetryMiddleware({ maxAttempts: 3, sleep });
    const failure = new ValidationError("bad input");
    let calls = 0;
    const next: MiddlewareNext = async () => {
      calls += 1;
      throw failure;
    };

    await expect(middleware.execute(makeRequest(), next)).rejects.toBe(failure);
    expect(calls).toBe(1);
  });

  it("does not retry an AuthenticationError", async () => {
    const { sleep } = fakeSleep();
    const middleware = new RetryMiddleware({ maxAttempts: 3, sleep });
    const failure = new AuthenticationError("unauthorized", "openai");
    let calls = 0;
    const next: MiddlewareNext = async () => {
      calls += 1;
      throw failure;
    };

    await expect(middleware.execute(makeRequest(), next)).rejects.toBe(failure);
    expect(calls).toBe(1);
  });

  it("a first-attempt success never sleeps", async () => {
    const { sleep, delays } = fakeSleep();
    const sleepSpy = vi.fn(sleep);
    const middleware = new RetryMiddleware({ maxAttempts: 3, sleep: sleepSpy });
    const next: MiddlewareNext = async () => ({
      response: makeResponse(),
      fromCache: false,
      attempts: 1,
    });

    await middleware.execute(makeRequest(), next);

    expect(sleepSpy).not.toHaveBeenCalled();
    expect(delays).toHaveLength(0);
  });
});

describe("RetryMiddleware backoff", () => {
  it("computes exponential backoff without jitter", async () => {
    const { sleep, delays } = fakeSleep();
    const middleware = new RetryMiddleware({
      maxAttempts: 4,
      initialDelayMs: 100,
      backoffFactor: 2,
      maxDelayMs: 100_000,
      jitter: false,
      sleep,
    });
    const failure = new ProviderConnectionError("network down", "openai");
    let calls = 0;
    const next: MiddlewareNext = async () => {
      calls += 1;
      if (calls < 4) throw failure;
      return { response: makeResponse(), fromCache: false, attempts: 1 };
    };

    await middleware.execute(makeRequest(), next);

    expect(delays).toEqual([100, 200, 400]);
  });

  it("clamps computed backoff to maxDelayMs", async () => {
    const { sleep, delays } = fakeSleep();
    const middleware = new RetryMiddleware({
      maxAttempts: 3,
      initialDelayMs: 1000,
      backoffFactor: 10,
      maxDelayMs: 1500,
      jitter: false,
      sleep,
    });
    const failure = new ProviderConnectionError("network down", "openai");
    const next: MiddlewareNext = async () => {
      throw failure;
    };

    await expect(middleware.execute(makeRequest(), next)).rejects.toBeInstanceOf(
      RetryExhaustedError,
    );

    expect(delays.every((delay) => delay <= 1500)).toBe(true);
  });

  it("prefers RateLimitError.retryAfterSeconds over computed backoff, clamped by maxDelayMs", async () => {
    const { sleep, delays } = fakeSleep();
    const middleware = new RetryMiddleware({
      maxAttempts: 2,
      initialDelayMs: 100,
      maxDelayMs: 5000,
      jitter: false,
      sleep,
    });
    let calls = 0;
    const next: MiddlewareNext = async () => {
      calls += 1;
      if (calls < 2) {
        throw new RateLimitError("slow down", "openai", { retryAfterSeconds: 2 });
      }
      return { response: makeResponse(), fromCache: false, attempts: 1 };
    };

    await middleware.execute(makeRequest(), next);

    expect(delays).toEqual([2000]);
  });

  it("clamps a retryAfterSeconds delay that exceeds maxDelayMs", async () => {
    const { sleep, delays } = fakeSleep();
    const middleware = new RetryMiddleware({
      maxAttempts: 2,
      maxDelayMs: 1000,
      jitter: false,
      sleep,
    });
    let calls = 0;
    const next: MiddlewareNext = async () => {
      calls += 1;
      if (calls < 2) {
        throw new RateLimitError("slow down", "openai", { retryAfterSeconds: 100 });
      }
      return { response: makeResponse(), fromCache: false, attempts: 1 };
    };

    await middleware.execute(makeRequest(), next);

    expect(delays).toEqual([1000]);
  });
});

describe("RetryMiddleware exhaustion", () => {
  it("throws RetryExhaustedError carrying the attempt count and last failure once attempts run out", async () => {
    const { sleep } = fakeSleep();
    const middleware = new RetryMiddleware({ maxAttempts: 3, sleep, jitter: false });
    const failure = new ProviderConnectionError("network down", "openai");
    let calls = 0;
    const next: MiddlewareNext = async () => {
      calls += 1;
      throw failure;
    };

    await expect(middleware.execute(makeRequest(), next)).rejects.toMatchObject({
      attempts: 3,
      cause: failure,
    });
    expect(calls).toBe(3);
  });
});
