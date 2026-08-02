import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ValidationError } from "../core/errors.js";
import { Guard } from "./Guard.js";

describe("Guard.assertDefined", () => {
  it("passes for a defined value", () => {
    expect(() => Guard.assertDefined("ok", "subject")).not.toThrow();
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
  ])("throws ValidationError for %s", (_label, value) => {
    expect(() => Guard.assertDefined(value, "Agent.provider")).toThrow(ValidationError);
  });

  it("throws with a what/why/fix message and context", () => {
    try {
      Guard.assertDefined(undefined, "Agent.provider", "Pass a provider instance.");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const validationError = error as ValidationError;
      expect(validationError.message).toBe(
        "Agent.provider is required: received undefined. Pass a provider instance.",
      );
      expect(validationError.context).toEqual({ subject: "Agent.provider", received: undefined });
    }
  });

  it("omits the trailing fix sentence when none is given", () => {
    try {
      Guard.assertDefined(null, "Agent.provider");
      expect.unreachable();
    } catch (error) {
      expect((error as ValidationError).message).toBe("Agent.provider is required: received null.");
    }
  });
});

describe("Guard.assertNonEmptyString", () => {
  it("passes for a non-empty string", () => {
    expect(() => Guard.assertNonEmptyString("Assistant", "Agent.name")).not.toThrow();
  });

  it.each([
    ["empty string", ""],
    ["whitespace-only", "   "],
    ["a number", 42],
    ["null", null],
    ["undefined", undefined],
  ])("throws ValidationError for %s", (_label, value) => {
    expect(() => Guard.assertNonEmptyString(value, "Agent.name")).toThrow(ValidationError);
  });

  it("reports the received value in the message", () => {
    try {
      Guard.assertNonEmptyString(42, "Agent.name");
      expect.unreachable();
    } catch (error) {
      expect((error as ValidationError).message).toContain("Agent.name must be a non-empty string");
      expect((error as ValidationError).message).toContain("received 42");
    }
  });

  it("falls back to typeof for values with no dedicated description (e.g. a symbol)", () => {
    try {
      Guard.assertNonEmptyString(Symbol("id"), "Agent.name");
      expect.unreachable();
    } catch (error) {
      expect((error as ValidationError).message).toContain("received symbol");
    }
  });

  it("falls back to \"Object\" when the value has no constructor (e.g. Object.create(null))", () => {
    try {
      Guard.assertNonEmptyString(Object.create(null) as unknown, "Agent.name");
      expect.unreachable();
    } catch (error) {
      expect((error as ValidationError).message).toContain('received an object of type "Object"');
    }
  });
});

describe("Guard.assertPositiveInteger", () => {
  it("passes for a positive integer", () => {
    expect(() => Guard.assertPositiveInteger(5, "Agent.maxToolIterations")).not.toThrow();
  });

  it.each([
    ["zero", 0],
    ["a negative integer", -1],
    ["a float", 1.5],
    ["a string", "5"],
    ["NaN", Number.NaN],
  ])("throws ValidationError for %s", (_label, value) => {
    expect(() => Guard.assertPositiveInteger(value, "Agent.maxToolIterations")).toThrow(
      ValidationError,
    );
  });
});

describe("Guard.assertFiniteNumber", () => {
  it("passes for a finite number", () => {
    expect(() => Guard.assertFiniteNumber(30000, "Config.timeout")).not.toThrow();
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["a string", "30000"],
  ])("throws ValidationError for %s", (_label, value) => {
    expect(() => Guard.assertFiniteNumber(value, "Config.timeout")).toThrow(ValidationError);
  });
});

describe("Guard.assertInRange", () => {
  it("passes for a value within range (inclusive)", () => {
    expect(() => Guard.assertInRange(0, 0, 10, "Config.retryCount")).not.toThrow();
    expect(() => Guard.assertInRange(10, 0, 10, "Config.retryCount")).not.toThrow();
  });

  it("throws ValidationError below the minimum", () => {
    expect(() => Guard.assertInRange(-1, 0, 10, "Config.retryCount")).toThrow(ValidationError);
  });

  it("throws ValidationError above the maximum", () => {
    expect(() => Guard.assertInRange(11, 0, 10, "Config.retryCount")).toThrow(ValidationError);
  });

  it("throws ValidationError when the value is not a finite number at all", () => {
    expect(() => Guard.assertInRange(Number.NaN, 0, 10, "Config.retryCount")).toThrow(
      ValidationError,
    );
  });
});

