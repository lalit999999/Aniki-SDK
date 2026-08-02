import { describe, expect, it } from "vitest";
import { deepFreeze, isPlainObject, omitUndefined } from "./object.js";

describe("omitUndefined", () => {
  it("drops keys whose value is undefined", () => {
    expect(omitUndefined({ a: 1, b: undefined })).toEqual({ a: 1 });
  });

  it("keeps falsy-but-defined values", () => {
    expect(omitUndefined({ a: 0, b: "", c: null, d: false })).toEqual({
      a: 0,
      b: "",
      c: null,
      d: false,
    });
  });

  it("returns an empty object when every value is undefined", () => {
    expect(omitUndefined({ a: undefined, b: undefined })).toEqual({});
  });
});

describe("isPlainObject", () => {
  it.each([
    ["a plain object literal", {}, true],
    ["an object with keys", { a: 1 }, true],
    ["null", null, false],
    ["an array", [1, 2], false],
    ["a Date", new Date(), false],
    ["a class instance", new Map(), false],
    ["a string", "hello", false],
    ["a number", 42, false],
  ])("returns %s for %s", (_label, value, expected) => {
    expect(isPlainObject(value)).toBe(expected);
  });
});

describe("deepFreeze", () => {
  it("freezes the top-level object", () => {
    const frozen = deepFreeze({ a: 1 });

    expect(Object.isFrozen(frozen)).toBe(true);
  });

  it("recursively freezes nested plain objects", () => {
    const frozen = deepFreeze({ nested: { retries: 3 } });

    expect(Object.isFrozen(frozen.nested)).toBe(true);
  });

  it("recursively freezes elements of nested arrays", () => {
    const frozen = deepFreeze({ items: [{ id: 1 }] });

    expect(Object.isFrozen(frozen.items)).toBe(true);
    expect(Object.isFrozen(frozen.items[0])).toBe(true);
  });

  it("does not attempt to freeze non-plain-object values it encounters", () => {
    const date = new Date();
    const frozen = deepFreeze({ createdAt: date });

    expect(frozen.createdAt).toBe(date);
  });

  it("returns the same reference it was given", () => {
    const value = { a: 1 };

    expect(deepFreeze(value)).toBe(value);
  });
});
