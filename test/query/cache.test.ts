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
});
