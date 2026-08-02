import type { EventMap } from "../core/EventEmitter.js";
import type { FinishReason, TokenUsage } from "../providers/AIProvider.js";
import type { ToolCall } from "./tool.js";

/**
 * The canonical lifecycle event contracts {@link Runner} emits.
 *
 * These are the "new" event names introduced alongside the middleware
 * system; `Runner` continues to emit the pre-existing, now-deprecated names
 * (`agent:started`, `llm:request`, ...) immediately after their canonical
 * counterpart so existing subscribers keep working — see
 * {@link LEGACY_EVENT_ALIASES}. Every payload here is read-only data: a
 * listener observes a run, it never influences it. Only {@link IMiddleware}
 * is permitted to alter execution. No payload defined in this file may ever
 * carry an API key, auth header, or other raw credential.
 */

/** Fields every canonical lifecycle event payload carries. */
export interface BaseEventPayload {
  /** The id of the run this event belongs to. */
  readonly runId: string;
  /** When this event was emitted. */
  readonly timestamp: Date;
}

/** Fields carried by every event that reports the duration of a completed step. */
export interface TimedEventPayload extends BaseEventPayload {
  /** How long the reported step took, in milliseconds. */
  readonly durationMs: number;
}

/** Emitted when {@link Runner.run} (or {@link Runner.stream}) begins a turn. */
export interface AgentStartEvent extends BaseEventPayload {
  /** The name of the agent executing this run. */
  readonly agentName: string;
  /** The model identifier the run will use. */
  readonly model: string;
  /** The name of the provider the run will execute against. */
  readonly providerName: string;
}

/** Emitted when a run completes successfully. */
export interface AgentEndEvent extends TimedEventPayload {
  /** The name of the agent that executed this run. */
  readonly agentName: string;
  /** The model identifier the run used. */
  readonly model: string;
  /** The name of the provider the run executed against. */
  readonly providerName: string;
  /** How many LLM request/response round trips this run took. */
  readonly iterations: number;
}

/** Emitted when a run fails and throws. */
export interface AgentErrorEvent extends BaseEventPayload {
  /** The name of the agent that was executing when the failure occurred. */
  readonly agentName: string;
  /** The error that caused the run to fail. */
  readonly error: Error;
}

/** Emitted immediately before a provider round trip is issued. */
export interface LlmStartEvent extends BaseEventPayload {
  /** The name of the agent issuing this request. */
  readonly agentName: string;
  /** The model identifier this request targets. */
  readonly model: string;
  /** The name of the provider this request targets. */
  readonly providerName: string;
  /** Which tool-loop iteration this request belongs to, starting at `1`. */
  readonly iteration: number;
  /** The number of messages sent with this request. */
  readonly messageCount: number;
}

/** Emitted immediately after a provider round trip resolves successfully. */
export interface LlmEndEvent extends TimedEventPayload {
  /** The name of the agent that issued this request. */
  readonly agentName: string;
  /** The model identifier that produced this response. */
  readonly model: string;
  /** The name of the provider this response came from. */
  readonly providerName: string;
  /** Which tool-loop iteration this response belongs to, starting at `1`. */
  readonly iteration: number;
  /** Why generation stopped, when the provider reports it. */
  readonly finishReason?: FinishReason;
  /** Token accounting for this request/response cycle, when the provider reports it. */
  readonly usage?: TokenUsage;
}

/** Emitted when a provider round trip fails. */
export interface LlmErrorEvent extends BaseEventPayload {
  /** The name of the agent that issued the failing request. */
  readonly agentName: string;
  /** The model identifier the failing request targeted. */
  readonly model: string;
  /** The name of the provider that rejected the request. */
  readonly providerName: string;
  /** Which tool-loop iteration this request belonged to, starting at `1`. */
  readonly iteration: number;
  /** The error the provider (or transport) raised. */
  readonly error: Error;
}

/** Emitted immediately before a requested tool call is executed. */
export interface ToolStartEvent extends BaseEventPayload {
  /** The name of the tool being invoked. */
  readonly toolName: string;
  /** The id of the tool call being executed. */
  readonly toolCallId: string;
  /** The raw, unvalidated arguments the model supplied for this call. */
  readonly call: ToolCall;
}

/** Emitted after a tool call finishes, successfully or not. */
export interface ToolEndEvent extends TimedEventPayload {
  /** The name of the tool that was executed. */
  readonly toolName: string;
  /** The id of the tool call that was executed. */
  readonly toolCallId: string;
  /** Whether execution completed successfully. */
  readonly ok: boolean;
}

/** Emitted when a tool call throws or otherwise fails. */
export interface ToolErrorEvent extends BaseEventPayload {
  /** The name of the tool that failed. */
  readonly toolName: string;
  /** The id of the tool call that failed. */
  readonly toolCallId: string;
  /** The error the tool raised. */
  readonly error: Error;
}

/** Emitted when a {@link MiddlewareError} escapes the middleware pipeline. */
export interface MiddlewareErrorEvent extends BaseEventPayload {
  /** The name of the middleware that raised or caused the error, when known. */
  readonly middlewareName?: string;
  /** The error that escaped the pipeline. */
  readonly error: Error;
}

/** The canonical event map. See {@link EVENT_NAMES} for the concrete name strings. */
export interface AnikiEvents extends EventMap {
  "agent:start": [event: AgentStartEvent];
  "agent:end": [event: AgentEndEvent];
  "agent:error": [event: AgentErrorEvent];
  "llm:start": [event: LlmStartEvent];
  "llm:end": [event: LlmEndEvent];
  "llm:error": [event: LlmErrorEvent];
  "tool:start": [event: ToolStartEvent];
  "tool:end": [event: ToolEndEvent];
  "tool:error": [event: ToolErrorEvent];
  "middleware:error": [event: MiddlewareErrorEvent];
}

/** Every canonical event name, frozen so callers can iterate or validate against it. */
export const EVENT_NAMES = Object.freeze([
  "agent:start",
  "agent:end",
  "agent:error",
  "llm:start",
  "llm:end",
  "llm:error",
  "tool:start",
  "tool:end",
  "tool:error",
  "middleware:error",
] as const);

/** The canonical event name a value from {@link EVENT_NAMES} represents. */
export type EventName = (typeof EVENT_NAMES)[number];

/**
 * Maps each canonical event name to the deprecated, pre-Task-6 name
 * {@link Runner} still emits immediately afterward for backward
 * compatibility. `tool:error` kept its name across the rename, and
 * `middleware:error` and `agent:error`/`llm:error` have no legacy
 * predecessor (the old, single generic `error` event partially covered
 * their role), so none of those appear in this map.
 */
export const LEGACY_EVENT_ALIASES: Readonly<Partial<Record<EventName, string>>> = Object.freeze({
  "agent:start": "agent:started",
  "agent:end": "agent:finished",
  "llm:start": "llm:request",
  "llm:end": "llm:response",
  "tool:start": "tool:started",
  "tool:end": "tool:finished",
});
