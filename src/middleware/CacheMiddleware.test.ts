import { describe, expect, it, vi } from "vitest";
import { Context } from "../core/Context.js";
import type { ILogger, LogFields } from "../logger/Logger.js";
import type { ProviderResponse } from "../providers/AIProvider.js";
import type { MiddlewareNext, MiddlewareRequest } from "./Middleware.js";
import type { ICacheStore } from "./CacheMiddleware.js";
import { CacheMiddleware, InMemoryCacheStore } from "./CacheMiddleware.js";

function makeRequest(overrides: Partial<MiddlewareRequest> = {}): MiddlewareRequest {
  return {
    runId: "run-1",
    agentName: "Assistant",
    model: "gpt-5.5",
    providerName: "openai",
    messages: [{ role: "user", content: "hi" }],
    iteration: 1,
    context: new Context({ agent: {}, input: { message: "hi" } }),
    ...overrides,
  };
}

function makeResponse(overrides: Partial<ProviderResponse> = {}): ProviderResponse {
  return { content: "hello", model: "gpt-5.5", ...overrides };
}

function fakeLogger(): ILogger & { warnings: { message: string; fields?: LogFields }[] } {
  const warnings: { message: string; fields?: LogFields }[] = [];
  return {
    warnings,
    debug: () => {},
    info: () => {},
    warn: (message, fields) =>
      warnings.push(fields !== undefined ? { message, fields } : { message }),
    error: () => {},
    child(): ILogger {
      return this;
    },
  };
}

describe("InMemoryCacheStore", () => {
  it("returns undefined for a missing key", async () => {
    const store = new InMemoryCacheStore();
    expect(await store.get("missing")).toBeUndefined();
  });

  it("returns a stored value before it expires", async () => {
    let now = 1000;
    const store = new InMemoryCacheStore({ now: () => now });
    await store.set("k", "v", 5000);
    now += 4000;
    expect(await store.get("k")).toBe("v");
  });

  it("lazily expires an entry once its TTL has passed", async () => {
    let now = 1000;
    const store = new InMemoryCacheStore({ now: () => now });
    await store.set("k", "v", 1000);
    now += 1001;
    expect(await store.get("k")).toBeUndefined();
  });

  it("delete() removes an entry", async () => {
    const store = new InMemoryCacheStore();
    await store.set("k", "v", 5000);
    await store.delete("k");
    expect(await store.get("k")).toBeUndefined();
  });

  it("clear() removes every entry", async () => {
    const store = new InMemoryCacheStore();
    await store.set("a", "1", 5000);
    await store.set("b", "2", 5000);
    await store.clear();
    expect(await store.get("a")).toBeUndefined();
    expect(await store.get("b")).toBeUndefined();
  });

  it("evicts the least-recently-used entry once maxEntries is exceeded", async () => {
    const store = new InMemoryCacheStore({ maxEntries: 2 });
    await store.set("a", "1", 5000);
    await store.set("b", "2", 5000);
    await store.get("a"); // touch "a" so "b" becomes the least-recently-used
    await store.set("c", "3", 5000);

    expect(await store.get("b")).toBeUndefined();
    expect(await store.get("a")).toBe("1");
    expect(await store.get("c")).toBe("3");
  });
});

describe("CacheMiddleware key generation", () => {
  it("produces identical keys for requests that differ only in object key order", async () => {
    const store = new InMemoryCacheStore();
    const middleware = new CacheMiddleware({ store });
    let calls = 0;
    const next: MiddlewareNext = async () => {
      calls += 1;
      return { response: makeResponse(), fromCache: false, attempts: 1 };
    };

    const requestA: MiddlewareRequest = {
      runId: "r",
      agentName: "A",
      model: "m",
      providerName: "p",
      messages: [{ role: "user", content: "hi" }],
      iteration: 1,
      context: new Context({ agent: {}, input: { message: "hi" } }),
    };
    // Same content, but constructed with different key insertion order.
    const requestB: MiddlewareRequest = {
      providerName: "p",
      model: "m",
      runId: "r",
      iteration: 1,
      agentName: "A",
      messages: [{ role: "user", content: "hi" }],
      context: requestA.context,
    };

    await middleware.execute(requestA, next);
    await middleware.execute(requestB, next);

    expect(calls).toBe(1);
  });

  it("produces different keys for requests with different messages", async () => {
    const store = new InMemoryCacheStore();
    const middleware = new CacheMiddleware({ store });
    let calls = 0;
    const next: MiddlewareNext = async () => {
      calls += 1;
      return { response: makeResponse(), fromCache: false, attempts: 1 };
    };

    await middleware.execute(makeRequest({ messages: [{ role: "user", content: "one" }] }), next);
    await middleware.execute(makeRequest({ messages: [{ role: "user", content: "two" }] }), next);

    expect(calls).toBe(2);
  });
});

