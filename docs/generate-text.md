# Generating Text

How to run an agent, control generation, read the response object, and get typed, validated
output back instead of raw text.

## Overview

The main way to generate text is `runner.run(agent, { message })`. It sends the agent's
instructions plus the full conversation history to the provider, waits for the complete response,
and returns a `RunResult` with the text, token usage, and (if the agent has an output schema) a
typed, validated `output` field. There's also a lower-level escape hatch — calling a provider's
`generate` method directly — for when you want a single completion with none of `Runner`'s
machinery.

## Prerequisites

A working provider configuration, as covered in [Providers](./providers.md), and familiarity with
the basic `Agent`/`Runner` pattern from [Your First Agent](./first-agent.md).

## Basic Example

```ts
import { Agent, Runner } from "aniki-sdk";

const agent = new Agent({
  name: "Assistant",
  instructions: "You are a helpful assistant.",
  model: "gpt-4o-mini",
  provider: "openai",
});

const result = await new Runner().run(agent, { message: "Summarize the plot of Hamlet in one sentence." });

console.log(result.content);
```

## Explanation

`runner.run` always does the same sequence: append the user message to the agent's session, send
the full system instructions plus history to the provider, and — if the response has no tool calls
— append the assistant's reply to the session and return it. `result.content` is the raw text; if
the agent has an `output` schema, `result.output` is the same content parsed and validated (see
[Structured output](#structured-output) below).

## The response object

Every `RunResult` carries:

| Field | Description |
| --- | --- |
| `content` | The assistant's final reply, as text. |
| `output` | The reply validated against the agent's output schema, or `undefined` if it has none. |
| `runId` | A unique id for this run. |
| `messages` | The full conversation history, including this turn. |
| `toolResults` | Every tool result produced this turn, in execution order (empty if no tools ran). |
| `iterations` | How many provider round trips this turn took. |
| `metadata` | A `RunMetadata` object: `runId`, `model`, `provider`, `finishReason?`, `usage?`, `durationMs`, `iterations`, `streamed`. |

`metadata.usage`, when the provider reports it, is a `TokenUsage`: `promptTokens`,
`completionTokens`, `totalTokens`. `metadata.finishReason` is a normalized `FinishReason` —
`"stop"`, `"length"`, `"tool_use"`, `"content_filter"`, `"error"`, or `"other"` — the same
vocabulary across every provider.

```ts
import { Agent, Runner } from "aniki-sdk";

const agent = new Agent({
  name: "Assistant",
  instructions: "You are a helpful assistant.",
  model: "gpt-4o-mini",
  provider: "openai",
});

const result = await new Runner().run(agent, { message: "Hi" });

console.log(result.metadata.usage?.totalTokens);
console.log(result.metadata.finishReason);
console.log(result.iterations);
```

## Generation parameters

**There is currently no way to set `temperature`, `maxTokens`, `topP`, or `stopSequences` through
`Agent` or `Runner`.** The underlying pieces exist — `ProviderRequest.params` accepts a
`GenerationParams` object, and `OpenAIRequestBuilder` correctly maps it onto OpenAI's wire format
(`maxTokens` → `max_tokens`, `stopSequences` → `stop`, `temperature`/`topP` pass through unchanged)
— but `Agent` has no option for them, and `Runner.run` builds its `ProviderRequest` from only
`model`, `messages`, and `tools`. If you need `params` today, use the direct-provider escape hatch
below.

### The direct-provider escape hatch

For a one-shot completion where you need generation parameters and don't need sessions, tools,
middleware, events, or structured output, call a provider's `generate` method directly:

```ts
import { OpenAIProvider } from "aniki-sdk";

const provider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY ?? "" });

const response = await provider.generate({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "Write a haiku about autumn." }],
  params: {
    temperature: 0.7,
    maxTokens: 200,
    stopSequences: ["\n\n"],
  },
});

console.log(response.content);
```

This bypasses everything `Runner` normally provides — no conversation history, no tool loop, no
middleware, no lifecycle events, and no structured-output validation. `response` here is a
`ProviderResponse` directly, not a `RunResult`. Use this only when you specifically want a bare
completion; for anything involving conversation state or tools, use `runner.run`.

## Structured output

Give an `Agent` a Zod `output` schema and `result.output` becomes typed and validated instead of
raw text:

```ts
import { Agent, Runner } from "aniki-sdk";
import { z } from "zod";

const UserSchema = z.object({ name: z.string(), email: z.string() });

const agent = new Agent({
  name: "Extractor",
  instructions: "Extract the user described in the message as JSON.",
  model: "gpt-4o-mini",
  provider: "openai",
  output: UserSchema, // infers Agent<{ name: string; email: string }>
});

const result = await new Runner().run(agent, { message: "Lalit, lalit@example.com" });

console.log(result.output.email); // typed and validated
```

### How this actually works

`OpenAIProvider.capabilities.structuredOutput` is `false` — this SDK doesn't rely on any
provider's native JSON mode. Instead, structured output is entirely prompt-driven:

1. When an agent has an `output` schema, `Runner` **appends** format instructions (the schema
   rendered as JSON Schema, plus an instruction to reply with raw JSON only) to the agent's system
   message. This is an append, never a replacement — your `instructions` are always sent in full.
2. The model's raw text response is run through extraction (finding a JSON payload, even inside a
   markdown fence or surrounded by prose), `JSON.parse`, and then Zod validation against your
   schema.
3. This happens **after** the assistant's raw text has already been persisted to the session — so
   even if validation fails, the next turn still has consistent history to work from.

There is deliberately **no repair or retry loop**. If the model's response contains no parsable
JSON payload, `Runner.run` throws `OutputParseError`. If it parses but fails your schema, it throws
`OutputValidationError`. Both errors carry the raw model text (truncated) for debugging. Because
this mechanism is prompt-based rather than provider-native, it works identically on any provider —
it doesn't depend on `capabilities.structuredOutput` at all. See
[Error Handling](./error-handling.md#output-errors) for how to catch and handle these.

## Best Practices

- **Keep output schemas narrow.** A schema the model can plausibly satisfy in one shot works far
  better than a complex nested structure, since there's no repair loop to fall back on.
- **Reach for the direct-provider path deliberately, not by default.** It's easy to reach for
  `provider.generate` because it looks simpler, but you lose session history, tool support, and
  structured-output validation entirely. Prefer `runner.run` unless you specifically need a bare
  one-shot completion with generation parameters.
- **Read `metadata.finishReason` when a response looks truncated.** A `"length"` finish reason
  means the response hit a token limit — which today can only happen from a provider-side default,
  since `maxTokens` isn't configurable through `Runner`.

## Common Mistakes

- **Expecting `new Agent({ temperature: 0.7 })` to work.** `AgentOptions` has no such field; it
  silently wouldn't matter even if TypeScript let you add extra properties. Use the direct-provider
  path instead.
- **Assuming structured output retries on failure.** It doesn't — a schema mismatch throws
  immediately. Catch `OutputValidationError` and handle it explicitly, or narrow your schema.
- **Calling `provider.generate` and expecting the session to update.** It doesn't touch any
  `ISession` — that's `Runner`'s job.

## API Reference

See [`Runner.run`](./api-reference.md#runner), [`RunResult`](./api-reference.md#runresult),
[`GenerationParams`](./api-reference.md#generationparams), and
[`ProviderResponse`](./api-reference.md#providerresponse) in the API Reference.

## Related Pages

- [Providers](./providers.md)
- [Streaming](./streaming.md)
- [Error Handling](./error-handling.md)
- [FAQ](./faq.md)
