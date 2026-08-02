# Providers

Providers are how the SDK talks to an actual LLM vendor. This page covers what's registered and
working today, the `IProvider` contract every vendor integration implements, and how to write and
register your own.

## Overview

A provider is any object implementing `IProvider`: a `name`, a `capabilities` object declaring
which optional features it supports, and `generate`/`generateStream` methods. `Agent` depends only
on this interface, never on a vendor SDK, so swapping providers is a matter of changing one string
or one constructor call — nothing else in your application changes.

Providers are resolved by name through a registry (`defaultProviderRegistry`), so adding a new one
never requires modifying existing code — you register a factory function under a name, and every
`Agent` that references that name by string picks it up.

> **Note** — Only two of the six provider names the SDK's types declare are actually registered:
> `"openai"` and `"openrouter"`. Passing any of the other four (`"anthropic"`, `"gemini"`,
> `"ollama"`, `"groq"`) as an `Agent`'s `provider` typechecks — `ProviderName` is a union of all
> six strings — but throws `ConfigurationError` ("Unknown provider") at `Agent` construction time.
> See [Troubleshooting](./troubleshooting.md#unknown-provider-name) if you hit this.

## OpenAI

### Overview

The OpenAI integration talks to the `POST /chat/completions` endpoint over native `fetch`, with no
vendor SDK dependency.

### Installation

No separate installation — it ships as part of `aniki-sdk` and is registered automatically the
first time you resolve a provider by name.

### Configuration

```ts
import { Agent } from "aniki-sdk";

const agent = new Agent({
  name: "Assistant",
  instructions: "You are a helpful assistant.",
  model: "gpt-4o-mini",
  provider: "openai",
});
```

Or construct the provider directly for more control (a custom base URL, an injected HTTP client
for testing, and so on):

```ts
import { OpenAIProvider } from "aniki-sdk";

const provider = new OpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY ?? "",
  baseURL: "https://api.openai.com/v1", // optional; this is already the default
  timeout: 30_000, // optional; milliseconds
});
```

### API keys

Resolved from, in order: an explicit `ProviderConfig.apiKey`, the SDK's global `Aniki` config (only
when it targets this same provider), then the `OPENAI_API_KEY` environment variable. If none of
these resolve, `ConfigurationError` is thrown at `Agent`/provider construction time — never mid-run.
See [Configuration resolution](#configuration-resolution) below for the full precedence rule.

### Supported models

Any model identifier your OpenAI account has access to — the SDK passes `model` through unchanged
and never validates it.

### Streaming support

Yes. `capabilities.streaming` is `true`.

### Tool calling support

**No, not end-to-end, despite `Runner` fully implementing the tool-calling loop.**
`OpenAIProvider.capabilities.toolCalling` is `false`, and the request builder silently drops any
`tools` you attach to an agent — it never reaches OpenAI's wire format. Attaching tools to an
OpenAI-backed agent produces a run that never calls a tool, with no error raised. See
[Tools](./tools.md#the-openai-limitation) for the full explanation and the working alternative
(`MockProvider`, or your own `IProvider`).

### Limitations

- No tool calling (above).
- No native structured output — structured output works, but it's prompt-driven, not a provider
  feature. See [Generating Text](./generate-text.md#structured-output).
- Generation parameters (`temperature`, `maxTokens`, ...) are supported by `OpenAIRequestBuilder`,
  but there's no way to set them through `Agent`/`Runner` today. See
  [Generating Text](./generate-text.md#generation-parameters).

### Example

```ts
import { Agent, Runner } from "aniki-sdk";

const agent = new Agent({
  name: "Assistant",
  instructions: "You are a helpful assistant.",
  model: "gpt-4o-mini",
  provider: "openai",
});

const result = await new Runner().run(agent, { message: "Hi" });
console.log(result.content);
```

## OpenRouter

OpenRouter is registered as a built-in provider too — it reuses `OpenAIProvider` against
OpenRouter's OpenAI-wire-compatible endpoint, so everything above (streaming support, the tool-
calling limitation, generation-parameter limitation) applies to it identically. Configure it the
same way, with `provider: "openrouter"` and an `OPENROUTER_API_KEY`.

## Declared but not implemented

`"anthropic"`, `"gemini"`, `"ollama"`, and `"groq"` are valid `ProviderName` values and each has an
environment variable mapped for it (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OLLAMA_API_KEY`,
`GROQ_API_KEY`), but none of them has a registered factory. Using one throws `ConfigurationError`
at construction time — no request is ever sent.

## The provider abstraction

Every provider — built-in or custom — implements this contract:

```ts
interface IProvider {
  readonly name: string;
  readonly capabilities: {
    readonly streaming: boolean;
    readonly toolCalling: boolean;
    readonly structuredOutput: boolean;
  };
  generate(request: ProviderRequest): Promise<ProviderResponse>;
  generateStream(request: ProviderRequest): AsyncIterable<ProviderStreamChunk>;
}
```

(`ProviderRequest`, `ProviderResponse`, and `ProviderStreamChunk` are exported from `aniki-sdk` too
— see the custom-provider example below for how they're used in practice.)

`capabilities` isn't decorative — `Runner.stream` checks `capabilities.streaming` before opening a
stream, and throws `StreamingNotSupportedError` synchronously if it's `false`.

## Writing and registering a custom provider

A minimal provider only needs to implement `generate` and `generateStream`. This one returns a
canned response without making a real network call, which makes it a convenient pattern for a local
model server or an internal gateway:

```ts
import { Agent, ProviderFactory, Runner, defaultProviderRegistry } from "aniki-sdk";
import type { IProvider, ProviderRequest, ProviderResponse, ProviderStreamChunk } from "aniki-sdk";

class EchoProvider implements IProvider {
  readonly name = "echo";
  readonly capabilities = { streaming: true, toolCalling: false, structuredOutput: false };

  async generate(request: ProviderRequest): Promise<ProviderResponse> {
    const lastMessage = request.messages[request.messages.length - 1];
    return {
      content: `Echo: ${lastMessage?.content ?? ""}`,
      model: request.model,
    };
  }

  async *generateStream(request: ProviderRequest): AsyncIterable<ProviderStreamChunk> {
    const lastMessage = request.messages[request.messages.length - 1];
    yield { delta: `Echo: ${lastMessage?.content ?? ""}`, finishReason: "stop" };
  }
}

defaultProviderRegistry.register("echo", () => new EchoProvider());

const agent = new Agent({
  name: "Assistant",
  instructions: "You are a helpful assistant.",
  model: "n/a",
  provider: ProviderFactory.create("echo"), // Agent.provider only accepts the six built-in
  //                                           ProviderName strings or an IProvider instance,
  //                                           so a custom name is resolved to an instance first.
});

const result = await new Runner().run(agent, { message: "Hi" });
console.log(result.content); // "Echo: Hi"
```

`defaultProviderRegistry.register(name, factory)` throws `ConfigurationError` if `name` is already
registered — registration is one-time, not an overwrite. Note that `Agent.provider`'s type only
accepts the six built-in `ProviderName` strings or an `IProvider` instance — a custom provider name
isn't part of that union, so you resolve it through `ProviderFactory.create(name)` (or
`defaultProviderRegistry.resolve(name)(config)` directly) and pass the resulting instance.

## Switching providers

Because `Agent.provider` accepts either a registered name or an already-constructed `IProvider`
instance, switching providers for an existing agent is a one-line change:

```ts
// By name, resolved through the registry:
const agent = new Agent({ /* ... */, provider: "openai" });

// Or with an explicitly constructed instance, e.g. for a non-default configuration:
const provider = new OpenAIProvider({ apiKey: "sk-...", baseURL: "https://my-gateway.example" });
const agentWithCustomBaseURL = new Agent({ /* ... */, provider });
```

## Configuration resolution

When you resolve a provider by name (via `ProviderFactory.create`, which is what happens when you
pass a string as `Agent.provider`), its `ProviderConfig` is resolved in this precedence order,
highest first:

1. An explicit `ProviderConfig` passed directly to `ProviderFactory.create`.
2. The global `Aniki` configuration set via `Aniki.configure(...)` — **only** when
   `global.provider` or `global.defaultProvider` equals the provider name being resolved.
3. The provider's `PROVIDER_API_KEY_ENV_VAR` environment variable (for `apiKey` only).

If no API key is found from any of these sources for a known provider name, `ConfigurationError` is
thrown immediately — at `Agent` construction time, not on the first `runner.run` call.

## Related Pages

- [Generating Text](./generate-text.md)
- [Tools](./tools.md)
- [Error Handling](./error-handling.md)
- [Troubleshooting](./troubleshooting.md)
