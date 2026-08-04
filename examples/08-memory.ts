// Mirrors docs/memory.md — already MockProvider-based in the doc itself.
//
// Run: npx tsx examples/08-memory.ts
import { Agent, InMemorySession, Memory, Runner } from "aniki-sdk";
import type { ISession, Message } from "aniki-sdk";
import { MockProvider } from "aniki-sdk/testing";

async function conversationHistory(): Promise<void> {
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
}

function inMemorySessionBasics(): void {
  const session = new InMemorySession("s1");
  session.addMessage({ role: "user", content: "Hi" });
  console.log(session.getMessages()); // [{ role: "user", content: "Hi" }]
  session.clear();
  console.log(session.getMessages()); // []
}

// Persistent session — a thin wrapper you'd back with a real database.
class DatabaseSession implements ISession {
  readonly id: string;
  private readonly store: Message[] = []; // stands in for a real database table

  constructor(id: string) {
    this.id = id;
  }
  addMessage(message: Message): void {
    this.store.push(message);
  }
  getMessages(): readonly Message[] {
    return this.store;
  }
  clear(): void {
    this.store.length = 0;
  }
}

function persistentSessionStub(): void {
  const session = new DatabaseSession("conversation-42");
  session.addMessage({ role: "user", content: "Hi" });
  console.log(session.getMessages().length); // 1
}

// Windowed session — keeps everything in the underlying Memory store, but
// only returns (and thus only sends to the provider) the most recent
// maxMessages entries.
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

function windowedSessionExample(): void {
  const session = new WindowedSession("s2", 2);
  session.addMessage({ role: "user", content: "one" });
  session.addMessage({ role: "assistant", content: "two" });
  session.addMessage({ role: "user", content: "three" });

  console.log(session.getMessages().length); // 2 — only the most recent two
}

async function main(): Promise<void> {
  await conversationHistory();
  inMemorySessionBasics();
  persistentSessionStub();
  windowedSessionExample();
}

void main();
