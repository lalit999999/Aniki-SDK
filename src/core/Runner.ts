import { randomUUID } from "node:crypto";
import type { ProviderRequest, ProviderResponse } from "../providers/AIProvider.js";
import type { Message, ToolCall, ToolResult } from "../types/index.js";
import type {
  AgentEndEvent,
  AgentErrorEvent,
  AgentStartEvent,
  LlmEndEvent,
  LlmErrorEvent,
  LlmStartEvent,
  MiddlewareErrorEvent,
  ToolEndEvent,
  ToolStartEvent,
} from "../types/events.js";
import type { RunMetadata } from "../types/output.js";
import { OutputPipeline } from "../parser/OutputPipeline.js";
import { StructuredOutputParser } from "../parser/StructuredOutput.js";
import { ToolExecutor } from "../tools/ToolExecutor.js";
import type { Agent } from "./Agent.js";
import { Context } from "./Context.js";
import { EventEmitter, type EventMap } from "./EventEmitter.js";
import {
  MaxToolIterationsError,
  ProviderError,
  StreamingNotSupportedError,
  ValidationError,
} from "./errors.js";
import { RunStream } from "./RunStream.js";

/** Input accepted by {@link Runner.run}. */
export interface RunInput {
  /** The user's message for this turn. */
  readonly message: string;
}

/** The result of a completed {@link Runner.run} call. */
export interface RunResult<TOutput = undefined> {
  /** The assistant's final reply for this turn. */
  readonly content: string;
  /** The final reply validated against the agent's output schema, or `undefined` when the agent has none. */
  readonly output: TOutput;
  /** The id of the run that produced this result. */
  readonly runId: string;
  /** The full conversation history, including this turn, after the run completed. */
  readonly messages: readonly Message[];
  /** Every tool result produced while resolving this turn, across all iterations, in execution order. */
  readonly toolResults: readonly ToolResult[];
  /** How many LLM request/response round trips this turn took (`1` when no tool was called). */
  readonly iterations: number;
  /** Descriptive metadata about this run (model, provider, timing, token usage, ...). */
  readonly metadata: RunMetadata;
}

/**
 * The per-run execution context {@link Runner} threads through a call.
 * Typed loosely over its agent (`unknown`) so a single {@link RunnerEvents}
 * map can describe events for every `Agent<TOutput>` instantiation.
 */
type RunnerContext = Context<unknown, RunInput>;

/**
 * Lifecycle events emitted by {@link Runner} over the course of a run.
 *
 * Combines the canonical event names from `src/types/events.ts` with every
 * pre-Task-6 legacy name, so existing subscribers keep working unchanged.
 * `Runner` emits each canonical event immediately followed by its legacy
 * counterpart (see {@link LEGACY_EVENT_ALIASES}); events with no renamed
 * predecessor (`agent:error`, `llm:error`, `middleware:error`) are emitted
 * canonically only.
 *
 * `"tool:error"` is the one name that did not change across the rename —
 * `Runner` predates the canonical event contracts and already shipped it
 * with a `(context, call, error)` payload, which existing subscribers (and
 * this SDK's own tests) depend on; that shape is kept here rather than
 * switched to the generic single-object {@link ToolErrorEvent}, so this
 * event is emitted exactly once, not twice.
 */
export interface RunnerEvents extends EventMap {
  /** @deprecated Use `"agent:start"` instead. */
  "agent:started": [context: RunnerContext];
  /** @deprecated Use `"agent:end"` instead. */
  "agent:finished": [context: RunnerContext, result: RunResult<unknown>];
  /** @deprecated Use `"llm:start"` instead. */
  "llm:request": [context: RunnerContext, request: ProviderRequest];
  /** @deprecated Use `"llm:end"` instead. */
  "llm:response": [context: RunnerContext, response: ProviderResponse];
  /** @deprecated Use `"tool:start"` instead. */
  "tool:started": [context: RunnerContext, call: ToolCall];
  /** @deprecated Use `"tool:end"` instead. */
  "tool:finished": [context: RunnerContext, result: ToolResult];
  "tool:error": [context: RunnerContext, call: ToolCall, error: Error];
  error: [context: RunnerContext, error: Error];

