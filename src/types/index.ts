import type { ToolCall } from "./tool.js";

export type { ToolCall, ToolDefinition, ToolResult } from "./tool.js";
export type { RunMetadata, StreamEvent, StructuredParseOutcome } from "./output.js";
export type {
  AgentEndEvent,
  AgentErrorEvent,
  AgentStartEvent,
  AnikiEvents,
  BaseEventPayload,
  EventName,
  LlmEndEvent,
  LlmErrorEvent,
  LlmStartEvent,
  MiddlewareErrorEvent,
  TimedEventPayload,
  ToolEndEvent,
  ToolErrorEvent,
  ToolStartEvent,
} from "./events.js";
export { EVENT_NAMES, LEGACY_EVENT_ALIASES } from "./events.js";

/** The speaker a conversation message is attributed to. */
export type Role = "system" | "user" | "assistant" | "tool";

const ROLES: readonly Role[] = ["system", "user", "assistant", "tool"];

/** Returns whether `value` is a valid {@link Role}. */
export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** A single message in a conversation's history. */
export interface Message {
  /** Who this message is attributed to. */
  readonly role: Role;
  /** The textual content of the message. Empty only when `role` is `"assistant"` and `toolCalls` is non-empty. */
  readonly content: string;
  /** The tool calls this assistant turn requested. Only ever set when `role` is `"assistant"`. */
  readonly toolCalls?: readonly ToolCall[];
  /** The id of the {@link ToolCall} this message answers. Required when `role` is `"tool"`. */
  readonly toolCallId?: string;
  /** The name of the tool this message answers. Set alongside `toolCallId`. */
  readonly name?: string;
}
