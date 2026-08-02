import { describe, expect, it } from "vitest";
import { OutputProcessingError } from "../core/errors.js";
import type { RunMetadata } from "../types/output.js";
import type { IOutputProcessor, OutputProcessingContext } from "./OutputPipeline.js";
import { OutputPipeline } from "./OutputPipeline.js";

const metadata: RunMetadata = {
  runId: "run-1",
  model: "gpt-5.5",
  provider: "openai",
  durationMs: 10,
  iterations: 1,
  streamed: false,
};

function makeContext(text: string): OutputProcessingContext {
  return { raw: text, text, metadata, data: {} };
}

function processorNamed(
  name: string,
  transform: (context: OutputProcessingContext) => OutputProcessingContext,
): IOutputProcessor {
  return { name, process: transform };
}

describe("OutputPipeline", () => {
  it("is the identity function when constructed with no processors", async () => {
    const pipeline = new OutputPipeline();
    const context = makeContext("hello");

    await expect(pipeline.run(context)).resolves.toEqual(context);
  });

  it("runs processors sequentially, each receiving the previous one's result", async () => {
    const order: string[] = [];
    const upper = processorNamed("upper", (context) => {
      order.push("upper");
      return { ...context, text: context.text.toUpperCase() };
    });
    const exclaim = processorNamed("exclaim", (context) => {
      order.push("exclaim");
      return { ...context, text: `${context.text}!` };
    });
    const pipeline = new OutputPipeline([upper, exclaim]);

    const result = await pipeline.run(makeContext("hi"));

    expect(order).toEqual(["upper", "exclaim"]);
    expect(result.text).toBe("HI!");
  });

  it("supports registering processors via use(), chainably", async () => {
    const pipeline = new OutputPipeline()
      .use(processorNamed("upper", (context) => ({ ...context, text: context.text.toUpperCase() })))
      .use(processorNamed("suffix", (context) => ({ ...context, text: `${context.text}-done` })));

    const result = await pipeline.run(makeContext("hi"));

    expect(result.text).toBe("HI-done");
  });

  it("accumulates processor-contributed data across steps", async () => {
    const pipeline = new OutputPipeline([
      processorNamed("first", (context) => ({ ...context, data: { ...context.data, a: 1 } })),
      processorNamed("second", (context) => ({ ...context, data: { ...context.data, b: 2 } })),
    ]);

    const result = await pipeline.run(makeContext("hi"));

    expect(result.data).toEqual({ a: 1, b: 2 });
  });

  it("wraps a throwing processor in OutputProcessingError naming the processor", async () => {
    const pipeline = new OutputPipeline([
      processorNamed("boom", () => {
        throw new Error("processor exploded");
      }),
    ]);

    try {
      await pipeline.run(makeContext("hi"));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(OutputProcessingError);
      expect((error as OutputProcessingError).processorName).toBe("boom");
      expect((error as OutputProcessingError).cause).toBeInstanceOf(Error);
    }
  });

  it("stops running further processors once one throws", async () => {
    const calls: string[] = [];
    const pipeline = new OutputPipeline([
      processorNamed("boom", () => {
        throw new Error("processor exploded");
      }),
      processorNamed("never", (context) => {
        calls.push("never");
        return context;
      }),
    ]);

    await expect(pipeline.run(makeContext("hi"))).rejects.toThrow(OutputProcessingError);
    expect(calls).toEqual([]);
  });

  it("supports an async processor", async () => {
    const pipeline = new OutputPipeline([
      {
        name: "async-upper",
        process: async (context) => {
          await Promise.resolve();
          return { ...context, text: context.text.toUpperCase() };
        },
      },
    ]);

    const result = await pipeline.run(makeContext("hi"));

    expect(result.text).toBe("HI");
  });
});
