import { describe, expect, it } from "vitest";
import { MockLogger } from "./MockLogger.js";

describe("MockLogger", () => {
  it("captures debug/info/warn/error records with their fields", () => {
    const logger = new MockLogger();

    logger.debug("d", { a: 1 });
    logger.info("i", { a: 2 });
    logger.warn("w", { a: 3 });
    logger.error("e", { a: 4 });

    expect(logger.records).toEqual([
      { level: "debug", message: "d", fields: { a: 1 } },
      { level: "info", message: "i", fields: { a: 2 } },
      { level: "warn", message: "w", fields: { a: 3 } },
      { level: "error", message: "e", fields: { a: 4 } },
    ]);
  });

  it("captures a record with undefined fields when none are given", () => {
    const logger = new MockLogger();

    logger.info("no fields");

    expect(logger.records).toEqual([{ level: "info", message: "no fields", fields: undefined }]);
  });

  it("recordsAt filters by level", () => {
    const logger = new MockLogger();
    logger.info("i1");
    logger.error("e1");
    logger.info("i2");

    expect(logger.recordsAt("info").map((r) => r.message)).toEqual(["i1", "i2"]);
    expect(logger.recordsAt("error").map((r) => r.message)).toEqual(["e1"]);
    expect(logger.recordsAt("warn")).toEqual([]);
  });

  it("reset() clears every captured record", () => {
    const logger = new MockLogger();
    logger.info("i1");

    logger.reset();

    expect(logger.records).toEqual([]);
  });

  it("records returns a defensive copy", () => {
    const logger = new MockLogger();
    logger.info("i1");

    const snapshot = logger.records;
    logger.info("i2");

    expect(snapshot).toHaveLength(1);
    expect(logger.records).toHaveLength(2);
  });

  describe("child()", () => {
    it("merges bindings into every record the child writes", () => {
      const logger = new MockLogger();
      const child = logger.child({ runId: "run-1" });

      child.info("hello", { extra: true });

      expect(logger.records).toEqual([
        { level: "info", message: "hello", fields: { runId: "run-1", extra: true } },
      ]);
    });

    it("does not affect the parent's own subsequent records", () => {
      const logger = new MockLogger();
      logger.child({ runId: "run-1" });

      logger.info("parent record");

      expect(logger.records).toEqual([{ level: "info", message: "parent record", fields: undefined }]);
    });

    it("writes to the same underlying sink as the parent, so records interleave in call order", () => {
      const logger = new MockLogger();
      const child = logger.child({ runId: "run-1" });

      logger.info("from parent");
      child.info("from child");

      expect(logger.records.map((r) => r.message)).toEqual(["from parent", "from child"]);
    });

    it("stacks bindings across nested child() calls", () => {
      const logger = new MockLogger();
      const child = logger.child({ a: 1 });
      const grandchild = child.child({ b: 2 });

      grandchild.info("nested");

      expect(logger.records).toEqual([
        { level: "info", message: "nested", fields: { a: 1, b: 2 } },
      ]);
    });

    it("a child's own bindings override the parent's for the same key", () => {
      const logger = new MockLogger();
      const child = logger.child({ scope: "parent" });
      const grandchild = child.child({ scope: "child" });

      grandchild.info("override");

      expect(logger.records).toEqual([
        { level: "info", message: "override", fields: { scope: "child" } },
      ]);
    });
  });
});
