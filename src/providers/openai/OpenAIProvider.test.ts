import { describe, expect, it, vi } from "vitest";
import { ConfigurationError } from "../../core/errors.js";
import type {
  HttpRequestOptions,
  HttpResponse,
  HttpStreamResponse,
  IHttpClient,
} from "../http/HttpClient.js";
import { ProviderTimeoutError } from "../errors.js";
import { DEFAULT_BASE_URL, OpenAIProvider } from "./OpenAIProvider.js";

function jsonBody(overrides: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({
    id: "chatcmpl-1",
    model: "gpt-5.5",
    choices: [
      { index: 0, message: { role: "assistant", content: "Hello!" }, finish_reason: "stop" },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    ...overrides,
  });
}

class StubHttpClient implements IHttpClient {
  public lastRequest: HttpRequestOptions | undefined;
  constructor(
    private readonly response: HttpResponse,
    private readonly streamResponse?: HttpStreamResponse,
  ) {}

  async request(options: HttpRequestOptions): Promise<HttpResponse> {
    this.lastRequest = options;
    return this.response;
  }

  async requestStream(options: HttpRequestOptions): Promise<HttpStreamResponse> {
    this.lastRequest = options;
    if (!this.streamResponse) throw new Error("no stream response configured");
    return this.streamResponse;
  }
}

async function* toByteStream(chunks: string[]): AsyncIterable<Uint8Array> {
  const encoder = new TextEncoder();
  for (const chunk of chunks) yield encoder.encode(chunk);
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}

describe("OpenAIProvider", () => {
  it("throws ConfigurationError when apiKey is missing", () => {
    expect(() => new OpenAIProvider({})).toThrow(ConfigurationError);
  });

  it("reports its capabilities", () => {
    const provider = new OpenAIProvider(
      { apiKey: "sk-test" },
      { httpClient: new StubHttpClient({ status: 200, headers: {}, body: jsonBody() }) },
    );

    expect(provider.capabilities).toEqual({
      streaming: true,
      toolCalling: false,
      structuredOutput: false,
    });
    expect(provider.name).toBe("openai");
  });

  it("generates a completion and maps usage/finishReason from the wire response", async () => {
    const httpClient = new StubHttpClient({ status: 200, headers: {}, body: jsonBody() });
    const provider = new OpenAIProvider({ apiKey: "sk-test" }, { httpClient });

    const response = await provider.generate({
      model: "gpt-5.5",
      messages: [{ role: "user", content: "Hi" }],
      params: { temperature: 0.5, maxTokens: 100 },
    });

    expect(response).toEqual({
      content: "Hello!",
      model: "gpt-5.5",
      id: "chatcmpl-1",
      finishReason: "stop",
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
    expect(httpClient.lastRequest?.url).toBe(`${DEFAULT_BASE_URL}/chat/completions`);
    expect(httpClient.lastRequest?.headers?.Authorization).toBe("Bearer sk-test");
    const sentBody = JSON.parse(httpClient.lastRequest?.body ?? "{}") as Record<string, unknown>;
    expect(sentBody).toMatchObject({ temperature: 0.5, max_tokens: 100 });
  });

  it("overrides the base URL via config", async () => {
    const httpClient = new StubHttpClient({ status: 200, headers: {}, body: jsonBody() });
    const provider = new OpenAIProvider(
      { apiKey: "sk-test", baseURL: "https://custom.example.com/v1" },
      { httpClient },
    );

    await provider.generate({ model: "gpt-5.5", messages: [{ role: "user", content: "Hi" }] });

    expect(httpClient.lastRequest?.url).toBe("https://custom.example.com/v1/chat/completions");
  });

  it.each([
    [401, "AuthenticationError"],
    [403, "AuthenticationError"],
    [404, "InvalidRequestError"],
    [400, "InvalidRequestError"],
    [422, "InvalidRequestError"],
    [429, "RateLimitError"],
    [500, "ProviderResponseError"],
  ])("translates a %d response into %s", async (status, errorName) => {
    const httpClient = new StubHttpClient({
      status,
      headers: {},
      body: JSON.stringify({ error: { message: "failed" } }),
    });
    const provider = new OpenAIProvider({ apiKey: "sk-test" }, { httpClient });

    await expect(
      provider.generate({ model: "gpt-5.5", messages: [{ role: "user", content: "Hi" }] }),
    ).rejects.toMatchObject({ name: errorName });
  });

  it("propagates a ProviderTimeoutError raised by the injected http client unchanged", async () => {
    const timeoutError = new ProviderTimeoutError("timed out", "openai");
    const httpClient: IHttpClient = {
      request: vi.fn(async () => {
        throw timeoutError;
      }),
      requestStream: vi.fn(async () => {
        throw timeoutError;
      }),
    };
    const provider = new OpenAIProvider({ apiKey: "sk-test" }, { httpClient });

    await expect(
      provider.generate({ model: "gpt-5.5", messages: [{ role: "user", content: "Hi" }] }),
    ).rejects.toBe(timeoutError);
  });

  it("streams a completion, yielding normalized chunks", async () => {
    const events = [
      `data: ${JSON.stringify({ id: "1", model: "gpt-5.5", choices: [{ index: 0, delta: { content: "Hel" }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ id: "1", model: "gpt-5.5", choices: [{ index: 0, delta: { content: "lo" }, finish_reason: "stop" }] })}\n\n`,
      `data: [DONE]\n\n`,
    ];
    const httpClient = new StubHttpClient(
      { status: 200, headers: {}, body: "" },
      { status: 200, headers: {}, body: toByteStream(events) },
    );
    const provider = new OpenAIProvider({ apiKey: "sk-test" }, { httpClient });

    const chunks = await collect(
      provider.generateStream({ model: "gpt-5.5", messages: [{ role: "user", content: "Hi" }] }),
    );

    expect(chunks).toEqual([{ delta: "Hel" }, { delta: "lo", finishReason: "stop" }]);
    expect(JSON.parse(httpClient.lastRequest?.body ?? "{}")).toMatchObject({ stream: true });
  });

  it("reassembles a streamed SSE event split across two chunks", async () => {
    const fullEvent = `data: ${JSON.stringify({
      id: "1",
      model: "gpt-5.5",
      choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: "stop" }],
    })}\n\n`;
    const splitPoint = Math.floor(fullEvent.length / 2);
    const parts = [fullEvent.slice(0, splitPoint), fullEvent.slice(splitPoint)];
    const httpClient = new StubHttpClient(
      { status: 200, headers: {}, body: "" },
      { status: 200, headers: {}, body: toByteStream(parts) },
    );
    const provider = new OpenAIProvider({ apiKey: "sk-test" }, { httpClient });

    const chunks = await collect(
      provider.generateStream({ model: "gpt-5.5", messages: [{ role: "user", content: "Hi" }] }),
    );

    expect(chunks).toEqual([{ delta: "Hello", finishReason: "stop" }]);
  });

  it("produces a bounded, readable message for a non-JSON HTML error response, not a raw body dump", async () => {
    const html = `<!DOCTYPE html><html><head><title>404</title></head><body>${"not found ".repeat(50)}</body></html>`;
    const httpClient = new StubHttpClient({
      status: 404,
      headers: { "content-type": "text/html" },
      body: html,
    });
    const provider = new OpenAIProvider(
      { apiKey: "sk-test", baseURL: "https://openrouter.ai/v1" },
      { httpClient },
    );

    await expect(
      provider.generate({ model: "gpt-5.5", messages: [{ role: "user", content: "Hi" }] }),
    ).rejects.toMatchObject({
      name: "InvalidRequestError",
      message:
        "OpenAI request failed with status 404 (non-JSON HTML response) — https://openrouter.ai/v1/chat/completions",
    });
  });

  it("translates an error response encountered while streaming", async () => {
    const httpClient = new StubHttpClient(
      { status: 200, headers: {}, body: "" },
      {
        status: 401,
        headers: {},
        body: toByteStream([JSON.stringify({ error: { message: "invalid api key" } })]),
      },
    );
    const provider = new OpenAIProvider({ apiKey: "sk-test" }, { httpClient });

    await expect(
      collect(
        provider.generateStream({ model: "gpt-5.5", messages: [{ role: "user", content: "Hi" }] }),
      ),
    ).rejects.toMatchObject({ name: "AuthenticationError" });
  });
});
