// Mirrors docs/streaming.md — already MockProvider-based in the doc itself.
//
// Run: npx tsx examples/06-streaming.ts
import { Agent, Runner, StreamAbortedError, StreamingNotSupportedError, Tool } from "aniki-sdk";
import { MockProvider } from "aniki-sdk/testing";
import { z } from "zod";

async function readingDeltaText(): Promise<void> {
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
  process.stdout.write("\n");
}

async function typedEventsPlusFinalResult(): Promise<void> {
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
}

async function abortHandling(): Promise<void> {
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
}

function toolsAndStreamingIncompatibility(): void {
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
}

async function main(): Promise<void> {
  await readingDeltaText();
  await typedEventsPlusFinalResult();
  await abortHandling();
  toolsAndStreamingIncompatibility();
}

void main();