  "agent:start": [event: AgentStartEvent];
  "agent:end": [event: AgentEndEvent];
  "agent:error": [event: AgentErrorEvent];
  "llm:start": [event: LlmStartEvent];
  "llm:end": [event: LlmEndEvent];
  "llm:error": [event: LlmErrorEvent];
  "tool:start": [event: ToolStartEvent];
  "tool:end": [event: ToolEndEvent];
  "middleware:error": [event: MiddlewareErrorEvent];
}

/**
 * The execution engine of the SDK.
 *
 * Composes an {@link Agent}, its {@link ISession}, a per-run {@link Context},
 * an {@link EventEmitter}, a fresh {@link ToolExecutor} bound to the agent's
 * {@link ToolRegistry}, and an {@link OutputPipeline} to orchestrate a full
 * request/response cycle against the agent's injected {@link IProvider} —
 * including, when the model requests them, executing tools and feeding
 * their results back for as many iterations as {@link Agent.maxToolIterations}
 * allows, and, when the agent has an output schema, appending format
 * instructions to the system message and validating the final response
 * against it via {@link StructuredOutputParser}. Runner is the only
 * component that decides what happens next: `Agent` stores configuration,
 * `Tool` describes itself, and `ToolExecutor` only executes what it is
 * told to.
 *
 * @example
 * ```ts
 * const runner = new Runner();
 * const result = await runner.run(agent, { message: "What's the weather in Gaya?" });
 * ```
 */
export class Runner {
  private readonly emitter: EventEmitter<RunnerEvents>;
  private readonly outputPipeline: OutputPipeline;

  /**
   * Constructs a Runner, optionally with a caller-supplied event emitter
   * and/or {@link OutputPipeline} of post-processing steps run over every
   * response before structured-output validation. Both default to fresh,
   * empty instances.
   */
  constructor(
    emitter: EventEmitter<RunnerEvents> = new EventEmitter<RunnerEvents>(),
    outputPipeline: OutputPipeline = new OutputPipeline(),
  ) {
    this.emitter = emitter;
    this.outputPipeline = outputPipeline;
  }

  /** Subscribes to a Runner lifecycle event. See {@link RunnerEvents}. */
  on<K extends keyof RunnerEvents>(
    event: K,
    listener: (...args: RunnerEvents[K]) => void,
  ): () => void {
    return this.emitter.on(event, listener);
  }

  /** Unsubscribes `listener` from `event`. No-op if it wasn't subscribed. */
  off<K extends keyof RunnerEvents>(event: K, listener: (...args: RunnerEvents[K]) => void): void {
    this.emitter.off(event, listener);
  }

  /** Subscribes `listener` to `event` for a single invocation, then automatically unsubscribes. */
  once<K extends keyof RunnerEvents>(
    event: K,
    listener: (...args: RunnerEvents[K]) => void,
  ): () => void {
    return this.emitter.once(event, listener);
  }

