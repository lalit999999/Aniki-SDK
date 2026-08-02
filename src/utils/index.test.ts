import { describe, expect, it } from "vitest";
import {
  deepFreeze,
  formatZodIssues,
  generateId,
  isPlainObject,
  omitUndefined,
  sleep,
  truncate,
  withTimeout,
} from "./index.js";

describe("utils barrel", () => {
  it("re-exports omitUndefined at its original signature", () => {
    expect(omitUndefined({ a: 1, b: undefined })).toEqual({ a: 1 });
  });

  it("re-exports formatZodIssues at its original signature", () => {
    expect(formatZodIssues([{ path: ["a"], message: "Required" }])).toBe("a: Required");
  });

  it("re-exports every other helper module", () => {
    expect(typeof isPlainObject).toBe("function");
    expect(typeof deepFreeze).toBe("function");
    expect(typeof generateId).toBe("function");
    expect(typeof truncate).toBe("function");
    expect(typeof sleep).toBe("function");
    expect(typeof withTimeout).toBe("function");
  });
});
