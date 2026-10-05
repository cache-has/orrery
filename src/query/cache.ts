interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  meta?: CacheMeta;
}

export interface CacheMeta {
  sql?: string;
  connectionName?: string;
}

const DEFAULT_MAX_ENTRIES = 500;

export class QueryCache {
  // Map iteration order is insertion order; a hit re-inserts its entry, so the
  // first key is always the least recently used.
  private store = new Map<string, CacheEntry<unknown>>();

  constructor(private readonly maxEntries: number = DEFAULT_MAX_ENTRIES) {}

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.data as T;
  }

  set<T>(key: string, data: T, ttlSeconds: number, meta?: CacheMeta): void {
    this.store.delete(key);
    this.store.set(key, {
      data,
      expiresAt: Date.now() + ttlSeconds * 1000,
      meta,
    });
    this.evict();
  }

  /** Keep the store within maxEntries: drop expired entries first, then the least recently used. */
  private evict(): void {
    if (this.store.size <= this.maxEntries) return;
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
    for (const key of this.store.keys()) {
      if (this.store.size <= this.maxEntries) break;
      this.store.delete(key);
    }
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  /**
   * Invalidate all entries matching a predicate.
   * Used for parameter-based cache invalidation.
   */
  invalidateByPredicate(
    predicate: (key: string, meta: CacheMeta | undefined) => boolean,
  ): void {
    for (const [key, entry] of this.store) {
      if (predicate(key, entry.meta)) {
        this.store.delete(key);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}
