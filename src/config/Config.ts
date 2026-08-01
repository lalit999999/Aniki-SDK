import { z } from "zod";
import { ConfigurationError } from "../core/errors.js";

/** LLM vendors the SDK knows how to talk to. */
export type ProviderName = "openai" | "anthropic" | "gemini" | "ollama" | "groq" | "openrouter";

const PROVIDER_NAMES = ["openai", "anthropic", "gemini", "ollama", "groq", "openrouter"] as const;

/** Environment variable each provider's API key is read from when not passed explicitly. */
const PROVIDER_API_KEY_ENV_VAR: Readonly<Record<ProviderName, string>> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  ollama: "OLLAMA_API_KEY",
  groq: "GROQ_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

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
  return process.env[PROVIDER_API_KEY_ENV_VAR[provider]];
}

/** Drops keys whose value is `undefined`, satisfying `exactOptionalPropertyTypes`. */
function omitUndefined<T extends object>(value: { [K in keyof T]?: T[K] | undefined }): T {
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  return Object.fromEntries(entries) as T;
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
      const details = result.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      throw new ConfigurationError(`Invalid Aniki configuration: ${details}`);
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
