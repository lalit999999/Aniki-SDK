/**
 * The pluggable logger contract.
 *
 * The SDK never assumes a caller wants console output — every internal
 * component that logs (middleware, `Runner`, ...) is constructed with an
 * {@link ILogger}, and defaults to {@link NoopLogger} when none is supplied.
 * A concrete, console-backed implementation lives in `ConsoleLogger.ts`;
 * callers may equally plug in their own adapter (pino, winston, a remote
 * sink, ...) by implementing this interface.
 */

/** The severity of a single log record, ordered from most to least verbose. `"silent"` is only meaningful as a threshold — nothing is ever logged at that level. */
export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

/**
 * Numeric ordering for {@link LogLevel}, higher is more severe.
 *
 * Used to compare a record's level against a logger's configured threshold:
 * a record is emitted only when its priority is greater than or equal to
 * the threshold's.
 */
export const LOG_LEVEL_PRIORITY: Readonly<Record<LogLevel, number>> = Object.freeze({
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
});

/** Structured, free-form context attached to a log record. */
export interface LogFields {
  readonly [key: string]: unknown;
}

/**
 * The contract every logger implementation satisfies.
 *
 * Modeled after the common `debug/info/warn/error` shape so existing
 * logging libraries are trivial to adapt. {@link ILogger.child} returns a
 * new logger that merges `bindings` into every record it subsequently
 * writes, without mutating the parent — the standard way to attach
 * request-scoped context (e.g. `runId`) for the lifetime of a single run.
 *
 * @example
 * ```ts
 * class MyLogger implements ILogger {
 *   debug(message: string, fields?: LogFields) { console.debug(message, fields); }
 *   info(message: string, fields?: LogFields) { console.info(message, fields); }
 *   warn(message: string, fields?: LogFields) { console.warn(message, fields); }
 *   error(message: string, fields?: LogFields) { console.error(message, fields); }
 *   child(bindings: LogFields): ILogger { return this; }
 * }
 * ```
 */
export interface ILogger {
  /** Logs a `"debug"`-level record. */
  debug(message: string, fields?: LogFields): void;
  /** Logs an `"info"`-level record. */
  info(message: string, fields?: LogFields): void;
  /** Logs a `"warn"`-level record. */
  warn(message: string, fields?: LogFields): void;
  /** Logs an `"error"`-level record. */
  error(message: string, fields?: LogFields): void;
  /** Returns a logger that merges `bindings` into every record it writes, leaving this logger unaffected. */
  child(bindings: LogFields): ILogger;
}

/**
 * The SDK's default logger: every method is a no-op.
 *
 * Exists so internal components can unconditionally hold an {@link ILogger}
 * without the SDK ever writing to a caller's console unless they explicitly
 * opt in by supplying their own logger (e.g. `ConsoleLogger`).
 *
 * @example
 * ```ts
 * const logger: ILogger = new NoopLogger();
 * logger.info("this goes nowhere");
 * ```
 */
export class NoopLogger implements ILogger {
  debug(message: string, fields?: LogFields): void {
    void message;
    void fields;
  }

  info(message: string, fields?: LogFields): void {
    void message;
    void fields;
  }

  warn(message: string, fields?: LogFields): void {
    void message;
    void fields;
  }

  error(message: string, fields?: LogFields): void {
    void message;
    void fields;
  }

  child(bindings: LogFields): ILogger {
    void bindings;
    return this;
  }
}

/** Field names redacted (case-insensitively) by {@link redactFields}. */
const REDACTED_FIELD_NAMES = new Set([
  "apikey",
  "authorization",
  "api_key",
  "token",
  "password",
  "secret",
]);

/** The value {@link redactFields} substitutes for a redacted field. */
const REDACTED_PLACEHOLDER = "[redacted]";

/**
 * Returns a deep copy of `fields` with every key matching a name in
 * {@link REDACTED_FIELD_NAMES} (case-insensitive, at any nesting depth)
 * replaced with `"[redacted]"`.
 *
 * Arrays are walked element-wise; non-plain-object values (including
 * `Date`, `Map`, class instances) are returned as-is without recursing into
 * them, so this never throws on cyclical-looking but opaque values.
 *
 * @example
 * ```ts
 * redactFields({ user: "lalit", apiKey: "sk-live-123" });
 * // => { user: "lalit", apiKey: "[redacted]" }
 * ```
 */
export function redactFields<T extends LogFields>(fields: T): T {
  return redactValue(fields) as T;
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = REDACTED_FIELD_NAMES.has(key.toLowerCase())
        ? REDACTED_PLACEHOLDER
        : redactValue(val);
    }
    return result;
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && value.constructor === Object;
}
