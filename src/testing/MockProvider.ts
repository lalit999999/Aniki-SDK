import type {
  FinishReason,
  IProvider,
  ProviderCapabilities,
  ProviderRequest,
  ProviderResponse,
  ProviderStreamChunk,
} from "../providers/AIProvider.js";
import type { ToolCall } from "../types/tool.js";
import { generateId } from "../utils/id.js";
import { sleep } from "../utils/async.js";

/** {@link ProviderCapabilities} a {@link MockProvider} exposes unless overridden via {@link MockProviderOptions.capabilities}. */
const DEFAULT_CAPABILITIES: ProviderCapabilities = {
  streaming: true,
  toolCalling: true,
  structuredOutput: true,
};

/** The {@link ProviderResponse} a {@link MockProvider} returns when nothing was enqueued, and the base every {@link MockProvider.enqueueResponse} partial is merged over. */
const DEFAULT_RESPONSE: ProviderResponse = {
  content: "Mock response",
  model: "mock-model",
};

/** The `finishReason` a scripted stream's final chunk carries when {@link MockProvider.enqueueStream} was not given one. */
const DEFAULT_STREAM_FINISH_REASON: FinishReason = "stop";

/** Options accepted by the {@link MockProvider} constructor. */
export interface MockProviderOptions {
  /** This provider's reported name. Defaults to `"mock"`. */
  readonly name?: string;
  /** Overrides for the default (all-`true`) {@link ProviderCapabilities}. Set `streaming: false`, etc. to exercise capability-gated failure paths. */
  readonly capabilities?: Partial<ProviderCapabilities>;
  /** Artificial delay, in milliseconds, before `generate`/`generateStream` resolve. Defaults to `0`. */
  readonly latencyMs?: number;
  /** Responses queued at construction time, equivalent to calling {@link enqueueResponse} for each in order. */
  readonly responses?: readonly Partial<ProviderResponse>[];
}

type QueueEntry =
  | { readonly kind: "response"; readonly response: ProviderResponse }
  | { readonly kind: "error"; readonly error: unknown };

interface QueuedStream {
  readonly deltas: readonly string[];
  readonly finishReason: FinishReason;
}

/**
 * A scripted, in-process {@link IProvider} test double.
 *
 * Replaces the hand-rolled `IProvider` object literals every test file used
 * to declare individually. Queue up responses, tool calls, errors, or a
 * stream script, then run an {@link Agent}/{@link Runner} against it exactly
 * as you would a real provider — no network, no vendor SDK.
 *
 * @example
 * ```ts
 * const provider = new MockProvider();
 * provider.enqueueResponse({ content: "Hello, Lalit!" });
 *
 * const runner = new Runner();
 * const result = await runner.run(agent, { message: "Hi" });
 *
 * expect(provider.callCount).toBe(1);
 * expect(provider.lastRequest?.model).toBe("gpt-5.5");
 * ```
 */
export class MockProvider implements IProvider {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;
  private readonly latencyMs: number;
  private readonly queue: QueueEntry[] = [];
  private readonly streamQueue: QueuedStream[] = [];
  private readonly recordedCalls: ProviderRequest[] = [];

  /** Constructs a MockProvider. All options are optional; a fresh instance responds successfully with defaults until scripted otherwise. */
  constructor(options: MockProviderOptions = {}) {
    this.name = options.name ?? "mock";
    this.capabilities = { ...DEFAULT_CAPABILITIES, ...options.capabilities };
    this.latencyMs = options.latencyMs ?? 0;
    for (const partial of options.responses ?? []) {
      this.enqueueResponse(partial);
    }
  }

  /**
   * Queues a response for the next {@link generate} call. `partial` is
   * merged over a sane default, so a test only sets the fields it cares
   * about.
   *
   * @returns `this`, for chaining.
   * @example
   * ```ts
   * provider.enqueueResponse({ content: "42" }).enqueueResponse({ content: "done" });
   * ```
   */
  enqueueResponse(partial: Partial<ProviderResponse> = {}): this {
    this.queue.push({ kind: "response", response: { ...DEFAULT_RESPONSE, ...partial } });
    return this;
  }

