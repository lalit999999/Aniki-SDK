/**
 * Shared, dependency-free helper utilities used across the SDK.
 */

/**
 * Returns a shallow copy of `value` with every key whose value is
 * `undefined` removed.
 *
 * Required to satisfy `exactOptionalPropertyTypes`: spreading a partial
 * object directly into a type with optional properties can otherwise leave
 * keys explicitly set to `undefined`, which that flag rejects.
 */
export function omitUndefined<T extends object>(value: { [K in keyof T]?: T[K] | undefined }): T {
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  return Object.fromEntries(entries) as T;
}

/**
 * Formats Zod issues into a single human-readable string, one issue per
 * `"; "`-separated segment, e.g. `"path.to.field: message; (root): message"`.
 */
export function formatZodIssues(
  issues: readonly { path: PropertyKey[]; message: string }[],
): string {
  return issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
}
