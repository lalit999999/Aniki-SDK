import {
  Aniki,
  PROVIDER_API_KEY_ENV_VAR,
  resolveApiKeyFromEnv,
  type ProviderName,
} from "../config/Config.js";
import type { ProviderConfig } from "../config/ProviderConfig.js";
import { ConfigurationError } from "../core/errors.js";
import { omitUndefined } from "../utils/index.js";
import type { IProvider } from "./AIProvider.js";
import { OPENROUTER_DEFAULT_BASE_URL, OpenAIProvider } from "./openai/OpenAIProvider.js";
import { defaultProviderRegistry, ProviderRegistry } from "./ProviderRegistry.js";

function isKnownProviderName(name: string): name is ProviderName {
  return Object.prototype.hasOwnProperty.call(PROVIDER_API_KEY_ENV_VAR, name);
}

/**
 * Registers the SDK's built-in providers against `registry`, skipping any
 * name already registered.
 *
 * Called lazily by {@link ProviderFactory.create} rather than at module load
 * time, so importing this module has no registration side effects — a
 * caller who never touches the factory never pays for provider construction
 * they don't use.
 */
export function registerBuiltInProviders(registry: ProviderRegistry): void {
  if (!registry.has("openai")) {
    registry.register("openai", (config) => new OpenAIProvider(config));
  }
  if (!registry.has("openrouter")) {
    registry.register(
      "openrouter",
      (config) =>
        new OpenAIProvider(config, {
          name: "openrouter",
          defaultBaseURL: OPENROUTER_DEFAULT_BASE_URL,
        }),
    );
  }
}

/**
 * Resolves the final {@link ProviderConfig} for `name`, merging (highest
 * precedence first): the explicit `config` argument, the SDK's global
 * {@link Aniki} configuration (when it targets this same provider), and the
 * provider's API-key environment variable. Provider-side defaults (base
 * URL, timeout) are left for the provider's own constructor to apply.
 *
 * Throws {@link ConfigurationError} if a known provider ends up with no
 * API key from any source.
 */
function resolveProviderConfig(name: string, explicit: ProviderConfig): ProviderConfig {
  const global = Aniki.getConfig();
  const globalTargetsThisProvider = global.provider === name || global.defaultProvider === name;

  const apiKey =
    explicit.apiKey ??
    (globalTargetsThisProvider ? global.apiKey : undefined) ??
    (isKnownProviderName(name) ? resolveApiKeyFromEnv(name) : undefined);
  const baseURL = explicit.baseURL ?? (globalTargetsThisProvider ? global.baseURL : undefined);
  const timeout = explicit.timeout ?? (globalTargetsThisProvider ? global.timeout : undefined);
  const model = explicit.model ?? (globalTargetsThisProvider ? global.defaultModel : undefined);

  if (apiKey === undefined && isKnownProviderName(name)) {
    throw new ConfigurationError(
      `Missing API key for provider "${name}". Pass it explicitly, set it via ` +
        `Aniki.configure({ apiKey }), or set the ${PROVIDER_API_KEY_ENV_VAR[name]} environment variable.`,
    );
  }

  return omitUndefined<ProviderConfig>({ apiKey, baseURL, timeout, model });
}

/**
 * Resolves and instantiates {@link IProvider}s by name.
 *
 * Built-in providers are lazily registered against the target registry on
 * first use (see {@link registerBuiltInProviders}); a caller-supplied
 * registry lets tests prove new providers plug in without touching this
 * class (Open/Closed Principle).
 *
 * @example
 * ```ts
 * const provider = ProviderFactory.create("openai", { apiKey: "sk-..." });
 * ```
 */
export class ProviderFactory {
  /**
   * Creates a provider instance for `name`, resolving its configuration
   * from `config`, the global {@link Aniki} configuration, and environment
   * variables (in that precedence order). Throws {@link ConfigurationError}
   * if `name` is not registered or a required API key cannot be resolved.
   */
  static create(
    name: string,
    config: ProviderConfig = {},
    registry: ProviderRegistry = defaultProviderRegistry,
  ): IProvider {
    registerBuiltInProviders(registry);
    const factory = registry.resolve(name);
    const resolvedConfig = resolveProviderConfig(name, config);
    return factory(resolvedConfig);
  }
}
