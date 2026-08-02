import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Agent } from "./Agent.js";
import {
  MaxToolIterationsError,
  MiddlewareExecutionError,
  OutputParseError,
  OutputValidationError,
  ProviderError,
  StreamAbortedError,
  StreamingNotSupportedError,
  ValidationError,
} from "./errors.js";
import { Runner } from "./Runner.js";
import type { MiddlewareNext, MiddlewareRequest } from "../middleware/Middleware.js";
import { AuthenticationError } from "../providers/errors.js";
import { Tool } from "../tools/Tool.js";
import type {
  IProvider,
  ProviderCapabilities,
  ProviderRequest,
  ProviderResponse,
  ProviderStreamChunk,
} from "../providers/AIProvider.js";
import type { ToolCall } from "../types/index.js";

const FAKE_CAPABILITIES: ProviderCapabilities = {
  streaming: false,
  toolCalling: true,
  structuredOutput: false,
};

async function* fakeGenerateStream(): AsyncIterable<ProviderStreamChunk> {
  yield { delta: "" };
}

function createAgent(provider: IProvider, options: { maxToolIterations?: number } = {}): Agent {
  return new Agent({
    name: "Assistant",
    instructions: "You are a helpful assistant.",
    model: "gpt-5.5",
    provider,
    ...options,
  });
}

function createAgentWithTools(
  provider: IProvider,
  tools: readonly Tool[],
  options: { maxToolIterations?: number } = {},
): Agent {
  return new Agent({
    name: "Assistant",
    instructions: "You are a helpful assistant.",
    model: "gpt-5.5",
    provider,
    tools,
    ...options,
  });
}

function createAgentWithOutput<TOutput>(
  provider: IProvider,
  output: z.ZodType<TOutput>,
): Agent<TOutput> {
  return new Agent({
    name: "Assistant",
    instructions: "You are a helpful assistant.",
    model: "gpt-5.5",
    provider,
    output,
  });
}

function makeWeatherTool(execute: (input: { city: string }) => Promise<{ tempC: number }>): Tool {
  return new Tool({
    name: "get_weather",
    description: "Get the current weather for a city.",
    input: z.object({ city: z.string() }),
    output: z.object({ tempC: z.number() }),
    execute,
  });
}

describe("Runner constructor validation", () => {
  it("throws ValidationError when an options.middleware entry does not implement IMiddleware", () => {
    expect(
      () => new Runner(undefined, undefined, { middleware: [{ name: "" } as never] }),
    ).toThrow(ValidationError);
  });

  it("accepts an empty middleware array (the default)", () => {
    expect(() => new Runner(undefined, undefined, { middleware: [] })).not.toThrow();
  });
});

