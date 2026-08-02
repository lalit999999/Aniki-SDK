# FAQ

## Which providers are supported?

Only two are actually registered and working today: `"openai"` and `"openrouter"` (which reuses
the OpenAI adapter against OpenRouter's OpenAI-wire-compatible endpoint). Four more provider names
(`"anthropic"`, `"gemini"`, `"ollama"`, `"groq"`) are declared in the SDK's types but have no
registered implementation — using one throws `ConfigurationError` at construction time. See
[Providers](./providers.md).

## Does it support streaming?

Yes, via `runner.stream`, with two hard limits: it only works against a provider whose
`capabilities.streaming` is `true`, and it doesn't work at all if the agent has any registered
tools. See [Streaming](./streaming.md#limitations).

## Does it support Node.js?

Yes — it requires Node.js 18 or later, because the HTTP layer uses native `fetch` with no polyfill.
See [Installation](./installation.md).

## Does it support Bun?

It hasn't been specifically tested against Bun. The package is standard Node-targeted TypeScript
(ESM + CJS, native `fetch`, `node:crypto`), so it's likely to work under Bun's Node compatibility
layer, but this isn't a claim the SDK's own test suite verifies.

## Can I use multiple providers in the same application?

Yes — `Agent.provider` is per-agent, not global. Construct different agents with different
providers (or different `IProvider` instances of the same provider, pointed at different base
URLs), and use whichever `Agent` fits a given request.

## How do I switch models?

`model` is just a string on `Agent`, passed through unvalidated to the provider — change it and
construct a new `Agent` (or a new run against the same provider with a different agent). There's no
separate "model registry" to update. See [Providers](./providers.md#switching-providers).

## How do I create a tool?

Construct a `Tool` with a name, description, Zod input schema, optional Zod output schema, and an
`execute` function, then pass it in an `Agent`'s `tools` array. See [Tools](./tools.md). Keep in
mind the [OpenAI limitation](./tools.md#the-openai-limitation) if you're testing against OpenAI —
use `MockProvider` or a custom provider to see the full loop run today.

## Does it support TypeScript?

Yes — it's written in TypeScript, in strict mode, and ships bundled `.d.ts` declarations with no
separate `@types` package needed. An agent's `output` schema flows through generics, so
`result.output` is typed based on the Zod schema you passed.

## Is it open source?

The SDK itself is available on [GitHub](https://github.com/lalit999999/Aniki-SDK). See
[Contributing](./contributing.md) for how to get involved.

## Where do I report bugs?

[GitHub Issues](https://github.com/lalit999999/Aniki-SDK/issues).

## How do I set temperature or max tokens?

You currently can't, through `Agent`/`Runner` — there's no option for `GenerationParams` on either.
The underlying pieces work (`ProviderRequest.params` is correctly mapped by `OpenAIRequestBuilder`),
but nothing in the `Agent`/`Runner` path constructs a request with `params` set. If you need this
today, call a provider's `generate` method directly — see
[Generating Text](./generate-text.md#generation-parameters) for the full explanation and the
escape-hatch example, including what you lose by bypassing `Runner`.

## Why isn't my tool being called?

Almost certainly because your agent's provider is `"openai"` (or `"openrouter"`) — the adapter for
both silently drops tool definitions before they reach the wire, and never populates `toolCalls` on
the response. This is a gap in that one adapter, not the tool-calling architecture: the loop itself
(`Runner`, `ToolExecutor`, `ToolRegistry`) works completely against `MockProvider` or a custom
`IProvider`. See [Tools](./tools.md#the-openai-limitation).

## Is structured output a native provider feature?

No — it's entirely prompt-driven, on every provider, regardless of what `capabilities.structuredOutput`
reports. `Runner` appends JSON-formatting instructions to the system message, then extracts,
parses, and Zod-validates the response itself. There's no repair/retry loop on a validation
failure. See [Generating Text](./generate-text.md#structured-output) for the full mechanism.

## Is conversation history persisted across process restarts?

No — the only shipped `ISession` implementation, `InMemorySession`, holds history only in the
current process's memory. If your process restarts, that history is gone. Persistent backends
(Redis, SQLite, file storage) aren't implemented; you'd write your own `ISession` against whatever
store you use. See [Memory](./memory.md#persistent-memory).

## Related Pages

- [Providers](./providers.md)
- [Streaming](./streaming.md)
- [Tools](./tools.md)
- [Generating Text](./generate-text.md)
- [Memory](./memory.md)
