import type { ProviderRequest } from "../AIProvider.js";
import type { OpenAIChatCompletionRequestBody, OpenAIChatMessage } from "./types.js";

/**
 * Translates a normalized {@link ProviderRequest} into OpenAI's
 * `POST /chat/completions` wire body.
 *
 * Field mapping: `maxTokens` → `max_tokens`, `stopSequences` → `stop`,
 * `temperature`/`topP` pass through unchanged.
 */
export class OpenAIRequestBuilder {
  /** Builds a non-streaming chat-completion request body. */
  build(request: ProviderRequest): OpenAIChatCompletionRequestBody {
    return this.buildBase(request);
  }

  /** Builds a streaming (`stream: true`) chat-completion request body. */
  buildStream(request: ProviderRequest): OpenAIChatCompletionRequestBody {
    return { ...this.buildBase(request), stream: true };
  }

  private buildBase(request: ProviderRequest): OpenAIChatCompletionRequestBody {
    const messages: OpenAIChatMessage[] = request.messages.map((message) => ({
      role: message.role,
      content: message.content,
    }));

    const params = request.params;
    return {
      model: request.model,
      messages,
      ...(params?.temperature !== undefined ? { temperature: params.temperature } : {}),
      ...(params?.maxTokens !== undefined ? { max_tokens: params.maxTokens } : {}),
      ...(params?.topP !== undefined ? { top_p: params.topP } : {}),
      ...(params?.stopSequences !== undefined ? { stop: params.stopSequences } : {}),
    };
  }
}
