// Mirrors docs/providers.md
//
// The custom-provider (EchoProvider) and provider-switching sections run
// fully offline since EchoProvider never touches the network. The OpenAI
// configuration section is shown as a comment, since constructing it for
// real requires an OPENAI_API_KEY:
//
//   import { OpenAIProvider } from "aniki-sdk";
//   const provider = new OpenAIProvider({
//     apiKey: process.env.OPENAI_API_KEY ?? "",
//     baseURL: "https://api.openai.com/v1", // optional; this is already the default
//     timeout: 30_000, // optional; milliseconds
//   });
//
// Run: npx tsx examples/04-providers.ts
import { Agent, ProviderFactory, Runner, defaultProviderRegistry } from "aniki-sdk";
import type { IProvider, ProviderRequest, ProviderResponse, ProviderStreamChunk } from "aniki-sdk";

class EchoProvider implements IProvider {
  readonly name = "echo";
  readonly capabilities = { streaming: true, toolCalling: false, structuredOutput: false };

  async generate(request: ProviderRequest): Promise<ProviderResponse> {
    const lastMessage = request.messages[request.messages.length - 1];
    return {
      content: `Echo: ${lastMessage?.content ?? ""}`,
      model: request.model,
    };
  }

  async *generateStream(request: ProviderRequest): AsyncIterable<ProviderStreamChunk> {
    const lastMessage = request.messages[request.messages.length - 1];
    yield { delta: `Echo: ${lastMessage?.content ?? ""}`, finishReason: "stop" };
  }
}

async function customProvider(): Promise<void> {
  defaultProviderRegistry.register("echo", () => new EchoProvider());

  const agent = new Agent({
    name: "Assistant",
    instructions: "You are a helpful assistant.",
    model: "n/a",
    provider: ProviderFactory.create("echo"),
  });

  const result = await new Runner().run(agent, { message: "Hi" });
  console.log(result.content); // "Echo: Hi"
}

function switchingProviders(): void {
  // By name, resolved through the registry, or with an explicitly
  // constructed instance (e.g. for a non-default configuration) — both
  // forms are accepted by Agent.provider.
  const echoInstance = ProviderFactory.create("echo");
  const agentWithInstance = new Agent({
    name: "Assistant",
    instructions: "You are a helpful assistant.",
    model: "n/a",
    provider: echoInstance,
  });

  console.log("switched provider instance:", agentWithInstance.provider.name);
}

async function main(): Promise<void> {
  await customProvider();
  switchingProviders();
}

void main();
