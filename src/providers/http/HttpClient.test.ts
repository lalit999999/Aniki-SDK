import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderConnectionError, ProviderTimeoutError } from "../errors.js";
import { FetchHttpClient } from "./HttpClient.js";

function jsonResponse(body: string, status = 200): Response {
  return {
    status,
    headers: new Headers({ "content-type": "application/json" }),
    text: async () => body,
    body: null,
  } as unknown as Response;
}

function streamResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return {
    status,
    headers: new Headers({ "content-type": "text/event-stream" }),
    body: stream,
  } as unknown as Response;
}

async function collect(iterable: AsyncIterable<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let out = "";
  for await (const chunk of iterable) out += decoder.decode(chunk);
  return out;
}

describe("FetchHttpClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("issues a request and buffers the text body", async () => {
    const fetchMock = vi.fn(async () => jsonResponse('{"ok":true}'));
    vi.stubGlobal("fetch", fetchMock);

    const client = new FetchHttpClient({ providerName: "openai" });
    const response = await client.request({
      method: "POST",
      url: "https://api.openai.com/v1/chat/completions",
      headers: { Authorization: "Bearer sk-test" },
      body: '{"model":"gpt-5.5"}',
    });

    expect(response.status).toBe(200);
    expect(response.body).toBe('{"ok":true}');
    expect(response.headers["content-type"]).toBe("application/json");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/chat/completions",
      expect.objectContaining({ method: "POST", body: '{"model":"gpt-5.5"}' }),
    );
  });

  it("returns non-2xx responses as ordinary data rather than throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse('{"error":"nope"}', 500)),
    );

    const client = new FetchHttpClient();
    const response = await client.request({ method: "GET", url: "https://example.com" });

    expect(response.status).toBe(500);
  });

  it("streams the response body as an async iterable of byte chunks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamResponse(["chunk-a", "chunk-b"])),
    );

    const client = new FetchHttpClient();
    const response = await client.requestStream({ method: "GET", url: "https://example.com" });

    expect(response.status).toBe(200);
    expect(await collect(response.body)).toBe("chunk-achunk-b");
  });

  it("throws ProviderTimeoutError when the request is aborted after the configured timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const error = new Error("The operation was aborted");
              error.name = "AbortError";
              reject(error);
            });
          }),
      ),
    );

    const client = new FetchHttpClient({ providerName: "openai" });
    const promise = client.request({
      method: "GET",
      url: "https://api.openai.com/v1/chat/completions",
      timeoutMs: 10,
    });
    const expectation = expect(promise).rejects.toThrow(ProviderTimeoutError);

    await vi.advanceTimersByTimeAsync(10);
    await expectation;
  });

  it("throws ProviderConnectionError when fetch rejects for a non-timeout reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("getaddrinfo ENOTFOUND");
      }),
    );

    const client = new FetchHttpClient({ providerName: "openai" });

    await expect(
      client.request({ method: "GET", url: "https://api.openai.com/v1/chat/completions" }),
    ).rejects.toThrow(ProviderConnectionError);
  });
});
