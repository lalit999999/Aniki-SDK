import { describe, expect, it } from "vitest";
import { Context } from "../core/Context.js";
import { MiddlewareContractError, MiddlewareExecutionError, ValidationError } from "../core/errors.js";
import type { ProviderResponse } from "../providers/AIProvider.js";
import { BaseMiddleware } from "./Middleware.js";
import type { IMiddleware, MiddlewareNext, MiddlewareRequest, MiddlewareResponse } from "./Middleware.js";
import { MiddlewarePipeline } from "./MiddlewarePipeline.js";

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

function ordered(name: string, log: string[]): IMiddleware {
  return {
    name,
    execute: async (request, next) => {
      log.push(`${name}:before`);
      const result = await next(request);
      log.push(`${name}:after`);
      return result;
    },
  };
}

const terminal: MiddlewareNext = async (request) => ({
  response: makeResponse({ model: request.model }),
  fromCache: false,
  attempts: 1,
});

describe("MiddlewarePipeline ordering", () => {
  it("delegates straight to terminal when empty", async () => {
    const pipeline = new MiddlewarePipeline();
    const result = await pipeline.execute(makeRequest(), terminal);
    expect(result.response.content).toBe("hello");
  });

  it("runs middleware in array order in, and unwinds in reverse order out", async () => {
    const log: string[] = [];
    const pipeline = new MiddlewarePipeline([
      ordered("A", log),
      ordered("B", log),
      ordered("C", log),
    ]);

    await pipeline.execute(makeRequest(), terminal);

    expect(log).toEqual(["A:before", "B:before", "C:before", "C:after", "B:after", "A:after"]);
  });

  it("short-circuits when a middleware never calls next", async () => {
    const log: string[] = [];
    const shortCircuit: IMiddleware = {
      name: "ShortCircuit",
      execute: async () => ({ response: makeResponse({ content: "cached" }), fromCache: true, attempts: 0 }),
    };
    const pipeline = new MiddlewarePipeline([ordered("A", log), shortCircuit, ordered("B", log)]);

    const result = await pipeline.execute(makeRequest(), terminal);

    expect(log).toEqual(["A:before", "A:after"]);
    expect(result.fromCache).toBe(true);
    expect(result.response.content).toBe("cached");
  });
});

describe("MiddlewarePipeline contract enforcement", () => {
  it("wraps a throwing middleware in MiddlewareExecutionError, naming it", async () => {
    const throwing: IMiddleware = {
      name: "Throws",
      execute: async () => {
        throw new Error("boom");
      },
    };
    const pipeline = new MiddlewarePipeline([throwing]);

    await expect(pipeline.execute(makeRequest(), terminal)).rejects.toBeInstanceOf(
      MiddlewareExecutionError,
    );
    await expect(pipeline.execute(makeRequest(), terminal)).rejects.toMatchObject({
      middlewareName: "Throws",
    });
  });

  it("lets an AnikiError thrown by a middleware pass through unwrapped", async () => {
    const throwing: IMiddleware = {
      name: "ThrowsAniki",
      execute: async () => {
        throw new ValidationError("bad input");
      },
    };
    const pipeline = new MiddlewarePipeline([throwing]);

    await expect(pipeline.execute(makeRequest(), terminal)).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws MiddlewareContractError when a middleware calls next() twice", async () => {
    const doubleNext: IMiddleware = {
      name: "DoubleNext",
      execute: async (request, next) => {
        await next(request);
        return next(request);
      },
    };
    const pipeline = new MiddlewarePipeline([doubleNext]);

    await expect(pipeline.execute(makeRequest(), terminal)).rejects.toBeInstanceOf(
      MiddlewareContractError,
    );
  });

  it("throws MiddlewareContractError when a middleware resolves without a response", async () => {
    class BadMiddleware extends BaseMiddleware {
      constructor() {
        super("Bad");
      }
      async execute(): Promise<MiddlewareResponse> {
        return undefined as unknown as MiddlewareResponse;
      }
    }
    const pipeline = new MiddlewarePipeline([new BadMiddleware()]);

    await expect(pipeline.execute(makeRequest(), terminal)).rejects.toBeInstanceOf(
      MiddlewareContractError,
    );
  });
});

describe("MiddlewarePipeline management", () => {
  it("use() appends and list() reflects execution order", () => {
    const pipeline = new MiddlewarePipeline();
    const a: IMiddleware = { name: "A", execute: async (_r, next) => next(_r) };
    const b: IMiddleware = { name: "B", execute: async (_r, next) => next(_r) };

    pipeline.use(a).use(b);

    expect(pipeline.list().map((m) => m.name)).toEqual(["A", "B"]);
  });

  it("remove() removes the named middleware and returns true", () => {
    const a: IMiddleware = { name: "A", execute: async (_r, next) => next(_r) };
    const b: IMiddleware = { name: "B", execute: async (_r, next) => next(_r) };
    const pipeline = new MiddlewarePipeline([a, b]);

    expect(pipeline.remove("A")).toBe(true);
    expect(pipeline.list().map((m) => m.name)).toEqual(["B"]);
  });

  it("remove() returns false for an unknown name and leaves the pipeline untouched", () => {
    const a: IMiddleware = { name: "A", execute: async (_r, next) => next(_r) };
    const pipeline = new MiddlewarePipeline([a]);

    expect(pipeline.remove("Missing")).toBe(false);
    expect(pipeline.list().map((m) => m.name)).toEqual(["A"]);
  });

  it("list() returns a snapshot that further use() calls do not mutate", () => {
    const a: IMiddleware = { name: "A", execute: async (_r, next) => next(_r) };
    const b: IMiddleware = { name: "B", execute: async (_r, next) => next(_r) };
    const pipeline = new MiddlewarePipeline([a]);

    const snapshot = pipeline.list();
    pipeline.use(b);

    expect(snapshot.map((m) => m.name)).toEqual(["A"]);
    expect(pipeline.list().map((m) => m.name)).toEqual(["A", "B"]);
  });
});
