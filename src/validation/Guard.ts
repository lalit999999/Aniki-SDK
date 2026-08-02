import { z } from "zod";
import { ValidationError } from "../core/errors.js";
import { formatZodIssues } from "../utils/index.js";

/**
 * The fail-fast validation layer used throughout the SDK's public
 * constructors and entry points.
 *
 * Every assertion throws {@link ValidationError} on failure, with the
 * offending `subject` (e.g. `"Agent.provider"`) and the received value
 * attached to `error.context`. Messages follow a consistent
 * what → why → fix shape so a caller can act on them without reading the
 * SDK's source:
 *
 * `Agent.provider must implement IProvider: "generate" is not a function.
 * Pass a provider instance (e.g. new OpenAIProvider(...)) or a registered
 * provider name such as "openai".`
 *
 * Guard depends on nothing but {@link ValidationError} and
 * {@link formatZodIssues} — it never touches I/O, logging, or any other
 * SDK module, so it can be used from any layer without creating cycles.
 */
export class Guard {
  private constructor() {
    // Static-only utility class; never instantiated.
  }

  /**
   * Asserts `value` is neither `null` nor `undefined`.
   *
   * @throws {@link ValidationError} when `value` is `null` or `undefined`.
   * @example
   * ```ts
   * Guard.assertDefined(options.provider, "Agent.provider");
   * ```
   */
  static assertDefined<T>(
    value: T | null | undefined,
    subject: string,
    fix?: string,
  ): asserts value is T {
    if (value === null || value === undefined) {
      throw Guard.fail(subject, "is required", value, fix);
    }
  }

