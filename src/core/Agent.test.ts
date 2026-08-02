import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Agent } from "./Agent.js";
import { DuplicateToolError, ConfigurationError, ValidationError } from "./errors.js";
import { InMemorySession } from "./Session.js";
import type { IMiddleware } from "../middleware/Middleware.js";
import type { IProvider } from "../providers/AIProvider.js";
import { OpenAIProvider } from "../providers/openai/OpenAIProvider.js";
import { Tool } from "../tools/Tool.js";
import { MockProvider } from "../testing/MockProvider.js";

function makeTool(name: string): Tool {
  return new Tool({
    name,
    description: `Tool named ${name}.`,
    input: z.object({}),
    execute: () => ({}),
  });
}

function createFakeProvider(): IProvider {
  return new MockProvider({
    name: "fake",
    capabilities: { streaming: false, toolCalling: false, structuredOutput: false },
    responses: [{ content: "fake response", model: "gpt-5.5" }],
  });
}

describe("Agent", () => {
  it("constructs with a valid configuration and exposes it via readonly getters", () => {
    const provider = createFakeProvider();
    const agent = new Agent({
      name: "Assistant",
      instructions: "You are a helpful assistant.",
      model: "gpt-5.5",
      provider,
    });

    expect(agent.name).toBe("Assistant");
    expect(agent.instructions).toBe("You are a helpful assistant.");
    expect(agent.model).toBe("gpt-5.5");
    expect(agent.provider).toBe(provider);
    expect(agent.tools).toEqual([]);
    expect(agent.middleware).toEqual([]);
    expect(agent.output).toBeUndefined();
  });

  it("defaults to a fresh in-memory session when none is provided", () => {
    const agent = new Agent({
      name: "Assistant",
      instructions: "Be helpful.",
      model: "gpt-5.5",
      provider: createFakeProvider(),
    });

    expect(agent.session).toBeTruthy();
    expect(agent.session.getMessages()).toEqual([]);
  });

  it("uses an explicitly provided session", () => {
    const session = new InMemorySession("my-session");
    const agent = new Agent({
      name: "Assistant",
      instructions: "Be helpful.",
      model: "gpt-5.5",
      provider: createFakeProvider(),
      session,
    });

    expect(agent.session).toBe(session);
  });

  it("stores an optional output schema and tools/middleware arrays", () => {
    const output = z.object({ answer: z.string() });
    const weatherTool = makeTool("get_weather");
    const middleware: IMiddleware = { name: "NoopMiddleware", execute: async (request, next) => next(request) };
    const agent = new Agent({
      name: "Assistant",
      instructions: "Be helpful.",
      model: "gpt-5.5",
      provider: createFakeProvider(),
      output,
      tools: [weatherTool],
      middleware: [middleware],
    });

    expect(agent.output).toBe(output);
    expect(agent.tools).toEqual([weatherTool]);
    expect(agent.middleware).toHaveLength(1);
  });

  describe("middleware validation", () => {
    it("throws ValidationError when a middleware entry has no name", () => {
      expect(
        () =>
          new Agent({
            name: "Assistant",
            instructions: "Be helpful.",
            model: "gpt-5.5",
            provider: createFakeProvider(),
            middleware: [{ execute: async () => {} } as never],
          }),
      ).toThrow(ValidationError);
    });

    it("throws ValidationError when a middleware entry has no execute function", () => {
      expect(
        () =>
          new Agent({
            name: "Assistant",
            instructions: "Be helpful.",
            model: "gpt-5.5",
            provider: createFakeProvider(),
            middleware: [{ name: "Bad" } as never],
          }),
      ).toThrow(ValidationError);
    });
  });

  describe("tools", () => {
    it("defaults to an empty tools array and a max of 5 tool iterations", () => {
      const agent = new Agent({
        name: "Assistant",
        instructions: "Be helpful.",
        model: "gpt-5.5",
        provider: createFakeProvider(),
      });

      expect(agent.tools).toEqual([]);
      expect(agent.toolRegistry.size).toBe(0);
      expect(agent.maxToolIterations).toBe(5);
    });

    it("builds a toolRegistry containing every configured tool", () => {
      const weatherTool = makeTool("get_weather");
      const searchTool = makeTool("search");
      const agent = new Agent({
        name: "Assistant",
        instructions: "Be helpful.",
        model: "gpt-5.5",
        provider: createFakeProvider(),
        tools: [weatherTool, searchTool],
      });

      expect(agent.toolRegistry.size).toBe(2);
      expect(agent.toolRegistry.get("get_weather")).toBe(weatherTool);
      expect(agent.toolRegistry.get("search")).toBe(searchTool);
    });

    it("throws DuplicateToolError at construction when two tools share a name", () => {
      expect(
        () =>
          new Agent({
            name: "Assistant",
            instructions: "Be helpful.",
            model: "gpt-5.5",
            provider: createFakeProvider(),
            tools: [makeTool("get_weather"), makeTool("get_weather")],
          }),
      ).toThrow(DuplicateToolError);
    });

    it("accepts a custom maxToolIterations", () => {
      const agent = new Agent({
        name: "Assistant",
        instructions: "Be helpful.",
        model: "gpt-5.5",
        provider: createFakeProvider(),
        maxToolIterations: 10,
      });

      expect(agent.maxToolIterations).toBe(10);
    });

    it("throws ValidationError for a non-positive maxToolIterations", () => {
      expect(
        () =>
          new Agent({
            name: "Assistant",
            instructions: "Be helpful.",
            model: "gpt-5.5",
            provider: createFakeProvider(),
            maxToolIterations: 0,
          }),
      ).toThrow(ValidationError);
    });
  });

  it("throws ValidationError with a clear message when name is missing", () => {
    expect(
      () =>
        new Agent({
          name: "",
          instructions: "Be helpful.",
          model: "gpt-5.5",
          provider: createFakeProvider(),
        }),
    ).toThrow(ValidationError);
  });

  it("throws ValidationError with a clear message when instructions is missing", () => {
    expect(
      () =>
        new Agent({
          name: "Assistant",
          instructions: "",
          model: "gpt-5.5",
          provider: createFakeProvider(),
        }),
    ).toThrow(ValidationError);
  });

  it("throws ValidationError when the provider does not implement IProvider", () => {
    expect(
      () =>
        new Agent({
          name: "Assistant",
          instructions: "Be helpful.",
          model: "gpt-5.5",
          provider: {} as IProvider,
        }),
    ).toThrow(ValidationError);
  });

  describe("structured output schema", () => {
    it("infers Agent<TOutput> from the output schema", () => {
      const schema = z.object({ email: z.string() });
      const agent = new Agent({
        name: "Assistant",
        instructions: "Be helpful.",
        model: "gpt-5.5",
        provider: createFakeProvider(),
        output: schema,
      });

      // Compile-time check: agent.output is typed z.ZodType<{ email: string }> | undefined.
      const parsed = agent.output?.parse({ email: "lalit@example.com" });
      expect(parsed?.email).toBe("lalit@example.com");
    });

    it("throws ValidationError when output is not a Zod schema", () => {
      const notASchema = { parse: () => undefined } as unknown as z.ZodType<unknown>;

      expect(
        () =>
          new Agent({
            name: "Assistant",
            instructions: "Be helpful.",
            model: "gpt-5.5",
            provider: createFakeProvider(),
            output: notASchema,
          }),
      ).toThrow(ValidationError);
    });
  });

  describe("string provider resolution", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("resolves a provider name string through ProviderFactory", () => {
      vi.stubEnv("OPENAI_API_KEY", "sk-test-123");

      const agent = new Agent({
        name: "Assistant",
        instructions: "Be helpful.",
        model: "gpt-5.5",
        provider: "openai",
      });

      expect(agent.provider).toBeInstanceOf(OpenAIProvider);
    });

    it("propagates ConfigurationError when the named provider has no resolvable API key", () => {
      expect(
        () =>
          new Agent({
            name: "Assistant",
            instructions: "Be helpful.",
            model: "gpt-5.5",
            provider: "openai",
          }),
      ).toThrow(ConfigurationError);
    });
  });
});
