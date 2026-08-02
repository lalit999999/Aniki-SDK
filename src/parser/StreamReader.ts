import { AnikiError, StreamAbortedError, StreamError } from "../core/errors.js";
import type { ProviderStreamChunk } from "../providers/AIProvider.js";

/** Options accepted by the {@link StreamReader} constructor. */
export interface StreamReaderOptions {
  /** When provided, aborting this signal stops the read loop with {@link StreamAbortedError}. */
  readonly signal?: AbortSignal;
  /** The name of the provider `source` came from, used in wrapped error messages. */
  readonly providerName?: string;
}

/**
 * Consumes a provider's raw chunk stream with cancellation and guaranteed
 * cleanup.
 *
 * `StreamReader` is the transport boundary between an {@link IProvider}'s
 * `generateStream` and everything downstream: it never inspects a chunk's
 * contents (that is {@link StreamParser}'s job) and only concerns itself
 * with getting chunks out of the source safely — translating a foreign
 * throw into {@link StreamError}, reacting to an {@link AbortSignal}, and
 * releasing the source iterator (and, transitively, its underlying HTTP
 * response body) no matter how consumption ends.
 *
 * @example
 * ```ts
 * const reader = new StreamReader(provider.generateStream(request), { signal });
 * for await (const chunk of reader.read()) {
 *   process.stdout.write(chunk.delta);
 * }
 * ```
 */
export class StreamReader {
  private readonly source: AsyncIterable<ProviderStreamChunk>;
  private readonly signal: AbortSignal | undefined;
  private readonly providerName: string;

  /** Constructs a StreamReader over `source`, an already-opened provider stream. */
  constructor(source: AsyncIterable<ProviderStreamChunk>, options: StreamReaderOptions = {}) {
    this.source = source;
    this.signal = options.signal;
    this.providerName = options.providerName ?? "unknown";
  }

  /**
   * Yields each chunk `source` produces, in order.
   *
   * An {@link AnikiError} thrown by the source (e.g. a `ProviderError`
   * surfaced mid-stream) is rethrown unchanged; any other throw is wrapped
   * in {@link StreamError}. If this reader's `signal` fires — including
   * while a chunk is in flight — the loop throws {@link StreamAbortedError}.
   * The source iterator's `return()` is always invoked in a `finally`
   * block, so the underlying transport is released whether consumption
   * completes normally, throws, or the caller `break`s out early.
   */
  async *read(): AsyncGenerator<ProviderStreamChunk, void, void> {
    const iterator = this.source[Symbol.asyncIterator]();
    try {
      while (true) {
        const step = await this.nextOrAbort(iterator);
        if (step.done) {
          return;
        }
        yield step.value;
      }
    } finally {
      await iterator.return?.();
    }
  }

  /** Races `iterator.next()` against this reader's abort signal, whichever settles first. */
  private nextOrAbort(
    iterator: AsyncIterator<ProviderStreamChunk>,
  ): Promise<IteratorResult<ProviderStreamChunk>> {
    if (this.signal?.aborted) {
      return Promise.reject(new StreamAbortedError(this.reasonFromSignal()));
    }
    if (!this.signal) {
      return this.next(iterator);
    }

    const signal = this.signal;
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        signal.removeEventListener("abort", onAbort);
        reject(new StreamAbortedError(this.reasonFromSignal()));
      };
      signal.addEventListener("abort", onAbort, { once: true });

      this.next(iterator).then(
        (step) => {
          signal.removeEventListener("abort", onAbort);
          resolve(step);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      );
    });
  }

  /** Advances `iterator`, translating a foreign throw into {@link StreamError}. */
  private async next(
    iterator: AsyncIterator<ProviderStreamChunk>,
  ): Promise<IteratorResult<ProviderStreamChunk>> {
    try {
      return await iterator.next();
    } catch (cause) {
      if (cause instanceof AnikiError) {
        throw cause;
      }
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new StreamError(`Provider "${this.providerName}" stream failed: ${reason}`, cause);
    }
  }

  /** Renders this reader's `signal.reason`, when set, as a string for {@link StreamAbortedError}. */
  private reasonFromSignal(): string | undefined {
    const reason = this.signal?.reason;
    if (reason === undefined) {
      return undefined;
    }
    return reason instanceof Error ? reason.message : String(reason);
  }
}