describe("CacheMiddleware hit/miss behavior", () => {
  it("misses on the first call, calling next()", async () => {
    const middleware = new CacheMiddleware();
    const next: MiddlewareNext = vi.fn(async () => ({
      response: makeResponse(),
      fromCache: false,
      attempts: 1,
    }));

    const result = await middleware.execute(makeRequest(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(result.fromCache).toBe(false);
  });

  it("hits on a repeated call, skipping next() entirely", async () => {
    const middleware = new CacheMiddleware();
    const next: MiddlewareNext = vi.fn(async () => ({
      response: makeResponse({ content: "first" }),
      fromCache: false,
      attempts: 1,
    }));

    await middleware.execute(makeRequest(), next);
    const second = await middleware.execute(makeRequest(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(second.fromCache).toBe(true);
    expect(second.response.content).toBe("first");
  });

  it("never caches a response carrying toolCalls", async () => {
    const middleware = new CacheMiddleware();
    const next: MiddlewareNext = vi.fn(async () => ({
      response: makeResponse({
        toolCalls: [{ id: "call-1", name: "get_weather", arguments: {} }],
      }),
      fromCache: false,
      attempts: 1,
    }));

    await middleware.execute(makeRequest(), next);
    await middleware.execute(makeRequest(), next);

    expect(next).toHaveBeenCalledTimes(2);
  });

  it("is a pass-through when enabled is false", async () => {
    const middleware = new CacheMiddleware({ enabled: false });
    const next: MiddlewareNext = vi.fn(async () => ({
      response: makeResponse(),
      fromCache: false,
      attempts: 1,
    }));

    await middleware.execute(makeRequest(), next);
    await middleware.execute(makeRequest(), next);

    expect(next).toHaveBeenCalledTimes(2);
  });
});

describe("CacheMiddleware failure isolation", () => {
  it("degrades to a miss and continues to next() when the store's get() throws", async () => {
    const logger = fakeLogger();
    const store: ICacheStore = {
      get: async () => {
        throw new Error("store down");
      },
      set: async () => {},
      delete: async () => {},
      clear: async () => {},
    };
    const middleware = new CacheMiddleware({ store, logger });
    const next: MiddlewareNext = vi.fn(async () => ({
      response: makeResponse(),
      fromCache: false,
      attempts: 1,
    }));

    const result = await middleware.execute(makeRequest(), next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(result.fromCache).toBe(false);
    expect(logger.warnings).toHaveLength(1);
    expect(logger.warnings[0]?.fields?.operation).toBe("get");
  });

  it("degrades to a no-op and still returns the result when the store's set() throws", async () => {
    const logger = fakeLogger();
    const store: ICacheStore = {
      get: async () => undefined,
      set: async () => {
        throw new Error("store full");
      },
      delete: async () => {},
      clear: async () => {},
    };
    const middleware = new CacheMiddleware({ store, logger });
    const next: MiddlewareNext = vi.fn(async () => ({
      response: makeResponse(),
      fromCache: false,
      attempts: 1,
    }));

    const result = await middleware.execute(makeRequest(), next);

    expect(result.response.content).toBe("hello");
    expect(logger.warnings).toHaveLength(1);
    expect(logger.warnings[0]?.fields?.operation).toBe("set");
  });
});
