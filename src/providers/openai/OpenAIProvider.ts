import { z } from "zod";
import type { ProviderConfig } from "../../config/ProviderConfig.js";
import { ConfigurationError } from "../../core/errors.js";
import { formatZodIssues } from "../../utils/index.js";
import type {
  IProvider,
  ProviderCapabilities,
  ProviderRequest,
  ProviderResponse,
  ProviderStreamChunk,
} from "../AIProvider.js";
import { BearerAuthStrategy, type IAuthStrategy } from "../auth/AuthStrategy.js";
import { FetchHttpClient, type IHttpClient } from "../http/HttpClient.js";
import { OpenAIErrorTranslator } from "./OpenAIErrorTranslator.js";
import { OpenAIRequestBuilder } from "./OpenAIRequestBuilder.js";
import { OpenAIResponseParser } from "./OpenAIResponseParser.js";

/** The default OpenAI API base URL, used when {@link ProviderConfig.baseURL} is omitted. */
export const DEFAULT_BASE_URL = "https://api.openai.com/v1";

const DEFAULT_TIMEOUT_MS = 30000;
const CHAT_COMPLETIONS_PATH = "/chat/completions";

const openAIProviderConfigSchema = z.object({
  apiKey: z.string().min(1),
  baseURL: z.string().min(1).optional(),
  timeout: z.number().positive().optional(),
});

/** Collaborators {@link OpenAIProvider} accepts via dependency injection. */
export interface OpenAIProviderDependencies {
  /** The HTTP transport to issue requests through. Defaults to a {@link FetchHttpClient}. */
  readonly httpClient?: IHttpClient;
  /** The auth strategy to attach credentials with. Defaults to a {@link BearerAuthStrategy}. */
  readonly authStrategy?: IAuthStrategy;
}

async function drain(byteStream: AsyncIterable<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of byteStream) text += decoder.decode(chunk, { stream: true });
  text += decoder.decode();
  return text;
}

/**
 * The OpenAI implementation of {@link IProvider}.
 *
 * Composes an {@link OpenAIRequestBuilder}, {@link OpenAIResponseParser},
 * {@link OpenAIErrorTranslator}, an injected {@link IHttpClient}, and an
 * injected {@link IAuthStrategy} — no inheritance, no vendor SDK, only
 * native `fetch` behind the shared transport abstraction.
 *
 * @example
 * ```ts
 * const provider = new OpenAIProvider({ apiKey: process.env.OPENAI_API_KEY });
 * const response = await provider.generate({
 *   model: "gpt-5.5",
 *   messages: [{ role: "user", content: "Hi" }],
 * });
 * ```
 */
export class OpenAIProvider implements IProvider {
  readonly name = "openai";
  readonly capabilities: ProviderCapabilities = {
    streaming: true,
    toolCalling: false,
    structuredOutput: false,
  };

  private readonly baseURL: string;
  private readonly timeoutMs: number;
  private readonly httpClient: IHttpClient;
  private readonly authStrategy: IAuthStrategy;
  private readonly requestBuilder = new OpenAIRequestBuilder();
  private readonly responseParser = new OpenAIResponseParser();
  private readonly errorTranslator = new OpenAIErrorTranslator();

  /** Constructs an OpenAIProvider. Throws {@link ConfigurationError} if `config` is invalid. */
  constructor(config: ProviderConfig, deps: OpenAIProviderDependencies = {}) {
    const result = openAIProviderConfigSchema.safeParse(config);
    if (!result.success) {
      throw new ConfigurationError(
        `Invalid OpenAI provider configuration: ${formatZodIssues(result.error.issues)}`,
      );
    }

    this.baseURL = result.data.baseURL ?? DEFAULT_BASE_URL;
    this.timeoutMs = result.data.timeout ?? DEFAULT_TIMEOUT_MS;
    this.httpClient =
      deps.httpClient ??
      new FetchHttpClient({ providerName: this.name, defaultTimeoutMs: this.timeoutMs });
    this.authStrategy = deps.authStrategy ?? new BearerAuthStrategy(result.data.apiKey);
  }

  /** Requests a single completion from the underlying model. */
  async generate(request: ProviderRequest): Promise<ProviderResponse> {
    const body = this.requestBuilder.build(request);
    const response = await this.httpClient.request({
      method: "POST",
      url: `${this.baseURL}${CHAT_COMPLETIONS_PATH}`,
      headers: this.headers(),
      body: JSON.stringify(body),
      timeoutMs: this.timeoutMs,
    });

    if (response.status < 200 || response.status >= 300) {
      this.errorTranslator.translate(response.status, response.body, response.headers);
    }

    return this.responseParser.parse(response.body);
  }

  /** Requests a streamed completion, yielding incremental chunks as they arrive. */
  async *generateStream(request: ProviderRequest): AsyncIterable<ProviderStreamChunk> {
    const body = this.requestBuilder.buildStream(request);
    const response = await this.httpClient.requestStream({
      method: "POST",
      url: `${this.baseURL}${CHAT_COMPLETIONS_PATH}`,
      headers: this.headers(),
      body: JSON.stringify(body),
      timeoutMs: this.timeoutMs,
    });

    if (response.status < 200 || response.status >= 300) {
      const bodyText = await drain(response.body);
      this.errorTranslator.translate(response.status, bodyText, response.headers);
    }

    yield* this.responseParser.parseStream(response.body);
  }

  private headers(): Readonly<Record<string, string>> {
    return { "content-type": "application/json", ...this.authStrategy.getHeaders() };
  }
}
