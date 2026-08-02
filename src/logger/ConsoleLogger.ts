import type { ILogger, LogFields, LogLevel } from "./Logger.js";
import { LOG_LEVEL_PRIORITY, redactFields } from "./Logger.js";

/**
 * The minimal console-shaped surface {@link ConsoleLogger} writes to.
 *
 * The global `console` object satisfies this on its own; tests inject a
 * fake implementing just these four methods so nothing touches real
 * stdout/stderr.
 */
export interface ConsoleSink {
  /** Writes a `"debug"`-level line. */
  debug(line: string): void;
  /** Writes an `"info"`-level line. */
  info(line: string): void;
  /** Writes a `"warn"`-level line. */
  warn(line: string): void;
  /** Writes an `"error"`-level line. */
  error(line: string): void;
}

/** Options accepted by the {@link ConsoleLogger} constructor. */
export interface ConsoleLoggerOptions {
  /** The minimum level that gets written. Records below this priority (per {@link LOG_LEVEL_PRIORITY}) are dropped. Defaults to `"info"`. */
  readonly level?: LogLevel;
  /** When `true`, each record is written as a single JSON line instead of a human-readable one. Defaults to `false`. */
  readonly json?: boolean;
  /** Where formatted lines are written. Defaults to the global `console`. Inject a fake here to keep tests off real stdout. */
  readonly sink?: ConsoleSink;
}

/** Bindings a {@link ConsoleLogger.child} merges into every record it writes. */
type Bindings = LogFields;

/**
 * An {@link ILogger} that writes to an injectable {@link ConsoleSink}
 * (the global `console` by default).
 *
 * Every field set passed to a log call — and every {@link child} binding —
 * is run through {@link redactFields} before it reaches the sink, so
 * credential-shaped values never reach a log line even if a caller passes
 * them in by mistake. A sink that itself throws is caught and dropped:
 * logging must never be the reason a run fails.
 *
 * @example
 * ```ts
 * const logger = new ConsoleLogger({ level: "info" });
 * logger.info("run started", { runId: "abc-123" });
 *
 * const scoped = logger.child({ runId: "abc-123" });
 * scoped.debug("this is below the info threshold and is dropped");
 * ```
 */
export class ConsoleLogger implements ILogger {
  private readonly level: LogLevel;
  private readonly json: boolean;
  private readonly sink: ConsoleSink;
  private readonly bindings: Bindings;

  constructor(options: ConsoleLoggerOptions = {}) {
    this.level = options.level ?? "info";
    this.json = options.json ?? false;
    this.sink = options.sink ?? console;
    this.bindings = {};
  }

  private write(level: Exclude<LogLevel, "silent">, message: string, fields?: LogFields): void {
    if (this.level === "silent") return;
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.level]) return;

    const merged = { ...this.bindings, ...fields };
    const redacted = redactFields(merged);
    const line = this.json
      ? this.formatJson(level, message, redacted)
      : this.formatText(level, message, redacted);

    try {
      this.sink[level](line);
    } catch {
      // A throwing sink must never break execution — see class docs.
    }
  }

  private formatJson(level: LogLevel, message: string, fields: LogFields): string {
    return JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...fields });
  }

  private formatText(level: LogLevel, message: string, fields: LogFields): string {
    const timestamp = new Date().toISOString();
    const suffix = Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : "";
    return `${timestamp} ${level} ${message}${suffix}`;
  }

  debug(message: string, fields?: LogFields): void {
    this.write("debug", message, fields);
  }

  info(message: string, fields?: LogFields): void {
    this.write("info", message, fields);
  }

  warn(message: string, fields?: LogFields): void {
    this.write("warn", message, fields);
  }

  error(message: string, fields?: LogFields): void {
    this.write("error", message, fields);
  }

  /** Returns a new `ConsoleLogger` sharing this one's level/json/sink, whose records additionally merge `bindings` — this logger's own bindings included. */
  child(bindings: LogFields): ILogger {
    const clone = new ConsoleLogger({ level: this.level, json: this.json, sink: this.sink });
    Object.assign(clone.bindings as Record<string, unknown>, this.bindings, bindings);
    return clone;
  }
}
