import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import { Tool } from "./Tool.js";
import {
  ToolInputValidationError,
  ToolOutputValidationError,
  ValidationError,
} from "../core/errors.js";

function createWeatherTool() {
  return new Tool({
    name: "get_weather",
    description: "Get the current weather for a city.",
    input: z.object({ city: z.string() }),
    output: z.object({ tempC: z.number(), summary: z.string() }),
    execute: async ({ city }) => ({ tempC: 21, summary: `Clear skies in ${city}` }),
  });
}

describe("Tool", () => {
  it("exposes its configuration via readonly getters", () => {
    const tool = new Tool({
      name: "get_weather",
      description: "Get the current weather for a city.",
      input: z.object({ city: z.string() }),
      output: z.object({ tempC: z.number() }),
      execute: async ({ city }) => ({ tempC: city.length }),
      timeoutMs: 3000,
      retries: 2,
      cache: true,
      tags: ["weather"],
      metadata: { owner: "team-x" },
    });

    expect(tool.name).toBe("get_weather");
    expect(tool.description).toBe("Get the current weather for a city.");
    expect(tool.timeoutMs).toBe(3000);
    expect(tool.retries).toBe(2);
    expect(tool.cache).toBe(true);
    expect(tool.tags).toEqual(["weather"]);
    expect(tool.metadata).toEqual({ owner: "team-x" });
  });

  it("defaults tags to [] and metadata to {} when omitted", () => {
    const tool = createWeatherTool();

    expect(tool.tags).toEqual([]);
    expect(tool.metadata).toEqual({});
    expect(tool.timeoutMs).toBeUndefined();
    expect(tool.retries).toBeUndefined();
    expect(tool.cache).toBeUndefined();
  });

  it("infers a fully typed, already-validated input for execute with no manual annotation", async () => {
    const execute = vi.fn(async (input: { city: string }) => ({ tempC: 1, summary: input.city }));
    const tool = new Tool({
      name: "get_weather",
      description: "Get the current weather for a city.",
      input: z.object({ city: z.string() }),
      output: z.object({ tempC: z.number(), summary: z.string() }),
      execute,
    });

    expectTypeOf(tool.run).parameter(0).toEqualTypeOf<{ city: string }>();
    await tool.run({ city: "Gaya" });
    expect(execute).toHaveBeenCalledWith({ city: "Gaya" });
  });

  describe("name validation", () => {
    it("accepts names matching the allowed pattern", () => {
      expect(
        () =>
          new Tool({
            name: "get_weather-v2",
            description: "d",
            input: z.object({}),
            execute: () => ({}),
          }),
      ).not.toThrow();
    });

    it("rejects a name with disallowed characters", () => {
      expect(
        () =>
          new Tool({
            name: "get weather!",
            description: "d",
            input: z.object({}),
            execute: () => ({}),
          }),
      ).toThrow(ValidationError);
    });

    it("rejects an empty name", () => {
      expect(
        () =>
          new Tool({
            name: "",
            description: "d",
            input: z.object({}),
            execute: () => ({}),
          }),
      ).toThrow(ValidationError);
    });

    it("rejects a name longer than 64 characters", () => {
      expect(
        () =>
          new Tool({
            name: "a".repeat(65),
            description: "d",
            input: z.object({}),
            execute: () => ({}),
          }),
      ).toThrow(ValidationError);
    });
  });

  it("rejects an empty description", () => {
    expect(
      () =>
        new Tool({
          name: "tool",
          description: "",
          input: z.object({}),
          execute: () => ({}),
        }),
    ).toThrow(ValidationError);
  });

  it("rejects a non-Zod input schema", () => {
    expect(
      () =>
        new Tool({
          name: "tool",
          description: "d",
          input: {} as never,
          execute: () => ({}),
        }),
    ).toThrow(ValidationError);
  });

  it("rejects a non-Zod output schema", () => {
    expect(
      () =>
        new Tool({
          name: "tool",
          description: "d",
          input: z.object({}),
          output: {} as never,
          execute: () => ({}),
        }),
    ).toThrow(ValidationError);
  });

  it("rejects a non-function execute", () => {
    expect(
      () =>
        new Tool({
          name: "tool",
          description: "d",
          input: z.object({}),
          execute: {} as never,
        }),
    ).toThrow(ValidationError);
  });

  describe("parseInput", () => {
    it("returns the validated, typed input on success", () => {
      const tool = createWeatherTool();
      expect(tool.parseInput({ city: "Gaya" })).toEqual({ city: "Gaya" });
    });

    it("throws ToolInputValidationError on failure", () => {
      const tool = createWeatherTool();
      expect(() => tool.parseInput({})).toThrow(ToolInputValidationError);
    });

    it("includes the tool name on the thrown error", () => {
      const tool = createWeatherTool();
      try {
        tool.parseInput({});
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(ToolInputValidationError);
        expect((error as ToolInputValidationError).toolName).toBe("get_weather");
      }
    });
  });

  describe("parseOutput", () => {
    it("returns the validated output on success", () => {
      const tool = createWeatherTool();
      expect(tool.parseOutput({ tempC: 21, summary: "sunny" })).toEqual({
        tempC: 21,
        summary: "sunny",
      });
    });

    it("throws ToolOutputValidationError on failure", () => {
      const tool = createWeatherTool();
      expect(() => tool.parseOutput({ tempC: "not a number" })).toThrow(ToolOutputValidationError);
    });

    it("passes the value through unchanged when no output schema is configured", () => {
      const tool = new Tool({
        name: "tool",
        description: "d",
        input: z.object({}),
        execute: () => ({ anything: true }),
      });

      expect(tool.parseOutput({ anything: true })).toEqual({ anything: true });
    });
  });

  describe("run", () => {
    it("validates input, executes, and validates output end to end", async () => {
      const tool = createWeatherTool();
      const result = await tool.run({ city: "Gaya" });
      expect(result).toEqual({ tempC: 21, summary: "Clear skies in Gaya" });
    });

    it("supports a synchronous execute function", async () => {
      const tool = new Tool({
        name: "double",
        description: "Doubles a number.",
        input: z.object({ n: z.number() }),
        output: z.object({ result: z.number() }),
        execute: ({ n }) => ({ result: n * 2 }),
      });

      await expect(tool.run({ n: 3 })).resolves.toEqual({ result: 6 });
    });

    it("rejects with ToolInputValidationError for invalid input without calling execute", async () => {
      const execute = vi.fn(async () => ({ tempC: 1, summary: "x" }));
      const tool = new Tool({
        name: "get_weather",
        description: "d",
        input: z.object({ city: z.string() }),
        output: z.object({ tempC: z.number(), summary: z.string() }),
        execute,
      });

      await expect(tool.run({} as never)).rejects.toThrow(ToolInputValidationError);
      expect(execute).not.toHaveBeenCalled();
    });

    it("rejects with ToolOutputValidationError when execute returns an invalid shape", async () => {
      const tool = new Tool({
        name: "get_weather",
        description: "d",
        input: z.object({ city: z.string() }),
        output: z.object({ tempC: z.number() }),
        execute: async () => ({ tempC: "not a number" }) as never,
      });

      await expect(tool.run({ city: "Gaya" })).rejects.toThrow(ToolOutputValidationError);
    });
  });

  describe("toDefinition", () => {
    it("produces a provider-agnostic definition with JSON Schema parameters", () => {
      const tool = createWeatherTool();
      const definition = tool.toDefinition();

      expect(definition.name).toBe("get_weather");
      expect(definition.description).toBe("Get the current weather for a city.");
      expect(definition.parameters).toMatchObject({
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
      });
    });
  });
});
