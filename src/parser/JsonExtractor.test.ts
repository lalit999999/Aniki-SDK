import { describe, expect, it } from "vitest";
import { OutputParseError } from "../core/errors.js";
import { JsonExtractor } from "./JsonExtractor.js";

describe("JsonExtractor", () => {
  const extractor = new JsonExtractor();

  describe("extract", () => {
    it("extracts bare JSON with no surrounding text", () => {
      expect(extractor.extract('{"name":"Lalit"}')).toBe('{"name":"Lalit"}');
    });

    it("extracts a payload from a ```json fenced block", () => {
      const raw = 'Here you go:\n```json\n{"name":"Lalit"}\n```\nHope that helps!';
      expect(extractor.extract(raw)).toBe('{"name":"Lalit"}');
    });

    it("extracts a payload from a bare ``` fenced block", () => {
      const raw = '```\n{"name":"Lalit"}\n```';
      expect(extractor.extract(raw)).toBe('{"name":"Lalit"}');
    });

    it("strips leading and trailing prose around a bare payload", () => {
      const raw = 'Sure, the result is {"name":"Lalit"} — let me know if you need anything else.';
      expect(extractor.extract(raw)).toBe('{"name":"Lalit"}');
    });

    it("extracts a top-level array payload", () => {
      expect(extractor.extract("Values: [1, 2, 3] done")).toBe("[1, 2, 3]");
    });

    it("handles nested objects and arrays", () => {
      const raw = '{"user":{"name":"Lalit","tags":["a","b"]},"count":2}';
      expect(extractor.extract(raw)).toBe(raw);
    });

    it("ignores braces and brackets inside quoted strings", () => {
      const raw = '{"note":"use {curly} and [square] freely"}';
      expect(extractor.extract(raw)).toBe(raw);
    });

    it("handles escaped quotes inside strings without ending the string early", () => {
      const raw = '{"quote":"she said \\"hi {there}\\""}';
      expect(extractor.extract(raw)).toBe(raw);
    });

    it("throws OutputParseError when no JSON payload exists", () => {
      expect(() => extractor.extract("just plain prose, nothing to see here")).toThrow(
        OutputParseError,
      );
    });

    it("throws OutputParseError when brackets never balance", () => {
      expect(() => extractor.extract('{"name": "Lalit"')).toThrow(OutputParseError);
    });

    it("carries a truncated raw snippet on the thrown error", () => {
      try {
        extractor.extract("no json here");
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(OutputParseError);
        expect((error as OutputParseError).raw).toBe("no json here");
      }
    });
  });

  describe("parse", () => {
    it("extracts and parses a valid JSON payload", () => {
      expect(extractor.parse('The answer: {"tempC": 21}')).toEqual({ tempC: 21 });
    });

    it("throws OutputParseError with the SyntaxError as cause for malformed JSON", () => {
      try {
        extractor.parse('{"tempC": }');
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(OutputParseError);
        expect((error as OutputParseError).cause).toBeInstanceOf(SyntaxError);
      }
    });

    it("throws OutputParseError when no payload is present", () => {
      expect(() => extractor.parse("nothing here")).toThrow(OutputParseError);
    });
  });
});
