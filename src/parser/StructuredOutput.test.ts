import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { OutputParseError, OutputValidationError } from "../core/errors.js";
import { JsonExtractor } from "./JsonExtractor.js";
import { OutputValidator } from "./OutputValidator.js";
import { StructuredOutputParser } from "./StructuredOutput.js";

const userSchema = z.object({ name: z.string(), age: z.number() });

describe("StructuredOutputParser", () => {
  describe("parse", () => {
    it("extracts and validates a fenced JSON payload end to end", () => {
      const parser = new StructuredOutputParser(userSchema);
      const raw = 'Here is the user:\n```json\n{"name":"Lalit","age":30}\n```';

      expect(parser.parse(raw)).toEqual({ name: "Lalit", age: 30 });
    });

    it("throws OutputParseError when no JSON payload exists", () => {
      const parser = new StructuredOutputParser(userSchema);
      expect(() => parser.parse("no json here")).toThrow(OutputParseError);
    });

    it("throws OutputValidationError when the payload fails the schema", () => {
      const parser = new StructuredOutputParser(userSchema);
      expect(() => parser.parse('{"name":"Lalit"}')).toThrow(OutputValidationError);
    });
  });

  describe("safeParse", () => {
    it("returns ok:true for a valid payload", () => {
      const parser = new StructuredOutputParser(userSchema);
      expect(parser.safeParse('{"name":"Lalit","age":30}')).toEqual({
        ok: true,
        data: { name: "Lalit", age: 30 },
      });
    });

    it("returns ok:false with the error, never throwing, for an invalid payload", () => {
      const parser = new StructuredOutputParser(userSchema);
      const outcome = parser.safeParse('{"name":"Lalit"}');

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error).toBeInstanceOf(OutputValidationError);
      }
    });

    it("returns ok:false, never throwing, when extraction fails", () => {
      const parser = new StructuredOutputParser(userSchema);
      const outcome = parser.safeParse("nothing to extract");

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error).toBeInstanceOf(OutputParseError);
      }
    });

    it("rethrows a non-OutputError thrown by a dependency instead of swallowing it", () => {
      const extractor = new JsonExtractor();
      // Cast: only `validate` is exercised by safeParse(), so a minimal stand-in
      // is enough to prove a non-OutputError throw propagates unwrapped.
      const validator = {
        validate: vi.fn(() => {
          throw new Error("unexpected");
        }),
      } as unknown as OutputValidator<z.infer<typeof userSchema>>;
      const parser = new StructuredOutputParser(userSchema, { extractor, validator });

      expect(() => parser.safeParse('{"name":"Lalit","age":30}')).toThrow("unexpected");
    });
  });

  it("toJSONSchema delegates to z.toJSONSchema", () => {
    const parser = new StructuredOutputParser(userSchema);
    const schema = parser.toJSONSchema();

    expect(schema).toEqual(z.toJSONSchema(userSchema));
  });

  it("toFormatInstructions embeds the JSON schema and demands JSON-only output", () => {
    const parser = new StructuredOutputParser(userSchema);
    const instructions = parser.toFormatInstructions();

    expect(instructions).toContain("JSON");
    expect(instructions).toContain('"name"');
    expect(instructions).toContain('"age"');
  });

  it("uses an injected extractor and validator instead of constructing its own", () => {
    const extractor = new JsonExtractor();
    const validator = new OutputValidator(userSchema);
    const extractSpy = vi.spyOn(extractor, "parse");
    const validateSpy = vi.spyOn(validator, "validate");
    const parser = new StructuredOutputParser(userSchema, { extractor, validator });

    parser.parse('{"name":"Lalit","age":30}');

    expect(extractSpy).toHaveBeenCalledTimes(1);
    expect(validateSpy).toHaveBeenCalledTimes(1);
  });
});
