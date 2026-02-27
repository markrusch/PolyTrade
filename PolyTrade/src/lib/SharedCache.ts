/**
 * Shared Cache Layer
 * Unified caching across all services with TTL support and statistics
 *
 * Replaces per-service caches with a centralized, configurable cache
 * that can be monitored and managed from a single location.
 */

export interface CacheEntry<T = unknown> {
  value: T;
  createdAt: number;
  expiresAt: number;
  hits: number;
  lastAccess: number;
}

export interface CacheOptions {
  /** Default TTL in milliseconds (default: 60000 = 1 minute) */
  defaultTtlMs?: number;
  /** Maximum number of entries (default: 10000) */
  maxSize?: number;
  /** Enable statistics tracking (default: true) */
  trackStats?: boolean;
  /** Cleanup interval in ms (default: 60000 = 1 minute) */
  cleanupIntervalMs?: number;
}

export interface CacheStats {
  size: number;
  hits: number;
  misses: number;
  hitRate: number;
  evictions: number;
  expirations: number;
}

export class SharedCache {
  private cache = new Map<string, CacheEntry>();
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    expirations: 0,
  };

  private readonly defaultTtlMs: number;
  private readonly maxSize: number;
  private readonly trackStats: boolean;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(options: CacheOptions = {}) {
    this.defaultTtlMs = options.defaultTtlMs ?? 60000;
    this.maxSize = options.maxSize ?? 10000;
    this.trackStats = options.trackStats ?? true;

    // Start periodic cleanup
    const cleanupInterval = options.cleanupIntervalMs ?? 60000;
    this.cleanupTimer = setInterval(() => this.cleanup(), cleanupInterval);

    // Ensure cleanup stops if process exits
    if (typeof process !== 'undefined') {
      process.on('beforeExit', () => this.shutdown());
    }
  }

  /**
   * Get a value from cache
   * @returns The cached value or null if not found/expired
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);

    if (!entry) {
      if (this.trackStats) this.stats.misses++;
      return null;
    }

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      if (this.trackStats) {
        this.stats.misses++;
        this.stats.expirations++;
      }
      return null;
    }

    // Update access stats
    entry.hits++;
    entry.lastAccess = Date.now();
    if (this.trackStats) this.stats.hits++;

    return entry.value as T;
  }

  /**
   * Set a value in cache
   * @param key Cache key
   * @param value Value to cache
   * @param ttlMs Optional TTL override in milliseconds
   */
  set<T>(key: string, value: T, ttlMs?: number): void {
    // Enforce max size by evicting oldest entries
    while (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }

    const now = Date.now();
    const entry: CacheEntry<T> = {
      value,
      createdAt: now,
      expiresAt: now + (ttlMs ?? this.defaultTtlMs),
      hits: 0,
      lastAccess: now,
    };

    this.cache.set(key, entry);
  }

  /**
   * Get or set a value using a factory function
   * @param key Cache key
   * @param factory Function to create value if not cached
   * @param ttlMs Optional TTL override
   */
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttlMs?: number
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const value = await factory();
    this.set(key, value, ttlMs);
    return value;
  }

  /**
   * Check if a key exists and is not expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Delete a specific key
   */
  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Delete all keys matching a pattern
   * @param pattern Pattern to match (supports * wildcard)
   * @returns Number of keys deleted
   */
  invalidate(pattern: string): number {
    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
    );

    let deleted = 0;
    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        deleted++;
      }
    }
    return deleted;
  }

  /**
   * Clear all cached data
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses;
    return {
      size: this.cache.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: total > 0 ? this.stats.hits / total : 0,
      evictions: this.stats.evictions,
      expirations: this.stats.expirations,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      expirations: 0,
    };
  }

  /**
   * Get all keys (including expired - mainly for debugging)
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Get keys matching a pattern
   */
  keysMatching(pattern: string): string[] {
    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
    );
    return this.keys().filter((key) => regex.test(key));
  }

  /**
   * Cleanup expired entries
   */
  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        cleaned++;
        if (this.trackStats) this.stats.expirations++;
      }
    }

    return cleaned;
  }

  /**
   * Shutdown the cache (cleanup timer)
   */
  shutdown(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Evict the oldest entry (by last access time)
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestAccess = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.lastAccess < oldestAccess) {
        oldestAccess = entry.lastAccess;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      if (this.trackStats) this.stats.evictions++;
    }
  }
}

/**
 * Namespace-scoped cache wrapper
 * Automatically prefixes all keys with a namespace
 */
export class NamespacedCache {
  constructor(
    private cache: SharedCache,
    private namespace: string
  ) {}

  private prefixKey(key: string): string {
    return `${this.namespace}:${key}`;
  }

  get<T>(key: string): T | null {
    return this.cache.get<T>(this.prefixKey(key));
  }

  set<T>(key: string, value: T, ttlMs?: number): void {
    this.cache.set(this.prefixKey(key), value, ttlMs);
  }

  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttlMs?: number
  ): Promise<T> {
    return this.cache.getOrSet(this.prefixKey(key), factory, ttlMs);
  }

  has(key: string): boolean {
    return this.cache.has(this.prefixKey(key));
  }

  delete(key: string): boolean {
    return this.cache.delete(this.prefixKey(key));
  }

  invalidateNamespace(): number {
    return this.cache.invalidate(`${this.namespace}:*`);
  }
}

// Singleton instance for global access
export const sharedCache = new SharedCache({
  defaultTtlMs: 60000,     // 1 minute default
  maxSize: 10000,          // 10k entries max
  cleanupIntervalMs: 60000, // Cleanup every minute
});

// Pre-configured namespaced caches for different services
export const caches = {
  pricing: new NamespacedCache(sharedCache, 'pricing'),
  orderbook: new NamespacedCache(sharedCache, 'orderbook'),
  binance: new NamespacedCache(sharedCache, 'binance'),
  deribit: new NamespacedCache(sharedCache, 'deribit'),
  polymarket: new NamespacedCache(sharedCache, 'polymarket'),
  research: new NamespacedCache(sharedCache, 'research'),
};