  /**
   * Queues an assistant turn that requests a tool call, for the next
   * {@link generate} call.
   *
   * @returns `this`, for chaining.
   * @example
   * ```ts
   * provider.enqueueToolCall("get_weather", { city: "Gaya" });
   * ```
   */
  enqueueToolCall(name: string, args: Readonly<Record<string, unknown>>, id?: string): this {
    const toolCall: ToolCall = { id: id ?? generateId("call"), name, arguments: args };
    this.queue.push({
      kind: "response",
      response: {
        ...DEFAULT_RESPONSE,
        content: "",
        finishReason: "tool_use",
        toolCalls: [toolCall],
      },
    });
    return this;
  }

  /**
   * Queues a rejection for the next {@link generate} call — for exercising
   * failure paths (a `ProviderResponseError` subclass, a timeout, ...).
   *
   * @returns `this`, for chaining.
   * @example
   * ```ts
   * provider.enqueueError(new RateLimitError("rate limited", "mock"));
   * ```
   */
  enqueueError(error: unknown): this {
    this.queue.push({ kind: "error", error });
    return this;
  }

  /**
   * Scripts the next {@link generateStream} call to yield one
   * {@link ProviderStreamChunk} per entry in `deltas`, with `finishReason`
   * attached to the final chunk.
   *
   * @returns `this`, for chaining.
   * @example
   * ```ts
   * provider.enqueueStream(["Hel", "lo"], "stop");
   * ```
   */
  enqueueStream(deltas: readonly string[], finishReason: FinishReason = "stop"): this {
    this.streamQueue.push({ deltas, finishReason });
    return this;
  }

  /** Every request this provider has received, in call order. */
  get calls(): readonly ProviderRequest[] {
    return [...this.recordedCalls];
  }

  /** The number of `generate`/`generateStream` calls received so far. */
  get callCount(): number {
    return this.recordedCalls.length;
  }

  /** The most recent request received, or `undefined` if none yet. */
  get lastRequest(): ProviderRequest | undefined {
    return this.recordedCalls[this.recordedCalls.length - 1];
  }

  /** Clears every recorded call and queued response/stream/error. */
  reset(): void {
    this.queue.length = 0;
    this.streamQueue.length = 0;
    this.recordedCalls.length = 0;
  }

  /**
   * Resolves with the next queued response (or default), or rejects with
   * the next queued error. Records `request` regardless of outcome.
   */
  async generate(request: ProviderRequest): Promise<ProviderResponse> {
    this.recordedCalls.push(request);
    if (this.latencyMs > 0) {
      await sleep(this.latencyMs);
    }
    const entry = this.queue.shift();
    if (!entry) {
      return { ...DEFAULT_RESPONSE };
    }
    if (entry.kind === "error") {
      throw entry.error;
    }
    return entry.response;
  }

  /**
   * Yields the next queued stream script (or a single default chunk).
   *
   * Records `request` synchronously, at call time — not lazily on first
   * iteration — so a caller that inspects {@link calls} immediately after
   * calling this (without yet awaiting/draining the returned iterable, the
   * way a real async generator would behave) still observes the call.
   */
  generateStream(request: ProviderRequest): AsyncIterable<ProviderStreamChunk> {
    this.recordedCalls.push(request);
    const entry = this.streamQueue.shift() ?? {
      deltas: [DEFAULT_RESPONSE.content],
      finishReason: DEFAULT_STREAM_FINISH_REASON,
    };
    const deltas = entry.deltas.length > 0 ? entry.deltas : [""];
    const latencyMs = this.latencyMs;

    const run = async function* (this: void): AsyncGenerator<ProviderStreamChunk> {
      if (latencyMs > 0) {
        await sleep(latencyMs);
      }
      const lastIndex = deltas.length - 1;
      for (const [index, delta] of deltas.entries()) {
        yield index === lastIndex ? { delta, finishReason: entry.finishReason } : { delta };
      }
    };
    return run();
  }
}
