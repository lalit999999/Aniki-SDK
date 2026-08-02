# API Reference

Every item exported from `aniki-sdk` and `aniki-sdk/testing`, grouped into the same sections
`src/index.ts` itself uses. Anything not listed here is internal to the package and not part of the
public surface — using it directly is unsupported.

- [Configuration](#configuration)
- [Core](#core)
- [Tools](#tools)
- [Providers](#providers)
- [Middleware](#middleware)
- [Logging](#logging)
- [Errors](#errors)
- [Streaming & Output](#streaming--output)
- [Types & Events](#types--events)
- [Testing (`aniki-sdk/testing`)](#testing-aniki-sdktesting)

---

## Configuration

### `Aniki`

The shared global configuration singleton (an instance of the internal `AnikiSDK` class — only
this instance is exported, not the class).

- **`Aniki.configure(options: AnikiConfigOptions): void`** — Validates and merges `options` into
  the current configuration. Calls merge rather than replace. `apiKey` falls back to the
  environment variable for `options.provider ?? options.defaultProvider` if not supplied.
  **Throws:** `ConfigurationError` if `options` fails validation.
- **`Aniki.getConfig(): Readonly<AnikiConfigOptions>`** — Returns a frozen snapshot of the current
  configuration.

```ts
import { Aniki } from "aniki-sdk";

Aniki.configure({ provider: "openai", apiKey: "sk-...", timeout: 30_000 });
Aniki.getConfig(); // { provider: "openai", apiKey: "sk-...", timeout: 30_000 }
```

**Notes:** See [Providers](./providers.md#configuration-resolution) for how this interacts with
per-provider configuration resolution.

### `PROVIDER_API_KEY_ENV_VAR`

`Readonly<Record<ProviderName, string>>` — maps each provider name to the environment variable its
API key is read from (`openai` → `"OPENAI_API_KEY"`, etc.).

### `resolveApiKeyFromEnv(provider: ProviderName): string | undefined`

Reads `provider`'s API key from its designated environment variable, or returns `undefined` if
unset.

### `AnikiConfigOptions` (type)

| Field | Type | Description |
| --- | --- | --- |
| `provider?` | `ProviderName` | The provider this configuration targets. |
| `apiKey?` | `string` | An explicit API key. |
| `baseURL?` | `string` | An explicit base URL. |
| `timeout?` | `number` | Request timeout, in milliseconds. |
| `retryCount?` | `number` | Retry count (informational at the config level; not itself applied — see `RetryMiddleware` for actual retry behavior). |
| `defaultModel?` | `string` | A default model identifier. |
| `defaultProvider?` | `ProviderName` | A default provider, used as a fallback target for resolution. |

### `ProviderName` (type)

`"openai" | "anthropic" | "gemini" | "ollama" | "groq" | "openrouter"`. See
[Providers](./providers.md) for which of these are actually registered.

### `ProviderConfig` (type)

| Field | Type | Description |
| --- | --- | --- |
| `apiKey?` | `string` | The API key to authenticate with. |
| `baseURL?` | `string` | Overrides the provider's default base URL. |
| `model?` | `string` | A default model for this provider config. |
| `timeout?` | `number` | Request timeout, in milliseconds. |

---

## Core

### `Agent`

A pure configuration container. Never communicates with a provider directly. Generic over
`TOutput` — `new Agent({ output: schema })` yields an `Agent<TOutput>` whose `RunResult.output` is
typed accordingly. See [Your First Agent](./first-agent.md).

**Constructor:** `new Agent(options: AgentOptions<TOutput>)`
**Throws:** `ValidationError` if `options` is invalid (missing required fields, a `provider` that
doesn't implement `IProvider`, a non-Zod `output` schema, malformed `middleware`, or a `Tool` name
collision surfaced as `DuplicateToolError` via the internal `ToolRegistry`).

**Getters:** `name`, `instructions`, `model`, `provider`, `session`, `output`, `tools`,
`toolRegistry`, `maxToolIterations`, `middleware` — all readonly, mirroring `AgentOptions`.

```ts
import { Agent } from "aniki-sdk";

const agent = new Agent({
  name: "Assistant",
  instructions: "You are a helpful assistant.",
  model: "gpt-4o-mini",
  provider: "openai",
});
```

### `AgentOptions<TOutput = undefined>` (type)

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `name` | `string` | — | Required. Human-readable label. |
| `instructions` | `string` | — | Required. System prompt. |
| `model` | `string` | — | Required. Opaque model identifier, passed through unchanged. |
| `provider` | `IProvider \| ProviderName` | — | Required. |
| `session?` | `ISession` | fresh `InMemorySession` | |
| `output?` | `z.ZodType<TOutput>` | none | Infers `TOutput`. |
| `tools?` | `readonly Tool[]` | `[]` | |
| `maxToolIterations?` | `number` | `5` | |
| `middleware?` | `readonly IMiddleware[]` | `[]` | |

### `Context`

Per-run, request-scoped execution state. Generic over `TAgent`/`TInput`. A fresh instance is created on every `Runner.run`/`stream`
call. Unrelated to conversation history — see [Memory](./memory.md#context-not-memory).

**Constructor:** `new Context(options: ContextOptions<TAgent, TInput>)`
**Throws:** `ValidationError` if `agent` or `input` is missing.

**Properties:** `agent: TAgent`, `input: TInput`, `runId: string`, `startedAt: Date`.
**Methods:** `set(key: string, value: unknown): void`, `get<T>(key: string): T | undefined`,
`has(key: string): boolean`.

```ts
import { Context } from "aniki-sdk";

const context = new Context({ agent: {}, input: { message: "hi" } });
context.set("traceId", "abc-123");
context.get<string>("traceId"); // "abc-123"
```

### `ContextOptions<TAgent, TInput>` (type)

| Field | Type | Description |
| --- | --- | --- |
| `agent` | `TAgent` | Required. |
| `input` | `TInput` | Required. |
| `runId?` | `string` | Overrides the generated UUID. |

### `EventEmitter<TEvents extends EventMap>`

A small, strongly-typed publish/subscribe emitter. Used internally by `Runner`; exported for
building your own typed event surfaces.

**Constructor:** `new EventEmitter<TEvents>()`
**Methods:**
- `on(event, listener): () => void` — subscribes; returns an unsubscribe function.
- `off(event, listener): void`
- `once(event, listener): () => void` — auto-unsubscribes after one invocation.
- `emit(event, ...args): void` — never throws; a throwing listener is isolated so remaining
  listeners still run.

```ts
import { EventEmitter } from "aniki-sdk";
import type { EventMap } from "aniki-sdk";

interface MyEvents extends EventMap {
  greeting: [name: string];
}

const emitter = new EventEmitter<MyEvents>();
emitter.on("greeting", (name) => console.log(`Hello, ${name}`));
emitter.emit("greeting", "world");
```

### `EventMap` / `Listener<TArgs>` (types)

`EventMap = Record<string, unknown[]>`. `Listener<TArgs> = (...args: TArgs) => void`.

### `Memory`

An ordered, append-only store of `Message`s. `Session` (specifically `InMemorySession`) builds
conversation history on top of this; it has no concept of session identity.

**Constructor:** `new Memory()`
**Methods:**
- `addMessage(message: Message): void` — **Throws:** `ValidationError` for an invalid role,
  non-string content, empty content (unless an assistant message with `toolCalls`), `toolCalls` on
  a non-assistant message, or a `role: "tool"` message missing `toolCallId`.
- `getMessages(): readonly Message[]` — a snapshot, in insertion order.
- `clear(): void`

### `InMemorySession`

The only shipped `ISession` implementation, backed by an in-process `Memory`. See
[Memory](./memory.md#session-memory).

**Constructor:** `new InMemorySession(id: string)`
**Throws:** `ValidationError` if `id` is empty.
**Implements:** `ISession` — `id`, `addMessage`, `getMessages`, `clear`.

### `ISession` (type)

| Member | Type | Description |
| --- | --- | --- |
| `id` | `string` | This session's id. |
| `addMessage` | `(message: Message) => void` | Appends a message. |
| `getMessages` | `() => readonly Message[]` | Full history, in order. |
| `clear` | `() => void` | Clears history. |

### `Runner`

The execution engine. The only component permitted to call a provider. See
[Your First Agent](./first-agent.md), [Generating Text](./generate-text.md), and
[Streaming](./streaming.md).

**Constructor:** `new Runner(emitter?: EventEmitter<RunnerEvents>, outputPipeline?: OutputPipeline, options?: RunnerOptions)`
All three parameters are positional and optional — `new Runner()` is the common case.
**Throws:** `ValidationError` if `options.middleware` contains a non-`IMiddleware` entry.

**Methods:**
- `on<K>(event: K, listener): () => void` — subscribes to a `RunnerEvents` event; returns an
  unsubscribe function.
- `off<K>(event: K, listener): void`
- `once<K>(event: K, listener): () => void`
- `run<TOutput>(agent: Agent<TOutput>, input: RunInput): Promise<RunResult<TOutput>>` — **Throws:**
  `ValidationError` (empty message), `ProviderError` (provider failure), `MaxToolIterationsError`,
  `OutputParseError`/`OutputValidationError` (when the agent has an output schema).
- `stream<TOutput>(agent: Agent<TOutput>, input: RunInput): RunStream<TOutput>` — **Throws:**
  `ValidationError` (empty message), `StreamingNotSupportedError` (synchronously, before any
  request — non-streaming provider or an agent with tools).

```ts
import { Runner } from "aniki-sdk";

const runner = new Runner(undefined, undefined, { middleware: [] });
```

### `RunInput` (type)

`{ readonly message: string }`.

### `RunnerEvents` (type)

The full event map `Runner` emits — every canonical name from `AnikiEvents`, plus deprecated
pre-rename aliases (`agent:started`, `agent:finished`, `llm:request`, `llm:response`,
`tool:started`, `tool:finished`) and a legacy generic `error` event. See
[Types & Events](#types--events) for the canonical payload shapes.

### `RunnerOptions` (type)

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `middleware?` | `readonly IMiddleware[]` | `[]` | Runs before any agent-level middleware. |
| `logger?` | `ILogger` | `NoopLogger` | Logged to when a `MiddlewareError` escapes the pipeline. |

### `RunResult` (type)

Generic over `TOutput`, matching the `Agent` it was produced from.

| Field | Type | Description |
| --- | --- | --- |
| `content` | `string` | The assistant's final reply. |
| `output` | `TOutput` | Validated output, or `undefined` if the agent has no schema. |
| `runId` | `string` | |
| `messages` | `readonly Message[]` | Full history including this turn. |
| `toolResults` | `readonly ToolResult[]` | Every tool result this turn, in order. |
| `iterations` | `number` | Provider round trips this turn took. |
| `metadata` | `RunMetadata` | |

### `RunStream`

The one-shot handle returned by `Runner.stream`. Generic over `TOutput`. See [Streaming](./streaming.md) for full behavior.

**Not constructed directly** — always via `Runner.stream`.

**Members:**
- `[Symbol.asyncIterator](): AsyncIterator<StreamEvent>` — **Throws:** `StreamConsumedError` if
  called more than once (across any of the three channels).
- `textStream: AsyncIterable<string>` — delta text only.
- `result: Promise<RunResult<TOutput>>` — drains the stream if unconsumed; otherwise awaits the
  existing consumption's outcome.
- `abort(reason?: string): void` — surfaces `StreamAbortedError` through whichever channel is
  consuming.

### `RunStreamOptions<TOutput>` (type)

Internal constructor options for `RunStream` — `runId`, `model`, `provider`, `session`, `source`,
`outputParser?`, `startedAt`. Not something you construct yourself; documented here only because
the type is exported.

---

## Tools

### `Tool`

A pure, self-describing tool definition. Generic over `TInput`/`TOutput`. See
[Tools](./tools.md).

**Constructor:** `new Tool(options: ToolOptions<TInput, TOutput>)`
**Throws:** `ValidationError` for an invalid `name` (must match `/^[a-zA-Z0-9_-]{1,64}$/`), a
missing `description`, a non-Zod `input`/`output` schema, or a non-function `execute`.

**Getters:** `name`, `description`, `inputSchema`, `outputSchema`, `timeoutMs`, `retries`, `cache`,
`tags`, `metadata`.

**Methods:**
- `parseInput(raw: unknown): TInput` — **Throws:** `ToolInputValidationError`.
- `parseOutput(raw: unknown): TOutput` — **Throws:** `ToolOutputValidationError`. Passes through
  unchanged if no output schema was configured.
- `toDefinition(): ToolDefinition` — renders the input schema as a provider-agnostic definition.
- `invoke(input: TInput, context?: ToolContext): Promise<TOutput>` — calls `execute` directly, no
  validation, no timeout/retry. Intended for `ToolExecutor`.
- `run(input: TInput): Promise<TOutput>` — validate → execute → validate, no timeout/retry. The
  unit-test path — see [Tools](./tools.md#unit-testing-a-tool--no-llm-required).

```ts
import { Tool } from "aniki-sdk";
import { z } from "zod";

const weatherTool = new Tool({
  name: "get_weather",
  description: "Get the current weather for a city.",
  input: z.object({ city: z.string() }),
  output: z.object({ tempC: z.number() }),
  execute: async ({ city }) => ({ tempC: 21 }),
});

await weatherTool.run({ city: "Gaya" }); // { tempC: 21 }
```

### `ToolContext` (type)

| Field | Type | Description |
| --- | --- | --- |
| `signal?` | `AbortSignal` | Aborted by `ToolExecutor` on timeout. |
| `toolCallId?` | `string` | The id of the call currently executing. |

### `ToolOptions<TInput, TOutput>` (type)

| Field | Type | Description |
| --- | --- | --- |
| `name` | `string` | Must match `/^[a-zA-Z0-9_-]{1,64}$/`. |
| `description` | `string` | |
| `input` | `z.ZodType<TInput>` | |
| `output?` | `z.ZodType<TOutput>` | |
| `execute` | `(input: TInput, context?: ToolContext) => Promise<TOutput> \| TOutput` | |
| `timeoutMs?` | `number` | Applied by `ToolExecutor`, not `Tool` itself. |
| `retries?` | `number` | Applies only to execution/timeout failures. |
| `cache?` | `boolean` | |
| `tags?` | `readonly string[]` | |
| `metadata?` | `Readonly<Record<string, unknown>>` | |

### `ToolExecutor`

Validates, executes, times, and contains failures for `ToolCall`s resolved from an injected
`ToolRegistry`. Never rejects for a tool-level failure. See
[Tools](./tools.md#execution-validation-and-error-handling).

**Constructor:** `new ToolExecutor(registry: ToolRegistry, options?: ToolExecutorOptions)`
**Methods:**
- `execute(call: ToolCall, context?: ToolContext): Promise<ToolResult>` — always resolves.
- `executeAll(calls: readonly ToolCall[], context?: ToolContext): Promise<readonly ToolResult[]>`

```ts
import { ToolExecutor, ToolRegistry } from "aniki-sdk";

const registry = new ToolRegistry([]);
const executor = new ToolExecutor(registry);
const results = await executor.executeAll([]);
```

### `ToolExecutorOptions` (type)

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `concurrency?` | `number` | `1` | Batch size for `executeAll`. |

### `ToolRegistry`

A `Map`-backed store of `Tool`s, keyed by name.

**Constructor:** `new ToolRegistry(tools?: Iterable<Tool>)` — **Throws:** `DuplicateToolError` on a
name collision.
**Methods:** `register(tool)`, `registerAll(tools)` (atomic), `get(name)`, `getOrThrow(name)`
(**Throws:** `ToolNotFoundError`), `has(name)`, `list()`, `names()`, `unregister(name)`, `clear()`,
`toDefinitions()`. **Getter:** `size`.

---

## Providers

### `BearerAuthStrategy` / `HeaderAuthStrategy` / `NoAuthStrategy`

`IAuthStrategy` implementations. `BearerAuthStrategy(apiKey)` sends
`Authorization: Bearer <apiKey>`; `HeaderAuthStrategy(headerName, apiKey)` sends an arbitrary
header; `NoAuthStrategy()` sends none. Each exposes `getHeaders(): Readonly<Record<string, string>>`.

### `IAuthStrategy` (type)

`{ getHeaders(): Readonly<Record<string, string>> }`.

### `FetchHttpClient`

The SDK's only `fetch`-based `IHttpClient`. Enforces a per-request timeout, translating a
timeout-triggered abort into `ProviderTimeoutError` and any other `fetch` rejection into
`ProviderConnectionError`.

**Constructor:** `new FetchHttpClient(options?: FetchHttpClientOptions)`
**Methods:** `request(options): Promise<HttpResponse>`, `requestStream(options): Promise<HttpStreamResponse>`.

### `FetchHttpClientOptions` / `HttpMethod` / `HttpRequestOptions` / `HttpResponse` / `HttpStreamResponse` / `IHttpClient` (types)

The transport abstraction every provider issues requests through. `IHttpClient` is
`{ request, requestStream }`; see the source-level JSDoc for full field tables — these are
transport-layer types most application code never touches directly.

### `DEFAULT_BASE_URL` / `OPENROUTER_DEFAULT_BASE_URL`

`string` constants: OpenAI's (`"https://api.openai.com/v1"`) and OpenRouter's
(`"https://openrouter.ai/api/v1"`) default base URLs, used by `OpenAIProvider` when
`ProviderConfig.baseURL` is omitted.

### `OpenAIProvider`

The OpenAI implementation of `IProvider`. See [Providers](./providers.md#openai).

**Constructor:** `new OpenAIProvider(config: ProviderConfig, deps?: OpenAIProviderDependencies)`
**Throws:** `ConfigurationError` if `config` is invalid (missing/empty `apiKey`).
**Properties:** `name` (default `"openai"`), `capabilities` (`{ streaming: true, toolCalling:
false, structuredOutput: false }`).
**Methods:** `generate(request): Promise<ProviderResponse>`, `generateStream(request):
AsyncIterable<ProviderStreamChunk>`.

```ts
import { OpenAIProvider } from "aniki-sdk";

const provider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY ?? "" });
```

### `OpenAIProviderDependencies` (type)

| Field | Type | Description |
| --- | --- | --- |
| `httpClient?` | `IHttpClient` | Defaults to `FetchHttpClient`. |
| `authStrategy?` | `IAuthStrategy` | Defaults to `BearerAuthStrategy`. |
| `name?` | `string` | Overrides `IProvider.name` (used for `"openrouter"`). |
| `defaultBaseURL?` | `string` | Used when `config.baseURL` is omitted. |

### `ProviderFactory`

Resolves and instantiates `IProvider`s by name.

**Static method:** `ProviderFactory.create(name: string, config?: ProviderConfig, registry?: ProviderRegistry): IProvider`
**Throws:** `ConfigurationError` if `name` isn't registered or a required API key can't be resolved.

### `registerBuiltInProviders(registry: ProviderRegistry): void`

Registers the SDK's built-in providers (`"openai"`, `"openrouter"`) against `registry`, skipping
any name already registered. Called lazily by `ProviderFactory.create`.

### `defaultProviderRegistry`

The shared `ProviderRegistry` instance `ProviderFactory` resolves against by default.

### `ProviderRegistry`

A name → factory-function registry.

**Constructor:** `new ProviderRegistry()`
**Methods:** `register(name, factory)` (**Throws:** `ConfigurationError` if already registered),
`has(name)`, `list()`, `resolve(name)` (**Throws:** `ConfigurationError` if unregistered, listing
available names).

```ts
import { ProviderRegistry } from "aniki-sdk";

const registry = new ProviderRegistry();
registry.register("custom", (config) => {
  throw new Error("implement me: " + JSON.stringify(config));
});
```

### `ProviderFactoryFn` (type)

`(config: ProviderConfig) => IProvider`.

### `FinishReason` (type)

`"stop" | "length" | "tool_use" | "content_filter" | "error" | "other"`.

### `GenerationParams` (type)

| Field | Type | Description |
| --- | --- | --- |
| `temperature?` | `number` | Typically `0`–`2`. |
| `maxTokens?` | `number` | |
| `topP?` | `number` | `0`–`1`. |
| `stopSequences?` | `readonly string[]` | |

Not reachable through `Agent`/`Runner` today — see
[Generating Text](./generate-text.md#generation-parameters).

### `IProvider` (type)

| Member | Type |
| --- | --- |
| `name` | `string` |
| `capabilities` | `ProviderCapabilities` |
| `generate` | `(request: ProviderRequest) => Promise<ProviderResponse>` |
| `generateStream` | `(request: ProviderRequest) => AsyncIterable<ProviderStreamChunk>` |

### `ProviderCapabilities` (type)

`{ streaming: boolean; toolCalling: boolean; structuredOutput: boolean }`.

### `ProviderRequest` (type)

| Field | Type | Description |
| --- | --- | --- |
| `messages` | `readonly Message[]` | |
| `model` | `string` | |
| `params?` | `GenerationParams` | |
| `tools?` | `readonly ToolDefinition[]` | Omitted entirely when the agent has none. |

### `ProviderResponse` (type)

| Field | Type | Description |
| --- | --- | --- |
| `content` | `string` | |
| `model` | `string` | |
| `id?` | `string` | |
| `finishReason?` | `FinishReason` | |
| `usage?` | `TokenUsage` | |
| `toolCalls?` | `readonly ToolCall[]` | |

### `ProviderStreamChunk` (type)

| Field | Type | Description |
| --- | --- | --- |
| `delta` | `string` | |
| `finishReason?` | `FinishReason` | Final chunk only. |
| `usage?` | `TokenUsage` | Final chunk only, when reported. |

### `TokenUsage` (type)

`{ promptTokens: number; completionTokens: number; totalTokens: number }`.

### Provider error classes

`AuthenticationError`, `InvalidRequestError`, `ModelNotFoundError`, `ProviderConnectionError`,
`ProviderResponseError` (the base class), `ProviderTimeoutError`, `RateLimitError` — see
[Error Handling](./error-handling.md#provider-errors) for the full table (status codes,
retryability) and usage examples.

### `ProviderErrorDetails` / `RateLimitErrorDetails` (types)

| Field | Type | Description |
| --- | --- | --- |
| `statusCode?` | `number` | |
| `providerCode?` | `string` | |
| `cause?` | `unknown` | |
| `retryAfterSeconds?` | `number` | `RateLimitErrorDetails` only. |

---

## Middleware

### `BaseMiddleware`

Convenience abstract base for custom middleware — implements `name` storage so a subclass only
needs `execute`.

```ts
import { BaseMiddleware } from "aniki-sdk";
import type { MiddlewareNext, MiddlewareRequest, MiddlewareResponse } from "aniki-sdk";

class TimingMiddleware extends BaseMiddleware {
  constructor() {
    super("TimingMiddleware");
  }
  async execute(request: MiddlewareRequest, next: MiddlewareNext): Promise<MiddlewareResponse> {
    const start = Date.now();
    const result = await next(request);
    console.log(`${request.model} took ${Date.now() - start}ms`);
    return result;
  }
}
```

### `IMiddleware` / `MiddlewareNext` / `MiddlewareRequest` / `MiddlewareResponse` (types)

| Type | Shape |
| --- | --- |
| `IMiddleware` | `{ name: string; execute(request, next): Promise<MiddlewareResponse> }` |
| `MiddlewareNext` | `(request: MiddlewareRequest) => Promise<MiddlewareResponse>` |
| `MiddlewareRequest` | `{ runId, agentName, model, providerName, messages, tools?, iteration, context }` |
| `MiddlewareResponse` | `{ response: ProviderResponse; fromCache: boolean; attempts: number }` |

Exactly one call to `next()` per invocation is permitted — a second call, or resolving without
returning a `MiddlewareResponse`, throws `MiddlewareContractError`.

### `CacheMiddleware`

Serves a cached `ProviderResponse` for a repeated request. See
[Error Handling](./error-handling.md) and the middleware section of
[Generating Text](./generate-text.md) for how it composes with the tool loop.

**Constructor:** `new CacheMiddleware(options?: CacheMiddlewareOptions)`

```ts
import { CacheMiddleware } from "aniki-sdk";

const cache = new CacheMiddleware({ ttlMs: 60_000 });
void cache;
```

### `InMemoryCacheStore`

The default `ICacheStore` — an in-process, `Map`-backed store with lazy expiry and LRU eviction.

**Constructor:** `new InMemoryCacheStore(options?: InMemoryCacheStoreOptions)`
**Methods:** `get(key)`, `set(key, value, ttlMs)`, `delete(key)`, `clear()` — all `async`.

### `CacheMiddlewareOptions` / `ICacheStore` / `InMemoryCacheStoreOptions` (types)

| Field (`CacheMiddlewareOptions`) | Type | Default |
| --- | --- | --- |
| `store?` | `ICacheStore` | fresh `InMemoryCacheStore` |
| `ttlMs?` | `number` | `300_000` |
| `keyBuilder?` | `(request: MiddlewareRequest) => string` | SHA-256 of `{ model, providerName, messages, tools }` |
| `enabled?` | `boolean` | `true` |
| `logger?` | `ILogger` | none |

`ICacheStore` is `{ get, set, delete, clear }`, all returning `Promise`s. Never caches a response
carrying `toolCalls`; a throwing store degrades to a miss/no-op, wrapped in `CacheError` for
logging.

### `LoggingMiddleware`

Logs the start, end, and failure of every provider round trip it wraps.

**Constructor:** `new LoggingMiddleware(options: LoggingMiddlewareOptions)` — `options.logger` is
required (no default).

```ts
import { ConsoleLogger, LoggingMiddleware } from "aniki-sdk";

const middleware = new LoggingMiddleware({ logger: new ConsoleLogger({ level: "info" }) });
void middleware;
```

### `LoggingMiddlewareOptions` (type)

| Field | Type | Default |
| --- | --- | --- |
| `logger` | `ILogger` | required |
| `level?` | `LogLevel` | `"info"` |
| `logContent?` | `boolean` | `false` |

### `MiddlewarePipeline`

Composes an ordered list of `IMiddleware` into a single `MiddlewareNext`, Express-style.

**Constructor:** `new MiddlewarePipeline(middleware?: readonly IMiddleware[])` — **Throws:**
`ValidationError` for a non-`IMiddleware` entry.
**Methods:** `use(middleware)` (chainable), `remove(name)`, `list()`,
`execute(request, terminal): Promise<MiddlewareResponse>`.

### `RetryMiddleware`

Retries a provider round trip on transient failure. See
[Error Handling](./error-handling.md#retry-strategy).

**Constructor:** `new RetryMiddleware(options?: RetryMiddlewareOptions)` — **Throws:**
`ConfigurationError` if `options` fails validation.

```ts
import { RetryMiddleware } from "aniki-sdk";

const retry = new RetryMiddleware({ maxAttempts: 3 });
void retry;
```

### `RetryMiddlewareOptions` (type)

| Field | Type | Default |
| --- | --- | --- |
| `maxAttempts?` | `number` | `3` |
| `initialDelayMs?` | `number` | `250` |
| `maxDelayMs?` | `number` | `8000` |
| `backoffFactor?` | `number` | `2` |
| `jitter?` | `boolean` | `true` |
| `isRetryable?` | `(error: unknown) => boolean` | retries only a retryable `ProviderResponseError` |
| `logger?` | `ILogger` | none |
| `sleep?` | `(ms: number) => Promise<void>` | real `setTimeout` |

---

## Logging

### `ConsoleLogger`

An `ILogger` writing to an injectable console-shaped sink (the global `console` by default).
Redacts fields before every write. See [FAQ](./faq.md).

**Constructor:** `new ConsoleLogger(options?: ConsoleLoggerOptions)`
**Methods:** `debug`, `info`, `warn`, `error` (all `(message, fields?) => void`), `child(bindings):
ILogger`.

```ts
import { ConsoleLogger } from "aniki-sdk";

const logger = new ConsoleLogger({ level: "info" });
logger.info("run started", { runId: "abc-123" });
```

### `ConsoleLoggerOptions` / `ConsoleSink` (types)

| Field (`ConsoleLoggerOptions`) | Type | Default |
| --- | --- | --- |
| `level?` | `LogLevel` | `"info"` |
| `json?` | `boolean` | `false` |
| `sink?` | `ConsoleSink` | global `console` |

`ConsoleSink` is `{ debug, info, warn, error }`, each `(line: string) => void`.

### `LOG_LEVEL_PRIORITY`

`Readonly<Record<LogLevel, number>>` — numeric ordering, `debug: 0` through `silent: 4`.

### `NoopLogger`

The SDK's default `ILogger` — every method is a no-op. Used everywhere a caller hasn't supplied
their own logger.

### `redactFields<T extends LogFields>(fields: T): T`

Returns a deep copy of `fields` with any key matching `apiKey`, `authorization`, `api_key`,
`token`, `password`, or `secret` (case-insensitive, any nesting depth) replaced with
`"[redacted]"`.

### `ILogger` / `LogFields` / `LogLevel` (types)

`ILogger` is `{ debug, info, warn, error, child }`. `LogFields` is `{ [key: string]: unknown }`.
`LogLevel` is `"debug" | "info" | "warn" | "error" | "silent"`.

---

## Errors

Every class below extends `AnikiError` (directly or via an abstract intermediate base). See
[Error Handling](./error-handling.md) for the full code table, provider-error status codes, and
usage examples — this section lists constructors and thrown-by context only.

### `AnikiError` (abstract base)

**Properties:** `code: ErrorCode` (abstract), `cause?: unknown`, `context: Readonly<Record<string, unknown>>`.
**Methods:** `toJSON(): AnikiErrorJson`. **Static:** `AnikiError.isAnikiError(value): value is AnikiError`.

### `isAnikiError(value: unknown): value is AnikiError`

Standalone form of `AnikiError.isAnikiError`.

### `isRetryableError(value: unknown): value is ProviderResponseError`

Narrows to a `ProviderResponseError` (or subclass) with `retryable === true`.

### Concrete error classes

| Class | Extends | Constructor |
| --- | --- | --- |
| `ConfigurationError` | `AnikiError` | `(message, context?)` |
| `ValidationError` | `AnikiError` | `(message, context?)` |
| `ProviderError` | `AnikiError` | `(message, cause?, context?)` |
| `ToolError` (abstract) | `AnikiError` | — |
| `DuplicateToolError` | `ToolError` | `(toolName)` |
| `ToolNotFoundError` | `ToolError` | `(toolName, toolCallId?)` |
| `ToolInputValidationError` | `ToolError` | `(toolName, issues, toolCallId?)` |
| `ToolOutputValidationError` | `ToolError` | `(toolName, issues, toolCallId?)` |
| `ToolExecutionError` | `ToolError` | `(toolName, cause, toolCallId?)` |
| `ToolTimeoutError` | `ToolError` | `(toolName, timeoutMs, toolCallId?)` |
| `MaxToolIterationsError` | `ToolError` | `(maxIterations)` |
| `OutputError` (abstract) | `AnikiError` | — |
| `OutputParseError` | `OutputError` | `(message, raw, cause?)` |
| `OutputValidationError` | `OutputError` | `(issues, raw)` |
| `OutputProcessingError` | `OutputError` | `(processorName, cause)` |
| `StreamError` | `AnikiError` | `(message, cause?, context?)` |
| `StreamAbortedError` | `StreamError` | `(reason?)` |
| `StreamConsumedError` | `StreamError` | `()` |
| `StreamingNotSupportedError` | `StreamError` | `(providerName, reason)` |
| `MiddlewareError` (abstract) | `AnikiError` | — |
| `MiddlewareExecutionError` | `MiddlewareError` | `(middlewareName, cause)` |
| `MiddlewareContractError` | `MiddlewareError` | `(middlewareName, message)` |
| `RetryExhaustedError` | `MiddlewareError` | `(attempts, cause)` |
| `CacheError` | `MiddlewareError` | `(operation, cause)` |

### `AnikiErrorJson` (type)

`{ name: string; code: string; message: string; context: Readonly<Record<string, unknown>>; cause?: { name: string; message: string } }` — the shape `toJSON()` returns.

### `ErrorCode` (type)

The union of every stable `code` literal in the core taxonomy (provider-layer errors all share
`"PROVIDER_ERROR"`). See the code table in [Error Handling](./error-handling.md#every-error-code).

---

## Streaming & Output

### `JsonExtractor`

Extracts a JSON payload from raw, untrusted model text — locating a fenced or bare balanced
`{...}`/`[...]` payload.

**Methods:** `extract(raw: string): string` (**Throws:** `OutputParseError`), `parse(raw: string):
unknown` (extract + `JSON.parse`, same throw).

### `OutputPipeline`

Runs a caller-defined chain of `IOutputProcessor`s over a run's output, sequentially. An empty
pipeline is the identity function.

**Constructor:** `new OutputPipeline(processors?: readonly IOutputProcessor[])`
**Methods:** `use(processor): this`, `run(context): Promise<OutputProcessingContext>` — **Throws:**
`OutputProcessingError`, naming the offending processor.

```ts
import { OutputPipeline } from "aniki-sdk";

const pipeline = new OutputPipeline().use({
  name: "trim",
  process: (context) => ({ ...context, text: context.text.trim() }),
});
void pipeline;
```

### `IOutputProcessor` / `OutputProcessingContext` (types)

`IOutputProcessor` is `{ name: string; process(context): OutputProcessingContext |
Promise<OutputProcessingContext> }`. `OutputProcessingContext` is `{ raw, text, metadata, data }`.

### `OutputValidator<TOutput>`

Validates an already-parsed JSON value against a Zod schema — the last, non-skippable step of the
output pipeline.

**Constructor:** `new OutputValidator(schema: z.ZodType<TOutput>)` — **Throws:** `ValidationError`
if `schema` isn't a Zod schema.
**Methods:** `validate(value, raw?): TOutput` (**Throws:** `OutputValidationError`),
`safeValidate(value, raw?): StructuredParseOutcome<TOutput>` (never throws).

### `StreamParser`

Turns a raw provider chunk stream into the SDK's typed `StreamEvent` vocabulary.

**Constructor:** `new StreamParser(options: StreamParserOptions)`
**Method:** `parse(chunks: AsyncIterable<ProviderStreamChunk>): AsyncGenerator<StreamEvent>`.

### `StreamParserOptions` (type)

`{ runId: string; model: string }`.

### `StreamReader`

Consumes a provider's raw chunk stream with cancellation and guaranteed cleanup.

**Constructor:** `new StreamReader(source: AsyncIterable<ProviderStreamChunk>, options?: StreamReaderOptions)`
**Method:** `read(): AsyncGenerator<ProviderStreamChunk>` — translates a foreign throw into
`StreamError`, and an aborted signal into `StreamAbortedError`.

### `StreamReaderOptions` (type)

`{ signal?: AbortSignal; providerName?: string }`.

### `StructuredOutputParser<TOutput>`

Turns raw model text into a schema-validated, typed value, and produces the prompt instructions
`Runner` appends to an agent's system message. See
[Generating Text](./generate-text.md#structured-output).

**Constructor:** `new StructuredOutputParser(schema: z.ZodType<TOutput>, deps?: StructuredOutputParserDependencies<TOutput>)`
**Methods:** `parse(raw): TOutput` (**Throws:** `OutputParseError`/`OutputValidationError`),
`safeParse(raw): StructuredParseOutcome<TOutput>` (never throws), `toJSONSchema()`,
`toFormatInstructions(): string`.

```ts
import { StructuredOutputParser } from "aniki-sdk";
import { z } from "zod";

const parser = new StructuredOutputParser(z.object({ name: z.string() }));
parser.parse('```json\n{"name": "Lalit"}\n```'); // { name: "Lalit" }
```

### `StructuredOutputParserDependencies<TOutput>` (type)

`{ extractor?: JsonExtractor; validator?: OutputValidator<TOutput> }`.

---

## Types & Events

### `EVENT_NAMES`

A frozen tuple of every canonical event name: `"agent:start"`, `"agent:end"`, `"agent:error"`,
`"llm:start"`, `"llm:end"`, `"llm:error"`, `"tool:start"`, `"tool:end"`, `"tool:error"`,
`"middleware:error"`.

### `LEGACY_EVENT_ALIASES`

Maps each canonical event name to the deprecated pre-rename name `Runner` still emits immediately
after it (e.g. `"agent:start"` → `"agent:started"`). `tool:error` and the `*:error` events have no
legacy predecessor and are absent from this map.

### Event payload types

| Type | Extends | Key fields beyond the base |
| --- | --- | --- |
| `BaseEventPayload` | — | `runId`, `timestamp` |
| `TimedEventPayload` | `BaseEventPayload` | `durationMs` |
| `AgentStartEvent` | `BaseEventPayload` | `agentName`, `model`, `providerName` |
| `AgentEndEvent` | `TimedEventPayload` | `agentName`, `model`, `providerName`, `iterations` |
| `AgentErrorEvent` | `BaseEventPayload` | `agentName`, `error` |
| `LlmStartEvent` | `BaseEventPayload` | `agentName`, `model`, `providerName`, `iteration`, `messageCount` |
| `LlmEndEvent` | `TimedEventPayload` | + `finishReason?`, `usage?` |
| `LlmErrorEvent` | `BaseEventPayload` | `agentName`, `model`, `providerName`, `iteration`, `error` |
| `ToolStartEvent` | `BaseEventPayload` | `toolName`, `toolCallId`, `call` |
| `ToolEndEvent` | `TimedEventPayload` | `toolName`, `toolCallId`, `ok` |
| `ToolErrorEvent` | `BaseEventPayload` | `toolName`, `toolCallId`, `error` |
| `MiddlewareErrorEvent` | `BaseEventPayload` | `middlewareName?`, `error` |

`AnikiEvents` is the canonical event map (`EventMap` keyed by each name above to its payload
tuple). `EventName` is the union of `EVENT_NAMES`' values.

### `Message` (type)

| Field | Type | Description |
| --- | --- | --- |
| `role` | `Role` | |
| `content` | `string` | Empty only for an assistant message with `toolCalls`. |
| `toolCalls?` | `readonly ToolCall[]` | Only on `role: "assistant"`. |
| `toolCallId?` | `string` | Required on `role: "tool"`. |
| `name?` | `string` | Set alongside `toolCallId`. |

### `Role` (type)

`"system" | "user" | "assistant" | "tool"`.

### `RunMetadata` (type)

`{ runId, model, provider, finishReason?, usage?, durationMs, iterations, streamed }`. See
[Generating Text](./generate-text.md#the-response-object).

### `StreamEvent` (type)

Discriminated union: `{ type: "start"; runId; model }` | `{ type: "delta"; text }` |
`{ type: "completed"; content; finishReason?; usage?; chunkCount }`. See
[Streaming](./streaming.md).

### `StructuredParseOutcome<T>` (type)

`{ ok: true; data: T } | { ok: false; error: OutputError }`.

### `ToolCall` (type)

`{ id: string; name: string; arguments: Readonly<Record<string, unknown>> }`.

### `ToolDefinition` (type)

`{ name: string; description: string; parameters: Readonly<Record<string, unknown>> }` — a tool's
input schema as JSON Schema.

### `ToolResult` (type)

`{ toolCallId, toolName, ok, output?, error?, durationMs }`.

---

## Testing (`aniki-sdk/testing`)

### `MockProvider`

A scripted, in-process `IProvider` test double. All capabilities default to `true`. See
[Tools](./tools.md#basic-example-the-working-path) and [Streaming](./streaming.md) for it in use.

**Constructor:** `new MockProvider(options?: MockProviderOptions)`
**Methods (all chainable except `generate`/`generateStream`):**
- `enqueueResponse(partial?: Partial<ProviderResponse>): this`
- `enqueueToolCall(name: string, args: Readonly<Record<string, unknown>>, id?: string): this`
- `enqueueError(error: unknown): this`
- `enqueueStream(deltas: readonly string[], finishReason?: FinishReason): this`
- `reset(): void`

**Getters:** `calls: readonly ProviderRequest[]`, `callCount: number`, `lastRequest:
ProviderRequest | undefined`.

```ts
import { Runner, Agent } from "aniki-sdk";
import { MockProvider } from "aniki-sdk/testing";

const provider = new MockProvider();
provider.enqueueResponse({ content: "Hello, Lalit!" });

const agent = new Agent({
  name: "Assistant",
  instructions: "You are a helpful assistant.",
  model: "gpt-4o-mini",
  provider,
});

const result = await new Runner().run(agent, { message: "Hi" });
console.log(provider.callCount); // 1
console.log(result.content); // "Hello, Lalit!"
```

### `MockProviderOptions` (type)

| Field | Type | Default |
| --- | --- | --- |
| `name?` | `string` | `"mock"` |
| `capabilities?` | `Partial<ProviderCapabilities>` | all `true` |
| `latencyMs?` | `number` | `0` |
| `responses?` | `readonly Partial<ProviderResponse>[]` | `[]` |

### `MockLogger`

An `ILogger` test double capturing every record instead of writing anywhere. `child()` shares the
parent's underlying sink, so records logged by a child are visible from the top-level logger too.

**Constructor:** `new MockLogger(bindings?: LogFields, sink?: MockLogRecord[])`
**Methods:** `debug`, `info`, `warn`, `error`, `child(bindings): ILogger`, `reset(): void`.
**Getters:** `records: readonly MockLogRecord[]`, `recordsAt(level): readonly MockLogRecord[]`.

```ts
import { Runner } from "aniki-sdk";
import { MockLogger } from "aniki-sdk/testing";

const logger = new MockLogger();
const runner = new Runner(undefined, undefined, { logger });
void runner;

logger.recordsAt("error"); // []
```

### `MockLogRecord` (type)

`{ level: Exclude<LogLevel, "silent">; message: string; fields: LogFields | undefined }`.

## Related Pages

- [Generating Text](./generate-text.md)
- [Tools](./tools.md)
- [Error Handling](./error-handling.md)
- [Contributing](./contributing.md)
