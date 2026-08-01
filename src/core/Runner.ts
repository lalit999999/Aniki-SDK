import type { ProviderRequest, ProviderResponse } from "../providers/AIProvider.js";
import type { Message } from "../types/index.js";
import type { Agent } from "./Agent.js";
import { Context } from "./Context.js";
import { EventEmitter, type EventMap } from "./EventEmitter.js";
import { ProviderError, ValidationError } from "./errors.js";

/** Input accepted by {@link Runner.run}. */
export interface RunInput {
  /** The user's message for this turn. */
  readonly message: string;
}

/** The result of a completed {@link Runner.run} call. */
export interface RunResult {
  /** The assistant's reply for this turn. */
  readonly content: string;
  /** The id of the run that produced this result. */
  readonly runId: string;
  /** The full conversation history, including this turn, after the run completed. */
  readonly messages: readonly Message[];
}

type RunnerContext = Context<Agent, RunInput>;

/** Lifecycle events emitted by {@link Runner} over the course of a run. */
export interface RunnerEvents extends EventMap {
  "agent:started": [context: RunnerContext];
  "agent:finished": [context: RunnerContext, result: RunResult];
  "llm:request": [context: RunnerContext, request: ProviderRequest];
  "llm:response": [context: RunnerContext, response: ProviderResponse];
  error: [context: RunnerContext, error: Error];
}

/**
 * The execution engine of the SDK.
 *
 * Composes an {@link Agent}, its {@link ISession}, a per-run {@link Context},
 * and an {@link EventEmitter} to orchestrate a single request/response cycle
 * against the agent's injected {@link IProvider}. Runner takes its
 * collaborators as constructor/method parameters (composition, not
 * inheritance) so future pipeline steps (tools, middleware) can be added
 * without changing this class.
 *
 * @example
 * ```ts
 * const runner = new Runner();
 * const result = await runner.run(agent, { message: "Hi, my name is Lalit." });
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
   * Executes one full turn for `agent` given `input`: loads prior history
   * from the agent's session, calls the agent's provider, appends the new
   * turn back into the session, and returns the result.
   *
   * Throws {@link ValidationError} for malformed input and {@link ProviderError}
   * when the injected provider fails.
   */
  async run(agent: Agent, input: RunInput): Promise<RunResult> {
    if (typeof input.message !== "string" || input.message.length === 0) {
      throw new ValidationError("Runner input requires a non-empty message");
    }

    const context = new Context({ agent, input });
    this.emitter.emit("agent:started", context);

    // Tools and middleware are optional pipeline steps; empty arrays (the
    // current default, since those modules land in later tasks) are skipped.
    const session = agent.session;
    const history = session.getMessages();

    const request: ProviderRequest = {
      model: agent.model,
      messages: [
        { role: "system", content: agent.instructions },
        ...history,
        { role: "user", content: input.message },
      ],
    };

    this.emitter.emit("llm:request", context, request);

    let response: ProviderResponse;
    try {
      response = await agent.provider.generate(request);
    } catch (cause) {
      const error = new ProviderError(
        `Provider "${agent.provider.name}" failed to generate a response: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
      this.emitter.emit("error", context, error);
      throw error;
    }

    this.emitter.emit("llm:response", context, response);

    session.addMessage({ role: "user", content: input.message });
    session.addMessage({ role: "assistant", content: response.content });

    const result: RunResult = {
      content: response.content,
      runId: context.runId,
      messages: session.getMessages(),
    };

    this.emitter.emit("agent:finished", context, result);

    return result;
  }
}
