import { describe, expect, it } from "vitest";
import { truncate } from "./string.js";

describe("truncate", () => {
  it("returns the value unchanged when within the length limit", () => {
    expect(truncate("hi", 5)).toBe("hi");
  });

  it("returns the value unchanged when exactly at the length limit", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });

  it("truncates and appends '...' when longer than the limit", () => {
    expect(truncate("hello world", 5)).toBe("hello...");
  });
});
