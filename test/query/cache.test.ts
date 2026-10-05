import { describe, it, expect, vi } from "vitest";
import { QueryCache } from "../../src/query/cache.js";

describe("QueryCache", () => {
  it("stores and retrieves a value", () => {
    const cache = new QueryCache();
    cache.set("key1", { data: "hello" }, 60);
    expect(cache.get("key1")).toEqual({ data: "hello" });
  });

  it("returns undefined for missing keys", () => {
    const cache = new QueryCache();
    expect(cache.get("nonexistent")).toBeUndefined();
  });

  it("expires entries after TTL", () => {
    const cache = new QueryCache();
    vi.useFakeTimers();
    cache.set("key1", "value", 1);
    expect(cache.get("key1")).toBe("value");

    vi.advanceTimersByTime(1500);
    expect(cache.get("key1")).toBeUndefined();
    vi.useRealTimers();
  });

  it("invalidates a specific key", () => {
    const cache = new QueryCache();
    cache.set("key1", "value", 60);
    cache.invalidate("key1");
    expect(cache.get("key1")).toBeUndefined();
  });

  it("clears all entries", () => {
    const cache = new QueryCache();
    cache.set("a", 1, 60);
    cache.set("b", 2, 60);
    expect(cache.size).toBe(2);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("invalidates entries by predicate", () => {
    const cache = new QueryCache();
    cache.set("k1", "v1", 60, { sql: "SELECT * WHERE {{region}}" });
    cache.set("k2", "v2", 60, { sql: "SELECT * WHERE {{status}}" });
    cache.set("k3", "v3", 60, { sql: "SELECT 1" });

    cache.invalidateByPredicate((_key, meta) => {
      return meta?.sql?.includes("{{region}}") ?? false;
    });

    expect(cache.get("k1")).toBeUndefined();
    expect(cache.get("k2")).toBe("v2");
    expect(cache.get("k3")).toBe("v3");
  });
});

describe("QueryCache size bound", () => {
  it("evicts the least recently used entry once maxEntries is exceeded", () => {
    const cache = new QueryCache(2);
    cache.set("a", 1, 60);
    cache.set("b", 2, 60);
    cache.get("a"); // "b" is now the least recently used
    cache.set("c", 3, 60);
    expect(cache.size).toBe(2);
    expect(cache.get("a")).toBe(1);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
  });

  it("drops expired entries before live ones", () => {
    const cache = new QueryCache(2);
    cache.set("stale", 1, -1);
    cache.set("b", 2, 60);
    cache.set("c", 3, 60);
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
  });
});
