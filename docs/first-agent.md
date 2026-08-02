# Your First Agent

A closer look at what `Agent` and `Runner` actually do, and how to hold a multi-turn conversation.

## Overview

An `Agent` is a pure configuration container: a name, system instructions, a model identifier, a
provider, and optionally tools, an output schema, a session, and middleware. It never talks to a
provider itself — it just describes one. `Runner` is the execution engine: it's the only component
that reads an agent's configuration, calls its provider, executes any tools it requests, validates
its output, and returns a result. Keeping these separate means an `Agent` is cheap to construct and
inspect, and a `Runner` can be reused across many agents.

## Prerequisites

You should have completed the [Quick Start](./quick-start.md) and have a working provider
configuration (an API key resolved either explicitly or from an environment variable).

## Basic Example

```ts
import { Agent, Runner } from "aniki-sdk";

const agent = new Agent({
  name: "Assistant",
  instructions: "You are a concise, helpful assistant. Keep answers to two sentences or fewer.",
  model: "gpt-4o-mini",
  provider: "openai",
});

const runner = new Runner();
const result = await runner.run(agent, { message: "What's the capital of Japan?" });

console.log(result.content);
```

## Explanation

- `name` is a human-readable label — it shows up in log fields and lifecycle events, but has no
  effect on the model's behavior.
- `instructions` is the system prompt. It's sent as a `role: "system"` message ahead of the
  conversation on every turn.
- `model` is an opaque string passed straight through to the provider — the SDK does not validate
  it, so any identifier your provider account accepts works.
- `provider` can be a registered provider name (a string, resolved through `ProviderFactory`) or an
  already-constructed provider instance. See [Providers](./providers.md) for what's actually
  registered today.
- `runner.run(agent, { message })` sends the message, waits for the full response, and returns a
  `RunResult` — no separate "send" and "receive" step.

If you construct an `Agent` with invalid configuration (for example, a `provider` value that
doesn't implement `IProvider`), the constructor throws `ValidationError` immediately, not on first
use.

## Advanced Usage: an example conversation

Every `Agent` has a session (an `InMemorySession` is created automatically if you don't pass one),
and `Runner.run` reads from and appends to that session on every call. Running the same agent twice
carries the conversation forward:

```ts
import { Agent, Runner } from "aniki-sdk";

const agent = new Agent({
  name: "Assistant",
  instructions: "You are a helpful assistant.",
  model: "gpt-4o-mini",
  provider: "openai",
});

const runner = new Runner();

const first = await runner.run(agent, { message: "My name is Lalit." });
console.log(first.content); // e.g. "Nice to meet you, Lalit!"

const second = await runner.run(agent, { message: "What's my name?" });
console.log(second.content); // e.g. "Your name is Lalit."

console.log(second.messages.length); // 4: user, assistant, user, assistant
```

Each call to `runner.run` sends the *entire* history so far, not just the new message — this is
covered in depth in [Memory](./memory.md), including its current lack of any windowing or
truncation.

## Best Practices

- **Keep instructions focused.** The system message is resent on every turn (and grows the
  conversation's token cost with it) — write instructions once, precisely, rather than repeating
  context in every user message.
- **One `Runner`, many agents.** A `Runner` holds no per-agent state; construct it once and reuse it
  across every `Agent` in your application.
- **Give each conversation its own session.** If two unrelated conversations share an `Agent`
  instance without separate sessions, they'll see each other's history. Pass a fresh `ISession` (or
  construct a fresh `Agent`) per conversation.

## Common Mistakes

- **Expecting `model` to be validated.** Passing a model name your provider doesn't recognize
  produces a provider-level error at request time, not a construction-time `ValidationError`.
- **Reusing one `Agent` across unrelated users.** Since the default session lives on the `Agent`
  instance, sharing one `Agent` across concurrent, unrelated conversations mixes their history
  together. See [Memory](./memory.md) for session ownership patterns.
- **Assuming `runner.run` supports empty input.** An empty `message` throws `ValidationError`
  before any provider request is made.

## API Reference

See [`Agent`](./api-reference.md#agent) and [`Runner`](./api-reference.md#runner) in the API
Reference for the complete option and method list.

## Related Pages

- [Quick Start](./quick-start.md)
- [Providers](./providers.md)
- [Memory](./memory.md)
- [Generating Text](./generate-text.md)
