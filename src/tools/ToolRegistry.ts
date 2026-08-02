import { DuplicateToolError, ToolNotFoundError } from "../core/errors.js";
import type { ToolDefinition } from "../types/tool.js";
import { Guard } from "../validation/Guard.js";
import { Tool } from "./Tool.js";

/**
 * A `Map`-backed store of {@link Tool}s, keyed by name for O(1) lookup.
 *
 * Enforces unique tool names: {@link register} and {@link registerAll} throw
 * {@link DuplicateToolError} rather than silently overwriting an existing
 * entry. `registerAll` is atomic — either every tool is added or none are.
 *
 * @example
 * ```ts
 * const registry = new ToolRegistry([weatherTool]);
 * registry.register(searchTool);
 * registry.getOrThrow("get_weather"); // weatherTool
 * registry.toDefinitions(); // provider-agnostic definitions for both tools
 * ```
 */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  /** Constructs a registry, optionally pre-populated with `tools`. Throws {@link DuplicateToolError} on a name collision. */
  constructor(tools: Iterable<Tool> = []) {
    this.registerAll(tools);
  }

  /** Registers `tool`. Throws {@link DuplicateToolError} if its name is already registered. */
  register(tool: Tool): void {
    Guard.assertInstanceOf(tool, Tool, "ToolRegistry.register(tool)");
    if (this.tools.has(tool.name)) {
      throw new DuplicateToolError(tool.name);
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * Registers every tool in `tools`. Atomic: if any name collides (against
   * the current registry state or another entry in `tools`), none of them
   * are added and {@link DuplicateToolError} is thrown for the first collision.
   */
  registerAll(tools: Iterable<Tool>): void {
    Guard.assertDefined(tools, "ToolRegistry.registerAll(tools)");
    const incoming = [...tools];
    const seen = new Set<string>();

    for (const tool of incoming) {
      if (this.tools.has(tool.name) || seen.has(tool.name)) {
        throw new DuplicateToolError(tool.name);
      }
      seen.add(tool.name);
    }

    for (const tool of incoming) {
      this.tools.set(tool.name, tool);
    }
  }

  /** Returns the tool named `name`, or `undefined` if none is registered. */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** Returns the tool named `name`. Throws {@link ToolNotFoundError} if none is registered. */
  getOrThrow(name: string): Tool {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new ToolNotFoundError(name);
    }
    return tool;
  }

  /** Returns whether a tool named `name` is registered. */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** Returns a defensive copy of every registered tool. */
  list(): readonly Tool[] {
    return [...this.tools.values()];
  }

  /** Returns a defensive copy of every registered tool's name. */
  names(): readonly string[] {
    return [...this.tools.keys()];
  }

  /** Removes the tool named `name`. Returns whether a tool was actually removed. */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /** Removes every registered tool. */
  clear(): void {
    this.tools.clear();
  }

  /** The number of registered tools. */
  get size(): number {
    return this.tools.size;
  }

  /** Returns every registered tool's provider-agnostic {@link ToolDefinition}. */
  toDefinitions(): readonly ToolDefinition[] {
    return this.list().map((tool) => tool.toDefinition());
  }
}
