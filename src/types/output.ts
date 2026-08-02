import type { FinishReason, TokenUsage } from "../providers/AIProvider.js";
import type { OutputError } from "../core/errors.js";

/**
 * Provider-agnostic contracts for a run's metadata and its streamed events.
 *
 * These shapes describe how a completed or in-progress {@link Runner} run is
 * reported back to a caller. They carry only normalized, vendor-neutral
 * data — see {@link RunMetadata}'s `finishReason`/`usage` fields, which are
 * themselves normalized by `src/providers/AIProvider.ts` — so nothing here
 * ever needs to know which provider produced a run.
 */

/**
 * Descriptive metadata about a single {@link Runner} run, attached to every
 * {@link RunResult} regardless of whether the run streamed or used
 * structured output.
 */
export interface RunMetadata {
  /** The id of the run this metadata describes. */
  readonly runId: string;
  /** The model identifier the run's provider actually used. */
  readonly model: string;
  /** The name of the provider that executed the run. */
  readonly provider: string;
  /** Why generation stopped, when the provider reports it. */
  readonly finishReason?: FinishReason;
  /** Token accounting for the run, when the provider reports it. */
  readonly usage?: TokenUsage;
  /** Wall-clock duration of the run, in milliseconds. */
  readonly durationMs: number;
  /** How many LLM request/response round trips the run took. Always `1` for a streamed run. */
  readonly iterations: number;
  /** Whether this run was produced by {@link Runner.stream} rather than {@link Runner.run}. */
  readonly streamed: boolean;
}

/**
 * A single event emitted while consuming a {@link RunStream}.
 *
 * Exactly one `"start"` event opens a stream, zero or more `"delta"` events
 * carry incremental text, and exactly one `"completed"` event closes it with
 * the fully accumulated content. Failures are never represented as an event
 * of this union — they are thrown from the iterator instead, so a consumer
 * has exactly one channel to check for errors rather than two.
 */
export type StreamEvent =
  | {
      /** Discriminant: the stream has begun. */
      readonly type: "start";
      /** The id of the run this stream belongs to. */
      readonly runId: string;
      /** The model identifier the run's provider is using. */
      readonly model: string;
    }
  | {
      /** Discriminant: an incremental chunk of text arrived. */
      readonly type: "delta";
      /** The incremental text produced since the previous `"delta"` event. */
      readonly text: string;
    }
  | {
      /** Discriminant: the stream has finished successfully. */
      readonly type: "completed";
      /** The full accumulated content across every `"delta"` event. */
      readonly content: string;
      /** Why generation stopped, when the provider reports it. */
      readonly finishReason?: FinishReason;
      /** Token accounting for the run, when the provider reports it. */
      readonly usage?: TokenUsage;
      /** The number of provider chunks consumed to produce this stream. */
      readonly chunkCount: number;
    };

/**
 * The outcome of a non-throwing structured-output parse attempt, as returned
 * by {@link OutputValidator.safeValidate} and
 * {@link StructuredOutputParser.safeParse}.
 */
export type StructuredParseOutcome<T> =
  { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: OutputError };
