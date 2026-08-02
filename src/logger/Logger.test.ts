import { describe, expect, it } from "vitest";
import { LOG_LEVEL_PRIORITY, NoopLogger, redactFields } from "./Logger.js";

describe("LOG_LEVEL_PRIORITY", () => {
  it("orders levels from most to least verbose", () => {
    expect(LOG_LEVEL_PRIORITY.debug).toBeLessThan(LOG_LEVEL_PRIORITY.info);
    expect(LOG_LEVEL_PRIORITY.info).toBeLessThan(LOG_LEVEL_PRIORITY.warn);
    expect(LOG_LEVEL_PRIORITY.warn).toBeLessThan(LOG_LEVEL_PRIORITY.error);
    expect(LOG_LEVEL_PRIORITY.error).toBeLessThan(LOG_LEVEL_PRIORITY.silent);
  });
});

describe("NoopLogger", () => {
  it("never throws for any method", () => {
    const logger = new NoopLogger();
    expect(() => logger.debug("x")).not.toThrow();
    expect(() => logger.info("x", { a: 1 })).not.toThrow();
    expect(() => logger.warn("x")).not.toThrow();
    expect(() => logger.error("x")).not.toThrow();
  });

  it("child() returns a logger that is also a no-op", () => {
    const logger = new NoopLogger();
    const child = logger.child({ runId: "run-1" });
    expect(() => child.info("x")).not.toThrow();
  });
});

describe("redactFields", () => {
  it("redacts known credential-shaped keys case-insensitively", () => {
    const result = redactFields({
      user: "lalit",
      apiKey: "sk-live-123",
      Authorization: "Bearer xyz",
      api_key: "abc",
      TOKEN: "t",
      password: "p",
      secret: "s",
    });

    expect(result).toEqual({
      user: "lalit",
      apiKey: "[redacted]",
      Authorization: "[redacted]",
      api_key: "[redacted]",
      TOKEN: "[redacted]",
      password: "[redacted]",
      secret: "[redacted]",
    });
  });

  it("redacts recursively through nested objects and arrays", () => {
    const result = redactFields({
      request: { headers: { authorization: "Bearer xyz" }, body: { ok: true } },
      list: [{ apiKey: "1" }, { apiKey: "2" }],
    });

    expect(result).toEqual({
      request: { headers: { authorization: "[redacted]" }, body: { ok: true } },
      list: [{ apiKey: "[redacted]" }, { apiKey: "[redacted]" }],
    });
  });

  it("leaves non-plain-object values (Date, class instances) untouched", () => {
    const date = new Date();
    class Custom {
      apiKey = "should-not-be-touched";
    }
    const custom = new Custom();

    const result = redactFields({ date, custom });

    expect(result.date).toBe(date);
    expect(result.custom).toBe(custom);
  });

  it("does not mutate the input", () => {
    const input = { apiKey: "secret-value" };
    redactFields(input);
    expect(input.apiKey).toBe("secret-value");
  });

  it("leaves fields with no credential-shaped keys unchanged", () => {
    const input = { message: "hello", count: 3 };
    expect(redactFields(input)).toEqual(input);
  });
});
