import { afterEach, describe, expect, it, vi } from "vitest";
import { Aniki } from "../config/Config.js";
import { ConfigurationError } from "../core/errors.js";
import type { IProvider } from "./AIProvider.js";
import { OPENROUTER_DEFAULT_BASE_URL, OpenAIProvider } from "./openai/OpenAIProvider.js";
import { ProviderFactory } from "./ProviderFactory.js";
import { ProviderRegistry } from "./ProviderRegistry.js";

const FAKE_CAPABILITIES = { streaming: false, toolCalling: false, structuredOutput: false };

function createFakeProvider(): IProvider {
  return {
    name: "custom",
    capabilities: FAKE_CAPABILITIES,
    generate: async () => ({ content: "fake", model: "fake-model" }),
    generateStream: async function* () {
      yield { delta: "fake" };
    },
  };
}

describe("ProviderFactory", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("creates a registered custom provider through an injected registry (OCP proof)", () => {
    const registry = new ProviderRegistry();
    const receivedConfigs: unknown[] = [];
    registry.register("custom", (config) => {
      receivedConfigs.push(config);
      return createFakeProvider();
    });

    const provider = ProviderFactory.create("custom", { apiKey: "sk-custom" }, registry);

    expect(provider.name).toBe("custom");
    expect(receivedConfigs).toEqual([{ apiKey: "sk-custom" }]);
  });

  it("lazily registers built-in providers (openai) on first use", () => {
    const registry = new ProviderRegistry();
    expect(registry.has("openai")).toBe(false);

    const provider = ProviderFactory.create("openai", { apiKey: "sk-test" }, registry);

    expect(registry.has("openai")).toBe(true);
    expect(provider.name).toBe("openai");
  });

  it("throws ConfigurationError listing registered providers for an unknown name", () => {
    const registry = new ProviderRegistry();
    registry.register("custom", () => createFakeProvider());

    expect(() => ProviderFactory.create("nope", {}, registry)).toThrow(ConfigurationError);
  });

  it("prefers an explicit apiKey over the global config and env var", () => {
    const registry = new ProviderRegistry();
    const seen: unknown[] = [];
    registry.register("openai-test", (config) => {
      seen.push(config);
      return createFakeProvider();
    });
    vi.stubEnv("OPENAI_API_KEY", "");

    ProviderFactory.create("openai-test", { apiKey: "explicit-key" }, registry);

    expect(seen).toEqual([{ apiKey: "explicit-key" }]);
  });

  it("falls back to the global Aniki config when no explicit apiKey is given", () => {
    vi.spyOn(Aniki, "getConfig").mockReturnValue({ provider: "openai", apiKey: "global-key" });
    const registry = new ProviderRegistry();
    const seen: unknown[] = [];
    registry.register("openai", (config) => {
      seen.push(config);
      return createFakeProvider();
    });

    ProviderFactory.create("openai", {}, registry);

    expect(seen).toEqual([{ apiKey: "global-key" }]);
  });

  it("falls back to the provider's env var when no explicit or global apiKey is set", () => {
    vi.stubEnv("OPENAI_API_KEY", "env-key");
    const registry = new ProviderRegistry();
    const seen: unknown[] = [];
    registry.register("openai", (config) => {
      seen.push(config);
      return createFakeProvider();
    });

    ProviderFactory.create("openai", {}, registry);

    expect(seen).toEqual([{ apiKey: "env-key" }]);
  });

  it("throws ConfigurationError naming the exact env var when a known provider has no resolvable API key", () => {
    const registry = new ProviderRegistry();
    registry.register("openai", () => createFakeProvider());

    expect(() => ProviderFactory.create("openai", {}, registry)).toThrow(ConfigurationError);
    try {
      ProviderFactory.create("openai", {}, registry);
      expect.fail("expected create to throw");
    } catch (error) {
      expect((error as Error).message).toContain("OPENAI_API_KEY");
    }
  });

  it("does not require an API key for an unknown/custom provider name", () => {
    const registry = new ProviderRegistry();
    registry.register("custom", () => createFakeProvider());

    expect(() => ProviderFactory.create("custom", {}, registry)).not.toThrow();
  });

  it("lazily registers openrouter as a built-in OpenAI-wire-compatible provider", () => {
    const registry = new ProviderRegistry();
    expect(registry.has("openrouter")).toBe(false);

    const provider = ProviderFactory.create("openrouter", { apiKey: "sk-or-test" }, registry);

    expect(registry.has("openrouter")).toBe(true);
    expect(provider).toBeInstanceOf(OpenAIProvider);
    expect(provider.name).toBe("openrouter");
  });

  it("leaves openai provider creation completely unchanged after openrouter registration", () => {
    const registry = new ProviderRegistry();

    const provider = ProviderFactory.create("openai", { apiKey: "sk-test" }, registry);

    expect(provider).toBeInstanceOf(OpenAIProvider);
    expect(provider.name).toBe("openai");
  });

  it("exports OpenRouter's default base URL as a named constant", () => {
    expect(OPENROUTER_DEFAULT_BASE_URL).toBe("https://openrouter.ai/api/v1");
  });
});
