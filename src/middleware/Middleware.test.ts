import { describe, expect, it } from "vitest";
import { Context } from "../core/Context.js";
import type { ProviderResponse } from "../providers/AIProvider.js";
import { BaseMiddleware } from "./Middleware.js";
import type { IMiddleware, MiddlewareNext, MiddlewareRequest, MiddlewareResponse } from "./Middleware.js";

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

const terminal: MiddlewareNext = async (request) => ({
  response: makeResponse({ model: request.model }),
  fromCache: false,
  attempts: 1,
});

describe("BaseMiddleware", () => {
  it("stores the name passed to its constructor", () => {
    class NamedMiddleware extends BaseMiddleware {
      constructor() {
        super("NamedMiddleware");
      }
      async execute(request: MiddlewareRequest, next: MiddlewareNext): Promise<MiddlewareResponse> {
        return next(request);
      }
    }

    const middleware: IMiddleware = new NamedMiddleware();
    expect(middleware.name).toBe("NamedMiddleware");
  });

  it("a five-line custom middleware can wrap next() and observe timing", async () => {
    const calls: string[] = [];

    class TimingMiddleware extends BaseMiddleware {
      constructor() {
        super("TimingMiddleware");
      }
      async execute(request: MiddlewareRequest, next: MiddlewareNext): Promise<MiddlewareResponse> {
        calls.push("before");
        const result = await next(request);
        calls.push("after");
        return result;
      }
    }

    const middleware = new TimingMiddleware();
    const result = await middleware.execute(makeRequest(), terminal);

    expect(calls).toEqual(["before", "after"]);
    expect(result.response.content).toBe("hello");
  });

  it("can short-circuit without calling next", async () => {
    class ShortCircuitMiddleware extends BaseMiddleware {
      constructor() {
        super("ShortCircuitMiddleware");
      }
      async execute(request: MiddlewareRequest, next: MiddlewareNext): Promise<MiddlewareResponse> {
        void request;
        void next;
        return { response: makeResponse({ content: "cached" }), fromCache: true, attempts: 0 };
      }
    }

    const middleware = new ShortCircuitMiddleware();
    const result = await middleware.execute(makeRequest(), terminal);

    expect(result.fromCache).toBe(true);
    expect(result.response.content).toBe("cached");
  });

  it("can modify the request before delegating to next", async () => {
    class ModelOverrideMiddleware extends BaseMiddleware {
      constructor() {
        super("ModelOverrideMiddleware");
      }
      async execute(request: MiddlewareRequest, next: MiddlewareNext): Promise<MiddlewareResponse> {
        return next({ ...request, model: "overridden-model" });
      }
    }

    const middleware = new ModelOverrideMiddleware();
    const result = await middleware.execute(makeRequest(), terminal);

    expect(result.response.model).toBe("overridden-model");
  });
});
