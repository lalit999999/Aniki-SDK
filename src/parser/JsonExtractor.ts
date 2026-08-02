import { OutputParseError } from "../core/errors.js";

/** Matches a fenced code block, capturing its inner content. The optional `json` tag is case-insensitive. */
const FENCE_PATTERN = /```(?:json)?\s*([\s\S]*?)```/i;

/**
 * Extracts a JSON payload from raw, untrusted model text.
 *
 * Model output is rarely bare JSON — it typically arrives wrapped in a
 * ` ```json ` fence, a bare ` ``` ` fence, or surrounded by explanatory
 * prose. `JsonExtractor` locates the first balanced `{...}` or `[...]`
 * payload, ignoring braces and brackets that appear inside quoted strings,
 * and hands the extracted (but not yet parsed) text back to the caller. It
 * performs no schema validation — that is {@link OutputValidator}'s job.
 *
 * @example
 * ```ts
 * const extractor = new JsonExtractor();
 * extractor.extract('Sure, here you go:\n```json\n{"name": "Lalit"}\n```');
 * // '{"name": "Lalit"}'
 * ```
 */
export class JsonExtractor {
  /**
   * Returns the first balanced JSON payload found in `raw`.
   * Throws {@link OutputParseError} when no payload can be located.
   */
  extract(raw: string): string {
    const fenceMatch = FENCE_PATTERN.exec(raw);
    const candidate = fenceMatch ? (fenceMatch[1] ?? "") : raw;
    const payload = this.scanBalancedPayload(candidate);
    if (payload === undefined) {
      throw new OutputParseError("No parsable JSON payload found in the model's output", raw);
    }
    return payload;
  }

  /**
   * Extracts a payload via {@link extract} and parses it with `JSON.parse`.
   * Throws {@link OutputParseError} when extraction fails or the extracted
   * text is not valid JSON.
   */
  parse(raw: string): unknown {
    const payload = this.extract(raw);
    try {
      return JSON.parse(payload);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new OutputParseError(`Extracted payload was not valid JSON: ${reason}`, raw, cause);
    }
  }

  /**
   * Scans `text` starting at the first `{` or `[`, tracking bracket depth
   * and quoted-string state (including backslash escapes), and returns the
   * substring spanning that opening bracket through its matching close.
   * Returns `undefined` when no opening bracket exists, brackets never
   * balance, or a closing bracket doesn't match its opener's kind.
   */
  private scanBalancedPayload(text: string): string | undefined {
    const startIndex = this.findStartIndex(text);
    if (startIndex === undefined) {
      return undefined;
    }

    const stack: string[] = [];
    let inString = false;
    let escaped = false;

    for (let i = startIndex; i < text.length; i++) {
      const char = text[i];
      if (char === undefined) {
        break;
      }

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
        continue;
      }

      if (char === "{" || char === "[") {
        stack.push(char);
        continue;
      }

      if (char === "}" || char === "]") {
        const opener = stack.pop();
        const expectedOpener = char === "}" ? "{" : "[";
        if (opener !== expectedOpener) {
          return undefined;
        }
        if (stack.length === 0) {
          return text.slice(startIndex, i + 1);
        }
      }
    }

    return undefined;
  }

  /** Returns the index of the first `{` or `[` in `text`, or `undefined` if there is none. */
  private findStartIndex(text: string): number | undefined {
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === "{" || char === "[") {
        return i;
      }
    }
    return undefined;
  }
}
