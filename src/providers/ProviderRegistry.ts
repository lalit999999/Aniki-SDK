import { ConfigurationError } from "../core/errors.js";
import type { ProviderConfig } from "../config/ProviderConfig.js";
import type { IProvider } from "./AIProvider.js";

/** Constructs a provider instance from a resolved {@link ProviderConfig}. */
export type ProviderFactoryFn = (config: ProviderConfig) => IProvider;

/**
 * A name → factory-function registry providers are looked up by.
 *
 * This is the mechanism that makes adding a new vendor an Open/Closed
 * operation: a new provider ships as a new folder plus one
 * {@link ProviderRegistry.register} call — no existing file changes.
 *
 * @example
 * ```ts
 * const registry = new ProviderRegistry();
 * registry.register("custom", (config) => new CustomProvider(config));
 * registry.resolve("custom")({ apiKey: "..." });
 * ```
 */
export class ProviderRegistry {
  private readonly factories = new Map<string, ProviderFactoryFn>();

  /**
   * Registers `factory` under `name`. Throws {@link ConfigurationError} if
   * `name` is already registered.
   */
  register(name: string, factory: ProviderFactoryFn): void {
    if (this.factories.has(name)) {
      throw new ConfigurationError(`Provider "${name}" is already registered`);
    }
    this.factories.set(name, factory);
  }

  /** Returns whether `name` has a registered factory. */
  has(name: string): boolean {
    return this.factories.has(name);
  }

  /** Returns the names of every currently registered provider. */
  list(): readonly string[] {
    return [...this.factories.keys()];
  }

  /**
   * Returns the factory registered under `name`. Throws
   * {@link ConfigurationError} — listing the currently available names — if
   * `name` is not registered.
   */
  resolve(name: string): ProviderFactoryFn {
    const factory = this.factories.get(name);
    if (!factory) {
      const available = this.list().join(", ") || "(none registered)";
      throw new ConfigurationError(`Unknown provider "${name}". Available providers: ${available}`);
    }
    return factory;
  }
}

/** The shared registry {@link ProviderFactory} resolves built-in and user-registered providers against by default. */
export const defaultProviderRegistry = new ProviderRegistry();
