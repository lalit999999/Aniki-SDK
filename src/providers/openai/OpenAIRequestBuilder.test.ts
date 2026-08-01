import { describe, expect, it } from "vitest";
import type { ProviderRequest } from "../AIProvider.js";
import { OpenAIRequestBuilder } from "./OpenAIRequestBuilder.js";

const baseRequest: ProviderRequest = {
  model: "gpt-5.5",
  messages: [
    { role: "system", content: "You are helpful." },
    { role: "user", content: "Hi" },
  ],
};

describe("OpenAIRequestBuilder", () => {
  it("builds a minimal request body with no params", () => {
    const body = new OpenAIRequestBuilder().build(baseRequest);

    expect(body).toEqual({
      model: "gpt-5.5",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "Hi" },
      ],
    });
  });

  it("maps generation params onto OpenAI's wire field names", () => {
    const body = new OpenAIRequestBuilder().build({
      ...baseRequest,
      params: { temperature: 0.7, maxTokens: 512, topP: 0.9, stopSequences: ["\n\n"] },
    });

    expect(body).toMatchObject({
      temperature: 0.7,
      max_tokens: 512,
      top_p: 0.9,
      stop: ["\n\n"],
    });
  });

  it("omits param keys that were not provided", () => {
    const body = new OpenAIRequestBuilder().build({
      ...baseRequest,
      params: { temperature: 0.5 },
    });

    expect(body).not.toHaveProperty("max_tokens");
    expect(body).not.toHaveProperty("top_p");
    expect(body).not.toHaveProperty("stop");
  });

  it("adds stream: true for the streaming variant", () => {
    const body = new OpenAIRequestBuilder().buildStream(baseRequest);

    expect(body.stream).toBe(true);
  });
});
