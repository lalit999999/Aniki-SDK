import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Tool } from "./Tool.js";
import { ToolRegistry } from "./ToolRegistry.js";
import { DuplicateToolError, ToolNotFoundError } from "../core/errors.js";

function makeTool(name: string): Tool {
  return new Tool({
    name,
    description: `Tool named ${name}.`,
    input: z.object({}),
    execute: () => ({}),
  });
}

describe("ToolRegistry", () => {
  it("starts empty when constructed with no tools", () => {
    const registry = new ToolRegistry();
    expect(registry.size).toBe(0);
    expect(registry.list()).toEqual([]);
    expect(registry.names()).toEqual([]);
  });

  it("pre-populates from an iterable passed to the constructor", () => {
    const a = makeTool("a");
    const b = makeTool("b");
    const registry = new ToolRegistry([a, b]);

    expect(registry.size).toBe(2);
    expect(registry.get("a")).toBe(a);
    expect(registry.get("b")).toBe(b);
  });

  it("registers a tool and finds it by name", () => {
    const registry = new ToolRegistry();
    const tool = makeTool("get_weather");

    registry.register(tool);

    expect(registry.has("get_weather")).toBe(true);
    expect(registry.get("get_weather")).toBe(tool);
    expect(registry.size).toBe(1);
  });

  it("throws DuplicateToolError when registering a name twice", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("get_weather"));

    expect(() => registry.register(makeTool("get_weather"))).toThrow(DuplicateToolError);
    expect(registry.size).toBe(1);
  });

  it("registerAll adds every tool atomically on success", () => {
    const registry = new ToolRegistry();
    registry.registerAll([makeTool("a"), makeTool("b"), makeTool("c")]);

    expect([...registry.names()].sort()).toEqual(["a", "b", "c"]);
  });

  it("registerAll rolls back entirely when any entry collides with the registry", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("a"));

    expect(() => registry.registerAll([makeTool("b"), makeTool("a")])).toThrow(DuplicateToolError);
    expect(registry.has("b")).toBe(false);
    expect(registry.names()).toEqual(["a"]);
  });

  it("registerAll rolls back entirely when two incoming entries collide with each other", () => {
    const registry = new ToolRegistry();

    expect(() => registry.registerAll([makeTool("a"), makeTool("a")])).toThrow(DuplicateToolError);
    expect(registry.size).toBe(0);
  });

  it("get returns undefined for an unknown name", () => {
    const registry = new ToolRegistry();
    expect(registry.get("missing")).toBeUndefined();
  });

  it("getOrThrow throws ToolNotFoundError for an unknown name", () => {
    const registry = new ToolRegistry();
    expect(() => registry.getOrThrow("missing")).toThrow(ToolNotFoundError);
  });

  it("getOrThrow returns the tool for a known name", () => {
    const registry = new ToolRegistry();
    const tool = makeTool("get_weather");
    registry.register(tool);

    expect(registry.getOrThrow("get_weather")).toBe(tool);
  });

  it("unregister removes a tool and reports whether one was removed", () => {
    const registry = new ToolRegistry();
    registry.register(makeTool("get_weather"));

    expect(registry.unregister("get_weather")).toBe(true);
    expect(registry.has("get_weather")).toBe(false);
    expect(registry.unregister("get_weather")).toBe(false);
  });

  it("clear removes every registered tool", () => {
    const registry = new ToolRegistry([makeTool("a"), makeTool("b")]);
    registry.clear();

    expect(registry.size).toBe(0);
    expect(registry.list()).toEqual([]);
  });

  it("toDefinitions returns a ToolDefinition per registered tool", () => {
    const registry = new ToolRegistry([makeTool("a"), makeTool("b")]);
    const definitions = registry.toDefinitions();

    expect(definitions).toHaveLength(2);
    expect(definitions.map((d) => d.name).sort()).toEqual(["a", "b"]);
    expect(definitions[0]).toHaveProperty("parameters");
  });

  it("mutating the array returned by list() does not affect the registry", () => {
    const registry = new ToolRegistry([makeTool("a")]);
    const list = registry.list() as Tool[];
    list.push(makeTool("b"));

    expect(registry.size).toBe(1);
    expect(registry.names()).toEqual(["a"]);
  });

  it("mutating the array returned by names() does not affect the registry", () => {
    const registry = new ToolRegistry([makeTool("a")]);
    const names = registry.names() as string[];
    names.push("b");

    expect(registry.names()).toEqual(["a"]);
  });
});
