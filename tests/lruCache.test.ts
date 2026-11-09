import { describe, expect, it } from "vitest";
import { LRUCache } from "@shared/lruCache";

describe("LRUCache", () => {
  it("evicts the least-recently-used key", () => {
    const cache = new LRUCache<number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3); // evicts "a"
    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(true);
    expect(cache.has("c")).toBe(true);
  });

  it("get() promotes a key to most-recently-used", () => {
    const cache = new LRUCache<number>(2);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.get("a")).toBe(1); // "a" now MRU
    cache.set("c", 3); // should evict "b"
    expect(cache.has("a")).toBe(true);
    expect(cache.has("b")).toBe(false);
  });

  it("tracks hit/miss/eviction stats", () => {
    const cache = new LRUCache<number>(1);
    cache.set("a", 1);
    cache.set("b", 2); // evicts a
    cache.get("b"); // hit
    cache.get("a"); // miss
    const stats = cache.stats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.evictions).toBe(1);
    expect(stats.size).toBe(1);
  });

  it("clear empties the cache", () => {
    const cache = new LRUCache<number>(4);
    cache.set("a", 1);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
