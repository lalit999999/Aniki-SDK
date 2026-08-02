/** Object-shaped helpers: pruning undefined keys, plain-object detection, and deep freezing. */

/**
 * Returns a shallow copy of `value` with every key whose value is
 * `undefined` removed.
 *
 * Required to satisfy `exactOptionalPropertyTypes`: spreading a partial
 * object directly into a type with optional properties can otherwise leave
 * keys explicitly set to `undefined`, which that flag rejects.
 *
 * @example
 * ```ts
 * omitUndefined({ a: 1, b: undefined }); // => { a: 1 }
 * ```
 */
export function omitUndefined<T extends object>(value: { [K in keyof T]?: T[K] | undefined }): T {
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  return Object.fromEntries(entries) as T;
}

/**
 * Narrows `value` to a plain object literal — excludes `null`, arrays, and
 * class instances (`Date`, `Map`, custom classes, ...).
 *
 * @example
 * ```ts
 * isPlainObject({ a: 1 }); // => true
 * isPlainObject(new Date()); // => false
 * ```
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && value.constructor === Object;
}

/**
 * Recursively freezes `value` and every plain-object or array value it
 * contains. Non-plain-object values (class instances, functions, ...) are
 * left untouched rather than frozen, since freezing them could break their
 * own invariants.
 *
 * @returns `value`, frozen in place.
 * @example
 * ```ts
 * const config = deepFreeze({ nested: { retries: 3 } });
 * config.nested.retries = 5; // throws in strict mode
 * ```
 */
export function deepFreeze<T>(value: T): Readonly<T> {
  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreeze(item);
    }
  } else if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      deepFreeze(value[key]);
    }
  }
  return Object.freeze(value);
}
