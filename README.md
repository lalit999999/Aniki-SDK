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
