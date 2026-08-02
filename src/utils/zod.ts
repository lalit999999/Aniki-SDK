/** Zod-adjacent formatting helpers. */

/**
 * Formats Zod issues into a single human-readable string, one issue per
 * `"; "`-separated segment, e.g. `"path.to.field: message; (root): message"`.
 *
 * @example
 * ```ts
 * const result = schema.safeParse(input);
 * if (!result.success) formatZodIssues(result.error.issues);
 * ```
 */
export function formatZodIssues(
  issues: readonly { path: PropertyKey[]; message: string }[],
): string {
  return issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
}
