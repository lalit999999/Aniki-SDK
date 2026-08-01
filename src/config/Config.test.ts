import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Aniki, AnikiSDK } from "./Config.js";
import { ConfigurationError } from "../core/errors.js";

describe("AnikiSDK", () => {
  let sdk: AnikiSDK;

  beforeEach(() => {
    sdk = new AnikiSDK();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to an empty configuration", () => {
    expect(sdk.getConfig()).toEqual({});
  });

  it("configures and reads back a valid configuration", () => {
    sdk.configure({
      provider: "openai",
      apiKey: "sk-test-123",
      baseURL: "https://api.openai.com/v1",
      timeout: 30000,
      retryCount: 3,
      defaultModel: "gpt-5.5",
      defaultProvider: "openai",
    });

    expect(sdk.getConfig()).toEqual({
      provider: "openai",
      apiKey: "sk-test-123",
      baseURL: "https://api.openai.com/v1",
      timeout: 30000,
      retryCount: 3,
      defaultModel: "gpt-5.5",
      defaultProvider: "openai",
    });
  });

  it("merges successive configure() calls instead of overwriting", () => {
    sdk.configure({ provider: "openai", timeout: 10000 });
    sdk.configure({ retryCount: 5 });

    expect(sdk.getConfig()).toEqual({
      provider: "openai",
      timeout: 10000,
      retryCount: 5,
    });
  });

  it("falls back to a provider-specific env var when apiKey is omitted", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "env-anthropic-key");

    sdk.configure({ provider: "anthropic" });

    expect(sdk.getConfig().apiKey).toBe("env-anthropic-key");
  });

  it("throws ConfigurationError on invalid input instead of a raw error", () => {
    expect(() => sdk.configure({ timeout: -1 })).toThrow(ConfigurationError);
    expect(() => sdk.configure({ retryCount: -5 })).toThrow(ConfigurationError);
    expect(() => sdk.configure({ provider: "not-a-provider" as never })).toThrow(ConfigurationError);
  });

  it("leaves prior configuration untouched when a later configure() call is invalid", () => {
    sdk.configure({ provider: "openai", apiKey: "sk-test-123" });

    expect(() => sdk.configure({ timeout: -1 })).toThrow(ConfigurationError);
    expect(sdk.getConfig()).toEqual({ provider: "openai", apiKey: "sk-test-123" });
  });

  it("exports a shared Aniki singleton", () => {
    expect(Aniki).toBeInstanceOf(AnikiSDK);
  });
});
