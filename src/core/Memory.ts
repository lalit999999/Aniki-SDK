import { isRole, type Message } from "../types/index.js";
import { ValidationError } from "./errors.js";
import { omitUndefined } from "../utils/index.js";

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
      throw new ValidationError(`Invalid message role: ${String(message.role)}`, {
        subject: "Memory.addMessage(message).role",
        received: message.role,
      });
    }
    if (typeof message.content !== "string") {
      throw new ValidationError("Message content must be a string", {
        subject: "Memory.addMessage(message).content",
        received: message.content,
      });
    }

    const hasToolCalls = message.toolCalls !== undefined && message.toolCalls.length > 0;
    if (message.content.length === 0 && !(message.role === "assistant" && hasToolCalls)) {
      throw new ValidationError("Message content must be a non-empty string", {
        subject: "Memory.addMessage(message).content",
        received: message.content,
      });
    }
    if (message.toolCalls !== undefined && message.role !== "assistant") {
      throw new ValidationError('Only an "assistant" message may carry toolCalls', {
        subject: "Memory.addMessage(message).role",
        received: message.role,
      });
    }
    if (message.role === "tool" && !message.toolCallId) {
      throw new ValidationError('A "tool" message requires a toolCallId', {
        subject: "Memory.addMessage(message).toolCallId",
        received: message.toolCallId,
      });
    }

    this.messages.push(
      omitUndefined<Message>({
        role: message.role,
        content: message.content,
        toolCalls: message.toolCalls,
        toolCallId: message.toolCallId,
        name: message.name,
      }),
    );
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
