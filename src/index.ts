export { Aniki, resolveApiKeyFromEnv, PROVIDER_API_KEY_ENV_VAR } from "./config/Config.js";
export type { AnikiConfigOptions, ProviderName } from "./config/Config.js";
export type { ProviderConfig } from "./config/ProviderConfig.js";
export { ConfigurationError, ProviderError, ValidationError } from "./core/errors.js";

export { Agent } from "./core/Agent.js";
export type { AgentOptions } from "./core/Agent.js";

export { Context } from "./core/Context.js";
export type { ContextOptions } from "./core/Context.js";

export { EventEmitter } from "./core/EventEmitter.js";
export type { EventMap, Listener } from "./core/EventEmitter.js";

export { Memory } from "./core/Memory.js";

export { InMemorySession } from "./core/Session.js";
export type { ISession } from "./core/Session.js";

export { Runner } from "./core/Runner.js";
export type { RunInput, RunResult, RunnerEvents } from "./core/Runner.js";

export type {
  FinishReason,
  GenerationParams,
  IProvider,
  ProviderCapabilities,
  ProviderRequest,
  ProviderResponse,
  ProviderStreamChunk,
  TokenUsage,
} from "./providers/AIProvider.js";

export {
  AuthenticationError,
  InvalidRequestError,
  ModelNotFoundError,
  ProviderConnectionError,
  ProviderResponseError,
  ProviderTimeoutError,
  RateLimitError,
} from "./providers/errors.js";
export type { ProviderErrorDetails, RateLimitErrorDetails } from "./providers/errors.js";

export {
  BearerAuthStrategy,
  HeaderAuthStrategy,
  NoAuthStrategy,
} from "./providers/auth/AuthStrategy.js";
export type { IAuthStrategy } from "./providers/auth/AuthStrategy.js";

export { FetchHttpClient } from "./providers/http/HttpClient.js";
export type {
  FetchHttpClientOptions,
  HttpMethod,
  HttpRequestOptions,
  HttpResponse,
  HttpStreamResponse,
  IHttpClient,
} from "./providers/http/HttpClient.js";

export { defaultProviderRegistry, ProviderRegistry } from "./providers/ProviderRegistry.js";
export type { ProviderFactoryFn } from "./providers/ProviderRegistry.js";

export { ProviderFactory } from "./providers/ProviderFactory.js";
export { registerBuiltInProviders } from "./providers/ProviderFactory.js";

export { DEFAULT_BASE_URL, OpenAIProvider } from "./providers/openai/OpenAIProvider.js";
export type { OpenAIProviderDependencies } from "./providers/openai/OpenAIProvider.js";

export type { Message, Role } from "./types/index.js";
