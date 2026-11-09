export interface LRUStats {
  size: number;
  hits: number;
  misses: number;
  evictions: number;
}

/**
 * A true LRU cache built on Map insertion order: `get` re-inserts to mark the
 * key as most-recently-used; eviction drops the least-recently-used key. TTL is
 * intentionally not handled here — callers store timestamps in the value and
 * decide expiry, keeping this structure simple and unit-testable.
 */
export class LRUCache<V> {
  private map = new Map<string, V>();
  private maxSize: number;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(maxSize: number) {
    this.maxSize = Math.max(1, maxSize);
  }

  get(key: string): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) {
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  peek(key: string): V | undefined {
    return this.map.get(key);
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.maxSize) {
      const oldest = this.map.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.map.delete(oldest);
      this.evictions += 1;
    }
  }

  delete(key: string): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }

  stats(): LRUStats {
    return { size: this.map.size, hits: this.hits, misses: this.misses, evictions: this.evictions };
  }
}
