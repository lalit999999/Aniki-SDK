import { OutputProcessingError } from "../core/errors.js";
import type { RunMetadata } from "../types/output.js";

/**
 * The state threaded through an {@link OutputPipeline} run.
 *
 * `raw` is the untouched model text a run produced and never changes across
 * processors; `text` is the working value each processor reads and may
 * return a transformed copy of; `data` is a free-form bag processors use to
 * hand extra, non-textual results (redaction counts, citations, ...) to
 * later processors or to the caller.
 */
export interface OutputProcessingContext {
  /** The untouched model text this run produced, unchanged across every processor. */
  readonly raw: string;
  /** The text as transformed by every processor that has run so far. */
  readonly text: string;
  /** Metadata about the run this output belongs to. */
  readonly metadata: RunMetadata;
  /** Free-form, processor-contributed extras, accumulated across the pipeline. */
  readonly data: Readonly<Record<string, unknown>>;
}

/**
 * A single, named step in an {@link OutputPipeline}.
 *
 * Implementations receive the context produced by the previous processor
 * (or the pipeline's initial context, for the first one) and return the
 * context the next processor should see.
 */
export interface IOutputProcessor {
  /** This processor's name, used to attribute a thrown error to its source. */
  readonly name: string;
  /** Transforms `context`, returning the context to pass to the next processor. */
  process(
    context: OutputProcessingContext,
  ): OutputProcessingContext | Promise<OutputProcessingContext>;
}

/**
 * Runs a caller-defined chain of {@link IOutputProcessor}s over a run's
 * output, sequentially, each seeing the previous one's result.
 *
 * `OutputPipeline` is the SDK's post-processing extension point — it has no
 * built-in processors and imposes no opinion on what a processor does. An
 * empty pipeline is the identity function, so wiring one into {@link Runner}
 * unconditionally never changes existing behavior when no processors are
 * registered.
 *
 * @example
 * ```ts
 * const pipeline = new OutputPipeline().use({
 *   name: "trim",
 *   process: (context) => ({ ...context, text: context.text.trim() }),
 * });
 *
 * const result = await pipeline.run({ raw, text: raw, metadata, data: {} });
 * ```
 */
export class OutputPipeline {
  private readonly processors: IOutputProcessor[];

  /** Constructs an OutputPipeline, optionally pre-populated with `processors`, run in array order. */
  constructor(processors: readonly IOutputProcessor[] = []) {
    this.processors = [...processors];
  }

  /** Appends `processor` to the end of the chain. Returns `this` for chaining. */
  use(processor: IOutputProcessor): this {
    this.processors.push(processor);
    return this;
  }

  /**
   * Runs every registered processor in order against `context`, threading
   * each processor's return value into the next. Throws
   * {@link OutputProcessingError}, naming the offending processor, if any
   * processor throws.
   */
  async run(context: OutputProcessingContext): Promise<OutputProcessingContext> {
    let current = context;
    for (const processor of this.processors) {
      try {
        current = await processor.process(current);
      } catch (cause) {
        throw new OutputProcessingError(processor.name, cause);
      }
    }
    return current;
  }
}
