import { describe, expect, it, vi } from "vitest";
import { Agent } from "./Agent.js";
import { ProviderError, ValidationError } from "./errors.js";
import { Runner } from "./Runner.js";
import type { IProvider, ProviderRequest, ProviderResponse } from "../providers/AIProvider.js";

function createAgent(provider: IProvider): Agent {
  return new Agent({
    name: "Assistant",
    instructions: "You are a helpful assistant.",
    model: "gpt-5.5",
    provider,
  });
}

describe("Runner", () => {
  it("executes a full run against a fake provider and returns a typed result", async () => {
    const provider: IProvider = {
      name: "fake",
      generate: vi.fn(async (): Promise<ProviderResponse> => ({ content: "Hello, Lalit!" })),
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
      generate: vi.fn(async (request: ProviderRequest): Promise<ProviderResponse> => ({
        content: `turn:${request.messages.length}`,
      })),
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
      generate: vi.fn(async () => {
        throw new Error("network exploded");
      }),
    };
    const agent = createAgent(provider);
    const runner = new Runner();

    await expect(runner.run(agent, { message: "Hi" })).rejects.toThrow(ProviderError);
  });

  it("throws ValidationError for an empty message without calling the provider", async () => {
    const provider: IProvider = {
      name: "fake",
      generate: vi.fn(async (): Promise<ProviderResponse> => ({ content: "unused" })),
    };
    const agent = createAgent(provider);
    const runner = new Runner();

    await expect(runner.run(agent, { message: "" })).rejects.toThrow(ValidationError);
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it("emits lifecycle events in the expected order on the happy path", async () => {
    const provider: IProvider = {
      name: "fake",
      generate: vi.fn(async (): Promise<ProviderResponse> => ({ content: "hi" })),
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
      generate: vi.fn(async () => {
        throw new Error("boom");
      }),
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
});