  /**
   * Asserts `value` is a `string` with at least one non-whitespace character.
   *
   * @throws {@link ValidationError} when `value` is not a string, or is empty/whitespace-only.
   * @example
   * ```ts
   * Guard.assertNonEmptyString(options.name, "Agent.name");
   * ```
   */
  static assertNonEmptyString(value: unknown, subject: string, fix?: string): asserts value is string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw Guard.fail(subject, "must be a non-empty string", value, fix);
    }
  }

  /**
   * Asserts `value` is an integer greater than zero.
   *
   * @throws {@link ValidationError} when `value` is not a positive integer.
   * @example
   * ```ts
   * Guard.assertPositiveInteger(options.maxToolIterations, "Agent.maxToolIterations");
   * ```
   */
  static assertPositiveInteger(value: unknown, subject: string, fix?: string): asserts value is number {
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
      throw Guard.fail(subject, "must be a positive integer", value, fix);
    }
  }

  /**
   * Asserts `value` is a finite `number` (rejects `NaN`, `Infinity`, `-Infinity`).
   *
   * @throws {@link ValidationError} when `value` is not a finite number.
   * @example
   * ```ts
   * Guard.assertFiniteNumber(options.timeoutMs, "Config.timeout");
   * ```
   */
  static assertFiniteNumber(value: unknown, subject: string, fix?: string): asserts value is number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw Guard.fail(subject, "must be a finite number", value, fix);
    }
  }

  /**
   * Asserts `value` is a finite number within `[min, max]` inclusive.
   *
   * @throws {@link ValidationError} when `value` is not a finite number, or falls outside the range.
   * @example
   * ```ts
   * Guard.assertInRange(retryCount, 0, 10, "Config.retryCount");
   * ```
   */
  static assertInRange(
    value: unknown,
    min: number,
    max: number,
    subject: string,
    fix?: string,
  ): asserts value is number {
    Guard.assertFiniteNumber(value, subject, fix);
    if (value < min || value > max) {
      throw Guard.fail(subject, `must be between ${min} and ${max}`, value, fix);
    }
  }

  /**
   * Asserts `value` is an array whose every element satisfies `itemGuard`.
   *
   * @throws {@link ValidationError} when `value` is not an array, or an element fails `itemGuard`.
   * @example
   * ```ts
   * Guard.assertArrayOf(options.tools, (t): t is Tool => t instanceof Tool, "Agent.tools");
   * ```
   */
  static assertArrayOf<T>(
    value: unknown,
    itemGuard: (item: unknown, index: number) => item is T,
    subject: string,
    fix?: string,
  ): asserts value is T[] {
    if (!Array.isArray(value)) {
      throw Guard.fail(subject, "must be an array", value, fix);
    }
    value.forEach((item: unknown, index: number) => {
      if (!itemGuard(item, index)) {
        throw Guard.fail(`${subject}[${index}]`, "failed validation", item, fix);
      }
    });
  }

  /**
   * Asserts `value` is an instance of `ctor`.
   *
   * @throws {@link ValidationError} when `value` is not an instance of `ctor`.
   * @example
   * ```ts
   * Guard.assertInstanceOf(cause, Error, "cause");
   * ```
   */
  static assertInstanceOf<T>(
    value: unknown,
    ctor: abstract new (...args: never[]) => T,
    subject: string,
    fix?: string,
  ): asserts value is T {
    if (!(value instanceof ctor)) {
      throw Guard.fail(subject, `must be an instance of ${ctor.name}`, value, fix);
    }
  }

  /**
   * Asserts `value` is a Zod schema (`z.ZodType`).
   *
   * @throws {@link ValidationError} when `value` is not a `z.ZodType`.
   * @example
   * ```ts
   * Guard.assertZodSchema(options.output, "Agent.output");
   * ```
   */
  static assertZodSchema(value: unknown, subject: string, fix?: string): asserts value is z.ZodType {
    if (!(value instanceof z.ZodType)) {
      throw Guard.fail(subject, "must be a Zod schema", value, fix);
    }
  }

  /**
   * Asserts `value` structurally implements an interface: a non-null object
   * (or function) exposing every name in `methodNames` as a function.
   *
   * @throws {@link ValidationError} when `value` is not an object/function, or is missing a required method.
   * @example
   * ```ts
   * Guard.assertImplements<IProvider>(
   *   provider,
   *   "Agent.provider",
   *   "IProvider",
   *   ["generate"],
   *   'Pass a provider instance (e.g. new OpenAIProvider(...)) or a registered provider name such as "openai".',
   * );
   * ```
   */
  static assertImplements<T>(
    value: unknown,
    subject: string,
    interfaceName: string,
    methodNames: readonly (string & keyof T)[],
    fix?: string,
  ): asserts value is T {
    if (value === null || (typeof value !== "object" && typeof value !== "function")) {
      throw Guard.fail(subject, `must implement ${interfaceName}`, value, fix);
    }
    const candidate = value as Record<string, unknown>;
    for (const method of methodNames) {
      if (typeof candidate[method] !== "function") {
        throw Guard.fail(
          subject,
          `must implement ${interfaceName}: "${method}" is not a function`,
          value,
          fix,
        );
      }
    }
  }

  /**
   * Converts a failed Zod `safeParse()` result into a thrown
   * {@link ValidationError}, formatted via {@link formatZodIssues} — so
   * Zod-driven and hand-written validation produce identical error shapes.
   * On success, returns the parsed data.
   *
   * @throws {@link ValidationError} when `result.success` is `false`.
   * @returns `result.data` when `result.success` is `true`.
   * @example
   * ```ts
   * const data = Guard.fromZod(agentSchema.safeParse(options), "Agent configuration");
   * ```
   */
  static fromZod<T>(result: z.ZodSafeParseResult<T>, subject: string): T {
    if (!result.success) {
      const issues = formatZodIssues(result.error.issues);
      throw new ValidationError(`${subject}: ${issues}`, { subject, issues });
    }
    return result.data;
  }

  /** Builds the {@link ValidationError} every assertion above throws, in a consistent what → why → fix shape. */
  private static fail(subject: string, why: string, received: unknown, fix?: string): ValidationError {
    const message = `${subject} ${why}: received ${describeReceived(received)}.${fix ? ` ${fix}` : ""}`;
    return new ValidationError(message, { subject, received });
  }
}

/** Renders `value` as a short, human-readable diagnostic fragment for error messages. */
function describeReceived(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "function") return `a function ("${value.name || "anonymous"}")`;
  if (Array.isArray(value)) return `an array (length ${value.length})`;
  if (typeof value === "object") return `an object of type "${value.constructor?.name ?? "Object"}"`;
  return typeof value;
}
