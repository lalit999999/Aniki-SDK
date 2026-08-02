# Quick Start

The shortest path from installed package to a first model response.

## 1. Install

```bash
npm install aniki-sdk
```

## 2. Configure a provider

```ts
import { Aniki } from "aniki-sdk";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  throw new Error("Set OPENAI_API_KEY before running this example.");
}

Aniki.configure({ provider: "openai", apiKey });
```

`Aniki.configure` is optional — you can also pass `apiKey` directly when constructing a provider —
but it's the least code for a first run. If you omit `apiKey` entirely, the SDK falls back to the
`OPENAI_API_KEY` environment variable.

## 3. Create and run an agent

```ts
import { Agent, Runner } from "aniki-sdk";

const agent = new Agent({
  name: "Assistant",
  instructions: "You are a helpful assistant.",
  model: "gpt-4o-mini",
  provider: "openai",
});

const runner = new Runner();
const result = await runner.run(agent, { message: "Say hello in one sentence." });

console.log(result.content);
```

`model` is passed straight through to the provider with no validation on the SDK's side, so any
model identifier your provider account accepts will work here — `"gpt-4o-mini"` is just this
guide's example.

## Expected output

```text
Hello! I'm here and happy to help with whatever you need.
```

The exact wording will differ every time you run it — this is the model's real, non-deterministic
output, not a fixture.

## Explanation

`Agent` only stores configuration — name, instructions, model, and which provider to use — it never
talks to a provider itself. `Runner.run` is what actually sends the request: it loads any prior
conversation history from the agent's session, calls the provider, and returns a `RunResult` whose
`content` field is the model's final reply.

Continue to [Your First Agent](./first-agent.md) for a deeper look at what `Agent` and `Runner` are
doing, or jump straight to [Providers](./providers.md) if you want to understand what's actually
supported today.
