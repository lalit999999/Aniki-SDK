import { describe, expect, it } from "vitest";
import { BearerAuthStrategy, HeaderAuthStrategy, NoAuthStrategy } from "./AuthStrategy.js";

describe("BearerAuthStrategy", () => {
  it("returns an Authorization bearer header", () => {
    const strategy = new BearerAuthStrategy("sk-test-123");

    expect(strategy.getHeaders()).toEqual({ Authorization: "Bearer sk-test-123" });
  });
});

describe("HeaderAuthStrategy", () => {
  it("returns the api key under the given header name", () => {
    const strategy = new HeaderAuthStrategy("x-api-key", "sk-test-123");

    expect(strategy.getHeaders()).toEqual({ "x-api-key": "sk-test-123" });
  });
});

describe("NoAuthStrategy", () => {
  it("returns no headers", () => {
    const strategy = new NoAuthStrategy();

    expect(strategy.getHeaders()).toEqual({});
  });
});
