import { describe, expect, it, vi } from "vitest";
import type { ConsoleSink } from "./ConsoleLogger.js";
import { ConsoleLogger } from "./ConsoleLogger.js";

function fakeSink() {
  return {
    debug: vi.fn<(line: string) => void>(),
    info: vi.fn<(line: string) => void>(),
    warn: vi.fn<(line: string) => void>(),
    error: vi.fn<(line: string) => void>(),
  } satisfies ConsoleSink;
}

describe("ConsoleLogger level filtering", () => {
  it("defaults to the info threshold, dropping debug", () => {
    const sink = fakeSink();
    const logger = new ConsoleLogger({ sink });

    logger.debug("hidden");
    logger.info("shown");

    expect(sink.debug).not.toHaveBeenCalled();
    expect(sink.info).toHaveBeenCalledTimes(1);
  });

  it("writes nothing at all when level is silent", () => {
    const sink = fakeSink();
    const logger = new ConsoleLogger({ sink, level: "silent" });

    logger.debug("x");
    logger.info("x");
    logger.warn("x");
    logger.error("x");

    expect(sink.debug).not.toHaveBeenCalled();
    expect(sink.info).not.toHaveBeenCalled();
    expect(sink.warn).not.toHaveBeenCalled();
    expect(sink.error).not.toHaveBeenCalled();
  });

  it("writes a level and everything above it", () => {
    const sink = fakeSink();
    const logger = new ConsoleLogger({ sink, level: "warn" });

    logger.info("hidden");
    logger.warn("shown");
    logger.error("shown");

    expect(sink.info).not.toHaveBeenCalled();
    expect(sink.warn).toHaveBeenCalledTimes(1);
    expect(sink.error).toHaveBeenCalledTimes(1);
  });
});

describe("ConsoleLogger formatting", () => {
  it("writes a readable timestamp/level/message/fields line by default", () => {
    const sink = fakeSink();
    const logger = new ConsoleLogger({ sink });

    logger.info("run started", { runId: "abc" });

    const line = sink.info.mock.calls[0]?.[0] as string;
    expect(line).toContain("info");
    expect(line).toContain("run started");
    expect(line).toContain('"runId":"abc"');
  });

  it("writes a single JSON line when json is true", () => {
    const sink = fakeSink();
    const logger = new ConsoleLogger({ sink, json: true });

    logger.info("run started", { runId: "abc" });

    const line = sink.info.mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({ level: "info", message: "run started", runId: "abc" });
    expect(typeof parsed.timestamp).toBe("string");
  });

  it("redacts credential-shaped fields before writing", () => {
    const sink = fakeSink();
    const logger = new ConsoleLogger({ sink, json: true });

    logger.info("request", { apiKey: "sk-live-123" });

    const parsed = JSON.parse(sink.info.mock.calls[0]?.[0] as string);
    expect(parsed.apiKey).toBe("[redacted]");
  });
});

describe("ConsoleLogger.child", () => {
  it("merges bindings into every subsequent record", () => {
    const sink = fakeSink();
    const logger = new ConsoleLogger({ sink, json: true });
    const scoped = logger.child({ runId: "run-1" });

    scoped.info("tool started", { toolName: "get_weather" });

    const parsed = JSON.parse(sink.info.mock.calls[0]?.[0] as string);
    expect(parsed).toMatchObject({ runId: "run-1", toolName: "get_weather" });
  });

  it("does not affect the parent logger", () => {
    const sink = fakeSink();
    const logger = new ConsoleLogger({ sink, json: true });
    logger.child({ runId: "run-1" });

    logger.info("unscoped");

    const parsed = JSON.parse(sink.info.mock.calls[0]?.[0] as string);
    expect(parsed.runId).toBeUndefined();
  });

  it("chains bindings across nested children", () => {
    const sink = fakeSink();
    const logger = new ConsoleLogger({ sink, json: true });
    const scoped = logger.child({ runId: "run-1" }).child({ iteration: 1 });

    scoped.info("nested");

    const parsed = JSON.parse(sink.info.mock.calls[0]?.[0] as string);
    expect(parsed).toMatchObject({ runId: "run-1", iteration: 1 });
  });
});

describe("ConsoleLogger sink failure isolation", () => {
  it("swallows an error thrown by the sink instead of propagating it", () => {
    const sink: ConsoleSink = {
      debug: vi.fn(),
      info: vi.fn(() => {
        throw new Error("sink exploded");
      }),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const logger = new ConsoleLogger({ sink });

    expect(() => logger.info("this should not throw")).not.toThrow();
  });
});
