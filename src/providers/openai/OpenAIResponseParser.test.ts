import { describe, expect, it } from "vitest";
import { ProviderResponseError } from "../errors.js";
import { OpenAIResponseParser } from "./OpenAIResponseParser.js";

async function* toByteStream(chunks: string[]): AsyncIterable<Uint8Array> {
  const encoder = new TextEncoder();
  for (const chunk of chunks) yield encoder.encode(chunk);
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}

describe("OpenAIResponseParser", () => {
  describe("parse", () => {
    it("parses a well-formed non-streamed response", () => {
      const body = JSON.stringify({
        id: "chatcmpl-1",
        model: "gpt-5.5",
        choices: [
          { index: 0, message: { role: "assistant", content: "Hello!" }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      const response = new OpenAIResponseParser().parse(body);

      expect(response).toEqual({
        content: "Hello!",
        model: "gpt-5.5",
        id: "chatcmpl-1",
        finishReason: "stop",
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      });
    });

    it.each([
      ["stop", "stop"],
      ["length", "length"],
      ["tool_calls", "tool_use"],
      ["content_filter", "content_filter"],
      ["something_vendor_specific", "other"],
    ])("maps finish_reason %s to %s", (wire, normalized) => {
      const body = JSON.stringify({
        id: "chatcmpl-1",
        model: "gpt-5.5",
        choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: wire }],
      });

      const response = new OpenAIResponseParser().parse(body);

      expect(response.finishReason).toBe(normalized);
    });

    it("throws ProviderResponseError for invalid JSON", () => {
      expect(() => new OpenAIResponseParser().parse("not json")).toThrow(ProviderResponseError);
    });

    it("throws ProviderResponseError when the body fails schema validation", () => {
      expect(() => new OpenAIResponseParser().parse(JSON.stringify({ foo: "bar" }))).toThrow(
        ProviderResponseError,
      );
    });

    it("throws ProviderResponseError when there are no choices", () => {
      const body = JSON.stringify({ id: "chatcmpl-1", model: "gpt-5.5", choices: [] });

      expect(() => new OpenAIResponseParser().parse(body)).toThrow(ProviderResponseError);
    });
  });

  describe("parseStream", () => {
    it("parses SSE events into normalized chunks and stops at [DONE]", async () => {
      const events = [
        `data: ${JSON.stringify({ id: "1", model: "gpt-5.5", choices: [{ index: 0, delta: { content: "Hel" }, finish_reason: null }] })}\n\n`,
        `data: ${JSON.stringify({ id: "1", model: "gpt-5.5", choices: [{ index: 0, delta: { content: "lo" }, finish_reason: "stop" }] })}\n\n`,
        `data: [DONE]\n\n`,
      ];

      const chunks = await collect(new OpenAIResponseParser().parseStream(toByteStream(events)));

      expect(chunks).toEqual([{ delta: "Hel" }, { delta: "lo", finishReason: "stop" }]);
    });

    it("reassembles a single SSE event split across two underlying byte chunks", async () => {
      const fullEvent = `data: ${JSON.stringify({
        id: "1",
        model: "gpt-5.5",
        choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: "stop" }],
      })}\n\n`;
      const splitPoint = Math.floor(fullEvent.length / 2);
      const parts = [fullEvent.slice(0, splitPoint), fullEvent.slice(splitPoint)];

      const chunks = await collect(new OpenAIResponseParser().parseStream(toByteStream(parts)));

      expect(chunks).toEqual([{ delta: "Hello", finishReason: "stop" }]);
    });

    it("throws ProviderResponseError when a stream event fails schema validation", async () => {
      const events = [`data: ${JSON.stringify({ foo: "bar" })}\n\n`];

      await expect(
        collect(new OpenAIResponseParser().parseStream(toByteStream(events))),
      ).rejects.toThrow(ProviderResponseError);
    });

    it("throws ProviderResponseError when a stream event is not valid JSON", async () => {
      const events = ["data: not json at all\n\n"];

      await expect(
        collect(new OpenAIResponseParser().parseStream(toByteStream(events))),
      ).rejects.toThrow(ProviderResponseError);
    });

    it("processes a trailing SSE event with no terminating newline", async () => {
      const payload = JSON.stringify({
        id: "chatcmpl-1",
        model: "gpt-5.5",
        choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: null }],
      });
      // No trailing "\n\n" — this line only surfaces via the post-loop flush.
      const events = [`data: ${payload}`];

      const chunks = await collect(new OpenAIResponseParser().parseStream(toByteStream(events)));

      expect(chunks).toEqual([{ delta: "Hi" }]);
    });

    it("skips a stream event whose choices array is empty", async () => {
      const emptyChoices = JSON.stringify({ id: "chatcmpl-1", model: "gpt-5.5", choices: [] });
      const finalEvent = JSON.stringify({
        id: "chatcmpl-1",
        model: "gpt-5.5",
        choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: "stop" }],
      });
      const events = [`data: ${emptyChoices}\n\ndata: ${finalEvent}\n\n`];

      const chunks = await collect(new OpenAIResponseParser().parseStream(toByteStream(events)));

      expect(chunks).toEqual([{ delta: "Hi", finishReason: "stop" }]);
    });
  });
});
