import type {
  FinishReason,
  ProviderResponse,
  ProviderStreamChunk,
  TokenUsage,
} from "../AIProvider.js";
import { ProviderResponseError } from "../errors.js";
import { formatZodIssues } from "../../utils/index.js";
import {
  openAIChatCompletionChunkSchema,
  openAIChatCompletionResponseSchema,
  type OpenAIUsage,
} from "./types.js";

const PROVIDER_NAME = "openai";

function mapFinishReason(reason: string): FinishReason {
  switch (reason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "tool_calls":
      return "tool_use";
    case "content_filter":
      return "content_filter";
    default:
      return "other";
  }
}

function mapUsage(usage: OpenAIUsage): TokenUsage {
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
  };
}

function invalidShape(detail: string, cause: unknown): ProviderResponseError {
  return new ProviderResponseError(
    `Unexpected response shape from OpenAI: ${detail}`,
    PROVIDER_NAME,
    false,
    { cause },
  );
}

/**
 * Parses OpenAI's `POST /chat/completions` wire responses — both the
 * buffered, non-streamed JSON body and the SSE stream — into normalized
 * {@link ProviderResponse} / {@link ProviderStreamChunk} values.
 *
 * Every wire payload is validated against its Zod schema before use; a
 * malformed 2xx body raises {@link ProviderResponseError} rather than
 * letting an invalid shape propagate.
 */
export class OpenAIResponseParser {
  /** Parses a complete, non-streamed response body. */
  parse(body: string): ProviderResponse {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (cause) {
      throw invalidShape("response body is not valid JSON", cause);
    }

    const result = openAIChatCompletionResponseSchema.safeParse(parsed);
    if (!result.success) {
      throw invalidShape(formatZodIssues(result.error.issues), parsed);
    }

    const choice = result.data.choices[0];
    if (!choice) {
      throw invalidShape("response contained no choices", parsed);
    }

    return {
      content: choice.message.content ?? "",
      model: result.data.model,
      id: result.data.id,
      ...(choice.finish_reason ? { finishReason: mapFinishReason(choice.finish_reason) } : {}),
      ...(result.data.usage ? { usage: mapUsage(result.data.usage) } : {}),
    };
  }

  /**
   * Parses an OpenAI SSE stream into normalized {@link ProviderStreamChunk}s.
   *
   * Buffers partial lines across chunk boundaries so a single `data: {...}`
   * event split across two underlying byte chunks is still parsed as one
   * JSON event. Recognizes `data: [DONE]` as the stream terminator.
   */
  async *parseStream(byteStream: AsyncIterable<Uint8Array>): AsyncIterable<ProviderStreamChunk> {
    const decoder = new TextDecoder();
    let buffer = "";

    for await (const chunk of byteStream) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      yield* this.processLines(lines);
    }

    if (buffer.trim().length > 0) {
      yield* this.processLines([buffer]);
    }
  }

  private *processLines(lines: readonly string[]): Generator<ProviderStreamChunk> {
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;

      const data = line.slice("data:".length).trim();
      if (data.length === 0 || data === "[DONE]") continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch (cause) {
        throw invalidShape("stream event is not valid JSON", cause);
      }

      const result = openAIChatCompletionChunkSchema.safeParse(parsed);
      if (!result.success) {
        throw invalidShape(formatZodIssues(result.error.issues), parsed);
      }

      const choice = result.data.choices[0];
      if (!choice) continue;

      yield {
        delta: choice.delta.content ?? "",
        ...(choice.finish_reason ? { finishReason: mapFinishReason(choice.finish_reason) } : {}),
        ...(result.data.usage ? { usage: mapUsage(result.data.usage) } : {}),
      };
    }
  }
}
