import { isRole, type Message } from "../types/index.js";
import { ValidationError } from "./errors.js";

/**
 * An ordered, append-only store of conversation {@link Message}s.
 *
 * Memory has no concept of session identity or lifecycle — it is the raw
 * message list that {@link Session} builds conversation history on top of.
 *
 * @example
 * ```ts
 * const memory = new Memory();
 * memory.addMessage({ role: "user", content: "Hi" });
 * memory.getMessages(); // [{ role: "user", content: "Hi" }]
 * ```
 */
export class Memory {
  private readonly messages: Message[] = [];

  /** Appends `message` to the store. Throws {@link ValidationError} if it is malformed. */
  addMessage(message: Message): void {
    if (!isRole(message.role)) {
      throw new ValidationError(`Invalid message role: ${String(message.role)}`);
    }
    if (typeof message.content !== "string" || message.content.length === 0) {
      throw new ValidationError("Message content must be a non-empty string");
    }

    this.messages.push({ role: message.role, content: message.content });
  }

  /** Returns a read-only snapshot of all stored messages, in insertion order. */
  getMessages(): readonly Message[] {
    return [...this.messages];
  }

  /** Removes all stored messages. */
  clear(): void {
    this.messages.length = 0;
  }
}
