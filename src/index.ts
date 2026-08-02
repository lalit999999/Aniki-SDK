/**
 * Aniki-SDK — a provider-agnostic AI Agent SDK.
 *
 * The public surface is grouped below into:
 * Configuration · Core (Agent/Runner/Session) · Tools · Providers ·
 * Middleware · Logging · Errors · Streaming & Output · Types & Events.
 *
 * Within each section, values are exported first, then `export type`,
 * alphabetized. Anything internal to a module (vendor wire-format types,
 * request builders, response parsers, ...) is intentionally not exported
 * here. Test doubles (`MockProvider`, `MockLogger`) ship from the separate
 * `aniki-sdk/testing` entry point instead, so they never reach this surface.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export { Aniki, PROVIDER_API_KEY_ENV_VAR, resolveApiKeyFromEnv } from "./config/Config.js";
export type { AnikiConfigOptions, ProviderName } from "./config/Config.js";
export type { ProviderConfig } from "./config/ProviderConfig.js";

// ---------------------------------------------------------------------------
// Core (Agent / Runner / Session)
// ---------------------------------------------------------------------------

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
export type { RunInput, RunnerEvents, RunnerOptions, RunResult } from "./core/Runner.js";

export { RunStream } from "./core/RunStream.js";
export type { RunStreamOptions } from "./core/RunStream.js";

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export { Tool } from "./tools/Tool.js";
export type { ToolContext, ToolOptions } from "./tools/Tool.js";

export { ToolExecutor } from "./tools/ToolExecutor.js";
export type { ToolExecutorOptions } from "./tools/ToolExecutor.js";

export { ToolRegistry } from "./tools/ToolRegistry.js";

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

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

export { DEFAULT_BASE_URL, OpenAIProvider } from "./providers/openai/OpenAIProvider.js";
export type { OpenAIProviderDependencies } from "./providers/openai/OpenAIProvider.js";

export { ProviderFactory, registerBuiltInProviders } from "./providers/ProviderFactory.js";

export { defaultProviderRegistry, ProviderRegistry } from "./providers/ProviderRegistry.js";
export type { ProviderFactoryFn } from "./providers/ProviderRegistry.js";

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

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export { BaseMiddleware } from "./middleware/Middleware.js";
export type {
  IMiddleware,
  MiddlewareNext,
  MiddlewareRequest,
  MiddlewareResponse,
} from "./middleware/Middleware.js";

export { CacheMiddleware, InMemoryCacheStore } from "./middleware/CacheMiddleware.js";
export type {
  CacheMiddlewareOptions,
  ICacheStore,
  InMemoryCacheStoreOptions,
} from "./middleware/CacheMiddleware.js";

export { LoggingMiddleware } from "./middleware/LoggerMiddleware.js";
export type { LoggingMiddlewareOptions } from "./middleware/LoggerMiddleware.js";

export { MiddlewarePipeline } from "./middleware/MiddlewarePipeline.js";

export { RetryMiddleware } from "./middleware/RetryMiddleware.js";
export type { RetryMiddlewareOptions } from "./middleware/RetryMiddleware.js";

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

export { ConsoleLogger } from "./logger/ConsoleLogger.js";
export type { ConsoleLoggerOptions, ConsoleSink } from "./logger/ConsoleLogger.js";

export { LOG_LEVEL_PRIORITY, NoopLogger, redactFields } from "./logger/Logger.js";
export type { ILogger, LogFields, LogLevel } from "./logger/Logger.js";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export {
  AnikiError,
  CacheError,
  ConfigurationError,
  DuplicateToolError,
  isAnikiError,
  isRetryableError,
  MaxToolIterationsError,
  MiddlewareContractError,
  MiddlewareError,
  MiddlewareExecutionError,
  OutputError,
  OutputParseError,
  OutputProcessingError,
  OutputValidationError,
  ProviderError,
  RetryExhaustedError,
  StreamAbortedError,
  StreamConsumedError,
  StreamError,
  StreamingNotSupportedError,
  ToolError,
  ToolExecutionError,
  ToolInputValidationError,
  ToolNotFoundError,
  ToolOutputValidationError,
  ToolTimeoutError,
  ValidationError,
} from "./core/errors.js";
export type { AnikiErrorJson, ErrorCode } from "./core/errors.js";

// ---------------------------------------------------------------------------
// Streaming & Output
// ---------------------------------------------------------------------------

export { JsonExtractor } from "./parser/JsonExtractor.js";

export { OutputPipeline } from "./parser/OutputPipeline.js";
export type { IOutputProcessor, OutputProcessingContext } from "./parser/OutputPipeline.js";

export { OutputValidator } from "./parser/OutputValidator.js";

export { StreamParser } from "./parser/StreamParser.js";
export type { StreamParserOptions } from "./parser/StreamParser.js";

export { StreamReader } from "./parser/StreamReader.js";
export type { StreamReaderOptions } from "./parser/StreamReader.js";

export { StructuredOutputParser } from "./parser/StructuredOutput.js";
export type { StructuredOutputParserDependencies } from "./parser/StructuredOutput.js";

// ---------------------------------------------------------------------------
// Types & Events
// ---------------------------------------------------------------------------

export { EVENT_NAMES, LEGACY_EVENT_ALIASES } from "./types/events.js";
export type {
  AgentEndEvent,
  AgentErrorEvent,
  AgentStartEvent,
  AnikiEvents,
  BaseEventPayload,
  EventName,
  LlmEndEvent,
  LlmErrorEvent,
  LlmStartEvent,
  MiddlewareErrorEvent,
  TimedEventPayload,
  ToolEndEvent,
  ToolErrorEvent,
  ToolStartEvent,
} from "./types/events.js";

export type {
  Message,
  Role,
  RunMetadata,
  StreamEvent,
  StructuredParseOutcome,
  ToolCall,
  ToolDefinition,
  ToolResult,
} from "./types/index.js";
