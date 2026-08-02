import { describe, expect, it } from "vitest";
import type { ProviderStreamChunk } from "../providers/AIProvider.js";
import { StreamParser } from "./StreamParser.js";

async function* chunksOf(
  chunks: readonly ProviderStreamChunk[],
): AsyncIterable<ProviderStreamChunk> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) {
    values.push(value);
  }
  return values;
}

describe("StreamParser", () => {
  it("emits start, one delta per non-empty chunk, then completed", async () => {
    const parser = new StreamParser({ runId: "run-1", model: "gpt-5.5" });
    const events = await collect(
      parser.parse(chunksOf([{ delta: "Hel" }, { delta: "lo" }, { delta: "!" }])),
    );

    expect(events).toEqual([
      { type: "start", runId: "run-1", model: "gpt-5.5" },
      { type: "delta", text: "Hel" },
      { type: "delta", text: "lo" },
      { type: "delta", text: "!" },
      { type: "completed", content: "Hello!", chunkCount: 3 },
    ]);
  });

  it("skips a delta event for an empty-string delta but still counts the chunk", async () => {
    const parser = new StreamParser({ runId: "run-1", model: "gpt-5.5" });
    const events = await collect(parser.parse(chunksOf([{ delta: "Hi" }, { delta: "" }])));

    expect(events).toEqual([
      { type: "start", runId: "run-1", model: "gpt-5.5" },
      { type: "delta", text: "Hi" },
      { type: "completed", content: "Hi", chunkCount: 2 },
    ]);
  });

  it("yields start and completed for an empty stream", async () => {
    const parser = new StreamParser({ runId: "run-1", model: "gpt-5.5" });
    const events = await collect(parser.parse(chunksOf([])));

    expect(events).toEqual([
      { type: "start", runId: "run-1", model: "gpt-5.5" },
      { type: "completed", content: "", chunkCount: 0 },
    ]);
  });

  it("captures the last finishReason and usage seen across chunks", async () => {
    const parser = new StreamParser({ runId: "run-1", model: "gpt-5.5" });
    const events = await collect(
      parser.parse(
        chunksOf([
          { delta: "Hi", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } },
          {
            delta: "!",
            finishReason: "stop",
            usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
          },
        ]),
      ),
    );

    const completed = events.at(-1);
    expect(completed).toEqual({
      type: "completed",
      content: "Hi!",
      chunkCount: 2,
      finishReason: "stop",
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    });
  });

  it("omits finishReason and usage from completed when no chunk reported them", async () => {
    const parser = new StreamParser({ runId: "run-1", model: "gpt-5.5" });
    const events = await collect(parser.parse(chunksOf([{ delta: "Hi" }])));

    const completed = events.at(-1) as { finishReason?: unknown; usage?: unknown };
    expect(completed).not.toHaveProperty("finishReason");
    expect(completed).not.toHaveProperty("usage");
  });
});
