import { describe, expect, it } from "vitest";
import { z } from "zod";
import { OutputValidationError, ValidationError } from "../core/errors.js";
import { OutputValidator } from "./OutputValidator.js";

const userSchema = z.object({ name: z.string(), age: z.number() });

describe("OutputValidator", () => {
  it("constructs successfully with a valid Zod schema", () => {
    expect(() => new OutputValidator(userSchema)).not.toThrow();
  });

  it("throws ValidationError when constructed with a non-Zod schema", () => {
    const notASchema = { notASchema: true } as unknown as z.ZodType<unknown>;
    expect(() => new OutputValidator(notASchema)).toThrow(ValidationError);
  });

  describe("validate", () => {
    it("returns typed data for a valid value", () => {
      const validator = new OutputValidator(userSchema);
      expect(validator.validate({ name: "Lalit", age: 30 })).toEqual({
        name: "Lalit",
        age: 30,
      });
    });

    it("throws OutputValidationError carrying formatted issues and the raw snippet", () => {
      const validator = new OutputValidator(userSchema);
      try {
        validator.validate({ name: "Lalit" }, '{"name":"Lalit"}');
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(OutputValidationError);
        const validationError = error as OutputValidationError;
        expect(validationError.issues).toContain("age");
        expect(validationError.raw).toBe('{"name":"Lalit"}');
      }
    });

    it("falls back to a JSON-stringified raw snippet when raw is omitted", () => {
      const validator = new OutputValidator(userSchema);
      try {
        validator.validate({ name: "Lalit" });
        expect.unreachable();
      } catch (error) {
        expect((error as OutputValidationError).raw).toBe('{"name":"Lalit"}');
      }
    });

    it("falls back to String(value) when the invalid value cannot be JSON-stringified (e.g. circular)", () => {
      const validator = new OutputValidator(userSchema);
      const circular: Record<string, unknown> = { name: "Lalit" };
      circular["self"] = circular;

      try {
        validator.validate(circular);
        expect.unreachable();
      } catch (error) {
        expect((error as OutputValidationError).raw).toBe(String(circular));
      }
    });
  });

  describe("safeValidate", () => {
    it("never throws, returning ok:true for valid input", () => {
      const validator = new OutputValidator(userSchema);
      expect(validator.safeValidate({ name: "Lalit", age: 30 })).toEqual({
        ok: true,
        data: { name: "Lalit", age: 30 },
      });
    });

    it("never throws, returning ok:false with the error for invalid input", () => {
      const validator = new OutputValidator(userSchema);
      const outcome = validator.safeValidate({ name: "Lalit" });

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error).toBeInstanceOf(OutputValidationError);
      }
    });
  });
});
