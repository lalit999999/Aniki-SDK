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

/**
 * Maps an OpenAI non-2xx HTTP response onto the shared provider error
 * taxonomy, using the response status plus OpenAI's `error.code`/`error.type`
 * fields to disambiguate cases (e.g. a 404 for an unknown model versus any
 * other 404).
 */
export class OpenAIErrorTranslator {
  /** Translates a non-2xx OpenAI response into the appropriate {@link ProviderResponseError} subclass and throws it. */
  translate(status: number, bodyText: string, headers: Readonly<Record<string, string>>): never {
    const errorBody = tryParseErrorBody(bodyText);
    const message =
      errorBody?.error.message ?? (bodyText || `OpenAI request failed with status ${status}`);
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
