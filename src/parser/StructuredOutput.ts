import { z } from "zod";
import { OutputError } from "../core/errors.js";
import type { StructuredParseOutcome } from "../types/output.js";
import { JsonExtractor } from "./JsonExtractor.js";
import { OutputValidator } from "./OutputValidator.js";

/** Dependencies an {@link StructuredOutputParser} may be constructed with, in place of its defaults. */
export interface StructuredOutputParserDependencies<TOutput> {
  /** The extractor used to locate a JSON payload in raw model text. Defaults to a fresh {@link JsonExtractor}. */
  readonly extractor?: JsonExtractor;
  /** The validator used to check the extracted payload against the schema. Defaults to a fresh {@link OutputValidator} bound to the constructor's schema. */
  readonly validator?: OutputValidator<TOutput>;
}

/**
 * Turns raw model text into a schema-validated, typed value, and produces
 * the prompt instructions that ask the model to emit that shape in the
 * first place.
 *
 * `StructuredOutputParser` composes a {@link JsonExtractor} and an
 * {@link OutputValidator} into the full "text → extract → parse → validate"
 * pipeline described by the SDK's untrusted-output policy: every step runs,
 * every time, and no step trusts the previous one's intent. Structured
 * output in this SDK is prompt-driven rather than provider-driven — see
 * {@link toFormatInstructions} — so this class is also how {@link Runner}
 * builds the instructions it appends to an agent's system message.
 *
 * @example
 * ```ts
 * const parser = new StructuredOutputParser(z.object({ name: z.string() }));
 * parser.parse('```json\n{"name": "Lalit"}\n```'); // { name: "Lalit" }
 * parser.toFormatInstructions(); // prompt fragment demanding JSON-only output
 * ```
 */
export class StructuredOutputParser<TOutput> {
  private readonly schema: z.ZodType<TOutput>;
  private readonly extractor: JsonExtractor;
  private readonly validator: OutputValidator<TOutput>;

  /** Constructs a StructuredOutputParser. `deps` overrides the default extractor/validator, primarily for testing. */
  constructor(schema: z.ZodType<TOutput>, deps: StructuredOutputParserDependencies<TOutput> = {}) {
    this.schema = schema;
    this.extractor = deps.extractor ?? new JsonExtractor();
    this.validator = deps.validator ?? new OutputValidator(schema);
  }

  /**
   * Extracts, parses, and validates `raw` against this parser's schema.
   * Throws {@link OutputParseError} when no payload can be extracted or
   * parsed, and {@link OutputValidationError} when the parsed value fails
   * the schema.
   */
  parse(raw: string): TOutput {
    const value = this.extractor.parse(raw);
    return this.validator.validate(value, raw);
  }

  /** {@link parse}, but returns a {@link StructuredParseOutcome} instead of throwing. Never throws. */
  safeParse(raw: string): StructuredParseOutcome<TOutput> {
    try {
      return { ok: true, data: this.parse(raw) };
    } catch (error) {
      if (error instanceof OutputError) {
        return { ok: false, error };
      }
      throw error;
    }
  }

  /** Renders this parser's schema as JSON Schema, via `z.toJSONSchema`. */
  toJSONSchema(): Readonly<Record<string, unknown>> {
    return z.toJSONSchema(this.schema);
  }

  /**
   * Builds the prompt fragment {@link Runner} appends to an agent's system
   * message when it has a structured output schema configured. Embeds the
   * schema as JSON Schema and instructs the model to reply with raw JSON
   * only — no prose, no markdown fences.
   */
  toFormatInstructions(): string {
    return [
      "You must respond with a single JSON value that strictly conforms to the following JSON Schema.",
      "Output raw JSON only: no explanation, no markdown formatting, no code fences.",
      JSON.stringify(this.toJSONSchema(), null, 2),
    ].join("\n\n");
  }
}
