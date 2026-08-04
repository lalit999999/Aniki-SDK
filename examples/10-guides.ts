// Mirrors docs/guides.md
//
// guides.md documents 9 end-to-end tutorials. Five are reproduced below,
// adapted to MockProvider so they run offline. The other four are not
// runnable here and are left as pointers back to the doc:
//
//   - Chatbot: needs an interactive stdin loop (node:readline) — see
//     docs/guides.md#chatbot for the full source.
//   - Production Deployment: demonstrates composing CacheMiddleware +
//     RetryMiddleware against a real provider — see
//     docs/guides.md#production-deployment.
//   - NestJS Integration: depends on @nestjs/common, not part of this SDK —
//     see docs/guides.md#nestjs-integration.
//   - Next.js Integration: depends on next/server, not part of this SDK —
//     see docs/guides.md#nextjs-integration.
//
// Run: npx tsx examples/10-guides.ts
import { Agent, ConsoleLogger, LoggingMiddleware, Runner } from "aniki-sdk";
import { MockProvider } from "aniki-sdk/testing";
import { z } from "zod";

async function aiAssistant(): Promise<void> {
  const DecisionSchema = z.object({
    action: z.enum(["approve", "reject", "escalate"]),
    reason: z.string(),
  });

  const provider = new MockProvider();
  provider.enqueueResponse({
    content: JSON.stringify({ action: "escalate", reason: "Amount exceeds standard approval limits." }),
  });

  const logger = new ConsoleLogger({ level: "info" });
  const agent = new Agent({
    name: "Assistant",
    instructions: "Decide whether to approve, reject, or escalate the request. Explain why.",
    model: "gpt-4o-mini",
    provider,
    output: DecisionSchema,
    middleware: [new LoggingMiddleware({ logger })],
  });

  const runner = new Runner();
  runner.on("agent:end", (event) => logger.info("run finished", { iterations: event.iterations }));

  const result = await runner.run(agent, { message: "A refund request for $12,000." });
  console.log(result.output.action, "—", result.output.reason);
}

async function codeReviewer(): Promise<void> {
  const FindingSchema = z.object({
    file: z.string(),
    line: z.number(),
    severity: z.enum(["low", "medium", "high"]),
    summary: z.string(),
  });

  const provider = new MockProvider();
  provider.enqueueResponse({
    content: JSON.stringify([
      { file: "src/auth.ts", line: 42, severity: "high", summary: "Password compared without constant-time check." },
    ]),
  });

  const agent = new Agent({
    name: "CodeReviewer",
    instructions: "Review the given diff for correctness and security issues. Report findings as JSON.",
    model: "gpt-4o-mini",
    provider,
    output: z.array(FindingSchema),
  });

  const diff = "--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ ...";
  const result = await new Runner().run(agent, { message: diff });

  for (const finding of result.output) {
    console.log(`[${finding.severity}] ${finding.file}:${finding.line} — ${finding.summary}`);
  }
}

async function streamingChat(): Promise<void> {
  const provider = new MockProvider();
  provider.enqueueStream(["Sure", ", ", "here's ", "an ", "answer."], "stop");

  const agent = new Agent({
    name: "Chatbot",
    instructions: "You are a helpful, concise chatbot.",
    model: "gpt-4o-mini",
    provider, // no tools — required for streaming
  });

  const stream = new Runner().stream(agent, { message: "Explain streaming in one sentence." });

  for await (const token of stream.textStream) {
    process.stdout.write(token);
  }
  process.stdout.write("\n");
}

// Stand-in for your own retrieval — a real implementation would query a
// vector store or search index. The SDK has no built-in equivalent of this.
async function retrieveContext(question: string): Promise<readonly string[]> {
  return [`Relevant passage about: ${question}`];
}

async function rag(): Promise<void> {
  const provider = new MockProvider();
  provider.enqueueResponse({ content: "The SDK retries only retryable provider errors, up to a configured maxAttempts." });

  const agent = new Agent({
    name: "Assistant",
    instructions: "Answer using only the provided context. Say so if the context is insufficient.",
    model: "gpt-4o-mini",
    provider,
  });

  const question = "What is the SDK's retry policy?";
  const passages = await retrieveContext(question);
  const message = `Context:\n${passages.join("\n")}\n\nQuestion: ${question}`;

  const result = await new Runner().run(agent, { message });
  console.log(result.content);
}

async function multiAgent(): Promise<void> {
  const researcherProvider = new MockProvider();
  researcherProvider.enqueueResponse({
    content: "- Invented by Gutenberg around 1440\n- Enabled mass production of books\n- Fueled the spread of literacy",
  });

  const writerProvider = new MockProvider();
  writerProvider.enqueueResponse({
    content: "Gutenberg's press, born around 1440, turned book production into a mass endeavor and spread literacy across Europe.",
  });

  const researcher = new Agent({
    name: "Researcher",
    instructions: "List three factual bullet points about the given topic. No prose.",
    model: "gpt-4o-mini",
    provider: researcherProvider,
  });

  const writer = new Agent({
    name: "Writer",
    instructions: "Turn the given bullet points into a short, engaging paragraph.",
    model: "gpt-4o-mini",
    provider: writerProvider,
  });

  const runner = new Runner();

  const research = await runner.run(researcher, { message: "The history of the printing press" });
  const article = await runner.run(writer, { message: research.content });

  console.log(article.content);
}

async function main(): Promise<void> {
  await aiAssistant();
  await codeReviewer();
  await streamingChat();
  await rag();
  await multiAgent();
}

void main();
