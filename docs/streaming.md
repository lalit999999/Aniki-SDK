# Streaming

Consuming a run's output as it's produced, instead of waiting for the whole response.

## Overview

`runner.stream(agent, input)` opens a turn and returns a `RunStream` immediately, without waiting
for the provider to finish. This is useful for anything that renders output progressively — a chat
UI showing tokens as they arrive, a CLI that prints as it goes — where waiting for the full
response before showing anything would feel slow. Streaming has real limits in this SDK today,
covered below, so read [Limitations](#limitations) before reaching for it.

## Prerequisites

Familiarity with `runner.run` from [Generating Text](./generate-text.md). The examples on this page
use `MockProvider` from `aniki-sdk/testing`, so they run with no API key and no network access.

## The stream API

`runner.stream` is synchronous — it validates the input, appends the user message to the session,
opens the provider's stream, and returns a `RunStream` handle right away. Nothing is awaited yet.
That handle offers three ways to consume the same underlying stream:

- Direct async iteration, yielding typed `StreamEvent`s (`"start"`, `"delta"`, `"completed"`).
- `stream.textStream` — an async iterable of just the delta text, for when you don't need the
  event envelope.
- `await stream.result` — skips straight to the final, schema-validated `RunResult`, draining the
  stream internally.

**Only one of these three may actually be used.** The underlying provider stream can only be read
once; touching a second channel after the first has started consuming throws `StreamConsumedError`.

## Basic Example: reading delta text

```ts
import { Agent, Runner } from "aniki-sdk";
import { MockProvider } from "aniki-sdk/testing";

const provider = new MockProvider();
provider.enqueueStream(["Hel", "lo, ", "Lalit!"], "stop");

const agent = new Agent({
  name: "Assistant",
  instructions: "You are a helpful assistant.",
  model: "gpt-4o-mini",
  provider,
});

const runner = new Runner();
const stream = runner.stream(agent, { message: "Hi" });

for await (const token of stream.textStream) {
  process.stdout.write(token);
}
```

## Explanation

`MockProvider.enqueueStream` scripts a sequence of chunks for the next `generateStream` call — here,
three deltas that concatenate to `"Hello, Lalit!"`, with a `"stop"` finish reason on the last one.
`stream.textStream` filters the underlying event stream down to just the `"delta"` events' text, so
the loop above prints exactly `"Hello, Lalit!"` as it "arrives" (instantly, since this is a mock —
against a real provider, each `write` would happen as the network delivers a chunk).

## Advanced Usage: typed events, plus the final result

```ts
import { Agent, Runner } from "aniki-sdk";
import { MockProvider } from "aniki-sdk/testing";

const provider = new MockProvider();
provider.enqueueStream(["Hel", "lo"], "stop");

const agent = new Agent({
  name: "Assistant",
  instructions: "You are a helpful assistant.",
  model: "gpt-4o-mini",
  provider,
});

const runner = new Runner();
const stream = runner.stream(agent, { message: "Hi" });

for await (const event of stream) {
  if (event.type === "start") console.log(`run ${event.runId} started`);
  if (event.type === "delta") process.stdout.write(event.text);
  if (event.type === "completed") console.log(`\nfinished: ${event.finishReason}`);
}

const result = await stream.result;
console.log(result.metadata.streamed); // true
console.log(result.metadata.iterations); // 1
```

Because the loop above already consumed the stream via direct iteration, `await stream.result` here
doesn't re-read anything — it awaits the outcome that the iteration already produced. Calling
`stream.result` on a stream nothing has touched yet drains it internally and resolves with the same
final result, without yielding any events to you.

## Stream completion and error handling

**Failures are never represented as an event.** There's no `"error"` entry in the `StreamEvent`
union — a failure is always *thrown*, from whichever channel is actively consuming the stream, and
mirrored as a rejection of `stream.result`. This is the opposite of many streaming APIs, where an
error arrives as just another event you have to check for:

```ts
import { Agent, Runner, StreamAbortedError } from "aniki-sdk";
import { MockProvider } from "aniki-sdk/testing";

const provider = new MockProvider();
provider.enqueueStream(["Hel", "lo"], "stop");

const agent = new Agent({
  name: "Assistant",
  instructions: "You are a helpful assistant.",
  model: "gpt-4o-mini",
  provider,
});

const runner = new Runner();
const stream = runner.stream(agent, { message: "Hi" });

stream.abort("user navigated away");

try {
  await stream.result;
} catch (error) {
  if (error instanceof StreamAbortedError) {
    console.log("stream was aborted:", error.reason);
  }
}
```

`stream.abort(reason?)` cancels the stream; whichever channel is consuming it throws
`StreamAbortedError`, and `stream.result` rejects with the same error.

### Session behavior on failure

This is the one place streaming behaves differently from `runner.run`: the assistant's message is
appended to the session **only on successful completion**, including passing schema validation (if
the agent has an output schema). If a stream fails or is aborted partway through, the session is
left holding just that turn's user message — no partial assistant reply. `runner.run`, in contrast,
persists messages incrementally as the run progresses. See
[Memory](./memory.md#streaming-vs-non-streaming-persistence) for the full comparison.

## Limitations

- **No tool calls.** `runner.stream` throws `StreamingNotSupportedError` synchronously — before any
  request is sent — if the agent has any registered tools. `ProviderStreamChunk` has no field that
  could express a tool call, so streaming with tools isn't supported in this release.
- **Provider must declare streaming support.** The same error is thrown if
  `agent.provider.capabilities.streaming` is `false`.
- **Always exactly one iteration.** `metadata.iterations` is always `1` for a streamed run, and
  `metadata.streamed` is always `true` — there's no equivalent of the tool-calling loop for
  streams.

```ts
import { Agent, StreamingNotSupportedError, Runner, Tool } from "aniki-sdk";
import { MockProvider } from "aniki-sdk/testing";
import { z } from "zod";

const echoTool = new Tool({
  name: "echo",
  description: "Echoes the input back.",
  input: z.object({ text: z.string() }),
  execute: async ({ text }) => text,
});

const provider = new MockProvider();

const agent = new Agent({
  name: "Assistant",
  instructions: "You are a helpful assistant.",
  model: "gpt-4o-mini",
  provider,
  tools: [echoTool], // any registered tool makes streaming unavailable for this agent
});

try {
  new Runner().stream(agent, { message: "Hi" });
} catch (error) {
  if (error instanceof StreamingNotSupportedError) {
    console.log(error.reason); // "streaming does not support tool calls"
  }
}
```

## Best Practices

- **Pick one consumption channel and commit to it.** Decide up front whether you need typed events,
  delta text only, or just the final result — don't try to read `stream.textStream` and then also
  await `stream.result` from a fresh call.
- **Always handle `stream.result`'s rejection**, even if you're only using `for await` for UI
  rendering — a `try`/`catch` around the loop (or a `.catch` on `stream.result` if you access it) is
  how you learn a stream failed.
- **Don't attach tools to an agent you intend to stream.** If an agent needs both tool calling and
  streaming-style UX, use `runner.run` and render the final result — this SDK doesn't support
  combining the two yet.

## Common Mistakes

- **Iterating a stream twice.** Whether by accident (a UI re-render triggering a second `for await`)
  or by touching both `stream.textStream` and direct iteration, this throws `StreamConsumedError`.
- **Expecting a `"error"` `StreamEvent`.** Check your `for await` loop's surrounding `try`/`catch`
  instead — errors are thrown, never yielded.
- **Assuming the session has the assistant's partial reply after a failed stream.** It doesn't; see
  [Session behavior on failure](#session-behavior-on-failure) above.

## API Reference

See [`Runner.stream`](./api-reference.md#runner), [`RunStream`](./api-reference.md#runstream), and
[`StreamEvent`](./api-reference.md#streamevent-type) in the API Reference.

## Related Pages

- [Generating Text](./generate-text.md)
- [Memory](./memory.md)
- [Error Handling](./error-handling.md)
- [Troubleshooting](./troubleshooting.md)
