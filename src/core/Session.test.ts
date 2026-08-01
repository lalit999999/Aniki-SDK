import { describe, expect, it } from "vitest";
import { InMemorySession } from "./Session.js";
import { ValidationError } from "./errors.js";

describe("InMemorySession", () => {
  it("stores its id", () => {
    const session = new InMemorySession("session-1");
    expect(session.id).toBe("session-1");
  });

  it("starts with empty history", () => {
    const session = new InMemorySession("session-1");
    expect(session.getMessages()).toEqual([]);
  });

  it("persists history across multiple sequential reads", () => {
    const session = new InMemorySession("session-1");
    session.addMessage({ role: "user", content: "Hi, my name is Lalit." });
    session.addMessage({ role: "assistant", content: "Hello, Lalit!" });

    expect(session.getMessages()).toHaveLength(2);
    expect(session.getMessages()).toEqual(session.getMessages());
    expect(session.getMessages()).toEqual([
      { role: "user", content: "Hi, my name is Lalit." },
      { role: "assistant", content: "Hello, Lalit!" },
    ]);
  });

  it("keeps independently created sessions from leaking history into each other", () => {
    const first = new InMemorySession("session-1");
    const second = new InMemorySession("session-2");

    first.addMessage({ role: "user", content: "Only in session one" });

    expect(first.getMessages()).toHaveLength(1);
    expect(second.getMessages()).toEqual([]);
  });

  it("keeps two sessions constructed with the same id independent", () => {
    const first = new InMemorySession("shared-id");
    const second = new InMemorySession("shared-id");

    first.addMessage({ role: "user", content: "Only in first instance" });

    expect(second.getMessages()).toEqual([]);
  });

  it("clears history", () => {
    const session = new InMemorySession("session-1");
    session.addMessage({ role: "user", content: "Hi" });
    session.clear();

    expect(session.getMessages()).toEqual([]);
  });

  it("throws ValidationError when constructed with an empty id", () => {
    expect(() => new InMemorySession("")).toThrow(ValidationError);
  });
});
