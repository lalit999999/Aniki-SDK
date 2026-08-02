import { describe, expect, it } from "vitest";
import { EventEmitter } from "../core/EventEmitter.js";
import type {
  AgentEndEvent,
  AgentErrorEvent,
  AgentStartEvent,
  AnikiEvents,
  LlmEndEvent,
  LlmErrorEvent,
  LlmStartEvent,
  MiddlewareErrorEvent,
  ToolEndEvent,
  ToolErrorEvent,
  ToolStartEvent,
} from "./events.js";
import { EVENT_NAMES, LEGACY_EVENT_ALIASES } from "./events.js";

describe("EVENT_NAMES", () => {
  it("lists exactly the ten canonical event names", () => {
    expect([...EVENT_NAMES]).toEqual([
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
    ]);
  });

  it("is frozen", () => {
    expect(Object.isFrozen(EVENT_NAMES)).toBe(true);
  });
});

describe("LEGACY_EVENT_ALIASES", () => {
  it("maps each renamed canonical event to its pre-Task-6 name", () => {
    expect(LEGACY_EVENT_ALIASES).toEqual({
      "agent:start": "agent:started",
      "agent:end": "agent:finished",
      "llm:start": "llm:request",
      "llm:end": "llm:response",
      "tool:start": "tool:started",
      "tool:end": "tool:finished",
    });
  });

  it("is frozen", () => {
    expect(Object.isFrozen(LEGACY_EVENT_ALIASES)).toBe(true);
  });

  it("omits events whose name did not change or that have no legacy predecessor", () => {
    expect(LEGACY_EVENT_ALIASES["tool:error"]).toBeUndefined();
    expect(LEGACY_EVENT_ALIASES["agent:error"]).toBeUndefined();
    expect(LEGACY_EVENT_ALIASES["llm:error"]).toBeUndefined();
    expect(LEGACY_EVENT_ALIASES["middleware:error"]).toBeUndefined();
  });
});

describe("AnikiEvents payload contracts", () => {
  it("carries every canonical event through a real EventEmitter", () => {
    const emitter = new EventEmitter<AnikiEvents>();
    const received: unknown[] = [];

    for (const name of EVENT_NAMES) {
      emitter.on(name, (event) => received.push(event));
    }

    const runId = "run-1";
    const timestamp = new Date();

    const agentStart: AgentStartEvent = { runId, timestamp, agentName: "Assistant", model: "gpt-5.5", providerName: "openai" };
    const agentEnd: AgentEndEvent = { runId, timestamp, durationMs: 12, agentName: "Assistant", model: "gpt-5.5", providerName: "openai", iterations: 1 };
    const agentError: AgentErrorEvent = { runId, timestamp, agentName: "Assistant", error: new Error("boom") };
    const llmStart: LlmStartEvent = { runId, timestamp, agentName: "Assistant", model: "gpt-5.5", providerName: "openai", iteration: 1, messageCount: 2 };
    const llmEnd: LlmEndEvent = { runId, timestamp, durationMs: 8, agentName: "Assistant", model: "gpt-5.5", providerName: "openai", iteration: 1 };
    const llmError: LlmErrorEvent = { runId, timestamp, agentName: "Assistant", model: "gpt-5.5", providerName: "openai", iteration: 1, error: new Error("down") };
    const toolStart: ToolStartEvent = { runId, timestamp, toolName: "get_weather", toolCallId: "call-1", call: { id: "call-1", name: "get_weather", arguments: {} } };
    const toolEnd: ToolEndEvent = { runId, timestamp, durationMs: 3, toolName: "get_weather", toolCallId: "call-1", ok: true };
    const toolError: ToolErrorEvent = { runId, timestamp, toolName: "get_weather", toolCallId: "call-1", error: new Error("fail") };
    const middlewareError: MiddlewareErrorEvent = { runId, timestamp, middlewareName: "RetryMiddleware", error: new Error("wrapped") };

    emitter.emit("agent:start", agentStart);
    emitter.emit("agent:end", agentEnd);
    emitter.emit("agent:error", agentError);
    emitter.emit("llm:start", llmStart);
    emitter.emit("llm:end", llmEnd);
    emitter.emit("llm:error", llmError);
    emitter.emit("tool:start", toolStart);
    emitter.emit("tool:end", toolEnd);
    emitter.emit("tool:error", toolError);
    emitter.emit("middleware:error", middlewareError);

    expect(received).toEqual([
      agentStart,
      agentEnd,
      agentError,
      llmStart,
      llmEnd,
      llmError,
      toolStart,
      toolEnd,
      toolError,
      middlewareError,
    ]);
  });

  it("never carries an apiKey, authorization, or credential-shaped field", () => {
    const forbidden = ["apikey", "authorization", "api_key", "token", "password", "secret"];
    const runId = "run-1";
    const timestamp = new Date();
    const samplePayloads: Record<string, unknown> = {
      "agent:start": { runId, timestamp, agentName: "A", model: "m", providerName: "p" },
      "llm:end": { runId, timestamp, durationMs: 1, agentName: "A", model: "m", providerName: "p", iteration: 1 },
    };

    for (const payload of Object.values(samplePayloads)) {
      for (const key of Object.keys(payload as object)) {
        expect(forbidden).not.toContain(key.toLowerCase());
      }
    }
  });
});
