import { z } from "zod";
import { ConfigurationError } from "../core/errors.js";
import { formatZodIssues, omitUndefined } from "../utils/index.js";

/** LLM vendors the SDK knows how to talk to. */
export type ProviderName = "openai" | "anthropic" | "gemini" | "ollama" | "groq" | "openrouter";

const PROVIDER_NAMES = ["openai", "anthropic", "gemini", "ollama", "groq", "openrouter"] as const;

/** Environment variable each provider's API key is read from when not passed explicitly. */
export const PROVIDER_API_KEY_ENV_VAR: Readonly<Record<ProviderName, string>> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  ollama: "OLLAMA_API_KEY",
  groq: "GROQ_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

/**
 * Reads `provider`'s API key from its designated environment variable
 * (see {@link PROVIDER_API_KEY_ENV_VAR}), or `undefined` if unset.
 */
export function resolveApiKeyFromEnv(provider: ProviderName): string | undefined {
  return process.env[PROVIDER_API_KEY_ENV_VAR[provider]];
}

/** Options accepted by {@link AnikiSDK.configure}. */
export interface AnikiConfigOptions {
  readonly provider?: ProviderName;
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly timeout?: number;
  readonly retryCount?: number;
  readonly defaultModel?: string;
  readonly defaultProvider?: ProviderName;
}

const configSchema = z.object({
  provider: z.enum(PROVIDER_NAMES).optional(),
  apiKey: z.string().min(1).optional(),
  baseURL: z.string().min(1).optional(),
  timeout: z.number().positive().optional(),
  retryCount: z.number().positive().optional(),
  defaultModel: z.string().min(1).optional(),
  defaultProvider: z.enum(PROVIDER_NAMES).optional(),
});

function resolveApiKeyFallback(config: AnikiConfigOptions): string | undefined {
  const provider = config.provider ?? config.defaultProvider;
  if (!provider) return undefined;
  return resolveApiKeyFromEnv(provider);
}

/**
 * Holds the SDK's global configuration. Access the shared instance via the
 * exported {@link Aniki} singleton rather than constructing this directly.
 */
export class AnikiSDK {
  private config: AnikiConfigOptions = {};

  /**
   * Validates and merges the given options into the current configuration.
   * Throws {@link ConfigurationError} if the input shape is invalid.
   */
  configure(options: AnikiConfigOptions): void {
    const result = configSchema.safeParse(options);
    if (!result.success) {
      throw new ConfigurationError(
        `Invalid Aniki configuration: ${formatZodIssues(result.error.issues)}`,
      );
    }

    const merged = omitUndefined<AnikiConfigOptions>({ ...this.config, ...result.data });
    const apiKey = merged.apiKey ?? resolveApiKeyFallback(merged);

    this.config = apiKey !== undefined ? { ...merged, apiKey } : merged;
  }

  /** Returns the current configuration. The returned object is read-only. */
  getConfig(): Readonly<AnikiConfigOptions> {
    return Object.freeze({ ...this.config });
  }
}

/** Shared global configuration instance for the SDK. */
export const Aniki = new AnikiSDK();
