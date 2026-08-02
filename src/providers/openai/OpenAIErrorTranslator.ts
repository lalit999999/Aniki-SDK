import {
  AuthenticationError,
  InvalidRequestError,
  ModelNotFoundError,
  type ProviderErrorDetails,
  ProviderResponseError,
  RateLimitError,
} from "../errors.js";
import { openAIErrorResponseSchema, type OpenAIErrorResponse } from "./types.js";

const PROVIDER_NAME = "openai";

/** The maximum number of raw-body characters echoed into a synthesized error message. */
const MAX_BODY_EXCERPT_LENGTH = 200;

function tryParseErrorBody(bodyText: string): OpenAIErrorResponse | undefined {
  try {
    const parsed: unknown = JSON.parse(bodyText);
    const result = openAIErrorResponseSchema.safeParse(parsed);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

function parseRetryAfterSeconds(headers: Readonly<Record<string, string>>): number | undefined {
  const raw = headers["retry-after"];
  if (raw === undefined) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? seconds : undefined;
}

function isModelNotFound(errorBody: OpenAIErrorResponse | undefined): boolean {
  return errorBody?.error.code === "model_not_found";
}

function looksLikeHtml(bodyText: string, headers: Readonly<Record<string, string>>): boolean {
  const contentType = headers["content-type"] ?? "";
  return contentType.toLowerCase().includes("html") || bodyText.trimStart().startsWith("<");
}

/** Bounds `bodyText` to {@link MAX_BODY_EXCERPT_LENGTH}, marking truncation explicitly. */
function excerptOf(bodyText: string): string {
  if (bodyText.length <= MAX_BODY_EXCERPT_LENGTH) return bodyText;
  return `${bodyText.slice(0, MAX_BODY_EXCERPT_LENGTH)}… (truncated, ${bodyText.length} chars total)`;
}

/**
 * Synthesizes a bounded, human-readable message for a non-2xx response whose
 * body did not parse as OpenAI's error envelope — an HTML error page, a
 * plain-text gateway message, an empty body, or valid-but-unrelated JSON.
 * Never echoes the raw body verbatim; the full body remains available on
 * {@link ProviderErrorDetails.cause}.
 */
function synthesizeMessage(
  status: number,
  bodyText: string,
  headers: Readonly<Record<string, string>>,
  url: string | undefined,
): string {
  const urlSuffix = url ? ` — ${url}` : "";
  const trimmed = bodyText.trim();

  if (trimmed.length === 0) {
    return `OpenAI request failed with status ${status} (empty response body)${urlSuffix}`;
  }
  if (looksLikeHtml(bodyText, headers)) {
    return `OpenAI request failed with status ${status} (non-JSON HTML response)${urlSuffix}`;
  }
  return `OpenAI request failed with status ${status}: ${excerptOf(bodyText)}${urlSuffix}`;
}

/**
 * Maps an OpenAI non-2xx HTTP response onto the shared provider error
 * taxonomy, using the response status plus OpenAI's `error.code`/`error.type`
 * fields to disambiguate cases (e.g. a 404 for an unknown model versus any
 * other 404).
 */
export class OpenAIErrorTranslator {
  /**
   * Translates a non-2xx OpenAI response into the appropriate
   * {@link ProviderResponseError} subclass and throws it. `url`, when given,
   * is appended to a synthesized (non-envelope) message so the failure is
   * traceable to the request that produced it. Never included when the
   * message comes from OpenAI's own error envelope, which already speaks
   * for itself.
   */
  translate(
    status: number,
    bodyText: string,
    headers: Readonly<Record<string, string>>,
    url?: string,
  ): never {
    const errorBody = tryParseErrorBody(bodyText);
    const message = errorBody?.error.message ?? synthesizeMessage(status, bodyText, headers, url);
    const providerCode = errorBody?.error.code ?? errorBody?.error.type ?? undefined;

    const details: ProviderErrorDetails = {
      statusCode: status,
      cause: errorBody ?? bodyText,
      ...(providerCode !== undefined ? { providerCode } : {}),
    };

    if (status === 401 || status === 403) {
      throw new AuthenticationError(message, PROVIDER_NAME, details);
    }

    if (status === 404) {
      if (isModelNotFound(errorBody)) {
        throw new ModelNotFoundError(message, PROVIDER_NAME, details);
      }
      throw new InvalidRequestError(message, PROVIDER_NAME, details);
    }

    if (status === 400 || status === 422) {
      throw new InvalidRequestError(message, PROVIDER_NAME, details);
    }

    if (status === 429) {
      const retryAfterSeconds = parseRetryAfterSeconds(headers);
      throw new RateLimitError(message, PROVIDER_NAME, {
        ...details,
        ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
      });
    }

    if (status >= 500) {
      throw new ProviderResponseError(message, PROVIDER_NAME, true, details);
    }

    throw new ProviderResponseError(message, PROVIDER_NAME, false, details);
  }
}
