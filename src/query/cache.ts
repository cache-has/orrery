interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  meta?: CacheMeta;
}

export interface CacheMeta {
  sql?: string;
  connectionName?: string;
}

export class QueryCache {
  private store = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.data as T;
  }

  set<T>(key: string, data: T, ttlSeconds: number, meta?: CacheMeta): void {
    this.store.set(key, {
      data,
      expiresAt: Date.now() + ttlSeconds * 1000,
      meta,
    });
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
