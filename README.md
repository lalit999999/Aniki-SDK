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
