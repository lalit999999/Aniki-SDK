/** Map of event names to the tuple of argument types their listeners receive. */
export type EventMap = Record<string, unknown[]>;

/** A listener function subscribed to a specific event. */
export type Listener<TArgs extends unknown[]> = (...args: TArgs) => void;

/**
 * A small, strongly-typed publish/subscribe emitter.
 *
 * Used as the backbone for broadcasting lifecycle events (agent started,
 * LLM request/response, tool started/finished, errors, execution time)
 * without coupling publishers to any particular listener implementation.
 *
 * @example
 * ```ts
 * interface MyEvents extends EventMap {
 *   greeting: [name: string];
 * }
 *
 * const emitter = new EventEmitter<MyEvents>();
 * emitter.on("greeting", (name) => console.log(`Hello, ${name}`));
 * emitter.emit("greeting", "world");
 * ```
 */
export class EventEmitter<TEvents extends EventMap> {
  private readonly listeners: { [K in keyof TEvents]?: Set<Listener<TEvents[K]>> } = {};

  /** Subscribes `listener` to `event`. Call the returned function to unsubscribe. */
  on<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): () => void {
    const set = this.listeners[event] ?? new Set();
    set.add(listener);
    this.listeners[event] = set;
    return () => this.off(event, listener);
  }

  /** Unsubscribes `listener` from `event`. No-op if it wasn't subscribed. */
  off<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): void {
    this.listeners[event]?.delete(listener);
  }

  /** Subscribes `listener` to `event` for a single invocation, then automatically unsubscribes. */
  once<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): () => void {
    const wrapped: Listener<TEvents[K]> = (...args) => {
      this.off(event, wrapped);
      listener(...args);
    };
    return this.on(event, wrapped);
  }

  /**
   * Invokes every listener subscribed to `event` with `args`.
   *
   * A listener that throws is isolated: its error is swallowed so that
   * remaining listeners still run and `emit` never throws.
   */
  emit<K extends keyof TEvents>(event: K, ...args: TEvents[K]): void {
    const set = this.listeners[event];
    if (!set) return;

    for (const listener of [...set]) {
      try {
        listener(...args);
      } catch {
        // Isolate listener failures so one bad subscriber cannot block others.
      }
    }
  }
}
