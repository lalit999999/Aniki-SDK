# Guides

End-to-end tutorials for common application patterns. Each is built from the primitives covered
elsewhere in these docs — `Agent`, `Runner`, `Tool`, middleware, structured output — combined the
way a real application would. Where a guide needs something the SDK doesn't provide yet (retrieval,
multi-agent handoff), that's called out explicitly rather than glossed over.

## Chatbot

### Goal

A command-line chatbot that remembers the conversation across turns.

### Requirements

A working provider configuration (see [Providers](./providers.md)).

### Steps

1. Create one `Agent` with a default (in-memory) session.
2. Read a line of input, call `runner.run`, print the reply, repeat.
3. Because the agent's session persists across calls, each turn sees the full prior conversation.

### Final Result

A loop that holds a coherent, multi-turn conversation without you managing history yourself.

### Source Code

```ts
import { Agent, Runner } from "aniki-sdk";
import * as readline from "node:readline/promises";

async function main(): Promise<void> {
  const agent = new Agent({
    name: "Chatbot",
    instructions: "You are a friendly, concise chatbot.",
    model: "gpt-4o-mini",
    provider: "openai",
  });
  const runner = new Runner();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  for (;;) {
    const message = await rl.question("You: ");
    if (message === "/exit") break;
    const result = await runner.run(agent, { message });
    console.log("Bot:", result.content);
  }

  rl.close();
}

void main();
```

## AI Assistant

### Goal

An assistant that returns a typed, structured decision instead of free text, with full lifecycle
logging.

### Requirements

A Zod schema describing the assistant's output shape.

### Steps

1. Define an `output` schema on the `Agent`.
2. Attach a `ConsoleLogger` via a `LoggingMiddleware` so every provider round trip is logged.
3. Subscribe to lifecycle events for anything logging alone doesn't cover (e.g. tool activity).
4. Read `result.output`, already typed and validated.

### Final Result

A typed `{ action: string; reason: string }` value, with structured logs for every request.

### Source Code

```ts
import { Agent, ConsoleLogger, LoggingMiddleware, Runner } from "aniki-sdk";
import { z } from "zod";

const DecisionSchema = z.object({
  action: z.enum(["approve", "reject", "escalate"]),
  reason: z.string(),
});

async function main(): Promise<void> {
  const logger = new ConsoleLogger({ level: "info" });
  const agent = new Agent({
    name: "Assistant",
    instructions: "Decide whether to approve, reject, or escalate the request. Explain why.",
    model: "gpt-4o-mini",
    provider: "openai",
    output: DecisionSchema,
    middleware: [new LoggingMiddleware({ logger })],
  });

  const runner = new Runner();
  runner.on("agent:end", (event) => logger.info("run finished", { iterations: event.iterations }));

  const result = await runner.run(agent, { message: "A refund request for $12,000." });
  console.log(result.output.action, "—", result.output.reason);
}

void main();
```

## Code Reviewer

### Goal

Given a diff, return a structured list of findings instead of prose.

### Requirements

A Zod schema for a single finding, and an array schema for the full response.

### Steps

1. Model a `Finding` schema (`file`, `line`, `severity`, `summary`).
2. Give the agent an `output: z.array(FindingSchema)` schema.
3. Run it against a diff and iterate over `result.output`.

### Final Result

A typed array of findings you can render, filter by severity, or post as PR comments.

### Source Code

```ts
import { Agent, Runner } from "aniki-sdk";
import { z } from "zod";

const FindingSchema = z.object({
  file: z.string(),
  line: z.number(),
  severity: z.enum(["low", "medium", "high"]),
  summary: z.string(),
});

async function main(): Promise<void> {
  const agent = new Agent({
    name: "CodeReviewer",
    instructions:
      "Review the given diff for correctness and security issues. Report findings as JSON.",
    model: "gpt-4o-mini",
    provider: "openai",
    output: z.array(FindingSchema),
  });

  const diff = "--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ ...";
  const result = await new Runner().run(agent, { message: diff });

  for (const finding of result.output) {
    console.log(`[${finding.severity}] ${finding.file}:${finding.line} — ${finding.summary}`);
  }
}

void main();
```

## Streaming Chat

### Goal

