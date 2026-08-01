import { describe, expect, it } from "vitest";
import { Memory } from "./Memory.js";
import { ValidationError } from "./errors.js";

describe("Memory", () => {
  it("starts empty", () => {
    const memory = new Memory();
    expect(memory.getMessages()).toEqual([]);
  });

  it("appends messages in order and reads them back", () => {
    const memory = new Memory();
    memory.addMessage({ role: "user", content: "Hi, my name is Lalit." });
    memory.addMessage({ role: "assistant", content: "Nice to meet you, Lalit." });

    expect(memory.getMessages()).toEqual([
      { role: "user", content: "Hi, my name is Lalit." },
      { role: "assistant", content: "Nice to meet you, Lalit." },
    ]);
  });

  it("returns a snapshot that does not mutate internal state", () => {
    const memory = new Memory();
    memory.addMessage({ role: "user", content: "Hi" });

    const snapshot = memory.getMessages() as Array<{ role: string; content: string }>;
    snapshot.push({ role: "user", content: "injected" });

    expect(memory.getMessages()).toHaveLength(1);
  });

  it("clears all stored messages", () => {
    const memory = new Memory();
    memory.addMessage({ role: "user", content: "Hi" });
    memory.clear();

    expect(memory.getMessages()).toEqual([]);
  });

  it("rejects an invalid role with ValidationError", () => {
    const memory = new Memory();
    expect(() => memory.addMessage({ role: "narrator" as never, content: "Hi" })).toThrow(
      ValidationError,
    );
  });

  it("rejects empty content with ValidationError", () => {
    const memory = new Memory();
    expect(() => memory.addMessage({ role: "user", content: "" })).toThrow(ValidationError);
  });

  it("does not store a rejected message", () => {
    const memory = new Memory();
    expect(() => memory.addMessage({ role: "user", content: "" })).toThrow();
    expect(memory.getMessages()).toEqual([]);
  });

  it("accepts an empty-content assistant message that carries toolCalls", () => {
    const memory = new Memory();
    const toolCalls = [{ id: "call-1", name: "get_weather", arguments: { city: "Gaya" } }];

    memory.addMessage({ role: "assistant", content: "", toolCalls });

    expect(memory.getMessages()).toEqual([{ role: "assistant", content: "", toolCalls }]);
  });

  it("rejects an empty-content assistant message with an empty toolCalls array", () => {
    const memory = new Memory();
    expect(() => memory.addMessage({ role: "assistant", content: "", toolCalls: [] })).toThrow(
      ValidationError,
    );
  });

  it("rejects a non-assistant message that carries toolCalls", () => {
    const memory = new Memory();
    expect(() =>
      memory.addMessage({
        role: "user",
        content: "hi",
        toolCalls: [{ id: "call-1", name: "get_weather", arguments: {} }],
      }),
    ).toThrow(ValidationError);
  });

  it("requires a toolCallId on a tool-role message", () => {
    const memory = new Memory();
    expect(() => memory.addMessage({ role: "tool", content: "42", name: "get_weather" })).toThrow(
      ValidationError,
    );
  });

  it("stores a tool-role message with its toolCallId and name", () => {
    const memory = new Memory();
    memory.addMessage({
      role: "tool",
      content: '{"tempC":21}',
      toolCallId: "call-1",
      name: "get_weather",
    });

    expect(memory.getMessages()).toEqual([
      { role: "tool", content: '{"tempC":21}', toolCallId: "call-1", name: "get_weather" },
    ]);
  });
});
