import { describe, expect, it } from "vitest";
import {
  AuthenticationError,
  InvalidRequestError,
  ModelNotFoundError,
  ProviderResponseError,
  RateLimitError,
} from "../errors.js";
import { OpenAIErrorTranslator } from "./OpenAIErrorTranslator.js";

function errorBody(message: string, code?: string, type?: string): string {
  return JSON.stringify({ error: { message, code, type } });
}

describe("OpenAIErrorTranslator", () => {
  it("translates 401 into AuthenticationError", () => {
    expect(() =>
      new OpenAIErrorTranslator().translate(401, errorBody("invalid api key"), {}),
    ).toThrow(AuthenticationError);
  });

  it("translates 403 into AuthenticationError", () => {
    expect(() => new OpenAIErrorTranslator().translate(403, errorBody("forbidden"), {})).toThrow(
      AuthenticationError,
    );
  });

  it("translates a 404 with a model_not_found code into ModelNotFoundError", () => {
    expect(() =>
      new OpenAIErrorTranslator().translate(
        404,
        errorBody("model not found", "model_not_found"),
        {},
      ),
    ).toThrow(ModelNotFoundError);
  });

  it("translates a 404 without a model_not_found code into InvalidRequestError", () => {
    expect(() =>
      new OpenAIErrorTranslator().translate(404, errorBody("route not found"), {}),
    ).toThrow(InvalidRequestError);
  });

  it("translates 400 and 422 into InvalidRequestError", () => {
    expect(() => new OpenAIErrorTranslator().translate(400, errorBody("bad request"), {})).toThrow(
      InvalidRequestError,
    );
    expect(() =>
      new OpenAIErrorTranslator().translate(422, errorBody("unprocessable"), {}),
    ).toThrow(InvalidRequestError);
  });

  it("translates 429 into RateLimitError and captures retry-after", () => {
    try {
      new OpenAIErrorTranslator().translate(429, errorBody("rate limited"), {
        "retry-after": "30",
      });
      expect.fail("expected translate to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(RateLimitError);
      expect((error as RateLimitError).retryable).toBe(true);
      expect((error as RateLimitError).retryAfterSeconds).toBe(30);
    }
  });

  it("translates 5xx into a retryable base ProviderResponseError", () => {
    try {
      new OpenAIErrorTranslator().translate(500, errorBody("internal error"), {});
      expect.fail("expected translate to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderResponseError);
      expect((error as ProviderResponseError).retryable).toBe(true);
      expect((error as ProviderResponseError).statusCode).toBe(500);
    }
  });

  it("falls back gracefully when the error body is not JSON", () => {
    expect(() => new OpenAIErrorTranslator().translate(401, "not json", {})).toThrow(
      AuthenticationError,
    );
  });

  it("translates an unmapped status into a non-retryable base ProviderResponseError", () => {
    try {
      new OpenAIErrorTranslator().translate(418, errorBody("I'm a teapot"), {});
      expect.fail("expected translate to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderResponseError);
      expect((error as ProviderResponseError).retryable).toBe(false);
      expect((error as ProviderResponseError).statusCode).toBe(418);
    }
  });

  it("carries the provider name and original body as cause", () => {
    try {
      new OpenAIErrorTranslator().translate(401, errorBody("invalid api key", "invalid_key"), {});
      expect.fail("expected translate to throw");
    } catch (error) {
      expect((error as AuthenticationError).providerName).toBe("openai");
      expect((error as AuthenticationError).providerCode).toBe("invalid_key");
      expect((error as AuthenticationError).cause).toBeDefined();
    }
  });
});
