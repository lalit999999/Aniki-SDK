/** String-shaped helpers. */

/**
 * Truncates `value` to `maxLength` characters, appending `"..."` when it was
 * cut short. Used anywhere unbounded text (raw model output, ...) must be
 * bounded before it's attached to an error or log record.
 *
 * @example
 * ```ts
 * truncate("hello world", 5); // => "hello..."
 * truncate("hi", 5); // => "hi"
 * ```
 */
export function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}
