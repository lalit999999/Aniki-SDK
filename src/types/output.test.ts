import { describe, expect, it } from "vitest";
import { OutputParseError } from "../core/errors.js";
import type { RunMetadata, StreamEvent, StructuredParseOutcome } from "./output.js";

/**
 * Exhaustively switches on a {@link StreamEvent}, returning a label per
 * variant. The `default` branch assigns `event` to `never` — if a new
 * variant is ever added to the union without a case here, this file fails
 * to compile, which is the whole point of the exhaustiveness check.
 */
function describeEvent(event: StreamEvent): string {
  switch (event.type) {
    case "start":
      return `start:${event.runId}:${event.model}`;
    case "delta":
      return `delta:${event.text}`;
    case "completed":
      return `completed:${event.content}:${event.chunkCount}`;
    default: {
      const exhaustive: never = event;
      throw new Error(`Unhandled StreamEvent variant: ${JSON.stringify(exhaustive)}`);
    }
  }
}

describe("StreamEvent", () => {
  it("narrows to the start variant's fields", () => {
    const event: StreamEvent = { type: "start", runId: "run-1", model: "gpt-5.5" };
    expect(describeEvent(event)).toBe("start:run-1:gpt-5.5");
  });

  it("narrows to the delta variant's fields", () => {
    const event: StreamEvent = { type: "delta", text: "hello" };
    expect(describeEvent(event)).toBe("delta:hello");
  });

  it("narrows to the completed variant's fields", () => {
    const event: StreamEvent = {
      type: "completed",
      content: "hello world",
      finishReason: "stop",
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
      chunkCount: 2,
    };
    expect(describeEvent(event)).toBe("completed:hello world:2");
  });

  it("allows a completed event with no finishReason or usage", () => {
    const event: StreamEvent = { type: "completed", content: "", chunkCount: 0 };
    expect(describeEvent(event)).toBe("completed::0");
  });
});

describe("RunMetadata", () => {
  it("accepts a fully populated shape", () => {
    const metadata: RunMetadata = {
      runId: "run-1",
      model: "gpt-5.5",
      provider: "openai",
      finishReason: "stop",
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
      durationMs: 42,
      iterations: 1,
      streamed: false,
    };
    expect(metadata.provider).toBe("openai");
  });

  it("accepts a minimal shape with no finishReason or usage", () => {
    const metadata: RunMetadata = {
      runId: "run-1",
      model: "gpt-5.5",
      provider: "openai",
      durationMs: 0,
      iterations: 1,
      streamed: true,
    };
    expect(metadata.streamed).toBe(true);
  });
});

describe("StructuredParseOutcome", () => {
  it("narrows to data on the ok branch", () => {
    const outcome: StructuredParseOutcome<{ name: string }> = { ok: true, data: { name: "Lalit" } };
    expect(outcome.ok ? outcome.data.name : undefined).toBe("Lalit");
  });

  it("narrows to error on the failure branch", () => {
    const error = new OutputParseError("no payload found", "not json");
    const outcome: StructuredParseOutcome<{ name: string }> = { ok: false, error };
    expect(outcome.ok ? undefined : outcome.error.code).toBe("OUTPUT_PARSE_ERROR");
  });
});
