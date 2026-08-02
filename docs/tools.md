# Tools

Giving an agent capabilities beyond generating text — calling a weather API, querying a database,
running a calculation — that the model can invoke and get results back from.

> **Note — tool calling does not work end-to-end with the OpenAI provider today.** `Runner` fully
> implements the tool-calling loop, but `OpenAIProvider` silently drops any tools you attach before
> the request reaches OpenAI. Read [The OpenAI limitation](#the-openai-limitation) before you build
> around this. Everything else on this page — defining a tool, unit-testing it, and running the full
> loop against `MockProvider` or your own provider — works today.

## Overview

A `Tool` is a name, a description, an input schema, an optional output schema, and an `execute`
function. Attach tools to an `Agent` and, when the provider supports it, `Runner` automatically
calls the model, executes whatever tool it requests, validates and feeds the result back, and
repeats until the model returns a final answer with no more tool calls (or `maxToolIterations` is
exhausted).

## Prerequisites

Familiarity with `Agent` and `Runner` from [Your First Agent](./first-agent.md), and basic Zod
schema syntax.

## Creating a tool

```ts
import { Tool } from "aniki-sdk";
import { z } from "zod";

const weatherTool = new Tool({
  name: "get_weather",
  description: "Get the current weather for a city.",
  input: z.object({ city: z.string() }),
  output: z.object({ tempC: z.number(), summary: z.string() }),
  execute: async ({ city }) => ({ tempC: 21, summary: `Clear skies in ${city}` }),
});
```

`name` must match `/^[a-zA-Z0-9_-]{1,64}$/` — the intersection of what major vendors accept as a
function/tool name. `description` is the only signal the model has for deciding when to use the
tool, so be specific about what it does and when it's appropriate.

## Unit-testing a tool — no LLM required

**This works today, standalone, regardless of the OpenAI limitation below.** `Tool.run` validates
the input against the tool's schema, executes it, and validates the output — with no agent,
provider, or network call involved:

```ts
const result = await weatherTool.run({ city: "Gaya" });
console.log(result); // { tempC: 21, summary: "Clear skies in Gaya" }
```

If you pass input that fails the schema, `run` throws `ToolInputValidationError` before `execute`
is ever called. If `execute`'s return value fails the output schema, it throws
`ToolOutputValidationError` instead. This is the fastest way to develop and test a tool's logic in
isolation.

## Registering tools on an agent

```ts
import { Agent } from "aniki-sdk";

const agent = new Agent({
  name: "Assistant",
  instructions: "You are a helpful assistant.",
  model: "gpt-4o-mini",
  provider: "openai",
  tools: [weatherTool],
  maxToolIterations: 5, // this is already the default
});
```

Tool names must be unique per agent — `Agent`'s constructor builds a `ToolRegistry` internally and
throws `DuplicateToolError` immediately if two tools share a name, before any run happens.

## The OpenAI limitation

`Runner` does its job completely: it passes `tools` in the `ProviderRequest`, executes every
`ToolCall` the provider returns through `ToolExecutor`, appends results to the session as
`role: "tool"` messages, and loops until a final answer or `maxToolIterations` is reached. The gap
is entirely inside the OpenAI adapter:

- `OpenAIProvider.capabilities.toolCalling` is `false`.
- `OpenAIRequestBuilder`'s request builder maps only `model`, `messages`, and generation params —
  it never reads `request.tools` at all, so a tool definition never reaches OpenAI's wire format.
- `OpenAIResponseParser` never populates `ProviderResponse.toolCalls` — it maps OpenAI's
  `tool_calls` finish reason to the normalized `"tool_use"` `FinishReason` and stops there.

**Net effect:** attaching tools to an agent whose provider is `"openai"` produces a run that never
calls a tool — no error, no warning, just a plain text response as if the tools didn't exist. This
is a gap in one vendor adapter's wire-format translation, not a limitation of the tool-calling
architecture itself — the abstraction (`Runner`, `ToolExecutor`, `ToolRegistry`) is complete and
already exercised end-to-end against other providers in this SDK's own tests.

## Basic Example: the working path

To see the full tool loop run, use `MockProvider` (from `aniki-sdk/testing`) or any custom
`IProvider` that actually populates `toolCalls`:

```ts
import { Agent, Runner } from "aniki-sdk";
import { MockProvider } from "aniki-sdk/testing";
import { Tool } from "aniki-sdk";
import { z } from "zod";

const weatherTool = new Tool({
  name: "get_weather",
  description: "Get the current weather for a city.",
  input: z.object({ city: z.string() }),
  output: z.object({ tempC: z.number(), summary: z.string() }),
  execute: async ({ city }) => ({ tempC: 21, summary: `Clear skies in ${city}` }),
});

const provider = new MockProvider();
provider.enqueueToolCall("get_weather", { city: "Gaya" });
provider.enqueueResponse({ content: "It's 21°C and clear in Gaya." });

const agent = new Agent({
  name: "Assistant",
  instructions: "You are a helpful assistant.",
  model: "gpt-4o-mini",
  provider,
  tools: [weatherTool],
});

const result = await new Runner().run(agent, { message: "What's the weather in Gaya?" });

console.log(result.content); // "It's 21°C and clear in Gaya."
console.log(result.toolResults); // [{ toolCallId: ..., toolName: "get_weather", ok: true, output: {...}, durationMs: ... }]
console.log(result.iterations); // 2: one call that requested the tool, one that answered
```

## Explanation

`MockProvider.enqueueToolCall` scripts the *next* `generate` call to return a tool call instead of
plain text; `enqueueResponse` scripts the call after that to return the final answer. `Runner` sees
the first response has a `toolCalls` array, executes `get_weather` through `ToolExecutor`
(validating its arguments, running `execute`, validating its return value), appends a `role: "tool"`
message with the result, and loops back to the provider — which, this time, returns plain text and
ends the loop.

## Execution, validation, and error handling

`ToolExecutor.execute` — the component `Runner` uses internally — has one defining behavior: it
**never rejects** for a tool-level failure. An unknown tool name, arguments that fail the input
schema, a throwing `execute`, or a timeout all resolve as `{ ok: false, error: "..." }` rather than
throwing, so the loop can feed the failure back to the model as a `role: "tool"` message and let it
self-correct on the next iteration — rather than crashing the whole run over one bad tool call.

```ts
const results = result.toolResults;
for (const toolResult of results) {
  if (toolResult.ok) {
    console.log(toolResult.toolName, "succeeded:", toolResult.output);
  } else {
    console.log(toolResult.toolName, "failed:", toolResult.error);
  }
}
```

Retries (via a tool's `retries` option) apply only to execution and timeout failures — never to
input or output validation failures, since a validation failure is either the model's mistake (bad
arguments) or a deterministic bug in `execute` (bad return shape), and retrying either one
unchanged won't produce a different outcome.

`timeoutMs`, `retries`, and `cache` are all stored on the `Tool` itself but *applied* by
`ToolExecutor`, not by the tool. This is why `Tool.run` (the unit-test path above) has no timeout or
retry behavior — it calls `execute` directly.

## Best Practices

- **Write specific, unambiguous descriptions.** The model chooses whether and how to call a tool
  based entirely on `name` and `description` — vague descriptions produce unreliable tool selection.
- **Keep `execute` idempotent where possible.** The tool loop can call the same tool multiple times
  across iterations; side effects that aren't safe to repeat need their own guard logic.
- **Set `timeoutMs` on anything that calls out to a network or a slow resource.** Without it, a
  hanging `execute` blocks the entire run indefinitely.
- **Prefer `Tool.run` for unit tests, `MockProvider` for integration tests.** Test a tool's own
  logic in isolation with `run`; test how it behaves inside the full loop with `MockProvider`.

## Common Mistakes

- **Attaching tools to an OpenAI-backed agent and expecting them to be called.** See
  [The OpenAI limitation](#the-openai-limitation) above — this fails silently, not loudly.
- **Registering two tools with the same name.** `Agent`'s constructor throws `DuplicateToolError`
  immediately, so this fails fast rather than causing confusing runtime behavior.
- **Expecting a tool failure to throw and halt the run.** It doesn't — `ToolExecutor` converts
  failures into `{ ok: false }` results the model sees, so the run continues. If every iteration up
  to `maxToolIterations` fails without a final answer, `Runner` throws `MaxToolIterationsError`.
- **Trying to stream an agent that has tools.** `Runner.stream` throws `StreamingNotSupportedError`
  synchronously for any agent with registered tools — see [Streaming](./streaming.md#limitations).

## API Reference

See [`Tool`](./api-reference.md#tool), [`ToolExecutor`](./api-reference.md#toolexecutor), and
[`ToolRegistry`](./api-reference.md#toolregistry) in the API Reference.

## Related Pages

- [Providers](./providers.md)
- [Error Handling](./error-handling.md)
- [Troubleshooting](./troubleshooting.md)
- [FAQ](./faq.md)
