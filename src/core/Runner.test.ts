import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Agent } from "./Agent.js";
import { MaxToolIterationsError, ProviderError, ValidationError } from "./errors.js";
import { Runner } from "./Runner.js";
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

function makeWeatherTool(execute: (input: { city: string }) => Promise<{ tempC: number }>): Tool {
  return new Tool({
    name: "get_weather",
    description: "Get the current weather for a city.",
    input: z.object({ city: z.string() }),
    output: z.object({ tempC: z.number() }),
    execute,
  });
}

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
    expect(result.runId).toEqual(expect.any(String));
    expect(result.messages).toEqual([
      { role: "user", content: "Hi, my name is Lalit." },
      { role: "assistant", content: "Hello, Lalit!" },
    ]);
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
});