A chat interface that renders tokens as they arrive instead of waiting for the full reply.

### Requirements

None beyond `MockProvider` for this offline example — swap it for a real provider in production.

### Steps

1. Call `runner.stream` instead of `runner.run`.
2. Consume `stream.textStream` and write each token as it arrives.
3. Remember the constraint from [Streaming](./streaming.md#limitations): this agent must have no
   tools, since streaming with tool calls isn't supported.

### Final Result

Text rendered incrementally, with the same underlying `Agent`/`Runner` setup as a non-streaming
chat.

### Source Code

```ts
import { Agent, Runner } from "aniki-sdk";
import { MockProvider } from "aniki-sdk/testing";

async function main(): Promise<void> {
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
}

void main();
```

## RAG (Retrieval-Augmented Generation)

**Assembled by hand.** The SDK has no retriever, no vector store, and no embeddings support —
retrieval is entirely out of scope for `aniki-sdk` today. This guide shows the integration pattern:
fetch relevant context yourself (from wherever you already store embeddings), and inject it into
the message you send.

### Goal

Answer a question using context retrieved from your own document store.

### Requirements

A retrieval function of your own — any vector database or search index. It's stubbed here.

### Steps

1. Retrieve relevant passages for the user's question, outside the SDK entirely.
2. Build the message you send to `runner.run` by prepending that context.
3. Everything downstream (the agent, the run, the response) is ordinary `Runner` usage — the SDK
   has no concept of "retrieved context" as a distinct input.

### Final Result

An answer grounded in retrieved context, using only primitives this SDK already provides.

### Source Code

```ts
import { Agent, Runner } from "aniki-sdk";

// Stand-in for your own retrieval — a real implementation would query a vector
// store or search index. The SDK has no built-in equivalent of this function.
async function retrieveContext(question: string): Promise<readonly string[]> {
  return [`Relevant passage about: ${question}`];
}

async function main(): Promise<void> {
  const agent = new Agent({
    name: "Assistant",
    instructions: "Answer using only the provided context. Say so if the context is insufficient.",
    model: "gpt-4o-mini",
    provider: "openai",
  });

  const question = "What is the SDK's retry policy?";
  const passages = await retrieveContext(question);
  const message = `Context:\n${passages.join("\n")}\n\nQuestion: ${question}`;

  const result = await new Runner().run(agent, { message });
  console.log(result.content);
}

void main();
```

## Multi-Agent

**Assembled by hand.** There's no handoff primitive in this SDK — no `Agent.delegate` or
orchestration layer. This guide shows the pattern: drive two separate `Agent`s with one `Runner`,
passing one's output into the other's input yourself.

### Goal

A "researcher" agent gathers facts; a "writer" agent turns them into prose.

### Requirements

Two `Agent` instances with different instructions.

### Steps

1. Run the researcher agent and take `result.content`.
2. Pass that content as the writer agent's input message.
3. This is ordinary application code, not an SDK feature — the SDK has no concept of one agent
   calling another.

### Final Result

A two-stage pipeline where each stage is a plain, independently testable `Agent`.

### Source Code

```ts
import { Agent, Runner } from "aniki-sdk";

async function main(): Promise<void> {
  const researcher = new Agent({
    name: "Researcher",
    instructions: "List three factual bullet points about the given topic. No prose.",
    model: "gpt-4o-mini",
    provider: "openai",
  });

  const writer = new Agent({
    name: "Writer",
    instructions: "Turn the given bullet points into a short, engaging paragraph.",
    model: "gpt-4o-mini",
    provider: "openai",
  });

  const runner = new Runner();

  const research = await runner.run(researcher, { message: "The history of the printing press" });
  const article = await runner.run(writer, { message: research.content });

  console.log(article.content);
}

void main();
```

## Production Deployment

### Goal

Wire the SDK up the way you would for a real deployment: configuration from the environment,
structured logging, retry and caching, and metrics fed from lifecycle events.

### Requirements

`OPENAI_API_KEY` (or your provider's equivalent) set in the environment.

### Steps

1. Call `Aniki.configure` once at startup, sourcing everything from `process.env`.
2. Use `ConsoleLogger({ json: true })` so logs are structured for ingestion.
3. Compose `LoggingMiddleware`, `CacheMiddleware`, and `RetryMiddleware` on the `Runner`.
4. Handle errors by branching on `error.code`, not by parsing messages.
5. Pipe lifecycle events into your metrics system.

### Final Result

A `Runner` configured the way this SDK's own middleware and logging primitives are designed to be
used together in production.

### Source Code

```ts
import {
  Aniki,
  CacheMiddleware,
  ConsoleLogger,
  LoggingMiddleware,
  RetryMiddleware,
  Runner,
  isAnikiError,
} from "aniki-sdk";

function recordLatency(model: string, durationMs: number): void {
  // stand-in for your metrics client
  void model;
  void durationMs;
}

function main(): void {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Set OPENAI_API_KEY before starting.");

  Aniki.configure({
    provider: "openai",
    apiKey,
    timeout: 30_000,
  });

  const logger = new ConsoleLogger({ level: "info", json: true });

  const runner = new Runner(undefined, undefined, {
    middleware: [
      new LoggingMiddleware({ logger }),
      new CacheMiddleware({ ttlMs: 60_000 }),
      new RetryMiddleware({ maxAttempts: 3, logger }),
    ],
    logger,
  });

  runner.on("llm:end", (event) => recordLatency(event.model, event.durationMs));

  runner.on("agent:error", (event) => {
    const error = event.error;
    if (isAnikiError(error)) {
      logger.error("run failed", error.toJSON());
    } else {
      logger.error("run failed with a non-SDK error", { message: error.message });
    }
  });
}

main();
```

## NestJS Integration

### Goal

Wrap `Runner` as an injectable NestJS service.

### Requirements

An existing NestJS application.

### Steps

1. Call `Aniki.configure` once, in your module's initializer.
2. Wrap a `Runner` in an injectable service with one method per use case.
3. Inject that service into any controller that needs it.

### Final Result

A `Runner` accessible through Nest's dependency injection, configured once at module init.

### Source Code

```ts
// aniki.module.ts (illustrative — depends on @nestjs/common, not part of this SDK)
import { Injectable, Module, OnModuleInit } from "@nestjs/common";
import { Agent, Aniki, Runner } from "aniki-sdk";

@Injectable()
export class AnikiService implements OnModuleInit {
  private runner!: Runner;

  onModuleInit(): void {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Set OPENAI_API_KEY before starting.");
    Aniki.configure({ provider: "openai", apiKey });
    this.runner = new Runner();
  }

  async ask(message: string): Promise<string> {
    const agent = new Agent({
      name: "Assistant",
      instructions: "You are a helpful assistant.",
      model: "gpt-4o-mini",
      provider: "openai",
    });
    const result = await this.runner.run(agent, { message });
    return result.content;
  }
}

@Module({ providers: [AnikiService], exports: [AnikiService] })
export class AnikiModule {}
```

## Next.js Integration

### Goal

A Next.js route handler that runs an agent per request.

### Requirements

An existing Next.js application using the App Router.

> **Note** — This must run on the Node.js runtime, not the Edge runtime. The SDK's session ids are
> generated with `node:crypto`'s `randomUUID`, which isn't available in Edge's restricted runtime.

### Steps

1. Add `export const runtime = "nodejs";` to the route file.
2. Construct an `Agent` and `Runner` per request (or reuse a module-level `Runner`, which holds no
   per-agent state).
3. Return `result.content` in the response.

### Final Result

A working `POST /api/chat` endpoint backed by this SDK.

### Source Code

```ts
// app/api/chat/route.ts (illustrative — depends on next/server, not part of this SDK)
export const runtime = "nodejs";

import { Agent, Runner } from "aniki-sdk";

const runner = new Runner();

export async function POST(request: Request): Promise<Response> {
  const { message } = (await request.json()) as { message: string };

  const agent = new Agent({
    name: "Assistant",
    instructions: "You are a helpful assistant.",
    model: "gpt-4o-mini",
    provider: "openai",
  });

  const result = await runner.run(agent, { message });
  return Response.json({ content: result.content });
}
```

## Related Pages

- [Your First Agent](./first-agent.md)
- [Tools](./tools.md)
- [Streaming](./streaming.md)
- [Memory](./memory.md)
