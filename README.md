# Own-Agent-sdk

## Tools

A `Tool` is a self-describing, unit-testable definition: a name, a description, an input schema,
an optional output schema, and an `execute` function. Attach tools to an `Agent` and `Runner`
automatically calls the model, executes any tools it requests, feeds the results back, and
repeats until the model returns a final answer.

### Define a tool

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

### Attach it to an agent and run it

```ts
import { Agent, Runner } from "aniki-sdk";

const agent = new Agent({
  name: "Assistant",
  instructions: "You are a helpful assistant.",
  model: "gpt-5.5",
  provider,
  tools: [weatherTool],
  maxToolIterations: 5,
});

const runner = new Runner();
const result = await runner.run(agent, { message: "What's the weather in Gaya?" });

console.log(result.content); // the model's final answer
console.log(result.toolResults); // every tool call made along the way
```

### Unit-test a tool with zero LLM involvement

`Tool.run` validates the input, executes, and validates the output — no agent, provider, or
network call required:

```ts
const output = await weatherTool.run({ city: "Gaya" });
// { tempC: 21, summary: "Clear skies in Gaya" }
```

## Structured Output

Give an `Agent` a Zod `output` schema and `Runner.run` returns a schema-validated, typed
`result.output` instead of raw text. Structured output is prompt-driven: `Runner` appends format
instructions to the agent's system message (never replacing `instructions`) asking the model for
JSON matching the schema, then runs the response through extraction, `JSON.parse`, and Zod
validation before it ever reaches your code — no step trusts the model's raw text.

```ts
import { Agent, Runner } from "aniki-sdk";
import { z } from "zod";

const UserSchema = z.object({ name: z.string(), email: z.string() });

const agent = new Agent({
  name: "Extractor",
  instructions: "Extract the user described in the message.",
  model: "gpt-5.5",
  provider,
  output: UserSchema, // infers Agent<{ name: string; email: string }>
});

const runner = new Runner();
const result = await runner.run(agent, { message: "Lalit, lalit@example.com" });

result.output.email; // typed and validated: "lalit@example.com"
result.metadata.usage?.totalTokens;
```

A response that doesn't contain a JSON payload throws `OutputParseError`; a payload that parses
but fails the schema throws `OutputValidationError`. Both carry a truncated snippet of the raw
model text for debugging. There is no automatic repair/retry loop — a malformed response is a
thrown error, not a silent retry.

Every `Runner.run` result also carries `metadata` (model, provider, timing, iterations, and token
usage when the provider reports it), whether or not an output schema is configured.

## Streaming

`Runner.stream` opens a turn and returns a `RunStream` immediately, without waiting for
completion. Consume it as an async iterable of typed events, as delta text only via
`textStream`, or await the final, schema-validated result via `result` — pick whichever one
fits; touching more than one throws `StreamConsumedError`, since the underlying provider stream
can only be read once.

```ts
import { Agent, Runner } from "aniki-sdk";

const agent = new Agent({
  name: "Assistant",
  instructions: "You are a helpful assistant.",
  model: "gpt-5.5",
  provider, // must have capabilities.streaming === true
});

const runner = new Runner();

// Delta text only:
for await (const token of runner.stream(agent, { message: "Hi" }).textStream) {
  process.stdout.write(token);
}

// Typed events, plus the final result:
const stream = runner.stream(agent, { message: "Hi" });
for await (const event of stream) {
  if (event.type === "delta") render(event.text);
}
const result = await stream.result; // RunResult, metadata.streamed === true
```

Call `stream.abort(reason?)` to cancel early — it surfaces `StreamAbortedError` through whichever
channel (iterator or `result`) is currently consuming the stream. The assistant message is only
appended to the session once the stream completes successfully (including schema validation, if
the agent has an `output` schema); a stream that throws leaves the session holding just the user
message from that turn.

Streaming does not support tool calls in this release — `Runner.stream` throws
`StreamingNotSupportedError` synchronously, before opening any request, if the agent has
registered tools or its provider's `capabilities.streaming` is `false`.