describe("Guard.assertArrayOf", () => {
  const isString = (item: unknown): item is string => typeof item === "string";

  it("passes when every element satisfies the item guard", () => {
    expect(() => Guard.assertArrayOf(["a", "b"], isString, "names")).not.toThrow();
  });

  it("throws ValidationError when the value is not an array", () => {
    expect(() => Guard.assertArrayOf("not an array", isString, "names")).toThrow(ValidationError);
  });

  it("throws ValidationError naming the failing index", () => {
    try {
      Guard.assertArrayOf(["a", 2, "c"], isString, "names");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toContain("names[1]");
    }
  });
});

describe("Guard.assertInstanceOf", () => {
  it("passes for a matching instance", () => {
    expect(() => Guard.assertInstanceOf(new Error("boom"), Error, "cause")).not.toThrow();
  });

  it("throws ValidationError for a non-matching value", () => {
    expect(() => Guard.assertInstanceOf("not an error", Error, "cause")).toThrow(ValidationError);
  });

  it("names the expected constructor in the message", () => {
    try {
      Guard.assertInstanceOf({}, TypeError, "cause");
      expect.unreachable();
    } catch (error) {
      expect((error as ValidationError).message).toContain("must be an instance of TypeError");
    }
  });
});

describe("Guard.assertZodSchema", () => {
  it("passes for a Zod schema", () => {
    expect(() => Guard.assertZodSchema(z.object({ name: z.string() }), "Agent.output")).not.toThrow();
  });

  it.each([
    ["a plain object", {}],
    ["undefined", undefined],
    ["a string", "z.string()"],
    ["a function", () => "not a schema"],
    ["an array", []],
  ])("throws ValidationError for %s", (_label, value) => {
    expect(() => Guard.assertZodSchema(value, "Agent.output")).toThrow(ValidationError);
  });
});

interface IGreeter {
  greet(): string;
}

describe("Guard.assertImplements", () => {
  it("passes when every method is present and callable", () => {
    const greeter: IGreeter = { greet: () => "hi" };

    expect(() =>
      Guard.assertImplements<IGreeter>(greeter, "greeter", "IGreeter", ["greet"]),
    ).not.toThrow();
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "not an object"],
    ["a number", 42],
  ])("throws ValidationError for %s", (_label, value) => {
    expect(() =>
      Guard.assertImplements<IGreeter>(value, "greeter", "IGreeter", ["greet"]),
    ).toThrow(ValidationError);
  });

  it("throws ValidationError naming the missing method", () => {
    try {
      Guard.assertImplements<IGreeter>({}, "greeter", "IGreeter", ["greet"]);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toContain(
        'greeter must implement IGreeter: "greet" is not a function',
      );
    }
  });

  it("accepts functions (callable objects) as well as plain objects", () => {
    const fn = () => "hi";
    Object.assign(fn, { greet: () => "hi" });

    expect(() =>
      Guard.assertImplements<IGreeter>(fn, "greeter", "IGreeter", ["greet"]),
    ).not.toThrow();
  });

  it("appends the fix hint exactly as in the sub-task's worked example", () => {
    try {
      Guard.assertImplements(
        undefined,
        "Agent.provider",
        "IProvider",
        ["generate"],
        'Pass a provider instance (e.g. new OpenAIProvider(...)) or a registered provider name such as "openai".',
      );
      expect.unreachable();
    } catch (error) {
      expect((error as ValidationError).message).toBe(
        'Agent.provider must implement IProvider: received undefined. Pass a provider instance (e.g. new OpenAIProvider(...)) or a registered provider name such as "openai".',
      );
    }
  });
});

describe("Guard.fromZod", () => {
  const schema = z.object({ name: z.string().min(1) });

  it("returns the parsed data on success", () => {
    const result = schema.safeParse({ name: "Assistant" });

    expect(Guard.fromZod(result, "Agent configuration")).toEqual({ name: "Assistant" });
  });

  it("throws ValidationError with formatZodIssues output on failure", () => {
    const result = schema.safeParse({ name: "" });

    try {
      Guard.fromZod(result, "Agent configuration");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const validationError = error as ValidationError;
      expect(validationError.message).toContain("Agent configuration:");
      expect(validationError.message).toContain("name");
      expect(validationError.context["subject"]).toBe("Agent configuration");
      expect(typeof validationError.context["issues"]).toBe("string");
    }
  });
});
