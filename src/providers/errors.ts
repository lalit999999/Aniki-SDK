import { ProviderError } from "../core/errors.js";

/**
 * The provider error taxonomy.
 *
 * Every class here extends the core {@link ProviderError} (so callers that
 * check `instanceof ProviderError`, such as {@link Runner}, keep working
 * unchanged) and carries the structured fields every vendor integration
 * needs to normalize failures: which provider raised it, the HTTP status
 * (when applicable), the vendor's own error code, whether retrying could
 * plausibly succeed, and the original cause. No subclass is provider-specific;
 * a given vendor's `*ErrorTranslator` maps wire-level failures onto these
 * shared classes rather than defining its own.
 */

/** Structured details attached to a {@link ProviderResponseError} (or subclass). */
export interface ProviderErrorDetails {
  /** The HTTP status code returned by the provider, when applicable. */
  readonly statusCode?: number;
  /** The vendor's own error code or type string, when present. */
  readonly providerCode?: string;
  /** The original error or response body this error was translated from. */
  readonly cause?: unknown;
}

/**
 * The base class for all normalized provider failures.
 *
 * Thrown directly (rather than via a narrower subclass) for two cases: a
 * 5xx server error (`retryable: true`) and a 2xx response whose body fails
 * wire-schema validation (`retryable: false`).
 */
export class ProviderResponseError extends ProviderError {
  /** The name of the provider that raised this error (e.g. `"openai"`). */
  readonly providerName: string;
  /** The HTTP status code returned by the provider, when applicable. */
  readonly statusCode?: number;
  /** The vendor's own error code or type string, when present. */
  readonly providerCode?: string;
  /** Whether retrying the same request could plausibly succeed. */
  readonly retryable: boolean;

  constructor(
    message: string,
    providerName: string,
    retryable: boolean,
    details: ProviderErrorDetails = {},
  ) {
    super(message, details.cause);
    this.name = new.target.name;
    this.providerName = providerName;
    this.retryable = retryable;
    if (details.statusCode !== undefined) this.statusCode = details.statusCode;
    if (details.providerCode !== undefined) this.providerCode = details.providerCode;
  }
}

/** Thrown when a provider rejects a request as unauthenticated/unauthorized (HTTP 401/403). Never retryable. */
export class AuthenticationError extends ProviderResponseError {
  constructor(message: string, providerName: string, details: ProviderErrorDetails = {}) {
    super(message, providerName, false, details);
  }
}

/** Thrown when a provider reports that the requested model does not exist. Never retryable. */
export class ModelNotFoundError extends ProviderResponseError {
  constructor(message: string, providerName: string, details: ProviderErrorDetails = {}) {
    super(message, providerName, false, details);
  }
}

/** Thrown when a provider rejects a request as malformed (HTTP 400/422, or a 404 unrelated to model lookup). Never retryable. */
export class InvalidRequestError extends ProviderResponseError {
  constructor(message: string, providerName: string, details: ProviderErrorDetails = {}) {
    super(message, providerName, false, details);
  }
}

/** Additional details for a {@link RateLimitError}. */
export interface RateLimitErrorDetails extends ProviderErrorDetails {
  /** Seconds to wait before retrying, when the provider reports a `retry-after` header. */
  readonly retryAfterSeconds?: number;
}

/** Thrown when a provider reports the caller has exceeded a rate limit (HTTP 429). Always retryable. */
export class RateLimitError extends ProviderResponseError {
  /** Seconds to wait before retrying, when the provider reports a `retry-after` header. */
  readonly retryAfterSeconds?: number;

  constructor(message: string, providerName: string, details: RateLimitErrorDetails = {}) {
    super(message, providerName, true, details);
    if (details.retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = details.retryAfterSeconds;
    }
  }
}

/** Thrown when a request is aborted after exceeding its configured timeout. Always retryable. */
export class ProviderTimeoutError extends ProviderResponseError {
  constructor(message: string, providerName: string, details: ProviderErrorDetails = {}) {
    super(message, providerName, true, details);
  }
}

/** Thrown when a request fails at the transport level (DNS, socket, or fetch rejection). Always retryable. */
export class ProviderConnectionError extends ProviderResponseError {
  constructor(message: string, providerName: string, details: ProviderErrorDetails = {}) {
    super(message, providerName, true, details);
  }
}
