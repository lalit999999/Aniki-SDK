// Mirrors docs/generate-text.md
//
// The direct-provider escape hatch (generation params like temperature /
// maxTokens) is only reachable through a real IProvider.generate() call —
// shown as a comment here since it needs OPENAI_API_KEY:
//
//   import { OpenAIProvider } from "aniki-sdk";
//   const provider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY ?? "" });
//   const response = await provider.generate({
//     model: "gpt-4o-mini",
//     messages: [{ role: "user", content: "Write a haiku about autumn." }],
//     params: { temperature: 0.7, maxTokens: 200, stopSequences: ["\n\n"] },
//   });
//
// Run: npx tsx examples/05-generate-text.ts
import { Agent, Runner } from "aniki-sdk";
import { MockProvider } from "aniki-sdk/testing";
import { z } from "zod";

async function basicExample(): Promise<void> {
  const provider = new MockProvider();
  provider.enqueueResponse({ content: "Hamlet avenges his father's murder, at great cost to everyone around him." });

  const agent = new Agent({
    name: "Assistant",
    instructions: "You are a helpful assistant.",
    model: "gpt-4o-mini",
    provider,
  });

  const result = await new Runner().run(agent, {
    message: "Summarize the plot of Hamlet in one sentence.",
  });

  console.log(result.content);
}

async function responseObject(): Promise<void> {
  const provider = new MockProvider();
  provider.enqueueResponse({ content: "Hi there!" });

  const agent = new Agent({
    name: "Assistant",
    instructions: "You are a helpful assistant.",
    model: "gpt-4o-mini",
    provider,
  });

  const result = await new Runner().run(agent, { message: "Hi" });

  console.log(result.metadata.usage?.totalTokens);
  console.log(result.metadata.finishReason);
  console.log(result.iterations);
}

async function structuredOutput(): Promise<void> {
  const UserSchema = z.object({ name: z.string(), email: z.string() });

  const provider = new MockProvider();
  provider.enqueueResponse({ content: JSON.stringify({ name: "Lalit", email: "lalit@example.com" }) });

  const agent = new Agent({
    name: "Extractor",
    instructions: "Extract the user described in the message as JSON.",
    model: "gpt-4o-mini",
    provider,
    output: UserSchema, // infers Agent<{ name: string; email: string }>
  });

  const result = await new Runner().run(agent, { message: "Lalit, lalit@example.com" });

  console.log(result.output.email); // typed and validated
}

async function main(): Promise<void> {
  await basicExample();
  await responseObject();
  await structuredOutput();
}

void main();
