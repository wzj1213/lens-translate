import { CACHE_PREFIX, CACHE_WRITE_CHUNK, MEMORY_CACHE_LIMIT } from "@shared/constants";
import { LRUCache } from "@shared/lruCache";
import type { CacheStats } from "@shared/types";

interface StoredEntry {
  /** translated text */
  t: string;
  /** created-at epoch ms */
  c: number;
}

export interface PersistentCacheOptions {
  maxEntries: number;
  memoryLimit?: number;
}

/**
 * Two-tier cache: an in-memory LRU in front of a bounded, prefix-scoped
 * chrome.storage.local store. Stale entries are deleted on read and a debounced
 * single-flight sweep trims expired keys and evicts the oldest beyond maxEntries.
 */
export class PersistentCache {
  private memory: LRUCache<StoredEntry>;
  private maxEntries: number;
  private sweepTimer: ReturnType<typeof setTimeout> | null = null;
  private sweeping = false;
  private pendingSweepTtl = 0;

  constructor(options: PersistentCacheOptions) {
    this.maxEntries = Math.max(100, options.maxEntries);
    this.memory = new LRUCache<StoredEntry>(options.memoryLimit ?? MEMORY_CACHE_LIMIT);
  }

  setMaxEntries(value: number): void {
    this.maxEntries = Math.max(100, value);
  }

  async getMany(keys: string[], ttlMs: number): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const now = Date.now();
    const missing: string[] = [];

    for (const key of keys) {
      const mem = this.memory.get(key);
      if (mem && now - mem.c < ttlMs) result.set(key, mem.t);
      else missing.push(key);
    }
    if (!missing.length) return result;

    const stored = await chrome.storage.local.get(missing).catch(() => ({}) as Record<string, unknown>);
    const expired: string[] = [];
    for (const key of missing) {
      const entry = stored[key] as StoredEntry | undefined;
      if (entry && typeof entry.t === "string" && now - entry.c < ttlMs) {
        result.set(key, entry.t);
        this.memory.set(key, entry);
      } else if (entry) {
        expired.push(key);
      }
    }
    if (expired.length) chrome.storage.local.remove(expired).catch(() => undefined);
    return result;
  }

  async setMany(entries: Array<{ key: string; translated: string }>, ttlMs: number): Promise<void> {
    if (!entries.length) return;
    const now = Date.now();
    const payload: Record<string, StoredEntry> = {};
    for (const entry of entries) {
      const stored: StoredEntry = { t: entry.translated, c: now };
      this.memory.set(entry.key, stored);
      payload[entry.key] = stored;
    }
    const keys = Object.keys(payload);
    for (let i = 0; i < keys.length; i += CACHE_WRITE_CHUNK) {
      const chunk: Record<string, StoredEntry> = {};
      for (const key of keys.slice(i, i + CACHE_WRITE_CHUNK)) chunk[key] = payload[key];
      await chrome.storage.local.set(chunk).catch(() => undefined);
    }
    this.scheduleSweep(ttlMs);
  }

  scheduleSweep(ttlMs: number): void {
    this.pendingSweepTtl = ttlMs;
    if (this.sweepTimer) return;
    this.sweepTimer = setTimeout(() => {
      this.sweepTimer = null;
      void this.sweep(this.pendingSweepTtl);
    }, 5000);
  }

  async sweep(ttlMs: number): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const all = await chrome.storage.local.get(null).catch(() => ({}) as Record<string, unknown>);
      const now = Date.now();
      const live: Array<{ key: string; c: number }> = [];
      const expired: string[] = [];
      for (const [key, value] of Object.entries(all)) {
        if (!key.startsWith(CACHE_PREFIX)) continue;
        const entry = value as StoredEntry | undefined;
        if (!entry || typeof entry.t !== "string" || typeof entry.c !== "number") {
          expired.push(key);
        } else if (now - entry.c >= ttlMs) {
          expired.push(key);
        } else {
          live.push({ key, c: entry.c });
        }
      }
      if (live.length > this.maxEntries) {
        live.sort((a, b) => a.c - b.c);
        for (let i = 0; i < live.length - this.maxEntries; i += 1) expired.push(live[i].key);
      }
      if (expired.length) await chrome.storage.local.remove(expired).catch(() => undefined);
    } finally {
      this.sweeping = false;
    }
  }

  async stats(): Promise<CacheStats> {
    const all = await chrome.storage.local.get(null).catch(() => ({}) as Record<string, unknown>);
    let count = 0;
    let bytes = 0;
    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith(CACHE_PREFIX)) continue;
      count += 1;
      bytes += key.length + JSON.stringify(value).length;
    }
    return { count, bytes };
  }

  async clear(): Promise<void> {
    const all = await chrome.storage.local.get(null).catch(() => ({}) as Record<string, unknown>);
    const keys = Object.keys(all).filter((key) => key.startsWith(CACHE_PREFIX));
    if (keys.length) await chrome.storage.local.remove(keys).catch(() => undefined);
    this.memory.clear();
  }
}
