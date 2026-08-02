import { randomUUID } from "node:crypto";

/**
 * Generates a unique id, optionally prefixed (e.g. `generateId("run")` =>
 * `"run_3f1c...`"`). Wraps `node:crypto`'s `randomUUID` so every part of the
 * SDK that needs an id (run ids, tool call ids, session ids, ...) produces
 * them the same way.
 *
 * @param prefix - An optional prefix, joined to the UUID with `"_"`.
 * @returns A UUID, or `"${prefix}_${uuid}"` when `prefix` is given.
 * @example
 * ```ts
 * generateId(); // => "3f1c2e4a-..."
 * generateId("run"); // => "run_3f1c2e4a-..."
 * ```
 */
export function generateId(prefix?: string): string {
  const uuid = randomUUID();
  return prefix ? `${prefix}_${uuid}` : uuid;
}
