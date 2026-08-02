import type { Message } from "../types/index.js";
import { Memory } from "./Memory.js";
import { Guard } from "../validation/Guard.js";

/**
 * Storage-independent conversation history, keyed by session id.
 *
 * Future backends (Redis, SQLite, file storage) implement this same
 * contract in their own files without requiring changes here.
 */
export interface ISession {
  /** The id this session is keyed by. */
  readonly id: string;
  /** Appends `message` to this session's history. */
  addMessage(message: Message): void;
  /** Returns this session's full message history, in insertion order. */
  getMessages(): readonly Message[];
  /** Clears this session's history. */
  clear(): void;
}

/**
 * An {@link ISession} backed by an in-process {@link Memory} store.
 *
 * History is held only in memory and is lost when the process exits. Two
 * independently constructed instances never share state, even if given the
 * same id.
 *
 * @example
 * ```ts
 * const session = new InMemorySession("session-1");
 * session.addMessage({ role: "user", content: "Hi, my name is Lalit." });
 * session.getMessages();
 * ```
 */
export class InMemorySession implements ISession {
  readonly id: string;
  private readonly memory = new Memory();

  /** Constructs a session keyed by `id`. Throws {@link ValidationError} if `id` is empty. */
  constructor(id: string) {
    Guard.assertNonEmptyString(id, "InMemorySession.id");
    this.id = id;
  }

  /** Appends `message` to this session's history. */
  addMessage(message: Message): void {
    this.memory.addMessage(message);
  }

  /** Returns this session's full message history, in insertion order. */
  getMessages(): readonly Message[] {
    return this.memory.getMessages();
  }

  /** Clears this session's history. */
  clear(): void {
    this.memory.clear();
  }
}
