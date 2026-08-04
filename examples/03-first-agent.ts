// Mirrors docs/first-agent.md
//
// Doc's canonical form uses provider: "openai"; MockProvider is swapped in
// here so both the basic run and the multi-turn conversation run offline.
//
// Run: npx tsx examples/03-first-agent.ts
import { Agent, Runner } from "aniki-sdk";
import { MockProvider } from "aniki-sdk/testing";

async function basicExample(): Promise<void> {
  const provider = new MockProvider();
  provider.enqueueResponse({ content: "Tokyo is the capital of Japan." });

  const agent = new Agent({
    name: "Assistant",
    instructions: "You are a concise, helpful assistant. Keep answers to two sentences or fewer.",
    model: "gpt-4o-mini",
    provider,
  });

  const runner = new Runner();
  const result = await runner.run(agent, { message: "What's the capital of Japan?" });

  console.log(result.content);
}

async function multiTurnConversation(): Promise<void> {
  const provider = new MockProvider();
  provider.enqueueResponse({ content: "Nice to meet you, Lalit!" });
  provider.enqueueResponse({ content: "Your name is Lalit." });

  const agent = new Agent({
    name: "Assistant",
    instructions: "You are a helpful assistant.",
    model: "gpt-4o-mini",
    provider,
  });

  const runner = new Runner();

  const first = await runner.run(agent, { message: "My name is Lalit." });
  console.log(first.content); // "Nice to meet you, Lalit!"

  const second = await runner.run(agent, { message: "What's my name?" });
  console.log(second.content); // "Your name is Lalit."

  console.log(second.messages.length); // 4: user, assistant, user, assistant
}

async function main(): Promise<void> {
  await basicExample();
  await multiTurnConversation();
}

void main();
