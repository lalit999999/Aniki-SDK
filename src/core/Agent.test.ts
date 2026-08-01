import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Agent } from "./Agent.js";
import { ValidationError } from "./errors.js";
import { InMemorySession } from "./Session.js";
import type { IProvider } from "../providers/AIProvider.js";

function createFakeProvider(): IProvider {
  return {
    name: "fake",
    generate: async () => ({ content: "fake response" }),
  };
}

describe("Agent", () => {
  it("constructs with a valid configuration and exposes it via readonly getters", () => {
    const provider = createFakeProvider();
    const agent = new Agent({
      name: "Assistant",
      instructions: "You are a helpful assistant.",
      model: "gpt-5.5",
      provider,
    });

    expect(agent.name).toBe("Assistant");
    expect(agent.instructions).toBe("You are a helpful assistant.");
    expect(agent.model).toBe("gpt-5.5");
    expect(agent.provider).toBe(provider);
    expect(agent.tools).toEqual([]);
    expect(agent.middleware).toEqual([]);
    expect(agent.output).toBeUndefined();
  });

  it("defaults to a fresh in-memory session when none is provided", () => {
    const agent = new Agent({
      name: "Assistant",
      instructions: "Be helpful.",
      model: "gpt-5.5",
      provider: createFakeProvider(),
    });

    expect(agent.session).toBeTruthy();
    expect(agent.session.getMessages()).toEqual([]);
  });

  it("uses an explicitly provided session", () => {
    const session = new InMemorySession("my-session");
    const agent = new Agent({
      name: "Assistant",
      instructions: "Be helpful.",
      model: "gpt-5.5",
      provider: createFakeProvider(),
      session,
    });

    expect(agent.session).toBe(session);
  });

  it("stores an optional output schema and tools/middleware arrays", () => {
    const output = z.object({ answer: z.string() });
    const agent = new Agent({
      name: "Assistant",
      instructions: "Be helpful.",
      model: "gpt-5.5",
      provider: createFakeProvider(),
      output,
      tools: [{}],
      middleware: [{}],
    });

    expect(agent.output).toBe(output);
    expect(agent.tools).toHaveLength(1);
    expect(agent.middleware).toHaveLength(1);
  });

  it("throws ValidationError with a clear message when name is missing", () => {
    expect(
      () =>
        new Agent({
          name: "",
          instructions: "Be helpful.",
          model: "gpt-5.5",
          provider: createFakeProvider(),
        }),
    ).toThrow(ValidationError);
  });

  it("throws ValidationError with a clear message when instructions is missing", () => {
    expect(
      () =>
        new Agent({
          name: "Assistant",
          instructions: "",
          model: "gpt-5.5",
          provider: createFakeProvider(),
        }),
    ).toThrow(ValidationError);
  });

  it("throws ValidationError when the provider does not implement IProvider", () => {
    expect(
      () =>
        new Agent({
          name: "Assistant",
          instructions: "Be helpful.",
          model: "gpt-5.5",
          provider: {} as IProvider,
        }),
    ).toThrow(ValidationError);
  });
});
