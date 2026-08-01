import { describe, expect, it, vi } from "vitest";
import { EventEmitter, type EventMap } from "./EventEmitter.js";

interface TestEvents extends EventMap {
  greeting: [name: string];
  count: [value: number];
}

describe("EventEmitter", () => {
  it("invokes multiple listeners subscribed to the same event", () => {
    const emitter = new EventEmitter<TestEvents>();
    const first = vi.fn();
    const second = vi.fn();

    emitter.on("greeting", first);
    emitter.on("greeting", second);
    emitter.emit("greeting", "world");

    expect(first).toHaveBeenCalledWith("world");
    expect(second).toHaveBeenCalledWith("world");
  });

  it("only invokes a once() listener a single time", () => {
    const emitter = new EventEmitter<TestEvents>();
    const listener = vi.fn();

    emitter.once("count", listener);
    emitter.emit("count", 1);
    emitter.emit("count", 2);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(1);
  });

  it("stops calling a listener after off() unsubscribes it", () => {
    const emitter = new EventEmitter<TestEvents>();
    const listener = vi.fn();

    emitter.on("greeting", listener);
    emitter.off("greeting", listener);
    emitter.emit("greeting", "world");

    expect(listener).not.toHaveBeenCalled();
  });

  it("unsubscribes via the function returned from on()", () => {
    const emitter = new EventEmitter<TestEvents>();
    const listener = vi.fn();

    const unsubscribe = emitter.on("greeting", listener);
    unsubscribe();
    emitter.emit("greeting", "world");

    expect(listener).not.toHaveBeenCalled();
  });

  it("does not let a throwing listener stop other listeners or crash emit()", () => {
    const emitter = new EventEmitter<TestEvents>();
    const throwing = vi.fn(() => {
      throw new Error("boom");
    });
    const healthy = vi.fn();

    emitter.on("greeting", throwing);
    emitter.on("greeting", healthy);

    expect(() => emitter.emit("greeting", "world")).not.toThrow();
    expect(throwing).toHaveBeenCalled();
    expect(healthy).toHaveBeenCalledWith("world");
  });

  it("does nothing when emitting an event with no listeners", () => {
    const emitter = new EventEmitter<TestEvents>();
    expect(() => emitter.emit("greeting", "world")).not.toThrow();
  });
});
