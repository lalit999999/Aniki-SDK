/** Async control-flow helpers. */

/**
 * Resolves after `ms` milliseconds.
 *
 * @example
 * ```ts
 * await sleep(100);
 * ```
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** The outcome of {@link withTimeout}: either the settled value, or a timeout. */
export type TimeoutResult<T> =
  | { readonly timedOut: false; readonly value: T }
  | { readonly timedOut: true };

/**
 * Races `promise` against a `ms`-millisecond timer, returning a typed
 * result instead of throwing so callers can branch on `timedOut` without a
 * `try`/`catch`. If `promise` rejects before the timer fires, that
 * rejection propagates normally. `onTimeout` runs only when the timer wins.
 *
 * @example
 * ```ts
 * const result = await withTimeout(tool.execute(input), 5000, () => controller.abort());
 * if (result.timedOut) throw new ToolTimeoutError(tool.name, 5000);
 * ```
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout?: () => void,
): Promise<TimeoutResult<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<TimeoutResult<T>>((resolve) => {
    timer = setTimeout(() => {
      onTimeout?.();
      resolve({ timedOut: true });
    }, ms);
  });

  try {
    return await Promise.race([
      promise.then((value): TimeoutResult<T> => ({ timedOut: false, value })),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