  /**
   * Executes one full turn for `agent` given `input`.
   *
   * Loads prior history from the agent's session, then repeats
   * "call the provider → execute any requested tools → feed results back"
   * until the model returns a plain answer (no tool calls) or
   * {@link Agent.maxToolIterations} is exhausted. The user message and every
   * intermediate assistant/tool message are persisted to the session, in
   * order, as the run progresses — so a follow-up turn replays complete
   * context even if this run ultimately throws.
   *
   * When `agent.output` is set, its {@link StructuredOutputParser.toFormatInstructions}
   * output is appended to (never replaces) the system message, and the
   * final response — after passing through this Runner's
   * {@link OutputPipeline} — is parsed and validated into `result.output`.
   * This happens after the assistant message has already been persisted to
   * the session, so a malformed response still leaves a consistent history
   * for the next turn.
   *
   * Throws {@link ValidationError} for malformed input, {@link ProviderError}
   * when the injected provider fails, {@link MaxToolIterationsError} when the
   * iteration ceiling is reached without a final answer, and
   * {@link OutputParseError}/{@link OutputValidationError} when the agent has
   * an output schema and the final response doesn't satisfy it.
   */
  async run<TOutput = undefined>(
    agent: Agent<TOutput>,
    input: RunInput,
  ): Promise<RunResult<TOutput>> {
    if (typeof input.message !== "string" || input.message.length === 0) {
      throw new ValidationError("Runner input requires a non-empty message");
    }

    const context: RunnerContext = new Context({ agent, input });
    this.emitter.emit("agent:start", {
      runId: context.runId,
      timestamp: context.startedAt,
      agentName: agent.name,
      model: agent.model,
      providerName: agent.provider.name,
    });
    this.emitter.emit("agent:started", context);

    const session = agent.session;
    const executor = new ToolExecutor(agent.toolRegistry);
    const toolDefinitions = agent.toolRegistry.toDefinitions();
    const toolResults: ToolResult[] = [];
    const outputParser = agent.output ? new StructuredOutputParser(agent.output) : undefined;
    const systemContent = outputParser
      ? `${agent.instructions}\n\n${outputParser.toFormatInstructions()}`
      : agent.instructions;

    session.addMessage({ role: "user", content: input.message });

    let finalResponse: ProviderResponse | undefined;
    let iterations = 0;

    for (let iteration = 1; iteration <= agent.maxToolIterations; iteration++) {
      iterations = iteration;

      const request: ProviderRequest = {
        model: agent.model,
        messages: [{ role: "system", content: systemContent }, ...session.getMessages()],
        ...(toolDefinitions.length > 0 ? { tools: toolDefinitions } : {}),
      };

      this.emitter.emit("llm:start", {
        runId: context.runId,
        timestamp: new Date(),
        agentName: agent.name,
        model: agent.model,
        providerName: agent.provider.name,
        iteration,
        messageCount: request.messages.length,
      });
      this.emitter.emit("llm:request", context, request);

      const llmStartedAt = Date.now();
      let response: ProviderResponse;
      try {
        response = await agent.provider.generate(request);
      } catch (cause) {
        // A subclass (see `src/providers/errors.ts`) already carries structured
        // failure details, so it is rethrown unchanged rather than erased.
        const error =
          cause instanceof ProviderError
            ? cause
            : new ProviderError(
                `Provider "${agent.provider.name}" failed to generate a response: ${
                  cause instanceof Error ? cause.message : String(cause)
                }`,
              );
        this.emitter.emit("llm:error", {
          runId: context.runId,
          timestamp: new Date(),
          agentName: agent.name,
          model: agent.model,
          providerName: agent.provider.name,
          iteration,
          error,
        });
        this.emitter.emit("error", context, error);
        throw error;
      }

      this.emitter.emit("llm:end", {
        runId: context.runId,
        timestamp: new Date(),
        durationMs: Date.now() - llmStartedAt,
        agentName: agent.name,
        model: agent.model,
        providerName: agent.provider.name,
        iteration,
        ...(response.finishReason !== undefined ? { finishReason: response.finishReason } : {}),
        ...(response.usage !== undefined ? { usage: response.usage } : {}),
      });
      this.emitter.emit("llm:response", context, response);

      const toolCalls = response.toolCalls;
      if (!toolCalls || toolCalls.length === 0) {
        session.addMessage({ role: "assistant", content: response.content });
        finalResponse = response;
        break;
      }

      session.addMessage({ role: "assistant", content: response.content, toolCalls });

      for (const call of toolCalls) {
        this.emitter.emit("tool:start", {
          runId: context.runId,
          timestamp: new Date(),
          toolName: call.name,
          toolCallId: call.id,
          call,
        });
        this.emitter.emit("tool:started", context, call);
      }

      const results = await executor.executeAll(toolCalls);
      for (const result of results) {
        toolResults.push(result);
        if (result.ok) {
          this.emitter.emit("tool:end", {
            runId: context.runId,
            timestamp: new Date(),
            durationMs: result.durationMs,
            toolName: result.toolName,
            toolCallId: result.toolCallId,
            ok: true,
          });
          this.emitter.emit("tool:finished", context, result);
        } else {
          const call = toolCalls.find((c) => c.id === result.toolCallId);
          if (call) {
            this.emitter.emit(
              "tool:error",
              context,
              call,
              new Error(result.error ?? "Tool execution failed"),
            );
          }
        }
        session.addMessage({
          role: "tool",
          content: result.ok
            ? (JSON.stringify(result.output) ?? "null")
            : (result.error ?? "Tool execution failed"),
          toolCallId: result.toolCallId,
          name: result.toolName,
        });
      }
    }

    if (!finalResponse) {
      const error = new MaxToolIterationsError(agent.maxToolIterations);
      this.emitter.emit("agent:error", {
        runId: context.runId,
        timestamp: new Date(),
        agentName: agent.name,
        error,
      });
      this.emitter.emit("error", context, error);
      throw error;
    }

    const metadata: RunMetadata = {
      runId: context.runId,
      model: finalResponse.model,
      provider: agent.provider.name,
      durationMs: Date.now() - context.startedAt.getTime(),
      iterations,
      streamed: false,
      ...(finalResponse.finishReason !== undefined
        ? { finishReason: finalResponse.finishReason }
        : {}),
      ...(finalResponse.usage !== undefined ? { usage: finalResponse.usage } : {}),
    };

    let output: TOutput;
    try {
      const processed = await this.outputPipeline.run({
        raw: finalResponse.content,
        text: finalResponse.content,
        metadata,
        data: {},
      });
      output = outputParser ? outputParser.parse(processed.text) : (undefined as TOutput);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.emitter.emit("agent:error", {
        runId: context.runId,
        timestamp: new Date(),
        agentName: agent.name,
        error: err,
      });
      this.emitter.emit("error", context, err);
      throw error;
    }

    const result: RunResult<TOutput> = {
      content: finalResponse.content,
      output,
      runId: context.runId,
      messages: session.getMessages(),
      toolResults,
      iterations,
      metadata,
    };

    this.emitter.emit("agent:end", {
      runId: context.runId,
      timestamp: new Date(),
      durationMs: metadata.durationMs,
      agentName: agent.name,
      model: finalResponse.model,
      providerName: agent.provider.name,
      iterations,
    });
    this.emitter.emit("agent:finished", context, result);

    return result;
  }