describe("Runner", () => {
  it("executes a full run against a fake provider and returns a typed result", async () => {
    const provider: IProvider = {
      name: "fake",
      capabilities: FAKE_CAPABILITIES,
      generate: vi.fn(async (): Promise<ProviderResponse> => ({
        content: "Hello, Lalit!",
        model: "gpt-5.5",
      })),
      generateStream: fakeGenerateStream,
    };
    const agent = createAgent(provider);
    const runner = new Runner();

    const result = await runner.run(agent, { message: "Hi, my name is Lalit." });

    expect(result.content).toBe("Hello, Lalit!");
    expect(result.output).toBeUndefined();
    expect(result.runId).toEqual(expect.any(String));
    expect(result.messages).toEqual([
      { role: "user", content: "Hi, my name is Lalit." },
      { role: "assistant", content: "Hello, Lalit!" },
    ]);
    expect(result.metadata).toEqual({
      runId: result.runId,
      model: "gpt-5.5",
      provider: "fake",
      durationMs: expect.any(Number),
      iterations: 1,
      streamed: false,
    });
  });

  it("grows conversation history across sequential calls on the same session", async () => {
    const provider: IProvider = {
      name: "fake",
      capabilities: FAKE_CAPABILITIES,
      generate: vi.fn(async (request: ProviderRequest): Promise<ProviderResponse> => ({
        content: `turn:${request.messages.length}`,
        model: "gpt-5.5",
      })),
      generateStream: fakeGenerateStream,
    };
    const agent = createAgent(provider);
    const runner = new Runner();

    const r1 = await runner.run(agent, { message: "Hi, my name is Lalit." });
    const r2 = await runner.run(agent, { message: "What's my name?" });

    expect(r1.messages).toHaveLength(2);
    expect(r2.messages).toHaveLength(4);
    expect(r2.messages).toEqual([
      { role: "user", content: "Hi, my name is Lalit." },
      { role: "assistant", content: "turn:2" },
      { role: "user", content: "What's my name?" },
      { role: "assistant", content: "turn:4" },
    ]);

    // The second request must include the first turn's history.
    const secondRequest = (provider.generate as ReturnType<typeof vi.fn>).mock
      .calls[1]?.[0] as ProviderRequest;
    expect(secondRequest.messages).toContainEqual({
      role: "user",
      content: "Hi, my name is Lalit.",
    });
  });

  it("wraps a throwing provider's error as ProviderError instead of leaking it raw", async () => {
    const provider: IProvider = {
      name: "fake",
      capabilities: FAKE_CAPABILITIES,
      generate: vi.fn(async () => {
        throw new Error("network exploded");
      }),
      generateStream: fakeGenerateStream,
    };
    const agent = createAgent(provider);
    const runner = new Runner();

    await expect(runner.run(agent, { message: "Hi" })).rejects.toThrow(ProviderError);
  });

  it("throws ValidationError for an empty message without calling the provider", async () => {
    const provider: IProvider = {
      name: "fake",
      capabilities: FAKE_CAPABILITIES,
      generate: vi.fn(async (): Promise<ProviderResponse> => ({
        content: "unused",
        model: "gpt-5.5",
      })),
      generateStream: fakeGenerateStream,
    };
    const agent = createAgent(provider);
    const runner = new Runner();

    await expect(runner.run(agent, { message: "" })).rejects.toThrow(ValidationError);
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it("emits lifecycle events in the expected order on the happy path", async () => {
    const provider: IProvider = {
      name: "fake",
      capabilities: FAKE_CAPABILITIES,
      generate: vi.fn(async (): Promise<ProviderResponse> => ({ content: "hi", model: "gpt-5.5" })),
      generateStream: fakeGenerateStream,
    };
    const agent = createAgent(provider);
    const runner = new Runner();
    const seen: string[] = [];

    runner.on("agent:started", () => seen.push("agent:started"));
    runner.on("llm:request", () => seen.push("llm:request"));
    runner.on("llm:response", () => seen.push("llm:response"));
    runner.on("agent:finished", () => seen.push("agent:finished"));

    await runner.run(agent, { message: "Hi" });

    expect(seen).toEqual(["agent:started", "llm:request", "llm:response", "agent:finished"]);
  });

  it("emits an error event before throwing when the provider fails", async () => {
    const provider: IProvider = {
      name: "fake",
      capabilities: FAKE_CAPABILITIES,
      generate: vi.fn(async () => {
        throw new Error("boom");
      }),
      generateStream: fakeGenerateStream,
    };
    const agent = createAgent(provider);
    const runner = new Runner();
    const seen: string[] = [];

    runner.on("agent:started", () => seen.push("agent:started"));
    runner.on("llm:request", () => seen.push("llm:request"));
    runner.on("error", () => seen.push("error"));
    runner.on("agent:finished", () => seen.push("agent:finished"));

    await expect(runner.run(agent, { message: "Hi" })).rejects.toThrow(ProviderError);
    expect(seen).toEqual(["agent:started", "llm:request", "error"]);
  });

  it("rethrows a ProviderError subclass thrown by the provider unchanged, preserving its fields", async () => {
    const subclassError = new AuthenticationError("invalid api key", "openai", {
      statusCode: 401,
    });
    const provider: IProvider = {
      name: "fake",
      capabilities: FAKE_CAPABILITIES,
      generate: vi.fn(async () => {
        throw subclassError;
      }),
      generateStream: fakeGenerateStream,
    };
    const agent = createAgent(provider);
    const runner = new Runner();
    const seenErrors: Error[] = [];
    runner.on("error", (_context, error) => seenErrors.push(error));

    await expect(runner.run(agent, { message: "Hi" })).rejects.toBe(subclassError);
    expect(seenErrors).toEqual([subclassError]);
    expect((seenErrors[0] as AuthenticationError).statusCode).toBe(401);
  });

  it("wraps a plain, non-ProviderError throw into a fresh ProviderError as before", async () => {
    const provider: IProvider = {
      name: "fake",
      capabilities: FAKE_CAPABILITIES,
      generate: vi.fn(async () => {
        throw new Error("plain failure");
      }),
      generateStream: fakeGenerateStream,
    };
    const agent = createAgent(provider);
    const runner = new Runner();

    await expect(runner.run(agent, { message: "Hi" })).rejects.toThrow(ProviderError);
    await expect(runner.run(agent, { message: "Hi" })).rejects.not.toBeInstanceOf(
      AuthenticationError,
    );
  });

  describe("tool calling", () => {
    it("adds no tools key to the request when the agent has none", async () => {
      const provider: IProvider = {
        name: "fake",
        capabilities: FAKE_CAPABILITIES,
        generate: vi.fn(async (): Promise<ProviderResponse> => ({
          content: "hi",
          model: "gpt-5.5",
        })),
        generateStream: fakeGenerateStream,
      };
      const agent = createAgent(provider);
      const runner = new Runner();

      await runner.run(agent, { message: "Hi" });

      const request = (provider.generate as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
        ProviderRequest | undefined;
      expect(request?.tools).toBeUndefined();
    });

    it("includes tool definitions in the request when the agent has tools", async () => {
      const tool = makeWeatherTool(async () => ({ tempC: 21 }));
      const provider: IProvider = {
        name: "fake",
        capabilities: FAKE_CAPABILITIES,
        generate: vi.fn(async (): Promise<ProviderResponse> => ({
          content: "hi",
          model: "gpt-5.5",
        })),
        generateStream: fakeGenerateStream,
      };
      const agent = createAgentWithTools(provider, [tool]);
      const runner = new Runner();

      await runner.run(agent, { message: "Hi" });

      const request = (provider.generate as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
        ProviderRequest | undefined;
      expect(request?.tools).toEqual([tool.toDefinition()]);
    });

    it("executes a single requested tool call and returns the model's final answer", async () => {
      const tool = makeWeatherTool(async ({ city }) => ({ tempC: city.length }));
      const call: ToolCall = { id: "call-1", name: "get_weather", arguments: { city: "Gaya" } };
      const generate = vi
        .fn<(request: ProviderRequest) => Promise<ProviderResponse>>()
        .mockResolvedValueOnce({ content: "", model: "gpt-5.5", toolCalls: [call] })
        .mockResolvedValueOnce({ content: "It's 4°C in Gaya.", model: "gpt-5.5" });
      const provider: IProvider = {
        name: "fake",
        capabilities: FAKE_CAPABILITIES,
        generate,
        generateStream: fakeGenerateStream,
      };
      const agent = createAgentWithTools(provider, [tool]);
      const runner = new Runner();

      const result = await runner.run(agent, { message: "What's the weather in Gaya?" });

      expect(result.content).toBe("It's 4°C in Gaya.");
      expect(result.iterations).toBe(2);
      expect(result.toolResults).toEqual([
        {
          toolCallId: "call-1",
          toolName: "get_weather",
          ok: true,
          output: { tempC: 4 },
          durationMs: expect.any(Number),
        },
      ]);
      expect(generate).toHaveBeenCalledTimes(2);
    });

    it("handles two tool calls in a single response", async () => {
      const tool = makeWeatherTool(async ({ city }) => ({ tempC: city.length }));
      const calls: ToolCall[] = [
        { id: "call-1", name: "get_weather", arguments: { city: "Gaya" } },
        { id: "call-2", name: "get_weather", arguments: { city: "Patna" } },
      ];
      const generate = vi
        .fn<(request: ProviderRequest) => Promise<ProviderResponse>>()
        .mockResolvedValueOnce({ content: "", model: "gpt-5.5", toolCalls: calls })
        .mockResolvedValueOnce({ content: "Both checked.", model: "gpt-5.5" });
      const provider: IProvider = {
        name: "fake",
        capabilities: FAKE_CAPABILITIES,
        generate,
        generateStream: fakeGenerateStream,
      };
      const agent = createAgentWithTools(provider, [tool]);
      const runner = new Runner();

      const result = await runner.run(agent, { message: "Compare weather in two cities." });

      expect(result.content).toBe("Both checked.");
      expect(result.toolResults).toHaveLength(2);
      expect(result.toolResults.map((r) => r.toolCallId)).toEqual(["call-1", "call-2"]);
      expect(result.toolResults.map((r) => r.output)).toEqual([{ tempC: 4 }, { tempC: 5 }]);
    });

    it("runs two sequential tool-calling iterations before the final answer", async () => {
      const tool = makeWeatherTool(async ({ city }) => ({ tempC: city.length }));
      const generate = vi
        .fn<(request: ProviderRequest) => Promise<ProviderResponse>>()
        .mockResolvedValueOnce({
          content: "",
          model: "gpt-5.5",
          toolCalls: [{ id: "call-1", name: "get_weather", arguments: { city: "Gaya" } }],
        })
        .mockResolvedValueOnce({
          content: "",
          model: "gpt-5.5",
          toolCalls: [{ id: "call-2", name: "get_weather", arguments: { city: "Patna" } }],
        })
        .mockResolvedValueOnce({ content: "Done.", model: "gpt-5.5" });
      const provider: IProvider = {
        name: "fake",
        capabilities: FAKE_CAPABILITIES,
        generate,
        generateStream: fakeGenerateStream,
      };
      const agent = createAgentWithTools(provider, [tool]);
      const runner = new Runner();

      const result = await runner.run(agent, { message: "Check two cities, one at a time." });

      expect(result.content).toBe("Done.");
      expect(result.iterations).toBe(3);
      expect(result.toolResults).toHaveLength(2);
      expect(generate).toHaveBeenCalledTimes(3);
    });

    it("feeds a failing tool's error back to the model, which recovers on the next iteration", async () => {
      const tool = makeWeatherTool(async () => {
        throw new Error("service unavailable");
      });
      const call: ToolCall = { id: "call-1", name: "get_weather", arguments: { city: "Gaya" } };
      const generate = vi
        .fn<(request: ProviderRequest) => Promise<ProviderResponse>>()
        .mockResolvedValueOnce({ content: "", model: "gpt-5.5", toolCalls: [call] })
        .mockResolvedValueOnce({
          content: "The weather service is unavailable.",
          model: "gpt-5.5",
        });
      const provider: IProvider = {
        name: "fake",
        capabilities: FAKE_CAPABILITIES,
        generate,
        generateStream: fakeGenerateStream,
      };
      const agent = createAgentWithTools(provider, [tool]);
      const runner = new Runner();

      const result = await runner.run(agent, { message: "What's the weather in Gaya?" });

      expect(result.content).toBe("The weather service is unavailable.");
      expect(result.toolResults).toEqual([
        expect.objectContaining({
          ok: false,
          error: expect.stringContaining("service unavailable"),
        }),
      ]);

      const secondRequest = generate.mock.calls[1]?.[0];
      expect(secondRequest?.messages).toContainEqual(
        expect.objectContaining({ role: "tool", toolCallId: "call-1" }),
      );
    });

    it("throws MaxToolIterationsError when the provider keeps requesting tools forever", async () => {
      const tool = makeWeatherTool(async () => ({ tempC: 1 }));
      const call: ToolCall = { id: "call-1", name: "get_weather", arguments: { city: "Gaya" } };
      const provider: IProvider = {
        name: "fake",
        capabilities: FAKE_CAPABILITIES,
        generate: vi.fn(async (): Promise<ProviderResponse> => ({
          content: "",
          model: "gpt-5.5",
          toolCalls: [call],
        })),
        generateStream: fakeGenerateStream,
      };
      const agent = createAgentWithTools(provider, [tool], { maxToolIterations: 2 });
      const runner = new Runner();

      await expect(runner.run(agent, { message: "Loop forever" })).rejects.toThrow(
        MaxToolIterationsError,
      );
      expect(provider.generate).toHaveBeenCalledTimes(2);
    });

    it("persists the exact session history and ordering across a tool round trip", async () => {
      const tool = makeWeatherTool(async ({ city }) => ({ tempC: city.length }));
      const call: ToolCall = { id: "call-1", name: "get_weather", arguments: { city: "Gaya" } };
      const generate = vi
        .fn<(request: ProviderRequest) => Promise<ProviderResponse>>()
        .mockResolvedValueOnce({ content: "", model: "gpt-5.5", toolCalls: [call] })
        .mockResolvedValueOnce({ content: "It's 4°C in Gaya.", model: "gpt-5.5" });
      const provider: IProvider = {
        name: "fake",
        capabilities: FAKE_CAPABILITIES,
        generate,
        generateStream: fakeGenerateStream,
      };
      const agent = createAgentWithTools(provider, [tool]);
      const runner = new Runner();

      const result = await runner.run(agent, { message: "What's the weather in Gaya?" });

      expect(result.messages).toEqual([
        { role: "user", content: "What's the weather in Gaya?" },
        { role: "assistant", content: "", toolCalls: [call] },
        {
          role: "tool",
          content: JSON.stringify({ tempC: 4 }),
          toolCallId: "call-1",
          name: "get_weather",
        },
        { role: "assistant", content: "It's 4°C in Gaya." },
      ]);
    });

    it("emits tool:started and tool:finished around a successful tool call", async () => {
      const tool = makeWeatherTool(async () => ({ tempC: 21 }));
      const call: ToolCall = { id: "call-1", name: "get_weather", arguments: { city: "Gaya" } };
      const generate = vi
        .fn<(request: ProviderRequest) => Promise<ProviderResponse>>()
        .mockResolvedValueOnce({ content: "", model: "gpt-5.5", toolCalls: [call] })
        .mockResolvedValueOnce({ content: "Done.", model: "gpt-5.5" });
      const provider: IProvider = {
        name: "fake",
        capabilities: FAKE_CAPABILITIES,
        generate,
        generateStream: fakeGenerateStream,
      };
      const agent = createAgentWithTools(provider, [tool]);
      const runner = new Runner();
      const seen: string[] = [];

      runner.on("agent:started", () => seen.push("agent:started"));
      runner.on("llm:request", () => seen.push("llm:request"));
      runner.on("llm:response", () => seen.push("llm:response"));
      runner.on("tool:started", () => seen.push("tool:started"));
      runner.on("tool:finished", () => seen.push("tool:finished"));
      runner.on("agent:finished", () => seen.push("agent:finished"));

      await runner.run(agent, { message: "What's the weather in Gaya?" });

      expect(seen).toEqual([
        "agent:started",
        "llm:request",
        "llm:response",
        "tool:started",
        "tool:finished",
        "llm:request",
        "llm:response",
        "agent:finished",
      ]);
    });

    it("emits tool:error instead of tool:finished for a failing tool call", async () => {
      const tool = makeWeatherTool(async () => {
        throw new Error("nope");
      });
      const call: ToolCall = { id: "call-1", name: "get_weather", arguments: { city: "Gaya" } };
      const generate = vi
        .fn<(request: ProviderRequest) => Promise<ProviderResponse>>()
        .mockResolvedValueOnce({ content: "", model: "gpt-5.5", toolCalls: [call] })
        .mockResolvedValueOnce({ content: "Failed.", model: "gpt-5.5" });
      const provider: IProvider = {
        name: "fake",
        capabilities: FAKE_CAPABILITIES,
        generate,
        generateStream: fakeGenerateStream,
      };
      const agent = createAgentWithTools(provider, [tool]);
      const runner = new Runner();
      const errors: Error[] = [];
      let finishedCalled = false;

      runner.on("tool:error", (_context, _call, error) => errors.push(error));
      runner.on("tool:finished", () => {
        finishedCalled = true;
      });

      await runner.run(agent, { message: "What's the weather in Gaya?" });

      expect(finishedCalled).toBe(false);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.message).toContain("nope");
    });
  });

  describe("canonical lifecycle events", () => {
    it("emits each canonical event immediately before its legacy counterpart", async () => {
      const provider: IProvider = {
        name: "fake",
        capabilities: FAKE_CAPABILITIES,
        generate: vi.fn(async (): Promise<ProviderResponse> => ({ content: "hi", model: "gpt-5.5" })),
        generateStream: fakeGenerateStream,
      };
      const agent = createAgent(provider);
      const runner = new Runner();
      const seen: string[] = [];

      for (const name of [
        "agent:start",
        "agent:started",
        "llm:start",
        "llm:request",
        "llm:end",
        "llm:response",
        "agent:end",
        "agent:finished",
      ] as const) {
        runner.on(name, () => seen.push(name));
      }

      await runner.run(agent, { message: "Hi" });

      expect(seen).toEqual([
        "agent:start",
        "agent:started",
        "llm:start",
        "llm:request",
        "llm:end",
        "llm:response",
        "agent:end",
        "agent:finished",
      ]);
    });

    it("agent:start and agent:end carry runId, agentName, model, and providerName", async () => {
      const provider: IProvider = {
        name: "fake",
        capabilities: FAKE_CAPABILITIES,
        generate: vi.fn(async (): Promise<ProviderResponse> => ({ content: "hi", model: "gpt-5.5" })),
        generateStream: fakeGenerateStream,
      };
      const agent = createAgent(provider);
      const runner = new Runner();

      let startEvent: unknown;
      let endEvent: { durationMs: number; iterations: number } | undefined;
      runner.on("agent:start", (event) => {
        startEvent = event;
      });
      runner.on("agent:end", (event) => {
        endEvent = event;
      });

      const result = await runner.run(agent, { message: "Hi" });

      expect(startEvent).toMatchObject({
        runId: result.runId,
        agentName: "Assistant",
        model: "gpt-5.5",
        providerName: "fake",
      });
      expect(endEvent).toMatchObject({ agentName: "Assistant", iterations: 1 });
      expect(typeof endEvent?.durationMs).toBe("number");
    });

    it("llm:end carries durationMs, finishReason, and usage", async () => {
      const provider: IProvider = {
        name: "fake",
        capabilities: FAKE_CAPABILITIES,
        generate: vi.fn(async (): Promise<ProviderResponse> => ({
          content: "hi",
          model: "gpt-5.5",
          finishReason: "stop",
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        })),
        generateStream: fakeGenerateStream,
      };
      const agent = createAgent(provider);
      const runner = new Runner();
      let llmEnd: { durationMs: number; finishReason?: string; usage?: unknown } | undefined;
      runner.on("llm:end", (event) => {
        llmEnd = event;
      });

      await runner.run(agent, { message: "Hi" });

      expect(typeof llmEnd?.durationMs).toBe("number");
      expect(llmEnd?.finishReason).toBe("stop");
      expect(llmEnd?.usage).toEqual({ promptTokens: 1, completionTokens: 1, totalTokens: 2 });
    });

    it("emits llm:error before the legacy error event when the provider fails", async () => {
      const provider: IProvider = {
        name: "fake",
        capabilities: FAKE_CAPABILITIES,
        generate: vi.fn(async () => {
          throw new Error("boom");
        }),
        generateStream: fakeGenerateStream,
      };
      const agent = createAgent(provider);
      const runner = new Runner();
      const seen: string[] = [];
      runner.on("llm:error", () => seen.push("llm:error"));
      runner.on("error", () => seen.push("error"));

      await expect(runner.run(agent, { message: "Hi" })).rejects.toThrow(ProviderError);
      expect(seen).toEqual(["llm:error", "error"]);
    });

    it("emits agent:error before the legacy error event when max tool iterations is exceeded", async () => {
      const tool = makeWeatherTool(async () => ({ tempC: 1 }));
      const call: ToolCall = { id: "call-1", name: "get_weather", arguments: { city: "Gaya" } };
      const provider: IProvider = {
        name: "fake",
        capabilities: FAKE_CAPABILITIES,
        generate: vi.fn(async (): Promise<ProviderResponse> => ({
          content: "",
          model: "gpt-5.5",
          toolCalls: [call],
        })),
        generateStream: fakeGenerateStream,
      };
      const agent = createAgentWithTools(provider, [tool], { maxToolIterations: 1 });
      const runner = new Runner();
      const seen: string[] = [];
      runner.on("agent:error", () => seen.push("agent:error"));
      runner.on("error", () => seen.push("error"));

      await expect(runner.run(agent, { message: "Loop forever" })).rejects.toThrow(
        MaxToolIterationsError,
      );
      expect(seen).toEqual(["agent:error", "error"]);
    });

    it("emits tool:start/tool:end alongside the legacy tool events for a successful call", async () => {
      const tool = makeWeatherTool(async () => ({ tempC: 21 }));
      const call: ToolCall = { id: "call-1", name: "get_weather", arguments: { city: "Gaya" } };
      const generate = vi
        .fn<(request: ProviderRequest) => Promise<ProviderResponse>>()
        .mockResolvedValueOnce({ content: "", model: "gpt-5.5", toolCalls: [call] })
        .mockResolvedValueOnce({ content: "Done.", model: "gpt-5.5" });
      const provider: IProvider = {
        name: "fake",
        capabilities: FAKE_CAPABILITIES,
        generate,
        generateStream: fakeGenerateStream,
      };
      const agent = createAgentWithTools(provider, [tool]);
      const runner = new Runner();
      const seen: string[] = [];
      let toolEnd: { durationMs: number; ok: boolean } | undefined;

      runner.on("tool:start", () => seen.push("tool:start"));
      runner.on("tool:started", () => seen.push("tool:started"));
      runner.on("tool:end", (event) => {
        seen.push("tool:end");
        toolEnd = event;
      });
      runner.on("tool:finished", () => seen.push("tool:finished"));

      await runner.run(agent, { message: "What's the weather in Gaya?" });

      expect(seen).toEqual(["tool:start", "tool:started", "tool:end", "tool:finished"]);
      expect(toolEnd?.ok).toBe(true);
      expect(typeof toolEnd?.durationMs).toBe("number");
    });
  });

  describe("Runner.off and Runner.once", () => {
    it("off() unsubscribes a listener registered via on()", async () => {
      const provider: IProvider = {
        name: "fake",
        capabilities: FAKE_CAPABILITIES,
        generate: vi.fn(async (): Promise<ProviderResponse> => ({ content: "hi", model: "gpt-5.5" })),
        generateStream: fakeGenerateStream,
      };
      const agent = createAgent(provider);
      const runner = new Runner();
      let calls = 0;
      const listener = () => {
        calls += 1;
      };

      runner.on("agent:start", listener);
      runner.off("agent:start", listener);
      await runner.run(agent, { message: "Hi" });

      expect(calls).toBe(0);
    });

    it("once() fires exactly one time even across multiple runs", async () => {
      const provider: IProvider = {
        name: "fake",
        capabilities: FAKE_CAPABILITIES,
        generate: vi.fn(async (): Promise<ProviderResponse> => ({ content: "hi", model: "gpt-5.5" })),
        generateStream: fakeGenerateStream,
      };
      const agent = createAgent(provider);
      const runner = new Runner();
      let calls = 0;

      runner.once("agent:start", () => {
        calls += 1;
      });
      await runner.run(agent, { message: "Hi" });
      await runner.run(agent, { message: "Hi again" });

      expect(calls).toBe(1);
    });
  });

  describe("middleware pipeline wiring", () => {
    it("behaves identically to no middleware configured when none is given", async () => {
      const provider: IProvider = {
        name: "fake",
        capabilities: FAKE_CAPABILITIES,
        generate: vi.fn(async (): Promise<ProviderResponse> => ({ content: "hi", model: "gpt-5.5" })),
        generateStream: fakeGenerateStream,
      };
      const agent = createAgent(provider);
      const runner = new Runner();

      const result = await runner.run(agent, { message: "Hi" });

      expect(result.content).toBe("hi");
      expect(provider.generate).toHaveBeenCalledTimes(1);
    });

    it("runs Runner-level middleware before Agent-level middleware", async () => {
      const provider: IProvider = {
        name: "fake",
        capabilities: FAKE_CAPABILITIES,
        generate: vi.fn(async (): Promise<ProviderResponse> => ({ content: "hi", model: "gpt-5.5" })),
        generateStream: fakeGenerateStream,
      };
      const order: string[] = [];
      const runnerMiddleware = {
        name: "RunnerLevel",
        execute: async (
          request: MiddlewareRequest,
          next: MiddlewareNext,
        ) => {
          order.push("runner-level:before");
          const result = await next(request);
          order.push("runner-level:after");
          return result;
        },
      };
      const agentMiddleware = {
        name: "AgentLevel",
        execute: async (
          request: MiddlewareRequest,
          next: MiddlewareNext,
        ) => {
          order.push("agent-level:before");
          const result = await next(request);
          order.push("agent-level:after");
          return result;
        },
      };
      const agent = new Agent({
        name: "Assistant",
        instructions: "You are a helpful assistant.",
        model: "gpt-5.5",
        provider,
        middleware: [agentMiddleware],
      });
      const runner = new Runner(undefined, undefined, { middleware: [runnerMiddleware] });

      await runner.run(agent, { message: "Hi" });

      expect(order).toEqual([
        "runner-level:before",
        "agent-level:before",
        "agent-level:after",
        "runner-level:after",
      ]);
    });

    it("preserves ProviderError wrapping when middleware is configured", async () => {
      const provider: IProvider = {
        name: "fake",
        capabilities: FAKE_CAPABILITIES,
        generate: vi.fn(async () => {
          throw new Error("network exploded");
        }),
        generateStream: fakeGenerateStream,
      };
      const passthrough = {
        name: "Passthrough",
        execute: async (
          request: MiddlewareRequest,
          next: MiddlewareNext,
        ) => next(request),
      };
      const agent = new Agent({
        name: "Assistant",
        instructions: "You are a helpful assistant.",
        model: "gpt-5.5",
        provider,
        middleware: [passthrough],
      });
      const runner = new Runner();

      await expect(runner.run(agent, { message: "Hi" })).rejects.toThrow(ProviderError);
    });

    it("emits middleware:error and the legacy error event, then propagates, when a middleware throws", async () => {
      const provider: IProvider = {
        name: "fake",
        capabilities: FAKE_CAPABILITIES,
        generate: vi.fn(async (): Promise<ProviderResponse> => ({ content: "hi", model: "gpt-5.5" })),
        generateStream: fakeGenerateStream,
      };
      const broken = {
        name: "BrokenMiddleware",
        execute: async () => {
          throw new Error("middleware exploded");
        },
      };
      const agent = new Agent({
        name: "Assistant",
        instructions: "You are a helpful assistant.",
        model: "gpt-5.5",
        provider,
        middleware: [broken],
      });
      const runner = new Runner();
      const seen: string[] = [];
      let middlewareErrorEvent: { middlewareName?: string } | undefined;

      runner.on("middleware:error", (event) => {
        seen.push("middleware:error");
        middlewareErrorEvent = event;
      });
      runner.on("error", () => seen.push("error"));

      await expect(runner.run(agent, { message: "Hi" })).rejects.toBeInstanceOf(MiddlewareExecutionError);
      expect(seen).toEqual(["middleware:error", "error"]);
      expect(middlewareErrorEvent?.middlewareName).toBe("BrokenMiddleware");
      expect(provider.generate).not.toHaveBeenCalled();
    });
  });

  describe("structured output", () => {
    const userSchema = z.object({ name: z.string(), age: z.number() });

    it("appends format instructions to, and never replaces, the system message", async () => {
      const generate = vi
        .fn<(request: ProviderRequest) => Promise<ProviderResponse>>()
        .mockResolvedValue({ content: '{"name":"Lalit","age":30}', model: "gpt-5.5" });
      const provider: IProvider = {
        name: "fake",
        capabilities: FAKE_CAPABILITIES,
        generate,
        generateStream: fakeGenerateStream,
      };
      const agent = createAgentWithOutput(provider, userSchema);
      const runner = new Runner();

      await runner.run(agent, { message: "Extract the user" });

      const request = generate.mock.calls[0]?.[0] as ProviderRequest;
      const systemMessage = request.messages[0];
      expect(systemMessage?.role).toBe("system");
      expect(systemMessage?.content).toContain(agent.instructions);
      expect(systemMessage?.content).toContain("JSON");
      expect(systemMessage?.content.length).toBeGreaterThan(agent.instructions.length);
    });

    it("does not alter the system message when the agent has no output schema", async () => {
      const generate = vi
        .fn<(request: ProviderRequest) => Promise<ProviderResponse>>()
        .mockResolvedValue({ content: "hi", model: "gpt-5.5" });
      const provider: IProvider = {
        name: "fake",
        capabilities: FAKE_CAPABILITIES,
        generate,
        generateStream: fakeGenerateStream,
      };
      const agent = createAgent(provider);
      const runner = new Runner();

      await runner.run(agent, { message: "Hi" });

      const request = generate.mock.calls[0]?.[0] as ProviderRequest;
      expect(request.messages[0]).toEqual({ role: "system", content: agent.instructions });
    });

    it("parses and validates the final response into result.output", async () => {
      const provider: IProvider = {
        name: "fake",
        capabilities: FAKE_CAPABILITIES,
        generate: vi.fn(async (): Promise<ProviderResponse> => ({
          content: 'Sure:\n```json\n{"name":"Lalit","age":30}\n```',
          model: "gpt-5.5",
        })),
        generateStream: fakeGenerateStream,
      };
      const agent = createAgentWithOutput(provider, userSchema);
      const runner = new Runner();

      const result = await runner.run(agent, { message: "Extract the user" });

      expect(result.output).toEqual({ name: "Lalit", age: 30 });
      expect(result.content).toBe('Sure:\n```json\n{"name":"Lalit","age":30}\n```');
    });

    it("throws OutputParseError when the response has no JSON payload, after persisting the assistant message", async () => {
      const provider: IProvider = {
        name: "fake",
        capabilities: FAKE_CAPABILITIES,
        generate: vi.fn(async (): Promise<ProviderResponse> => ({
          content: "Sorry, I can't help with that.",
          model: "gpt-5.5",
        })),
        generateStream: fakeGenerateStream,
      };
      const agent = createAgentWithOutput(provider, userSchema);
      const runner = new Runner();

      await expect(runner.run(agent, { message: "Extract the user" })).rejects.toThrow(
        OutputParseError,
      );
      expect(agent.session.getMessages()).toContainEqual({
        role: "assistant",
        content: "Sorry, I can't help with that.",
      });
    });

    it("throws OutputValidationError when the parsed JSON fails the schema", async () => {
      const provider: IProvider = {
        name: "fake",
        capabilities: FAKE_CAPABILITIES,
        generate: vi.fn(async (): Promise<ProviderResponse> => ({
          content: '{"name":"Lalit"}',
          model: "gpt-5.5",
        })),
        generateStream: fakeGenerateStream,
      };
      const agent = createAgentWithOutput(provider, userSchema);
      const runner = new Runner();

      await expect(runner.run(agent, { message: "Extract the user" })).rejects.toThrow(
        OutputValidationError,
      );
    });

    it("emits an error event before throwing on invalid structured output", async () => {
      const provider: IProvider = {
        name: "fake",
        capabilities: FAKE_CAPABILITIES,
        generate: vi.fn(async (): Promise<ProviderResponse> => ({
          content: "not json",
          model: "gpt-5.5",
        })),
        generateStream: fakeGenerateStream,
      };
      const agent = createAgentWithOutput(provider, userSchema);
      const runner = new Runner();
      const seen: string[] = [];
      runner.on("error", () => seen.push("error"));
      runner.on("agent:finished", () => seen.push("agent:finished"));

      await expect(runner.run(agent, { message: "Extract the user" })).rejects.toThrow(
        OutputParseError,
      );
      expect(seen).toEqual(["error"]);
    });

    it("populates metadata with finishReason and usage from the final response", async () => {
      const provider: IProvider = {
        name: "fake",
        capabilities: FAKE_CAPABILITIES,
        generate: vi.fn(async (): Promise<ProviderResponse> => ({
          content: '{"name":"Lalit","age":30}',
          model: "gpt-5.5",
          finishReason: "stop",
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        })),
        generateStream: fakeGenerateStream,
      };
      const agent = createAgentWithOutput(provider, userSchema);
      const runner = new Runner();

      const result = await runner.run(agent, { message: "Extract the user" });

      expect(result.metadata).toEqual({
        runId: result.runId,
        model: "gpt-5.5",
        provider: "fake",
        finishReason: "stop",
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        durationMs: expect.any(Number),
        iterations: 1,
        streamed: false,
      });
    });
  });

  describe("stream", () => {
    const STREAMING_CAPABILITIES: ProviderCapabilities = {
      streaming: true,
      toolCalling: true,
      structuredOutput: false,
    };

    function createStreamingProvider(chunks: readonly ProviderStreamChunk[]): IProvider {
      return {
        name: "fake",
        capabilities: STREAMING_CAPABILITIES,
        generate: vi.fn(async (): Promise<ProviderResponse> => ({
          content: "unused",
          model: "gpt-5.5",
        })),
        generateStream: vi.fn(async function* (): AsyncIterable<ProviderStreamChunk> {
          for (const chunk of chunks) {
            yield chunk;
          }
        }),
      };
    }

    function createNeverStreamingProvider(): IProvider {
      return {
        name: "fake",
        capabilities: STREAMING_CAPABILITIES,
        generate: vi.fn(async (): Promise<ProviderResponse> => ({
          content: "unused",
          model: "gpt-5.5",
        })),
        generateStream: () => ({
          [Symbol.asyncIterator]() {
            return { next: () => new Promise<IteratorResult<ProviderStreamChunk>>(() => {}) };
          },
        }),
      };
    }

    it("throws ValidationError for an empty message without opening a stream", () => {
      const provider = createStreamingProvider([{ delta: "hi" }]);
      const agent = createAgent(provider);
      const runner = new Runner();

      expect(() => runner.stream(agent, { message: "" })).toThrow(ValidationError);
      expect(provider.generateStream).not.toHaveBeenCalled();
    });

    it("throws StreamingNotSupportedError when the provider does not support streaming", () => {
      const provider: IProvider = {
        ...createStreamingProvider([]),
        capabilities: FAKE_CAPABILITIES,
      };
      const agent = createAgent(provider);
      const runner = new Runner();

      expect(() => runner.stream(agent, { message: "Hi" })).toThrow(StreamingNotSupportedError);
    });

    it("throws StreamingNotSupportedError when the agent has registered tools", () => {
      const provider = createStreamingProvider([{ delta: "hi" }]);
      const tool = makeWeatherTool(async () => ({ tempC: 1 }));
      const agent = createAgentWithTools(provider, [tool]);
      const runner = new Runner();

      expect(() => runner.stream(agent, { message: "Hi" })).toThrow(StreamingNotSupportedError);
    });

    it("persists the user message before opening the stream", () => {
      const provider = createStreamingProvider([{ delta: "hi" }]);
      const agent = createAgent(provider);
      const runner = new Runner();

      runner.stream(agent, { message: "Hi" });

      expect(agent.session.getMessages()).toEqual([{ role: "user", content: "Hi" }]);
    });

    it("appends format instructions to the system message when the agent has an output schema", () => {
      const provider = createStreamingProvider([{ delta: '{"name":"Lalit"}' }]);
      const schema = z.object({ name: z.string() });
      const agent = createAgentWithOutput(provider, schema);
      const runner = new Runner();

      runner.stream(agent, { message: "Extract the user" });

      const request = (provider.generateStream as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as
        ProviderRequest | undefined;
      expect(request?.messages[0]).toEqual(expect.objectContaining({ role: "system" }));
      expect(request?.messages[0]?.content).toContain(agent.instructions);
      expect(request?.messages[0]?.content).toContain("JSON");
    });

    it("resolves result with the streamed content and typed output", async () => {
      const provider = createStreamingProvider([{ delta: "Hello" }, { delta: "!" }]);
      const agent = createAgent(provider);
      const runner = new Runner();

      const stream = runner.stream(agent, { message: "Hi" });
      const result = await stream.result;

      expect(result.content).toBe("Hello!");
      expect(result.metadata.streamed).toBe(true);
      expect(result.metadata.provider).toBe("fake");
    });

    it("aborting the returned stream surfaces StreamAbortedError through result", async () => {
      const provider = createNeverStreamingProvider();
      const agent = createAgent(provider);
      const runner = new Runner();

      const stream = runner.stream(agent, { message: "Hi" });
      const rejection = expect(stream.result).rejects.toThrow(StreamAbortedError);

      stream.abort("cancelled");

      await rejection;
    });
  });
});
