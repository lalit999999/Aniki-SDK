import { ProviderConnectionError, ProviderTimeoutError } from "../errors.js";

/** The HTTP methods providers issue requests with. */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Input to a single {@link IHttpClient} request. */
export interface HttpRequestOptions {
  /** The HTTP method to use. */
  readonly method: HttpMethod;
  /** The fully-qualified URL to request. */
  readonly url: string;
  /** Request headers. */
  readonly headers?: Readonly<Record<string, string>>;
  /** The raw request body, when applicable. */
  readonly body?: string;
  /** Overrides this client's default per-request timeout, in milliseconds. */
  readonly timeoutMs?: number;
}

/** A completed, buffered HTTP response. */
export interface HttpResponse {
  /** The HTTP status code. */
  readonly status: number;
  /** Response headers, lower-cased by the underlying `fetch` implementation. */
  readonly headers: Readonly<Record<string, string>>;
  /** The full response body, as text. */
  readonly body: string;
}

/** A completed HTTP response whose body is delivered incrementally. */
export interface HttpStreamResponse {
  /** The HTTP status code. */
  readonly status: number;
  /** Response headers, lower-cased by the underlying `fetch` implementation. */
  readonly headers: Readonly<Record<string, string>>;
  /** The raw response body, as a stream of byte chunks. */
  readonly body: AsyncIterable<Uint8Array>;
}

/**
 * The transport abstraction every provider issues its requests through.
 *
 * Providers depend on this interface, never on `fetch` directly, so tests
 * can inject a stub implementation and exercise zero real network calls.
 */
export interface IHttpClient {
  /** Issues a request and buffers the full response body. */
  request(options: HttpRequestOptions): Promise<HttpResponse>;
  /** Issues a request and returns the response body as an incremental byte stream. */
  requestStream(options: HttpRequestOptions): Promise<HttpStreamResponse>;
}

/** Options accepted by the {@link FetchHttpClient} constructor. */
export interface FetchHttpClientOptions {
  /** The provider name attributed to transport errors this client raises. Defaults to `"http"`. */
  readonly providerName?: string;
  /** The default per-request timeout in milliseconds, used when a request omits `timeoutMs`. Defaults to `30000`. */
  readonly defaultTimeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30000;

function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

async function* streamBody(body: ReadableStream<Uint8Array> | null): AsyncIterable<Uint8Array> {
  if (!body) return;
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * The SDK's only `fetch`-based {@link IHttpClient} implementation.
 *
 * Enforces a per-request timeout via `AbortController`, translating a
 * timeout-triggered abort into {@link ProviderTimeoutError} and any other
 * `fetch` rejection (DNS failure, socket error, ...) into
 * {@link ProviderConnectionError}. Non-2xx HTTP responses are *not* treated
 * as errors here — they are returned as ordinary data for the calling
 * provider's error translator to classify.
 *
 * @example
 * ```ts
 * const client = new FetchHttpClient({ providerName: "openai" });
 * const response = await client.request({ method: "POST", url, headers, body });
 * ```
 */
export class FetchHttpClient implements IHttpClient {
  private readonly providerName: string;
  private readonly defaultTimeoutMs: number;

  /** Constructs a FetchHttpClient. */
  constructor(options: FetchHttpClientOptions = {}) {
    this.providerName = options.providerName ?? "http";
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Issues a request and buffers the full response body as text. */
  async request(options: HttpRequestOptions): Promise<HttpResponse> {
    const response = await this.execute(options);
    const body = await response.text();
    return { status: response.status, headers: headersToRecord(response.headers), body };
  }

  /** Issues a request and returns the response body as an incremental byte stream. */
  async requestStream(options: HttpRequestOptions): Promise<HttpStreamResponse> {
    const response = await this.execute(options);
    return {
      status: response.status,
      headers: headersToRecord(response.headers),
      body: streamBody(response.body),
    };
  }

  private async execute(options: HttpRequestOptions): Promise<Response> {
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const init: RequestInit = {
        method: options.method,
        signal: controller.signal,
        ...(options.headers !== undefined ? { headers: options.headers } : {}),
        ...(options.body !== undefined ? { body: options.body } : {}),
      };
      return await fetch(options.url, init);
    } catch (cause) {
      if (controller.signal.aborted) {
        throw new ProviderTimeoutError(
          `Request to "${options.url}" timed out after ${timeoutMs}ms`,
          this.providerName,
          { cause },
        );
      }
      throw new ProviderConnectionError(
        `Request to "${options.url}" failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        this.providerName,
        { cause },
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
