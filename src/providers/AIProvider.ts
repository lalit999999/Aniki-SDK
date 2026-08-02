import { z } from "zod";
import type { Message, ToolCall, ToolDefinition } from "../types/index.js";

/**
 * The normalized provider contract and its supporting types.
 *
 * Every LLM vendor integration (OpenAI, Anthropic, Gemini, Ollama, Groq,
 * OpenRouter, ...) implements {@link IProvider} and lives in its own
 * `src/providers/<vendor>/` folder (e.g. `src/providers/openai/`). Shared,
 * vendor-agnostic abstractions (this file, error taxonomy, HTTP transport,
 * auth strategies, registry, factory) live at `src/providers/` root.
 *
 * Only the normalized shapes declared here — {@link ProviderRequest},
 * {@link ProviderResponse}, {@link ProviderStreamChunk}, {@link TokenUsage},
 * and {@link FinishReason} — ever cross a provider's module boundary. Wire
 * formats specific to a vendor (e.g. OpenAI's chat-completion JSON) are
 * folder-internal and must never be exported from the package's public API.
 */

/** Zod schema validating {@link GenerationParams} ranges. */
export const generationParamsSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  topP: z.number().min(0).max(1).optional(),
  stopSequences: z.array(z.string()).optional(),
});

/** Vendor-agnostic sampling/generation controls for a single request. */
export interface GenerationParams {
  /** Sampling temperature. Typically `0`–`2`. */
  readonly temperature?: number;
  /** Maximum number of tokens to generate. */
  readonly maxTokens?: number;
  /** Nucleus sampling threshold. `0`–`1`. */
  readonly topP?: number;
  /** Sequences that stop generation when encountered. */
  readonly stopSequences?: readonly string[];
}

/** A request for a single completion from an LLM provider. */
export interface ProviderRequest {
  /** The conversation history plus the current turn to send to the model. */
  readonly messages: readonly Message[];
  /** The model identifier to use for this request. */
  readonly model: string;
  /** Optional generation parameters (temperature, max tokens, etc.). */
  readonly params?: GenerationParams;
  /** The tools available to the model for this request, translated by the provider into its own wire format. Omitted entirely when the agent has none. */
  readonly tools?: readonly ToolDefinition[];
}

/**
 * The normalized reason a completion stopped, common to every provider.
 *
 * - `"stop"` — the model reached a natural stopping point or stop sequence.
 * - `"length"` — the configured max token limit was reached.
 * - `"tool_use"` — the model stopped to invoke a tool/function.
 * - `"content_filter"` — content was withheld by a safety filter.
 * - `"error"` — generation stopped because of an error.
 * - `"other"` — any vendor-specific reason not covered above.
 */
export type FinishReason = "stop" | "length" | "tool_use" | "content_filter" | "error" | "other";

/** Normalized token accounting for a single request/response cycle. */
export interface TokenUsage {
  /** Tokens consumed by the input (prompt) side of the request. */
  readonly promptTokens: number;
  /** Tokens generated in the completion. */
  readonly completionTokens: number;
  /** Total tokens (prompt + completion). */
  readonly totalTokens: number;
}

/** A completion returned by an LLM provider. */
export interface ProviderResponse {
  /** The generated assistant message content. */
  readonly content: string;
  /** The model identifier that actually produced this response. */
  readonly model: string;
  /** The vendor's identifier for this completion, when available. */
  readonly id?: string;
  /** Why generation stopped. */
  readonly finishReason?: FinishReason;
  /** Token accounting for this request/response cycle, when available. */
  readonly usage?: TokenUsage;
  /** The tool calls the model requested instead of (or alongside) `content`, when it chose to use a tool. */
  readonly toolCalls?: readonly ToolCall[];
}

/** A single incremental chunk of a streamed completion. */
export interface ProviderStreamChunk {
  /** The incremental text produced since the previous chunk. */
  readonly delta: string;
  /** Present only on the final chunk: why generation stopped. */
  readonly finishReason?: FinishReason;
  /** Present only on the final chunk, when the vendor reports usage for streams. */
  readonly usage?: TokenUsage;
}

/** Declares which optional features a given {@link IProvider} implementation supports. */
export interface ProviderCapabilities {
  /** Whether {@link IProvider.generateStream} yields real incremental chunks. */
  readonly streaming: boolean;
  /** Whether the provider supports invoking tools/functions. */
  readonly toolCalling: boolean;
  /** Whether the provider can be constrained to emit schema-validated structured output. */
  readonly structuredOutput: boolean;
}

/**
 * The contract every LLM vendor integration must implement.
 *
 * Implementations are drop-in interchangeable: given equivalent normalized
 * {@link ProviderRequest} input, every provider returns the same
 * {@link ProviderResponse} shape, the same {@link FinishReason} vocabulary,
 * and throws the same {@link ProviderError} subclasses on failure. This
 * interface intentionally stays scoped to text generation; future modalities
 * (embeddings, images, audio) are added as new, separately segregated
 * interfaces (e.g. `IEmbeddingProvider`) rather than by extending this one.
 */
export interface IProvider {
  /** A human-readable identifier for this provider (e.g. `"openai"`). */
  readonly name: string;
  /** The optional features this provider implementation supports. */
  readonly capabilities: ProviderCapabilities;
  /** Requests a single completion from the underlying model. */
  generate(request: ProviderRequest): Promise<ProviderResponse>;
  /** Requests a streamed completion, yielding incremental chunks as they arrive. */
  generateStream(request: ProviderRequest): AsyncIterable<ProviderStreamChunk>;
}
