import { describe, expect, it } from "vitest";
import { Agent } from "../core/Agent.js";
import { Runner } from "../core/Runner.js";
import { ProviderFactory } from "../providers/ProviderFactory.js";
import { ProviderRegistry } from "../providers/ProviderRegistry.js";
import type {
  HttpRequestOptions,
  HttpResponse,
  HttpStreamResponse,
  IHttpClient,
} from "../providers/http/HttpClient.js";
import { OpenAIProvider } from "../providers/openai/OpenAIProvider.js";

/**
 * End-to-end integration test: a factory-built {@link OpenAIProvider}
 * (with a stubbed transport — zero real network calls) driven through
 * {@link Runner.run}, proving the whole provider system slots into the
 * existing core architecture unchanged.
 */

function jsonBody(): string {
  return JSON.stringify({
    id: "chatcmpl-1",
    model: "gpt-5.5",
    choices: [
      { index: 0, message: { role: "assistant", content: "Hello, Lalit!" }, finish_reason: "stop" },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  });
}

class StubHttpClient implements IHttpClient {
  public requests: HttpRequestOptions[] = [];

  async request(options: HttpRequestOptions): Promise<HttpResponse> {
    this.requests.push(options);
    return { status: 200, headers: {}, body: jsonBody() };
  }

  async requestStream(options: HttpRequestOptions): Promise<HttpStreamResponse> {
    this.requests.push(options);
    const encoder = new TextEncoder();
    const events = [
      `data: ${JSON.stringify({
        id: "1",
        model: "gpt-5.5",
        choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: "stop" }],
      })}\n\n`,
      "data: [DONE]\n\n",
    ];
    async function* body(): AsyncIterable<Uint8Array> {
      for (const event of events) yield encoder.encode(event);
    }
    return { status: 200, headers: {}, body: body() };
  }
}

describe("integration: factory-built OpenAIProvider through Runner", () => {
  it("resolves a provider through the factory and runs a full turn", async () => {
    const httpClient = new StubHttpClient();
    const registry = new ProviderRegistry();
    registry.register("openai", (config) => new OpenAIProvider(config, { httpClient }));
    const provider = ProviderFactory.create("openai", { apiKey: "sk-test" }, registry);

    const agent = new Agent({
      name: "Assistant",
      instructions: "You are a helpful assistant.",
      model: "gpt-5.5",
      provider,
    });
    const runner = new Runner();
    const events: string[] = [];
    runner.on("agent:started", () => events.push("agent:started"));
    runner.on("llm:request", () => events.push("llm:request"));
    runner.on("llm:response", () => events.push("llm:response"));
    runner.on("agent:finished", () => events.push("agent:finished"));

    const result = await runner.run(agent, { message: "Hi, my name is Lalit." });

    expect(result.content).toBe("Hello, Lalit!");
    expect(result.messages).toEqual([
      { role: "user", content: "Hi, my name is Lalit." },
      { role: "assistant", content: "Hello, Lalit!" },
    ]);
    expect(events).toEqual(["agent:started", "llm:request", "llm:response", "agent:finished"]);
    expect(httpClient.requests).toHaveLength(1);
  });

  it("streams a completion directly from a factory-built provider", async () => {
    const httpClient = new StubHttpClient();
    const registry = new ProviderRegistry();
    registry.register("openai", (config) => new OpenAIProvider(config, { httpClient }));
    const provider = ProviderFactory.create("openai", { apiKey: "sk-test" }, registry);

    const chunks: string[] = [];
    for await (const chunk of provider.generateStream({
      model: "gpt-5.5",
      messages: [{ role: "user", content: "Hi" }],
    })) {
      chunks.push(chunk.delta);
    }

    expect(chunks.join("")).toBe("Hi");
  });
});