## Middleware

Middleware wraps a single provider round trip — not the whole of `Runner.run` — so it composes
safely with the tool loop: a retried attempt never replays session history, and a cache key stays
meaningful per iteration. Pass middleware to `Runner` (runs first) and/or to `Agent` (runs after);
with none configured, behavior is identical to not having the pipeline at all.

```ts
import { Agent, Runner, LoggingMiddleware, CacheMiddleware, RetryMiddleware, ConsoleLogger } from "aniki-sdk";

const runner = new Runner(undefined, undefined, {
  middleware: [
    new LoggingMiddleware({ logger: new ConsoleLogger({ level: "info" }) }),
    new CacheMiddleware({ ttlMs: 60_000 }),
    new RetryMiddleware({ maxAttempts: 3 }),
  ],
});

const result = await runner.run(agent, { message: "Hello" });
```

Write your own by extending `BaseMiddleware`:

```ts
import { BaseMiddleware } from "aniki-sdk";
import type { MiddlewareRequest, MiddlewareNext } from "aniki-sdk";

class TimingMiddleware extends BaseMiddleware {
  constructor() {
    super("TimingMiddleware");
  }
  async execute(request: MiddlewareRequest, next: MiddlewareNext) {
    const start = Date.now();
    const result = await next(request);
    console.log(`${request.model} took ${Date.now() - start}ms`);
    return result;
  }
}
```

`RetryMiddleware` only retries what the provider layer already marked transient (a
`ProviderResponseError` with `retryable: true`, e.g. `RateLimitError`) — validation, tool, output,
and auth errors rethrow immediately. `CacheMiddleware` never caches a response carrying
`toolCalls`, since replaying one would re-trigger its side effect, and a broken cache backend
degrades to a miss/no-op rather than failing the run.

## Logging

Every SDK component that logs depends on the `ILogger` interface, not `console` directly, and
defaults to `NoopLogger` — nothing logs until you opt in:

```ts
import { ConsoleLogger } from "aniki-sdk";

const logger = new ConsoleLogger({ level: "info", json: false });
logger.info("run started", { runId: "abc-123" });

const scoped = logger.child({ runId: "abc-123" });
scoped.debug("below the info threshold, dropped");
```

Fields passed to any log call are redacted before writing — `apiKey`, `authorization`,
`api_key`, `token`, `password`, and `secret` (case-insensitive, at any nesting depth) are replaced
with `"[redacted]"`, so credentials can't leak into a log line even by accident.

## Events

`Runner` emits a canonical set of lifecycle events, plus the pre-existing, now-deprecated names
immediately afterward for backward compatibility. Subscribe with `on` (returns an unsubscribe
function), or `once`/`off` directly:

```ts
const unsubscribe = runner.on("llm:end", (event) => {
  console.log(`${event.model} responded in ${event.durationMs}ms`);
});

runner.once("agent:end", (event) => console.log(`run ${event.runId} finished`));
```

| Event | Payload highlights |
| --- | --- |
| `agent:start` | `runId`, `agentName`, `model`, `providerName` |
| `agent:end` | + `durationMs`, `iterations` |
| `agent:error` | `agentName`, `error` |
| `llm:start` | `iteration`, `messageCount` |
| `llm:end` | + `durationMs`, `finishReason?`, `usage?` |
| `llm:error` | `iteration`, `error` |
| `tool:start` | `toolName`, `toolCallId`, `call` |
| `tool:end` | + `durationMs`, `ok` |
| `tool:error` | `toolName`, `toolCallId`, `error` (legacy `(context, call, error)` shape) |
| `middleware:error` | `error`, `middlewareName?` |

Event payloads are read-only and never carry credentials — listeners observe a run, they never
influence it. `EVENT_NAMES` (a frozen tuple) and `LEGACY_EVENT_ALIASES` (canonical → deprecated
name) are exported for callers that need to enumerate or validate against them.
