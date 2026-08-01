import { describe, expect, it } from "vitest";
import { ProviderError } from "../core/errors.js";
import {
  AuthenticationError,
  InvalidRequestError,
  ModelNotFoundError,
  ProviderConnectionError,
  ProviderResponseError,
  ProviderTimeoutError,
  RateLimitError,
} from "./errors.js";

describe("ProviderResponseError", () => {
  it("carries providerName, retryable, and structured details", () => {
    const cause = new Error("boom");
    const error = new ProviderResponseError("server error", "openai", true, {
      statusCode: 500,
      providerCode: "internal_error",
      cause,
    });

    expect(error).toBeInstanceOf(ProviderError);
    expect(error.name).toBe("ProviderResponseError");
    expect(error.providerName).toBe("openai");
    expect(error.retryable).toBe(true);
    expect(error.statusCode).toBe(500);
    expect(error.providerCode).toBe("internal_error");
    expect(error.cause).toBe(cause);
  });

  it("omits optional fields entirely when not provided", () => {
    const error = new ProviderResponseError("unexpected response shape", "openai", false);

    expect(error.statusCode).toBeUndefined();
    expect(error.providerCode).toBeUndefined();
    expect(error.cause).toBeUndefined();
  });
});

describe("AuthenticationError", () => {
  it("is a non-retryable ProviderResponseError", () => {
    const error = new AuthenticationError("invalid api key", "openai", { statusCode: 401 });

    expect(error).toBeInstanceOf(ProviderResponseError);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.name).toBe("AuthenticationError");
    expect(error.retryable).toBe(false);
    expect(error.statusCode).toBe(401);
  });
});

describe("ModelNotFoundError", () => {
  it("is a non-retryable ProviderResponseError", () => {
    const error = new ModelNotFoundError("unknown model", "openai", { statusCode: 404 });

    expect(error).toBeInstanceOf(ProviderResponseError);
    expect(error.name).toBe("ModelNotFoundError");
    expect(error.retryable).toBe(false);
  });
});

describe("InvalidRequestError", () => {
  it("is a non-retryable ProviderResponseError", () => {
    const error = new InvalidRequestError("bad request", "openai", { statusCode: 400 });

    expect(error).toBeInstanceOf(ProviderResponseError);
    expect(error.name).toBe("InvalidRequestError");
    expect(error.retryable).toBe(false);
  });
});

describe("RateLimitError", () => {
  it("is retryable and carries retryAfterSeconds", () => {
    const error = new RateLimitError("rate limited", "openai", {
      statusCode: 429,
      retryAfterSeconds: 30,
    });

    expect(error).toBeInstanceOf(ProviderResponseError);
    expect(error.name).toBe("RateLimitError");
    expect(error.retryable).toBe(true);
    expect(error.retryAfterSeconds).toBe(30);
  });

  it("leaves retryAfterSeconds undefined when not provided", () => {
    const error = new RateLimitError("rate limited", "openai", { statusCode: 429 });

    expect(error.retryAfterSeconds).toBeUndefined();
  });
});

describe("ProviderTimeoutError", () => {
  it("is retryable", () => {
    const error = new ProviderTimeoutError("request timed out", "openai");

    expect(error).toBeInstanceOf(ProviderResponseError);
    expect(error.name).toBe("ProviderTimeoutError");
    expect(error.retryable).toBe(true);
  });
});

describe("ProviderConnectionError", () => {
  it("is retryable", () => {
    const error = new ProviderConnectionError("connection refused", "openai");

    expect(error).toBeInstanceOf(ProviderResponseError);
    expect(error.name).toBe("ProviderConnectionError");
    expect(error.retryable).toBe(true);
  });
});
