// Mirrors docs/tools.md — already MockProvider-based in the doc itself.
//
// Run: npx tsx examples/07-tools.ts
import { Agent, Runner, Tool } from "aniki-sdk";
import { MockProvider } from "aniki-sdk/testing";
import { z } from "zod";

const weatherTool = new Tool({
  name: "get_weather",
  description: "Get the current weather for a city.",
  input: z.object({ city: z.string() }),
  output: z.object({ tempC: z.number(), summary: z.string() }),
  execute: async ({ city }) => ({ tempC: 21, summary: `Clear skies in ${city}` }),
});

async function unitTestingATool(): Promise<void> {
  const result = await weatherTool.run({ city: "Gaya" });
  console.log(result); // { tempC: 21, summary: "Clear skies in Gaya" }
}

async function theWorkingPath(): Promise<void> {
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
  console.log(result.toolResults);
  console.log(result.iterations); // 2: one call that requested the tool, one that answered

  for (const toolResult of result.toolResults) {
    if (toolResult.ok) {
      console.log(toolResult.toolName, "succeeded:", toolResult.output);
    } else {
      console.log(toolResult.toolName, "failed:", toolResult.error);
    }
  }
}

async function main(): Promise<void> {
  await unitTestingATool();
  await theWorkingPath();
}

void main();
