import type { Message } from "../types/index.js";

/** A request for a single completion from an LLM provider. */
export interface ProviderRequest {
  /** The conversation history plus the current turn to send to the model. */
  readonly messages: readonly Message[];
  /** The model identifier to use for this request. */
  readonly model: string;
}

/** A completion returned by an LLM provider. */
export interface ProviderResponse {
  /** The generated assistant message content. */
  readonly content: string;
}

/**
 * The contract every LLM vendor integration (OpenAI, Anthropic, Gemini,
 * Ollama, Groq, OpenRouter, ...) must implement.
 *
 * This is a method-signature-only contract; concrete vendor implementations
 * are added in later tasks and must not require changes to this interface
 * (Open/Closed Principle).
 */
export interface IProvider {
  /** A human-readable identifier for this provider (e.g. `"openai"`). */
  readonly name: string;
  /** Requests a single completion from the underlying model. */
  generate(request: ProviderRequest): Promise<ProviderResponse>;
}
