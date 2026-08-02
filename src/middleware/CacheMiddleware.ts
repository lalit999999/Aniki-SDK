import { createHash } from "node:crypto";
import { CacheError } from "../core/errors.js";
import type { ILogger } from "../logger/Logger.js";
import type { ProviderResponse } from "../providers/AIProvider.js";
import { BaseMiddleware } from "./Middleware.js";
import type { MiddlewareNext, MiddlewareRequest, MiddlewareResponse } from "./Middleware.js";

/**
 * The contract every cache backend implements for {@link CacheMiddleware}.
 *
 * Deliberately storage-independent and async-friendly, mirroring the
 * SDK's `ISession` pattern, so a Redis- or file-backed store is a drop-in
 * replacement for {@link InMemoryCacheStore} without touching
 * `CacheMiddleware` itself.
 */
export interface ICacheStore {
  /** Returns the value stored under `key`, or `undefined` if absent or expired. */
  get(key: string): Promise<unknown | undefined>;
  /** Stores `value` under `key`, expiring it after `ttlMs` milliseconds. */
  set(key: string, value: unknown, ttlMs: number): Promise<void>;
  /** Removes the entry stored under `key`, if any. */
  delete(key: string): Promise<void>;
  /** Removes every entry. */
  clear(): Promise<void>;
}

/** A single entry held by {@link InMemoryCacheStore}. */
interface CacheEntry {
  readonly value: unknown;
  readonly expiresAt: number;
}

/** Options accepted by the {@link InMemoryCacheStore} constructor. */
export interface InMemoryCacheStoreOptions {
  /** The maximum number of entries to retain. Once exceeded, the least-recently-used entry is evicted. Defaults to `1000`. */
  readonly maxEntries?: number;
  /** Overrides the store's clock. Defaults to `Date.now`. Inject a fake here for deterministic TTL tests. */
  readonly now?: () => number;
}

/**
 * An in-process, {@link Map}-backed {@link ICacheStore}.
 *
 * Expiry is lazy: an expired entry is only actually removed the next time
 * it is looked up via {@link get}, rather than on a background timer. Once
 * {@link InMemoryCacheStoreOptions.maxEntries} is exceeded, the
 * least-recently-used entry (tracked via `Map`'s insertion order, refreshed
 * on every `get`) is evicted to make room.
 *
 * @example
 * ```ts
 * const store = new InMemoryCacheStore({ maxEntries: 500 });
 * await store.set("key", response, 60_000);
 * await store.get("key"); // => response, until it expires or is evicted
 * ```
 */
export class InMemoryCacheStore implements ICacheStore {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: InMemoryCacheStoreOptions = {}) {
    this.maxEntries = options.maxEntries ?? 1000;
    this.now = options.now ?? Date.now;
  }

  async get(key: string): Promise<unknown | undefined> {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }

    // Refresh recency for LRU eviction by reinserting at the end.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  async set(key: string, value: unknown, ttlMs: number): Promise<void> {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });

    if (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey);
      }
    }
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async clear(): Promise<void> {
    this.entries.clear();
  }
}

/** Options accepted by the {@link CacheMiddleware} constructor. */
export interface CacheMiddlewareOptions {
  /** The backend this middleware reads from and writes to. Defaults to a fresh {@link InMemoryCacheStore}. */
  readonly store?: ICacheStore;
  /** How long a cached response stays valid, in milliseconds. Defaults to `300_000` (5 minutes). */
  readonly ttlMs?: number;
  /** Overrides how a cache key is derived from a request. Defaults to a stable SHA-256 hash of `{ model, providerName, messages, tools }`. */
  readonly keyBuilder?: (request: MiddlewareRequest) => string;
  /** When `false`, this middleware is a pass-through: it neither reads nor writes the cache. Defaults to `true`. */
  readonly enabled?: boolean;
  /** When supplied, cache errors are logged through this logger instead of silently degrading. */
  readonly logger?: ILogger;
}

/** Recursively sorts object keys (arrays keep their order) so semantically identical requests hash identically regardless of property insertion order. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/** The default cache key builder: a stable SHA-256 hash of the request's model, provider, messages, and tools. */
function defaultKeyBuilder(request: MiddlewareRequest): string {
  const canonical = canonicalize({
    model: request.model,
    providerName: request.providerName,
    messages: request.messages,
    tools: request.tools,
  });
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/**
 * Serves a cached {@link ProviderResponse} for a repeated request, skipping
 * the provider (and any middleware closer to it) entirely on a hit.
 *
 * Sits above {@link RetryMiddleware} in the default middleware order
 * (`Claude.md` §3.5) so a hit short-circuits before any retry machinery
 * spins up. A response carrying `toolCalls` is never cached — replaying a
 * cached tool call would re-trigger whatever side effect it caused, which
 * this middleware has no way to know is safe to repeat. A cache read or
 * write that throws is caught, wrapped in {@link CacheError} for logging,
 * and degrades to behaving as a miss (for a read) or a no-op (for a
 * write) — a broken cache backend must never fail a run.
 *
 * @example
 * ```ts
 * const middleware = new CacheMiddleware({ ttlMs: 60_000 });
 * ```
 */
export class CacheMiddleware extends BaseMiddleware {
  private readonly store: ICacheStore;
  private readonly ttlMs: number;
  private readonly keyBuilder: (request: MiddlewareRequest) => string;
  private readonly enabled: boolean;
  private readonly logger: ILogger | undefined;

  constructor(options: CacheMiddlewareOptions = {}) {
    super("CacheMiddleware");
    this.store = options.store ?? new InMemoryCacheStore();
    this.ttlMs = options.ttlMs ?? 300_000;
    this.keyBuilder = options.keyBuilder ?? defaultKeyBuilder;
    this.enabled = options.enabled ?? true;
    this.logger = options.logger;
  }

  async execute(request: MiddlewareRequest, next: MiddlewareNext): Promise<MiddlewareResponse> {
    if (!this.enabled) {
      return next(request);
    }

    const key = this.keyBuilder(request);
    const cached = await this.safeGet(key, request.runId);

    if (cached !== undefined) {
      return { response: cached as ProviderResponse, fromCache: true, attempts: 0 };
    }

    const result = await next(request);

    if (!result.response.toolCalls || result.response.toolCalls.length === 0) {
      await this.safeSet(key, result.response, request.runId);
    }

    return result;
  }

  private async safeGet(key: string, runId: string): Promise<unknown> {
    try {
      return await this.store.get(key);
    } catch (cause) {
      const error = new CacheError("get", cause);
      this.logger?.warn(error.message, { runId, operation: error.operation });
      return undefined;
    }
  }

  private async safeSet(key: string, value: ProviderResponse, runId: string): Promise<void> {
    try {
      await this.store.set(key, value, this.ttlMs);
    } catch (cause) {
      const error = new CacheError("set", cause);
      this.logger?.warn(error.message, { runId, operation: error.operation });
    }
  }
}
