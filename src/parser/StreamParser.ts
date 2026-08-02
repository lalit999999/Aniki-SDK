import type { FinishReason, ProviderStreamChunk, TokenUsage } from "../providers/AIProvider.js";
import type { StreamEvent } from "../types/output.js";

/** Options accepted by the {@link StreamParser} constructor. */
export interface StreamParserOptions {
  /** The id of the run this stream belongs to, echoed on the `"start"` event. */
  readonly runId: string;
  /** The model identifier in use for this run, echoed on the `"start"` event. */
  readonly model: string;
}

/**
 * Turns a raw provider chunk stream into the SDK's typed {@link StreamEvent}
 * vocabulary, and accumulates it along the way.
 *
 * `StreamParser` sits downstream of {@link StreamReader}: it never touches
 * transport concerns (cancellation, cleanup, transport error translation)
 * and only interprets chunks it is handed — one `"start"` event, a
 * `"delta"` event per non-empty chunk, then one `"completed"` event
 * carrying the full accumulated content plus the last `finishReason`/`usage`
 * seen and the total chunk count. An empty chunk stream still produces a
 * valid `"start"` → `"completed"` sequence, since a caller has no way to
 * know in advance whether a model will return zero chunks.
 *
 * @example
 * ```ts
 * const parser = new StreamParser({ runId, model: "gpt-5.5" });
 * for await (const event of parser.parse(reader.read())) {
 *   if (event.type === "delta") process.stdout.write(event.text);
 * }
 * ```
 */
export class StreamParser {
  private readonly runId: string;
  private readonly model: string;

  /** Constructs a StreamParser bound to a single run's id and model. */
  constructor(options: StreamParserOptions) {
    this.runId = options.runId;
    this.model = options.model;
  }

  /**
   * Consumes `chunks`, yielding a `"start"` event, one `"delta"` event per
   * non-empty chunk delta, and a final `"completed"` event summarizing the
   * whole stream.
   */
  async *parse(
    chunks: AsyncIterable<ProviderStreamChunk>,
  ): AsyncGenerator<StreamEvent, void, void> {
    yield { type: "start", runId: this.runId, model: this.model };

    let content = "";
    let chunkCount = 0;
    let finishReason: FinishReason | undefined;
    let usage: TokenUsage | undefined;

    for await (const chunk of chunks) {
      chunkCount += 1;

      if (chunk.delta.length > 0) {
        content += chunk.delta;
        yield { type: "delta", text: chunk.delta };
      }
      if (chunk.finishReason !== undefined) {
        finishReason = chunk.finishReason;
      }
      if (chunk.usage !== undefined) {
        usage = chunk.usage;
      }
    }

    yield {
      type: "completed",
      content,
      chunkCount,
      ...(finishReason !== undefined ? { finishReason } : {}),
      ...(usage !== undefined ? { usage } : {}),
    };
  }
}
