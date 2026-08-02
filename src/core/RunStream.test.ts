import { describe, expect, it } from "vitest";
import { z } from "zod";
import { OutputValidationError, StreamAbortedError, StreamConsumedError } from "./errors.js";
import { InMemorySession } from "./Session.js";
import { StructuredOutputParser } from "../parser/StructuredOutput.js";
import type { ProviderStreamChunk } from "../providers/AIProvider.js";
import { RunStream, type RunStreamOptions } from "./RunStream.js";

async function* chunksOf(
  chunks: readonly ProviderStreamChunk[],
): AsyncIterable<ProviderStreamChunk> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

function neverEndingSource(): AsyncIterable<ProviderStreamChunk> {
  return {
    [Symbol.asyncIterator]() {
      return {
        next: () => new Promise<IteratorResult<ProviderStreamChunk>>(() => {}),
      };
    },
  };
}

function makeOptions<TOutput>(
  overrides: Partial<RunStreamOptions<TOutput>> = {},
): RunStreamOptions<TOutput> {
  return {
    runId: "run-1",
    model: "gpt-5.5",
    provider: "fake",
    session: new InMemorySession("session-1"),
    source: chunksOf([{ delta: "Hi" }, { delta: " there" }]) as AsyncIterable<ProviderStreamChunk>,
    startedAt: Date.now(),
    ...overrides,
  } as RunStreamOptions<TOutput>;
}

/** Drains an async iterable without collecting its values. */
async function drain<T>(iterable: AsyncIterable<T>): Promise<void> {
  const iterator = iterable[Symbol.asyncIterator]();
  let step = await iterator.next();
  while (!step.done) {
    step = await iterator.next();
  }
}

/** Drains an async iterable, collecting every value it produces, in order. */
async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  const iterator = iterable[Symbol.asyncIterator]();
  let step = await iterator.next();
  while (!step.done) {
    values.push(step.value);
    step = await iterator.next();
  }
  return values;
}

describe("RunStream", () => {
  it("yields start, delta, then completed events on direct iteration", async () => {
    const session = new InMemorySession("session-1");
    session.addMessage({ role: "user", content: "Hi" });
    const stream = new RunStream(
      makeOptions({ session, source: chunksOf([{ delta: "Hi" }, { delta: "!" }]) }),
    );

    const events = await collect(stream);

    expect(events).toEqual([
      { type: "start", runId: "run-1", model: "gpt-5.5" },
      { type: "delta", text: "Hi" },
      { type: "delta", text: "!" },
      { type: "completed", content: "Hi!", chunkCount: 2 },
    ]);
  });

  it("appends the assistant message to the session only on successful completion", async () => {
    const session = new InMemorySession("session-1");
    session.addMessage({ role: "user", content: "Hi" });
    const stream = new RunStream(makeOptions({ session, source: chunksOf([{ delta: "Hello!" }]) }));

    await drain(stream);

    expect(session.getMessages()).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello!" },
    ]);
  });

  it("textStream yields delta text only, in order", async () => {
    const stream = new RunStream(
      makeOptions({ source: chunksOf([{ delta: "Hel" }, { delta: "lo" }]) }),
    );

    const tokens = await collect(stream.textStream);

    expect(tokens).toEqual(["Hel", "lo"]);
  });

  it("result resolves with a fully populated RunResult", async () => {
    const session = new InMemorySession("session-1");
    session.addMessage({ role: "user", content: "Hi" });
    const stream = new RunStream(
      makeOptions({
        session,
        source: chunksOf([{ delta: "Hello!" }, { finishReason: "stop", delta: "" }]),
      }),
    );

    const result = await stream.result;

    expect(result.content).toBe("Hello!");
    expect(result.output).toBeUndefined();
    expect(result.runId).toBe("run-1");
    expect(result.iterations).toBe(1);
    expect(result.toolResults).toEqual([]);
    expect(result.metadata).toEqual({
      runId: "run-1",
      model: "gpt-5.5",
      provider: "fake",
      finishReason: "stop",
      durationMs: expect.any(Number),
      iterations: 1,
      streamed: true,
    });
  });

  it("awaiting result on an unconsumed stream drains it internally", async () => {
    const source = chunksOf([{ delta: "Hi" }, { delta: "!" }]);
    const stream = new RunStream(makeOptions({ source }));

    const result = await stream.result;

    expect(result.content).toBe("Hi!");
  });

  it("validates the accumulated content against the agent's output schema", async () => {
    const schema = z.object({ name: z.string() });
    const outputParser = new StructuredOutputParser(schema);
    const stream = new RunStream(
      makeOptions({ source: chunksOf([{ delta: '{"name":"Lalit"}' }]), outputParser }),
    );

    const result = await stream.result;

    expect(result.output).toEqual({ name: "Lalit" });
  });

  it("rejects result and throws from the iterator on invalid structured output, without writing the session", async () => {
    const schema = z.object({ name: z.string() });
    const outputParser = new StructuredOutputParser(schema);
    const session = new InMemorySession("session-1");
    session.addMessage({ role: "user", content: "Hi" });
    const stream = new RunStream(
      makeOptions({ session, source: chunksOf([{ delta: "not json" }]), outputParser }),
    );

    await expect(drain(stream)).rejects.toThrow();
    expect(session.getMessages()).toEqual([{ role: "user", content: "Hi" }]);
  });

  it("propagates a schema-validation failure to result as well", async () => {
    const schema = z.object({ name: z.string() });
    const outputParser = new StructuredOutputParser(schema);
    const stream = new RunStream(
      makeOptions({ source: chunksOf([{ delta: '{"wrong":"shape"}' }]), outputParser }),
    );

    await expect(stream.result).rejects.toThrow(OutputValidationError);
  });

  it("throws StreamConsumedError on a second direct iteration attempt", async () => {
    const stream = new RunStream(makeOptions());

    await drain(stream);

    expect(() => stream[Symbol.asyncIterator]()).toThrow(StreamConsumedError);
  });

  it("throws StreamConsumedError when mixing for-await with textStream", async () => {
    const stream = new RunStream(makeOptions());

    await drain(stream);

    await expect(drain(stream.textStream)).rejects.toThrow(StreamConsumedError);
  });

  it("surfaces StreamAbortedError through the iterator when aborted", async () => {
    const stream = new RunStream(makeOptions({ source: neverEndingSource() }));

    const iterationRejection = expect(drain(stream)).rejects.toThrow(StreamAbortedError);

    stream.abort("caller cancelled");

    await iterationRejection;
  });

  it("surfaces StreamAbortedError through result when aborted", async () => {
    const stream = new RunStream(makeOptions({ source: neverEndingSource() }));

    const resultRejection = expect(stream.result).rejects.toThrow(StreamAbortedError);

    stream.abort("caller cancelled");

    await resultRejection;
  });
});
