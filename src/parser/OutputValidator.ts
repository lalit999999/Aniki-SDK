import { z } from "zod";
import { OutputValidationError, ValidationError } from "../core/errors.js";
import type { StructuredParseOutcome } from "../types/output.js";
import { formatZodIssues } from "../utils/index.js";

/**
 * Validates an already-parsed JSON value against a Zod schema.
 *
 * `OutputValidator` is the last, non-skippable step of the untrusted-input
 * pipeline: text has already been extracted and `JSON.parse`d by the time a
 * value reaches here, but it is still `unknown` until this class confirms it
 * matches the agent's declared shape. It has no knowledge of how the value
 * was produced — {@link StructuredOutputParser} owns extraction and wires
 * this class in as one step of a larger pipeline.
 *
 * @example
 * ```ts
 * const validator = new OutputValidator(z.object({ name: z.string() }));
 * validator.validate({ name: "Lalit" }); // { name: "Lalit" }
 * validator.validate({}); // throws OutputValidationError
 * ```
 */
export class OutputValidator<TOutput> {
  private readonly schema: z.ZodType<TOutput>;

  /** Constructs an OutputValidator. Throws {@link ValidationError} if `schema` is not a Zod schema. */
  constructor(schema: z.ZodType<TOutput>) {
    if (!(schema instanceof z.ZodType)) {
      throw new ValidationError("OutputValidator requires a Zod schema");
    }
    this.schema = schema;
  }

  /**
   * Validates `value` against this validator's schema, returning the typed
   * result. `raw`, the original model text `value` was parsed from, is
   * attached to the thrown error for diagnostics when validation fails; when
   * omitted, a JSON-stringified rendering of `value` is used instead.
   *
   * Throws {@link OutputValidationError} on a schema mismatch.
   */
  validate(value: unknown, raw?: string): TOutput {
    const outcome = this.safeValidate(value, raw);
    if (!outcome.ok) {
      throw outcome.error;
    }
    return outcome.data;
  }

  /** {@link validate}, but returns a {@link StructuredParseOutcome} instead of throwing. Never throws. */
  safeValidate(value: unknown, raw?: string): StructuredParseOutcome<TOutput> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      return {
        ok: false,
        error: new OutputValidationError(
          formatZodIssues(result.error.issues),
          raw ?? this.stringify(value),
        ),
      };
    }
    return { ok: true, data: result.data };
  }

  /** Best-effort JSON rendering of `value` for error diagnostics, falling back to `String(value)` for cyclic or non-serializable input. */
  private stringify(value: unknown): string {
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  }
}
