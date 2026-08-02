import { describe, expect, it, vi } from "vitest";
import type { ProviderRequest } from "../providers/AIProvider.js";
import { MockProvider } from "./MockProvider.js";

function makeRequest(overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return { messages: [{ role: "user", content: "hi" }], model: "gpt-5.5", ...overrides };
}

describe("MockProvider defaults", () => {
  it("defaults to name 'mock' and all-true capabilities", () => {
    const provider = new MockProvider();

    expect(provider.name).toBe("mock");
    expect(provider.capabilities).toEqual({
      streaming: true,
      toolCalling: true,
      structuredOutput: true,
    });
  });

  it("accepts a custom name and partial capabilities override", () => {
    const provider = new MockProvider({ name: "fake-openai", capabilities: { streaming: false } });

    expect(provider.name).toBe("fake-openai");
    expect(provider.capabilities).toEqual({
      streaming: false,
      toolCalling: true,
      structuredOutput: true,
    });
  });

  it("returns a deterministic default response when nothing is queued", async () => {
    const provider = new MockProvider();

    const response = await provider.generate(makeRequest());

    expect(response.content).toBe("Mock response");
    expect(response.model).toBe("mock-model");
    expect(response.finishReason).toBe("stop");
  });

  it("never crashes across repeated calls with an exhausted queue", async () => {
    const provider = new MockProvider();
    provider.enqueueResponse({ content: "one" });

    const first = await provider.generate(makeRequest());
    const second = await provider.generate(makeRequest());
    const third = await provider.generate(makeRequest());

    expect(first.content).toBe("one");
    expect(second.content).toBe("Mock response");
    expect(third.content).toBe("Mock response");
  });
});

describe("MockProvider.enqueueResponse", () => {
  it("merges a partial response over the default", async () => {
    const provider = new MockProvider();
    provider.enqueueResponse({ content: "42" });

    const response = await provider.generate(makeRequest());

    expect(response.content).toBe("42");
    expect(response.model).toBe("mock-model");
  });

  it("serves queued responses in FIFO order", async () => {
    const provider = new MockProvider();
    provider.enqueueResponse({ content: "first" }).enqueueResponse({ content: "second" });

    expect((await provider.generate(makeRequest())).content).toBe("first");
    expect((await provider.generate(makeRequest())).content).toBe("second");
  });

  it("accepts responses pre-queued via the constructor's responses option", async () => {
    const provider = new MockProvider({ responses: [{ content: "from options" }] });

    expect((await provider.generate(makeRequest())).content).toBe("from options");
  });
});

describe("MockProvider.enqueueToolCall", () => {
  it("queues an assistant turn requesting the named tool", async () => {
    const provider = new MockProvider();
    provider.enqueueToolCall("get_weather", { city: "Gaya" }, "call-1");

    const response = await provider.generate(makeRequest());

    expect(response.finishReason).toBe("tool_use");
    expect(response.toolCalls).toEqual([{ id: "call-1", name: "get_weather", arguments: { city: "Gaya" } }]);
  });

  it("generates a call id when none is given", async () => {
    const provider = new MockProvider();
    provider.enqueueToolCall("get_weather", { city: "Gaya" });

    const response = await provider.generate(makeRequest());

    expect(response.toolCalls?.[0]?.id).toBeTruthy();
  });
});

describe("MockProvider.enqueueError", () => {
  it("rejects the next generate() call with the queued error", async () => {
    const provider = new MockProvider();
    const error = new Error("rate limited");
    provider.enqueueError(error);

    await expect(provider.generate(makeRequest())).rejects.toBe(error);
  });

  it("only rejects once, then resumes normal responses", async () => {
    const provider = new MockProvider();
    provider.enqueueError(new Error("boom")).enqueueResponse({ content: "recovered" });

    await expect(provider.generate(makeRequest())).rejects.toThrow("boom");
    expect((await provider.generate(makeRequest())).content).toBe("recovered");
  });
});

describe("MockProvider.enqueueStream", () => {
  it("yields one chunk per delta, with finishReason on the last chunk", async () => {
    const provider = new MockProvider();
    provider.enqueueStream(["Hel", "lo"], "stop");

    const chunks = [];
    for await (const chunk of provider.generateStream(makeRequest())) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([{ delta: "Hel" }, { delta: "lo", finishReason: "stop" }]);
  });

  it("yields a single default chunk when nothing was scripted", async () => {
    const provider = new MockProvider();

    const chunks = [];
    for await (const chunk of provider.generateStream(makeRequest())) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([{ delta: "Mock response", finishReason: "stop" }]);
  });

  it("yields a single empty-delta chunk when scripted with an empty deltas array", async () => {
    const provider = new MockProvider();
    provider.enqueueStream([], "length");

    const chunks = [];
    for await (const chunk of provider.generateStream(makeRequest())) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([{ delta: "", finishReason: "length" }]);
  });
});

describe("MockProvider recording surface", () => {
  it("records every request across generate and generateStream, in order", async () => {
    const provider = new MockProvider();

    await provider.generate(makeRequest({ model: "a" }));
    const stream = provider.generateStream(makeRequest({ model: "b" }));
    for await (const chunk of stream) {
      void chunk;
    }

    expect(provider.callCount).toBe(2);
    expect(provider.calls.map((c) => c.model)).toEqual(["a", "b"]);
    expect(provider.lastRequest?.model).toBe("b");
  });

  it("lastRequest is undefined before any call", () => {
    const provider = new MockProvider();

    expect(provider.lastRequest).toBeUndefined();
    expect(provider.callCount).toBe(0);
  });

  it("calls returns a defensive copy", async () => {
    const provider = new MockProvider();
    await provider.generate(makeRequest());

    const snapshot = provider.calls;
    await provider.generate(makeRequest());

    expect(snapshot).toHaveLength(1);
    expect(provider.calls).toHaveLength(2);
  });

  it("reset() clears recorded calls and every queue", async () => {
    const provider = new MockProvider();
    provider.enqueueResponse({ content: "queued" });
    await provider.generate(makeRequest());

    provider.reset();

    expect(provider.callCount).toBe(0);
    expect((await provider.generate(makeRequest())).content).toBe("Mock response");
  });
});

describe("MockProvider latency", () => {
  it("waits latencyMs before generate() resolves", async () => {
    vi.useFakeTimers();
    const provider = new MockProvider({ latencyMs: 100 });

    let resolved = false;
    void provider.generate(makeRequest()).then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(99);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(resolved).toBe(true);
    vi.useRealTimers();
  });

  it("waits latencyMs before generateStream() yields", async () => {
    vi.useFakeTimers();
    const provider = new MockProvider({ latencyMs: 100 });

    let started = false;
    const drain = async () => {
      for await (const chunk of provider.generateStream(makeRequest())) {
        void chunk;
        started = true;
      }
    };
    void drain();

    await vi.advanceTimersByTimeAsync(99);
    expect(started).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(started).toBe(true);
    vi.useRealTimers();
  });
});
