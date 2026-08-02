# Memory

How conversation history is stored, grown, and (not yet) managed across a long-running
conversation.

## Overview

"Memory" in this SDK means conversation history — the ordered list of messages a session holds and
that `Runner` resends, in full, on every turn. It is unrelated to a run's transient execution state
(that's `Context`, covered at the bottom of this page) and unrelated to retrieval-augmented
generation (there's no vector store or retriever here — see the RAG guide in
[Guides](./guides.md) for how to assemble that yourself on top of this SDK).

## Conversation history

Every message — user, assistant, tool — is appended to an `ISession` in order, and `Runner.run`
sends the agent's system instructions plus that entire history on every call:

```ts
import { Agent, Runner } from "aniki-sdk";
import { MockProvider } from "aniki-sdk/testing";

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

await runner.run(agent, { message: "My name is Lalit." });
const second = await runner.run(agent, { message: "What's my name?" });

console.log(second.messages.length); // 4
console.log(agent.session.getMessages().length); // 4 — same underlying store
```

`agent.session` is the same `ISession` `Runner` read from and wrote to — `result.messages` is just
a snapshot of `session.getMessages()` taken at the end of that run.

## Session memory

`ISession` is intentionally small and storage-independent:

```ts
interface ISession {
  readonly id: string;
  addMessage(message: Message): void;
  getMessages(): readonly Message[];
  clear(): void;
}
```

**`InMemorySession` is the only implementation that ships today.** It's backed by an in-process
`Memory` store — history lives only in the process's memory and is lost when the process exits.
Redis, SQLite, and file-backed sessions are not implemented; if you need persistence across
restarts, implement `ISession` yourself against whatever store you use.

An `Agent` gets a fresh `InMemorySession` automatically if you don't pass one:

```ts
import { Agent, InMemorySession } from "aniki-sdk";

const session = new InMemorySession("conversation-42");

const agent = new Agent({
  name: "Assistant",
  instructions: "You are a helpful assistant.",
  model: "gpt-4o-mini",
  provider: "openai",
  session,
});
```

Two independently constructed `InMemorySession`s never share state, even with the same id — the id
is just a label, not a lookup key into shared storage.

## Persistent memory

There is no persistent (cross-restart) session backend in this SDK today — only `InMemorySession`.
If your application needs conversations to survive a process restart, you write your own `ISession`
implementation (backed by whatever database you use) and pass it to `Agent`. Because `ISession` is
just four methods, this is usually a thin wrapper:

```ts
import type { ISession } from "aniki-sdk";
import type { Message } from "aniki-sdk";

class DatabaseSession implements ISession {
  readonly id: string;
  constructor(id: string) {
    this.id = id;
  }
  addMessage(message: Message): void {
    // persist `message` under this.id in your database
    void message;
  }
  getMessages(): readonly Message[] {
    // load and return this session's messages from your database
    return [];
  }
  clear(): void {
    // delete this session's messages from your database
  }
}
```

## Memory lifecycle

`Memory` — the append-only store `InMemorySession` builds on — validates every message it accepts:
a valid `Role`, string `content`, non-empty `content` unless the message is an assistant turn that
carries tool calls, `toolCalls` only ever on an assistant message, and a `toolCallId` required on
any `role: "tool"` message. A violation throws `ValidationError` immediately — you won't accidentally
persist a malformed message.

```ts
import { InMemorySession } from "aniki-sdk";

const session = new InMemorySession("s1");
session.addMessage({ role: "user", content: "Hi" });
session.getMessages(); // [{ role: "user", content: "Hi" }]
session.clear();
session.getMessages(); // []
```

## Streaming vs. non-streaming persistence

`Runner.run` and `Runner.stream` persist to the session differently:

- **`Runner.run`** appends the user message immediately, then appends the assistant's (and any
  tool) messages incrementally as the run progresses — so even a run that ultimately throws leaves
  the session with whatever turns actually completed.
- **`Runner.stream`** appends the user message immediately, but the assistant's message is appended
  **only once the stream completes successfully**, including passing output-schema validation. A
  stream that fails or is aborted leaves the session holding just that turn's user message — no
  partial assistant reply. See [Streaming](./streaming.md#session-behavior-on-failure) for the full
  detail.

## Memory limits

**There is no windowing, truncation, or summarization.** History grows unbounded, and every turn
resends the entire thing. For a long-running conversation, this means token cost (and, eventually,
context-window limits) grows with every turn — the SDK does nothing to manage this for you.

If you need to cap history size, implement it yourself via a custom `ISession` that trims what
`getMessages()` returns:

```ts
import type { ISession, Message } from "aniki-sdk";
import { Memory } from "aniki-sdk";

class WindowedSession implements ISession {
  readonly id: string;
  private readonly memory = new Memory();
  private readonly maxMessages: number;

  constructor(id: string, maxMessages: number) {
    this.id = id;
    this.maxMessages = maxMessages;
  }

  addMessage(message: Message): void {
    this.memory.addMessage(message);
  }

  getMessages(): readonly Message[] {
    const all = this.memory.getMessages();
    return all.slice(-this.maxMessages);
  }

  clear(): void {
    this.memory.clear();
  }
}
```

This keeps every message in the underlying `Memory` store but only returns (and thus only sends to
the provider) the most recent `maxMessages`. A summarization-based approach would follow the same
shape — override `getMessages()` to return a condensed history instead of the raw tail.

## Context: not memory

`Context` is a separate, per-run scratch space — `runId`, `startedAt`, and a `get`/`set`/`has` data
bag — constructed fresh on every `Runner.run` or `Runner.stream` call. It exists for cross-cutting,
single-run concerns (middleware attaching a trace id, for example) and has no relationship to
conversation history. Don't reach for `Context` when you mean `ISession`, or vice versa.

## Best Practices

- **Give each independent conversation its own session.** Sharing one `Agent` (and therefore one
  default session) across unrelated conversations mixes their history together.
- **Plan for unbounded growth explicitly.** If your application has long-running conversations,
  decide on a windowing or summarization strategy via a custom `ISession` before token costs become
  a problem, not after.
- **Treat `InMemorySession` as ephemeral.** If your process restarts (a deploy, a crash, a
  serverless cold start), every `InMemorySession`'s history is gone. Build your own persistent
  `ISession` if that's unacceptable for your use case.

## Common Mistakes

- **Expecting `InMemorySession` to persist across restarts.** It's memory-backed by design; nothing
  in this SDK writes it to disk.
- **Assuming two sessions with the same id share history.** They don't — `id` is a label, not a key
  into shared storage, unless your own `ISession` implementation makes it one.
- **Forgetting that a failed stream still leaves the user's message in the session.** Only the
  assistant's reply is withheld on failure — see
  [Streaming vs. non-streaming persistence](#streaming-vs-non-streaming-persistence) above.

## API Reference

See [`ISession`](./api-reference.md#isession-type), [`InMemorySession`](./api-reference.md#inmemorysession),
[`Memory`](./api-reference.md#memory), and [`Context`](./api-reference.md#context) in the API
Reference.

## Related Pages

- [Your First Agent](./first-agent.md)
- [Streaming](./streaming.md)
- [Guides](./guides.md)