  /**
   * Opens a streamed turn for `agent` given `input`, returning a
   * {@link RunStream} the caller drains at its own pace.
   *
   * Unlike {@link run}, this method does not itself await completion — it
   * validates preconditions, persists the user message, opens the
   * provider's stream, and hands back a one-shot handle. Throws
   * {@link ValidationError} for malformed input and
   * {@link StreamingNotSupportedError} synchronously, before any request is
   * sent, when `agent.provider.capabilities.streaming` is `false` or the
   * agent has any registered tools — this SDK's `ProviderStreamChunk`
   * contract has no way to express a tool call, so streaming with tools is
   * out of scope until a later task.
   *
   * When `agent.output` is set, the same format instructions {@link run}
   * appends are appended here too; the accumulated stream content is
   * validated against that schema once, when the stream completes, and the
   * typed result is available via `RunStream.result`.
   */
  stream<TOutput = undefined>(agent: Agent<TOutput>, input: RunInput): RunStream<TOutput> {
    if (typeof input.message !== "string" || input.message.length === 0) {
      throw new ValidationError("Runner input requires a non-empty message");
    }
    if (!agent.provider.capabilities.streaming) {
      throw new StreamingNotSupportedError(agent.provider.name, "capabilities.streaming is false");
    }
    if (agent.toolRegistry.list().length > 0) {
      throw new StreamingNotSupportedError(
        agent.provider.name,
        "streaming does not support tool calls",
      );
    }

    const session = agent.session;
    const outputParser = agent.output ? new StructuredOutputParser(agent.output) : undefined;
    const systemContent = outputParser
      ? `${agent.instructions}\n\n${outputParser.toFormatInstructions()}`
      : agent.instructions;

    session.addMessage({ role: "user", content: input.message });

    const request: ProviderRequest = {
      model: agent.model,
      messages: [{ role: "system", content: systemContent }, ...session.getMessages()],
    };

    return new RunStream<TOutput>({
      runId: randomUUID(),
      model: agent.model,
      provider: agent.provider.name,
      session,
      source: agent.provider.generateStream(request),
      startedAt: Date.now(),
      ...(outputParser ? { outputParser } : {}),
    });
  }
}
