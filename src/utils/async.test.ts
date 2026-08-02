import { describe, expect, it, vi } from "vitest";
import { sleep, withTimeout } from "./async.js";

describe("sleep", () => {
  it("resolves after the given delay", async () => {
    vi.useFakeTimers();
    const promise = sleep(100);
    let resolved = false;
    void promise.then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(99);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);
    vi.useRealTimers();
  });
});

describe("withTimeout", () => {
  it("returns the resolved value when the promise settles first", async () => {
    const result = await withTimeout(Promise.resolve("done"), 1000);

    expect(result).toEqual({ timedOut: false, value: "done" });
  });

  it("returns timedOut: true when the timeout elapses first", async () => {
    vi.useFakeTimers();
    const never = new Promise<string>(() => {
      // never settles
    });
    const onTimeout = vi.fn();

    const resultPromise = withTimeout(never, 50, onTimeout);
    await vi.advanceTimersByTimeAsync(50);
    const result = await resultPromise;

    expect(result).toEqual({ timedOut: true });
    expect(onTimeout).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("propagates a rejection from the raced promise", async () => {
    const failing = Promise.reject(new Error("boom"));

    await expect(withTimeout(failing, 1000)).rejects.toThrow("boom");
  });

  it("does not call onTimeout when the promise wins the race", async () => {
    const onTimeout = vi.fn();

    await withTimeout(Promise.resolve("done"), 1000, onTimeout);

    expect(onTimeout).not.toHaveBeenCalled();
  });
});
