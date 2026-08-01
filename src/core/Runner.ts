import type { ProviderRequest, ProviderResponse } from "../providers/AIProvider.js";
import type { Message, ToolCall, ToolResult } from "../types/index.js";
import { ToolExecutor } from "../tools/ToolExecutor.js";
import type { Agent } from "./Agent.js";
import { Context } from "./Context.js";
import { EventEmitter, type EventMap } from "./EventEmitter.js";
import { MaxToolIterationsError, ProviderError, ValidationError } from "./errors.js";

/** Input accepted by {@link Runner.run}. */
export interface RunInput {
  /** The user's message for this turn. */
  readonly message: string;
}

/** The result of a completed {@link Runner.run} call. */
export interface RunResult {
  /** The assistant's final reply for this turn. */
  readonly content: string;
  /** The id of the run that produced this result. */
  readonly runId: string;
  /** The full conversation history, including this turn, after the run completed. */
  readonly messages: readonly Message[];
  /** Every tool result produced while resolving this turn, across all iterations, in execution order. */
  readonly toolResults: readonly ToolResult[];
  /** How many LLM request/response round trips this turn took (`1` when no tool was called). */
  readonly iterations: number;
}

type RunnerContext = Context<Agent, RunInput>;

/** Lifecycle events emitted by {@link Runner} over the course of a run. */
export interface RunnerEvents extends EventMap {
  "agent:started": [context: RunnerContext];
  "agent:finished": [context: RunnerContext, result: RunResult];
  "llm:request": [context: RunnerContext, request: ProviderRequest];
  "llm:response": [context: RunnerContext, response: ProviderResponse];
  "tool:started": [context: RunnerContext, call: ToolCall];
  "tool:finished": [context: RunnerContext, result: ToolResult];
  "tool:error": [context: RunnerContext, call: ToolCall, error: Error];
  error: [context: RunnerContext, error: Error];
}

/**
 * The execution engine of the SDK.
 *
 * Composes an {@link Agent}, its {@link ISession}, a per-run {@link Context},
 * an {@link EventEmitter}, and a fresh {@link ToolExecutor} bound to the
 * agent's {@link ToolRegistry} to orchestrate a full request/response cycle
 * against the agent's injected {@link IProvider} — including, when the
 * model requests them, executing tools and feeding their results back for
 * as many iterations as {@link Agent.maxToolIterations} allows. Runner is
 * the only component that decides what happens next: `Agent` stores
 * configuration, `Tool` describes itself, and `ToolExecutor` only executes
 * what it is told to.
 *
 * @example
 * ```ts
 * const runner = new Runner();
 * const result = await runner.run(agent, { message: "What's the weather in Gaya?" });
 * ```
 */
export class Runner {
  private readonly emitter: EventEmitter<RunnerEvents>;

  /** Constructs a Runner, optionally with a caller-supplied event emitter. */
  constructor(emitter: EventEmitter<RunnerEvents> = new EventEmitter<RunnerEvents>()) {
    this.emitter = emitter;
  }

  /** Subscribes to a Runner lifecycle event. See {@link RunnerEvents}. */
  on<K extends keyof RunnerEvents>(
    event: K,
    listener: (...args: RunnerEvents[K]) => void,
  ): () => void {
    return this.emitter.on(event, listener);
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
   * Throws {@link ValidationError} for malformed input, {@link ProviderError}
   * when the injected provider fails, and {@link MaxToolIterationsError} when
   * the iteration ceiling is reached without a final answer.
   */
  async run(agent: Agent, input: RunInput): Promise<RunResult> {
    if (typeof input.message !== "string" || input.message.length === 0) {
      throw new ValidationError("Runner input requires a non-empty message");
    }

    const context = new Context({ agent, input });
    this.emitter.emit("agent:started", context);

    const session = agent.session;
    const executor = new ToolExecutor(agent.toolRegistry);
    const toolDefinitions = agent.toolRegistry.toDefinitions();
    const toolResults: ToolResult[] = [];

    session.addMessage({ role: "user", content: input.message });

    let finalResponse: ProviderResponse | undefined;
    let iterations = 0;

    for (let iteration = 1; iteration <= agent.maxToolIterations; iteration++) {
      iterations = iteration;

      const request: ProviderRequest = {
        model: agent.model,
        messages: [{ role: "system", content: agent.instructions }, ...session.getMessages()],
        ...(toolDefinitions.length > 0 ? { tools: toolDefinitions } : {}),
      };

      this.emitter.emit("llm:request", context, request);

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
        this.emitter.emit("error", context, error);
        throw error;
      }

      this.emitter.emit("llm:response", context, response);

      const toolCalls = response.toolCalls;
      if (!toolCalls || toolCalls.length === 0) {
        session.addMessage({ role: "assistant", content: response.content });
        finalResponse = response;
        break;
      }

      session.addMessage({ role: "assistant", content: response.content, toolCalls });

      for (const call of toolCalls) {
        this.emitter.emit("tool:started", context, call);
      }

      const results = await executor.executeAll(toolCalls);
      for (const result of results) {
        toolResults.push(result);
        if (result.ok) {
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
      this.emitter.emit("error", context, error);
      throw error;
    }

    const result: RunResult = {
      content: finalResponse.content,
      runId: context.runId,
      messages: session.getMessages(),
      toolResults,
      iterations,
    };

    this.emitter.emit("agent:finished", context, result);

    return result;
  }
}
