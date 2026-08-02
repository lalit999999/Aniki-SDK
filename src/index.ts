export { Aniki, resolveApiKeyFromEnv, PROVIDER_API_KEY_ENV_VAR } from "./config/Config.js";
export type { AnikiConfigOptions, ProviderName } from "./config/Config.js";
export type { ProviderConfig } from "./config/ProviderConfig.js";
export {
  AnikiError,
  ConfigurationError,
  DuplicateToolError,
  MaxToolIterationsError,
  OutputError,
  OutputParseError,
  OutputProcessingError,
  OutputValidationError,
  ProviderError,
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

export { RunStream } from "./core/RunStream.js";
export type { RunStreamOptions } from "./core/RunStream.js";

export { JsonExtractor } from "./parser/JsonExtractor.js";

export { OutputValidator } from "./parser/OutputValidator.js";

export { StructuredOutputParser } from "./parser/StructuredOutput.js";
export type { StructuredOutputParserDependencies } from "./parser/StructuredOutput.js";

export { OutputPipeline } from "./parser/OutputPipeline.js";
export type { IOutputProcessor, OutputProcessingContext } from "./parser/OutputPipeline.js";

export { StreamReader } from "./parser/StreamReader.js";
export type { StreamReaderOptions } from "./parser/StreamReader.js";

export { StreamParser } from "./parser/StreamParser.js";
export type { StreamParserOptions } from "./parser/StreamParser.js";

export { Tool } from "./tools/Tool.js";
export type { ToolContext, ToolOptions } from "./tools/Tool.js";

export { ToolExecutor } from "./tools/ToolExecutor.js";
export type { ToolExecutorOptions } from "./tools/ToolExecutor.js";

export { ToolRegistry } from "./tools/ToolRegistry.js";

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
