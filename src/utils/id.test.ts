import { describe, expect, it } from "vitest";
import { generateId } from "./id.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("generateId", () => {
  it("returns a bare UUID when no prefix is given", () => {
    expect(generateId()).toMatch(UUID_PATTERN);
  });

  it("prefixes the UUID with 'prefix_' when given", () => {
    const id = generateId("run");

    expect(id.startsWith("run_")).toBe(true);
    expect(id.slice(4)).toMatch(UUID_PATTERN);
  });

  it("generates unique ids across calls", () => {
    expect(generateId()).not.toBe(generateId());
  });
});
