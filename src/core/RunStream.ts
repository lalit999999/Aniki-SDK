import { StreamReader } from "../parser/StreamReader.js";
import { StreamParser } from "../parser/StreamParser.js";
import type { StructuredOutputParser } from "../parser/StructuredOutput.js";
import type { ProviderStreamChunk } from "../providers/AIProvider.js";
import type { RunMetadata, StreamEvent } from "../types/output.js";
import { StreamConsumedError, StreamError } from "./errors.js";
import type { ISession } from "./Session.js";
import type { RunResult } from "./Runner.js";

/** Options {@link Runner.stream} constructs a {@link RunStream} with. */
export interface RunStreamOptions<TOutput> {
  /** The id of the run this stream belongs to. */
  readonly runId: string;
  /** The model identifier this run's provider is using. */
  readonly model: string;
  /** The name of the provider driving this stream. */
  readonly provider: string;
  /** The session the completed assistant message is appended to on success. */
  readonly session: ISession;
  /** The provider's raw chunk stream for this run. */
  readonly source: AsyncIterable<ProviderStreamChunk>;
  /** Validates and types the accumulated content, when the agent has an output schema. */
  readonly outputParser?: StructuredOutputParser<TOutput>;
  /** `Date.now()` when this run started, used to compute `metadata.durationMs`. */
  readonly startedAt: number;
}

/**
 * The one-shot handle returned by {@link Runner.stream}.
 *
 * `RunStream` has exactly one underlying source of truth — the provider's
 * chunk stream, read once via an internal {@link StreamReader} and
 * interpreted via an internal {@link StreamParser} — exposed through three
 * consumer-facing surfaces: direct async iteration (`StreamEvent`s),
 * {@link textStream} (delta text only), and {@link result} (the final,
 * schema-validated {@link RunResult}). Only one of those three may actually
 * consume the stream; touching a second one throws
 * {@link StreamConsumedError}, since re-reading an already-drained HTTP
 * stream isn't possible. Failures are never encoded as an event — they are
 * always thrown from whichever channel is consuming the stream when the
 * failure occurs, and mirrored as a rejection of {@link result}.
 *
 * On successful completion, the accumulated content is validated against
 * the agent's output schema (if any) and the assistant message is appended
 * to the session; on any failure, the session is left holding only the
 * user message from this turn.
 *
 * @example
 * ```ts
 * const stream = runner.stream(agent, { message: "Hi" });
 * for await (const token of stream.textStream) process.stdout.write(token);
 * const result = await stream.result;
 * ```
 */
export class RunStream<TOutput = undefined> implements AsyncIterable<StreamEvent> {
  private readonly generator: AsyncGenerator<StreamEvent, void, void>;
  private readonly controller = new AbortController();
  private readonly resultPromise: Promise<RunResult<TOutput>>;
  private resolveResult!: (result: RunResult<TOutput>) => void;
  private rejectResult!: (error: unknown) => void;
  private consumed = false;

  /** Constructs a RunStream. Not intended to be constructed directly — use {@link Runner.stream}. */
  constructor(options: RunStreamOptions<TOutput>) {
    this.resultPromise = new Promise((resolve, reject) => {
      this.resolveResult = resolve;
      this.rejectResult = reject;
    });
    // A caller that only consumes the StreamEvent iterator (never awaiting
    // `result`) must not trigger an unhandled-rejection warning on failure.
    this.resultPromise.catch(() => {});

    const reader = new StreamReader(options.source, {
      signal: this.controller.signal,
      providerName: options.provider,
    });
    this.generator = this.drive(options, reader);
  }

  /** Iterates this stream's {@link StreamEvent}s. One-shot — throws {@link StreamConsumedError} if called more than once. */
  [Symbol.asyncIterator](): AsyncIterator<StreamEvent> {
    if (this.consumed) {
      throw new StreamConsumedError();
    }
    this.consumed = true;
    return this.generator;
  }

  /** This stream's delta text only, in order. Draws from the same one-shot source as direct iteration. */
  get textStream(): AsyncIterable<string> {
    return {
      [Symbol.asyncIterator]: (): AsyncIterator<string> => {
        const events = this[Symbol.asyncIterator]();
        return {
          next: async (): Promise<IteratorResult<string>> => {
            for (;;) {
              const step = await events.next();
              if (step.done) {
                return { done: true, value: undefined };
              }
              if (step.value.type === "delta") {
                return { done: false, value: step.value.text };
              }
            }
          },
        };
      },
    };
  }

  /**
   * The final, schema-validated {@link RunResult}. Draining an unconsumed
   * stream happens internally on first access; on an already-consumed
   * stream, this simply awaits the outcome of that earlier consumption.
   * Rejects with the same error thrown from the iterator, when the stream
   * failed.
   */
  get result(): Promise<RunResult<TOutput>> {
    if (!this.consumed) {
      this.consumed = true;
      void this.drainSilently();
    }
    return this.resultPromise;
  }

  /** Aborts this stream. Surfaces {@link StreamAbortedError} through both the iterator and {@link result}. */
  abort(reason?: string): void {
    this.controller.abort(reason);
  }

  /** Drains {@link generator} without yielding to a caller, for {@link result} on an unconsumed stream. */
  private async drainSilently(): Promise<void> {
    try {
      // Draining only — `resultPromise` settles as a side effect inside `drive`.
      let step = await this.generator.next();
      while (!step.done) {
        step = await this.generator.next();
      }
    } catch {
      // `resultPromise` was already rejected inside `drive`; nothing further to do here.
    }
  }

  /**
   * Reads and parses the provider stream, then — only once it completes
   * successfully — validates the accumulated content and appends the
   * assistant message to the session. Rejects/rethrows before either of
   * those side effects on any failure.
   */
  private async *drive(
    options: RunStreamOptions<TOutput>,
    reader: StreamReader,
  ): AsyncGenerator<StreamEvent, void, void> {
    const parser = new StreamParser({ runId: options.runId, model: options.model });
    let completedEvent: Extract<StreamEvent, { type: "completed" }> | undefined;

    try {
      for await (const event of parser.parse(reader.read())) {
        if (event.type === "completed") {
          completedEvent = event;
        }
        yield event;
      }
    } catch (error) {
      this.rejectResult(error);
      throw error;
    }

    if (!completedEvent) {
      const error = new StreamError("Stream ended without a completed event");
      this.rejectResult(error);
      throw error;
    }

    try {
      const output = options.outputParser
        ? options.outputParser.parse(completedEvent.content)
        : (undefined as TOutput);

      options.session.addMessage({ role: "assistant", content: completedEvent.content });

      const metadata: RunMetadata = {
        runId: options.runId,
        model: options.model,
        provider: options.provider,
        durationMs: Date.now() - options.startedAt,
        iterations: 1,
        streamed: true,
        ...(completedEvent.finishReason !== undefined
          ? { finishReason: completedEvent.finishReason }
          : {}),
        ...(completedEvent.usage !== undefined ? { usage: completedEvent.usage } : {}),
      };

      const result: RunResult<TOutput> = {
        content: completedEvent.content,
        output,
        runId: options.runId,
        messages: options.session.getMessages(),
        toolResults: [],
        iterations: 1,
        metadata,
      };

      this.resolveResult(result);
    } catch (error) {
      this.rejectResult(error);
      throw error;
    }
  }
}
