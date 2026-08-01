import {
  ToolError,
  ToolExecutionError,
  ToolNotFoundError,
  ToolOutputValidationError,
  ToolTimeoutError,
} from "../core/errors.js";
import type { ToolCall, ToolResult } from "../types/tool.js";
import type { Tool, ToolContext } from "./Tool.js";
import type { ToolRegistry } from "./ToolRegistry.js";

/** Options accepted by the {@link ToolExecutor} constructor. */
export interface ToolExecutorOptions {
  /**
   * How many {@link ToolCall}s {@link ToolExecutor.executeAll} runs at once.
   * Fixed at `1` (fully sequential) by default; raising it is a config
   * change, not a rewrite, since batching is already structured around it.
   */
  readonly concurrency?: number;
}

/**
 * Validates, executes, times, and contains failures for {@link ToolCall}s
 * resolved from an injected {@link ToolRegistry}.
 *
 * `ToolExecutor` never constructs its own registry (composition, not
 * ownership) and knows nothing about providers or conversation history —
 * that orchestration belongs to {@link Runner}. Its defining behavior is
 * that {@link ToolExecutor.execute} *resolves*, never rejects, for any
 * tool-level failure (unknown tool, bad input, a throwing `execute`, a
 * timeout): each becomes a {@link ToolResult} with `ok: false` and an
 * LLM-readable `error` string, so the model can see its own mistake and
 * self-correct next turn. `execute` only rejects for a genuine programmer
 * error (a malformed {@link ToolCall}), never for a tool's own failure.
 *
 * @example
 * ```ts
 * const executor = new ToolExecutor(registry);
 * const [result] = await executor.executeAll([
 *   { id: "call-1", name: "get_weather", arguments: { city: "Gaya" } },
 * ]);
 * result.ok; // true or false — never throws for a tool-level failure
 * ```
 */
export class ToolExecutor {
  private readonly registry: ToolRegistry;
  private readonly concurrency: number;

  /** Constructs a ToolExecutor bound to `registry`. */
  constructor(registry: ToolRegistry, options: ToolExecutorOptions = {}) {
    this.registry = registry;
    this.concurrency = options.concurrency ?? 1;
  }

  /**
   * Resolves, validates, and executes a single {@link ToolCall}, applying
   * the resolved tool's configured timeout and retries.
   *
   * Always resolves. Unknown tool, invalid input, a throwing `execute`, and
   * a timeout all produce `{ ok: false, error }` rather than a rejection.
   * Retries apply only to execution/timeout failures — an input validation
   * failure is the LLM's mistake, not a transient fault, so it is never
   * retried; neither is an output validation failure, since a deterministic
   * bug in `execute` will not fix itself on a second attempt.
   */
  async execute(call: ToolCall, context?: ToolContext): Promise<ToolResult> {
    const startedAt = Date.now();

    const tool = this.registry.get(call.name);
    if (!tool) {
      return this.failureResult(call, new ToolNotFoundError(call.name, call.id), startedAt);
    }

    let input: unknown;
    try {
      input = tool.parseInput(call.arguments);
    } catch (cause) {
      return this.failureResult(call, this.toToolError(cause, tool, call), startedAt);
    }

    const maxAttempts = 1 + Math.max(tool.retries ?? 0, 0);
    for (let attempt = 1; ; attempt++) {
      try {
        const rawOutput = await this.invokeWithTimeout(tool, input, call, context);
        const output = tool.parseOutput(rawOutput);
        return {
          toolCallId: call.id,
          toolName: call.name,
          ok: true,
          output,
          durationMs: Date.now() - startedAt,
        };
      } catch (cause) {
        const error = this.toToolError(cause, tool, call);
        if (error instanceof ToolOutputValidationError || attempt >= maxAttempts) {
          return this.failureResult(call, error, startedAt);
        }
        // Execution/timeout failure with attempts remaining: retry.
      }
    }
  }

  /**
   * Executes every call in `calls`, preserving input order in the returned
   * results. Runs in batches of {@link ToolExecutorOptions.concurrency}
   * (`1` by default, i.e. fully sequential); one call's failure never
   * aborts the rest of the batch, since {@link execute} never rejects.
   */
  async executeAll(
    calls: readonly ToolCall[],
    context?: ToolContext,
  ): Promise<readonly ToolResult[]> {
    const results: ToolResult[] = [];
    for (let i = 0; i < calls.length; i += this.concurrency) {
      const batch = calls.slice(i, i + this.concurrency);
      const batchResults = await Promise.all(batch.map((call) => this.execute(call, context)));
      results.push(...batchResults);
    }
    return results;
  }

  /** Runs `tool.invoke` and races it against a timeout when one is configured. */
  private invokeWithTimeout(
    tool: Tool,
    input: unknown,
    call: ToolCall,
    context: ToolContext | undefined,
  ): Promise<unknown> {
    const timeoutMs = tool.timeoutMs;
    const controller = new AbortController();
    const mergedContext: ToolContext = {
      ...context,
      signal: controller.signal,
      toolCallId: call.id,
    };
    const executionPromise = Promise.resolve(tool.invoke(input, mergedContext));

    if (timeoutMs === undefined) {
      return executionPromise;
    }

    let timer: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new ToolTimeoutError(tool.name, timeoutMs, call.id));
      }, timeoutMs);
    });

    return Promise.race([executionPromise, timeoutPromise]).finally(() => clearTimeout(timer));
  }

  /** Normalizes an arbitrary thrown value into a {@link ToolError}, wrapping unknown causes. */
  private toToolError(cause: unknown, tool: Tool, call: ToolCall): ToolError {
    if (cause instanceof ToolError) {
      return cause;
    }
    return new ToolExecutionError(tool.name, cause, call.id);
  }

  private failureResult(call: ToolCall, error: ToolError, startedAt: number): ToolResult {
    return {
      toolCallId: call.id,
      toolName: call.name,
      ok: false,
      error: error.message,
      durationMs: Date.now() - startedAt,
    };
  }
}
