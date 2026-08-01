/** Settings scoped to a single LLM provider. */
export interface ProviderConfig {
  readonly apiKey?: string;
  readonly baseURL?: string;
  readonly model?: string;
  readonly timeout?: number;
}
