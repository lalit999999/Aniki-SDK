import type { ILogger, LogFields, LogLevel } from "../logger/Logger.js";

/** A single record captured by {@link MockLogger}. */
export interface MockLogRecord {
  /** The severity this record was logged at. */
  readonly level: Exclude<LogLevel, "silent">;
  /** The log message. */
  readonly message: string;
  /** Structured fields attached to this record, including any bindings from {@link MockLogger.child}. */
  readonly fields: LogFields | undefined;
}

/**
 * An {@link ILogger} test double that captures every record instead of
 * writing anywhere, so a test can assert on exactly what the SDK logged.
 *
 * {@link child} returns a new `MockLogger` whose records are also visible
 * from the parent's {@link records} (so asserting against the top-level
 * logger sees everything, regardless of how deep the `child()` chain that
 * produced a given record was) while carrying its own `bindings` merged
 * into every record it writes.
 *
 * @example
 * ```ts
 * const logger = new MockLogger();
 * const runner = new Runner(undefined, undefined, { logger });
 *
 * // ... run something that logs ...
 *
 * expect(logger.recordsAt("error")).toHaveLength(1);
 * ```
 */
export class MockLogger implements ILogger {
  private readonly bindings: LogFields;
  private readonly sink: MockLogRecord[];

  constructor(bindings: LogFields = {}, sink: MockLogRecord[] = []) {
    this.bindings = bindings;
    this.sink = sink;
  }

  /** Captures a `"debug"`-level record. */
  debug(message: string, fields?: LogFields): void {
    this.capture("debug", message, fields);
  }

  /** Captures an `"info"`-level record. */
  info(message: string, fields?: LogFields): void {
    this.capture("info", message, fields);
  }

  /** Captures a `"warn"`-level record. */
  warn(message: string, fields?: LogFields): void {
    this.capture("warn", message, fields);
  }

  /** Captures an `"error"`-level record. */
  error(message: string, fields?: LogFields): void {
    this.capture("error", message, fields);
  }

  /** Returns a logger that merges `bindings` into every record it writes, sharing this logger's underlying record sink. */
  child(bindings: LogFields): ILogger {
    return new MockLogger({ ...this.bindings, ...bindings }, this.sink);
  }

  /** Every record captured so far (by this logger and any descendant `child()` loggers), in call order. */
  get records(): readonly MockLogRecord[] {
    return [...this.sink];
  }

  /** Every record captured at `level`, in call order. */
  recordsAt(level: Exclude<LogLevel, "silent">): readonly MockLogRecord[] {
    return this.records.filter((record) => record.level === level);
  }

  /** Clears every captured record. */
  reset(): void {
    this.sink.length = 0;
  }

  private capture(level: Exclude<LogLevel, "silent">, message: string, fields?: LogFields): void {
    const merged =
      Object.keys(this.bindings).length === 0 && fields === undefined
        ? undefined
        : { ...this.bindings, ...fields };
    this.sink.push({ level, message, fields: merged });
  }
}
