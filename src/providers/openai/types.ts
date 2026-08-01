import { z } from "zod";

/**
 * OpenAI wire-format types and their validating Zod schemas.
 *
 * Everything in this file describes OpenAI's own JSON shapes exactly as
 * they appear on the wire. None of it is exported from the package's public
 * API (see `src/index.ts`) — callers only ever see the normalized shapes in
 * `src/providers/AIProvider.ts`.
 */

/** A single message in an OpenAI chat-completion request. */
export interface OpenAIChatMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
}

/** The request body sent to `POST /chat/completions`. */
export interface OpenAIChatCompletionRequestBody {
  readonly model: string;
  readonly messages: readonly OpenAIChatMessage[];
  readonly temperature?: number;
  readonly max_tokens?: number;
  readonly top_p?: number;
  readonly stop?: readonly string[];
  readonly stream?: boolean;
}

/** Token usage as reported by OpenAI. */
export const openAIUsageSchema = z.object({
  prompt_tokens: z.number(),
  completion_tokens: z.number(),
  total_tokens: z.number(),
});
export type OpenAIUsage = z.infer<typeof openAIUsageSchema>;

/** A single choice in a non-streamed chat-completion response. */
export const openAIChatCompletionChoiceSchema = z.object({
  index: z.number(),
  message: z.object({
    role: z.string(),
    content: z.string().nullable(),
  }),
  finish_reason: z.string().nullable(),
});

/** The full, non-streamed `POST /chat/completions` response body. */
export const openAIChatCompletionResponseSchema = z.object({
  id: z.string(),
  model: z.string(),
  choices: z.array(openAIChatCompletionChoiceSchema),
  usage: openAIUsageSchema.optional(),
});
export type OpenAIChatCompletionResponse = z.infer<typeof openAIChatCompletionResponseSchema>;

/** A single choice within one SSE stream chunk. */
export const openAIChatCompletionChunkChoiceSchema = z.object({
  index: z.number(),
  delta: z.object({
    content: z.string().optional(),
  }),
  finish_reason: z.string().nullable().optional(),
});

/** The JSON payload of a single `data:` SSE event in a streamed completion. */
export const openAIChatCompletionChunkSchema = z.object({
  id: z.string(),
  model: z.string(),
  choices: z.array(openAIChatCompletionChunkChoiceSchema),
  usage: openAIUsageSchema.optional(),
});
export type OpenAIChatCompletionChunk = z.infer<typeof openAIChatCompletionChunkSchema>;

/** OpenAI's standard error envelope, returned on non-2xx responses. */
export const openAIErrorResponseSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string().optional(),
    param: z.string().nullable().optional(),
    code: z.string().nullable().optional(),
  }),
});
export type OpenAIErrorResponse = z.infer<typeof openAIErrorResponseSchema>;
