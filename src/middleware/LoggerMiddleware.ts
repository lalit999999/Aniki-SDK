import type { ILogger, LogFields, LogLevel } from "../logger/Logger.js";
import { BaseMiddleware } from "./Middleware.js";
import type { MiddlewareNext, MiddlewareRequest, MiddlewareResponse } from "./Middleware.js";

/** Options accepted by the {@link LoggingMiddleware} constructor. */
export interface LoggingMiddlewareOptions {
  /** The logger this middleware writes lifecycle records to. */
  readonly logger: ILogger;
  /** The level LLM start/end records are written at. Failures always log at `"error"` regardless of this setting. Defaults to `"info"`. */
  readonly level?: LogLevel;
  /** When `true`, request/response message content is included in log records. Defaults to `false` so message bodies are never logged unless explicitly opted in. */
  readonly logContent?: boolean;
}

/**
 * Logs the start, end, and failure of every provider round trip it wraps.
 *
 * Sits outermost in the default middleware order (`Claude.md` §3.5) so it
 * records total wall-clock time across cache and retry, while
 * {@link RetryMiddleware} separately logs each individual attempt through
 * its own injected logger — so per-attempt detail is still observable
 * despite this middleware being outermost. Logging never swallows: a
 * failure is logged at `"error"` and then rethrown unchanged, so it never
 * affects the pipeline's error semantics. Message content is never logged
 * unless {@link LoggingMiddlewareOptions.logContent} is explicitly `true`,
 * and credential values never reach a log record because {@link ILogger}
 * implementations (e.g. `ConsoleLogger`) redact them before writing.
 *
 * @example
 * ```ts
 * const middleware = new LoggingMiddleware({ logger: new ConsoleLogger({ level: "info" }) });
 * const runner = new Runner(undefined, undefined, { middleware: [middleware] });
 * ```
 */
export class LoggingMiddleware extends BaseMiddleware {
  private readonly logger: ILogger;
  private readonly level: LogLevel;
  private readonly logContent: boolean;

  constructor(options: LoggingMiddlewareOptions) {
    super("LoggingMiddleware");
    this.logger = options.logger;
    this.level = options.level ?? "info";
    this.logContent = options.logContent ?? false;
  }

  async execute(request: MiddlewareRequest, next: MiddlewareNext): Promise<MiddlewareResponse> {
    const baseFields: LogFields = {
      runId: request.runId,
      agentName: request.agentName,
      model: request.model,
      providerName: request.providerName,
      iteration: request.iteration,
    };

    this.write("LLM request started", {
      ...baseFields,
      messageCount: request.messages.length,
      ...(this.logContent ? { messages: request.messages } : {}),
    });

    const startedAt = Date.now();
    try {
      const result = await next(request);
      const durationMs = Date.now() - startedAt;

      this.write("LLM request completed", {
        ...baseFields,
        durationMs,
        fromCache: result.fromCache,
        attempts: result.attempts,
        ...(result.response.finishReason !== undefined
          ? { finishReason: result.response.finishReason }
          : {}),
        ...(result.response.usage !== undefined ? { usage: result.response.usage } : {}),
        ...(this.logContent ? { content: result.response.content } : {}),
      });

      return result;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      this.logger.error("LLM request failed", {
        ...baseFields,
        durationMs,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private write(message: string, fields: LogFields): void {
    switch (this.level) {
      case "debug":
        this.logger.debug(message, fields);
        return;
      case "warn":
        this.logger.warn(message, fields);
        return;
      case "error":
        this.logger.error(message, fields);
        return;
      case "silent":
        return;
      case "info":
      default:
        this.logger.info(message, fields);
    }
  }
}
