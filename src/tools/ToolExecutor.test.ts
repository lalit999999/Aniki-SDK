import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { Tool } from "./Tool.js";
import { ToolExecutor } from "./ToolExecutor.js";
import { ToolRegistry } from "./ToolRegistry.js";
import type { ToolCall } from "../types/tool.js";

function call(name: string, args: Record<string, unknown> = {}, id = `call-${name}`): ToolCall {
  return { id, name, arguments: args };
}

describe("ToolExecutor", () => {
  it("executes a known tool and returns an ok result with output and durationMs", async () => {
    const tool = new Tool({
      name: "get_weather",
      description: "d",
      input: z.object({ city: z.string() }),
      output: z.object({ tempC: z.number() }),
      execute: async ({ city }) => ({ tempC: city.length }),
    });
    const executor = new ToolExecutor(new ToolRegistry([tool]));

    const result = await executor.execute(call("get_weather", { city: "Gaya" }));

    expect(result).toMatchObject({
      toolCallId: "call-get_weather",
      toolName: "get_weather",
      ok: true,
      output: { tempC: 4 },
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("resolves (not rejects) with ok:false for an unregistered tool", async () => {
    const executor = new ToolExecutor(new ToolRegistry());

    const result = await executor.execute(call("missing"));

    expect(result.ok).toBe(false);
    expect(result.error).toContain("missing");
    expect(result.toolName).toBe("missing");
  });

  it("resolves with ok:false when input fails validation, without calling execute", async () => {
    const execute = vi.fn(async () => ({}));
    const tool = new Tool({
      name: "get_weather",
      description: "d",
      input: z.object({ city: z.string() }),
      execute,
    });
    const executor = new ToolExecutor(new ToolRegistry([tool]));

    const result = await executor.execute(call("get_weather", {}));

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(execute).not.toHaveBeenCalled();
  });

  it("resolves with ok:false when output fails validation", async () => {
    const tool = new Tool({
      name: "get_weather",
      description: "d",
      input: z.object({}),
      output: z.object({ tempC: z.number() }),
      execute: async () => ({ tempC: "not a number" }) as never,
    });
    const executor = new ToolExecutor(new ToolRegistry([tool]));

    const result = await executor.execute(call("get_weather"));

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("resolves with ok:false when execute throws", async () => {
    const tool = new Tool({
      name: "boom",
      description: "d",
      input: z.object({}),
      execute: async () => {
        throw new Error("kaboom");
      },
    });
    const executor = new ToolExecutor(new ToolRegistry([tool]));

    const result = await executor.execute(call("boom"));

    expect(result.ok).toBe(false);
    expect(result.error).toContain("kaboom");
  });

  it("resolves with ok:false when execute exceeds its timeout", async () => {
    const tool = new Tool({
      name: "slow",
      description: "d",
      input: z.object({}),
      timeoutMs: 20,
      execute: () => new Promise((resolve) => setTimeout(() => resolve({}), 200)),
    });
    const executor = new ToolExecutor(new ToolRegistry([tool]));

    const result = await executor.execute(call("slow"));

    expect(result.ok).toBe(false);
    expect(result.error).toContain("timeout");
  });

  it("aborts the tool's signal when the timeout elapses", async () => {
    let observedAborted = false;
    const tool = new Tool({
      name: "slow",
      description: "d",
      input: z.object({}),
      timeoutMs: 20,
      execute: (_input, context) =>
        new Promise((resolve) => {
          context?.signal?.addEventListener("abort", () => {
            observedAborted = true;
          });
          setTimeout(() => resolve({}), 200);
        }),
    });
    const executor = new ToolExecutor(new ToolRegistry([tool]));

    await executor.execute(call("slow"));

    expect(observedAborted).toBe(true);
  });

  it("retries a throwing tool and succeeds on a later attempt", async () => {
    let attempts = 0;
    const tool = new Tool({
      name: "flaky",
      description: "d",
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      retries: 2,
      execute: async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("not yet");
        return { ok: true };
      },
    });
    const executor = new ToolExecutor(new ToolRegistry([tool]));

    const result = await executor.execute(call("flaky"));

    expect(result).toMatchObject({ ok: true, output: { ok: true } });
    expect(attempts).toBe(3);
  });

  it("exhausts retries and returns the final failure", async () => {
    let attempts = 0;
    const tool = new Tool({
      name: "always-fails",
      description: "d",
      input: z.object({}),
      retries: 2,
      execute: async () => {
        attempts += 1;
        throw new Error(`fail ${attempts}`);
      },
    });
    const executor = new ToolExecutor(new ToolRegistry([tool]));

    const result = await executor.execute(call("always-fails"));

    expect(result.ok).toBe(false);
    expect(result.error).toContain("fail 3");
    expect(attempts).toBe(3);
  });

  it("never retries an input validation failure", async () => {
    const execute = vi.fn();
    const tool = new Tool({
      name: "get_weather",
      description: "d",
      input: z.object({ city: z.string() }),
      retries: 3,
      execute,
    });
    const executor = new ToolExecutor(new ToolRegistry([tool]));

    await executor.execute(call("get_weather", {}));

    expect(execute).not.toHaveBeenCalled();
  });

  it("never retries an output validation failure", async () => {
    let attempts = 0;
    const tool = new Tool({
      name: "get_weather",
      description: "d",
      input: z.object({}),
      output: z.object({ tempC: z.number() }),
      retries: 3,
      execute: async () => {
        attempts += 1;
        return { tempC: "nope" } as never;
      },
    });
    const executor = new ToolExecutor(new ToolRegistry([tool]));

    await executor.execute(call("get_weather"));

    expect(attempts).toBe(1);
  });

  describe("executeAll", () => {
    it("runs multiple calls and returns one result per call in input order", async () => {
      const registry = new ToolRegistry([
        new Tool({
          name: "a",
          description: "d",
          input: z.object({}),
          output: z.object({ v: z.literal("a") }),
          execute: async () => ({ v: "a" as const }),
        }),
        new Tool({
          name: "b",
          description: "d",
          input: z.object({}),
          output: z.object({ v: z.literal("b") }),
          execute: async () => ({ v: "b" as const }),
        }),
      ]);
      const executor = new ToolExecutor(registry);

      const results = await executor.executeAll([call("a", {}, "1"), call("b", {}, "2")]);

      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({ toolCallId: "1", toolName: "a", ok: true });
      expect(results[1]).toMatchObject({ toolCallId: "2", toolName: "b", ok: true });
    });

    it("does not let one failing call abort the rest of the batch", async () => {
      const registry = new ToolRegistry([
        new Tool({
          name: "ok-tool",
          description: "d",
          input: z.object({}),
          execute: async () => ({}),
        }),
        new Tool({
          name: "bad-tool",
          description: "d",
          input: z.object({}),
          execute: async () => {
            throw new Error("nope");
          },
        }),
      ]);
      const executor = new ToolExecutor(registry);

      const results = await executor.executeAll([
        call("bad-tool", {}, "1"),
        call("ok-tool", {}, "2"),
      ]);

      expect(results[0]?.ok).toBe(false);
      expect(results[1]?.ok).toBe(true);
    });

    it("returns an empty array for an empty call list", async () => {
      const executor = new ToolExecutor(new ToolRegistry());
      expect(await executor.executeAll([])).toEqual([]);
    });
  });
});
