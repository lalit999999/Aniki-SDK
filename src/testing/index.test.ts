import { describe, expect, it } from "vitest";
import { MockLogger, MockProvider } from "./index.js";

describe("testing barrel", () => {
  it("exports MockProvider and MockLogger", () => {
    expect(new MockProvider()).toBeInstanceOf(MockProvider);
    expect(new MockLogger()).toBeInstanceOf(MockLogger);
  });
});
