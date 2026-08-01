import { describe, expect, it } from "vitest";
import { Context } from "./Context.js";
import { ValidationError } from "./errors.js";

describe("Context", () => {
  it("constructs with an agent, input, generated run id, and start timestamp", () => {
    const agent = { name: "Assistant" };
    const input = { message: "hi" };

    const context = new Context({ agent, input });

    expect(context.agent).toBe(agent);
    expect(context.input).toBe(input);
    expect(context.runId).toEqual(expect.any(String));
    expect(context.runId.length).toBeGreaterThan(0);
    expect(context.startedAt).toBeInstanceOf(Date);
  });

  it("uses a provided run id override instead of generating one", () => {
    const context = new Context({ agent: {}, input: {}, runId: "custom-id" });
    expect(context.runId).toBe("custom-id");
  });

  it("generates distinct run ids across separate contexts", () => {
    const first = new Context({ agent: {}, input: {} });
    const second = new Context({ agent: {}, input: {} });
    expect(first.runId).not.toBe(second.runId);
  });

  it("stores and retrieves values in its typed data bag", () => {
    const context = new Context({ agent: {}, input: {} });

    expect(context.has("traceId")).toBe(false);
    context.set("traceId", "abc-123");
    expect(context.has("traceId")).toBe(true);
    expect(context.get<string>("traceId")).toBe("abc-123");
    expect(context.get("missing")).toBeUndefined();
  });

  it("throws ValidationError when agent is missing", () => {
    expect(() => new Context({ agent: undefined, input: {} })).toThrow(ValidationError);
  });

  it("throws ValidationError when input is missing", () => {
    expect(() => new Context({ agent: {}, input: undefined })).toThrow(ValidationError);
  });
});
