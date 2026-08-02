import { describe, expect, it } from "vitest";
import { z } from "zod";
import { formatZodIssues } from "./zod.js";

describe("formatZodIssues", () => {
  it("formats a single nested-path issue", () => {
    const result = z.object({ user: z.object({ email: z.string() }) }).safeParse({ user: {} });
    if (result.success) throw new Error("expected failure");

    expect(formatZodIssues(result.error.issues)).toContain("user.email:");
  });

  it("joins multiple issues with '; '", () => {
    const result = z
      .object({ a: z.string(), b: z.number() })
      .safeParse({ a: 1, b: "x" });
    if (result.success) throw new Error("expected failure");

    const formatted = formatZodIssues(result.error.issues);

    expect(formatted.split("; ")).toHaveLength(2);
  });

  it("falls back to '(root)' when an issue's path is empty", () => {
    const formatted = formatZodIssues([{ path: [], message: "Invalid input" }]);

    expect(formatted).toBe("(root): Invalid input");
  });
});
