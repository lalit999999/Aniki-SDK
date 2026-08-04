// Mirrors docs/quick-start.md
//
// The doc's canonical form configures a real OpenAI provider:
//
//   import { Aniki } from "aniki-sdk";
//   Aniki.configure({ provider: "openai", apiKey: process.env.OPENAI_API_KEY });
//   const agent = new Agent({ ..., provider: "openai" });
//
// This example swaps in MockProvider so it runs offline, with no API key —
// the Agent/Runner call shapes below are identical to the doc's real form.
//
// Run: npx tsx examples/02-quick-start.ts
import { Agent, Runner } from "aniki-sdk";
import { MockProvider } from "aniki-sdk/testing";

async function main(): Promise<void> {
  const provider = new MockProvider();
  provider.enqueueResponse({ content: "Hello! I'm here and happy to help with whatever you need." });

  const agent = new Agent({
    name: "Assistant",
    instructions: "You are a helpful assistant.",
    model: "gpt-4o-mini",
    provider,
  });

  const runner = new Runner();
  const result = await runner.run(agent, { message: "Say hello in one sentence." });

  console.log(result.content);
}

void main();
