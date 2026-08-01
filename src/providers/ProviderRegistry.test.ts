import { describe, expect, it } from "vitest";
import { ConfigurationError } from "../core/errors.js";
import type { IProvider } from "./AIProvider.js";
import { defaultProviderRegistry, ProviderRegistry } from "./ProviderRegistry.js";

const FAKE_CAPABILITIES = { streaming: false, toolCalling: false, structuredOutput: false };

function createFakeProvider(): IProvider {
  return {
    name: "fake",
    capabilities: FAKE_CAPABILITIES,
    generate: async () => ({ content: "fake", model: "fake-model" }),
    generateStream: async function* () {
      yield { delta: "fake" };
    },
  };
}

describe("ProviderRegistry", () => {
  it("registers and resolves a factory by name", () => {
    const registry = new ProviderRegistry();
    const provider = createFakeProvider();
    registry.register("custom", () => provider);

    expect(registry.has("custom")).toBe(true);
    expect(registry.list()).toEqual(["custom"]);
    expect(registry.resolve("custom")({})).toBe(provider);
  });

  it("throws ConfigurationError when re-registering an existing name", () => {
    const registry = new ProviderRegistry();
    registry.register("custom", () => createFakeProvider());

    expect(() => registry.register("custom", () => createFakeProvider())).toThrow(
      ConfigurationError,
    );
  });

  it("throws ConfigurationError listing available providers when resolving an unknown name", () => {
    const registry = new ProviderRegistry();
    registry.register("custom", () => createFakeProvider());

    expect(() => registry.resolve("nope")).toThrow(ConfigurationError);
    try {
      registry.resolve("nope");
      expect.fail("expected resolve to throw");
    } catch (error) {
      expect((error as Error).message).toContain("custom");
    }
  });

  it("reports (none registered) when the registry is empty", () => {
    const registry = new ProviderRegistry();

    try {
      registry.resolve("anything");
      expect.fail("expected resolve to throw");
    } catch (error) {
      expect((error as Error).message).toContain("(none registered)");
    }
  });

  it("exports a shared defaultProviderRegistry instance", () => {
    expect(defaultProviderRegistry).toBeInstanceOf(ProviderRegistry);
  });
});
