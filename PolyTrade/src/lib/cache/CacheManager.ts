/**
 * Generic Cache Manager with TTL Support
 * Thread-safe in-memory cache with automatic expiration
 */

import { EventEmitter } from 'events';
import { CacheEntry, CacheStats } from '../types/index.js';

export interface CacheOptions {
  defaultTtl?: number; // Default TTL in milliseconds
  cleanupInterval?: number; // How often to clean expired entries (ms)
  maxSize?: number; // Maximum number of entries
}

/**
 * Generic cache manager with automatic expiration
 */
export class CacheManager<T> extends EventEmitter {
  private cache: Map<string, CacheEntry<T>>;
  private stats: CacheStats;
  private defaultTtl: number;
  private cleanupInterval: number;
  private maxSize: number;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(options: CacheOptions = {}) {
    super();
    this.cache = new Map();
    this.stats = {
      hits: 0,
      misses: 0,
      size: 0,
      evictions: 0,
    };
    this.defaultTtl = options.defaultTtl || 300000; // 5 minutes default
    this.cleanupInterval = options.cleanupInterval || 60000; // 1 minute
    this.maxSize = options.maxSize || 1000;

    // Start automatic cleanup
    this.startCleanup();
  }

  /**
   * Get value from cache
   */
  get(key: string): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.stats.misses++;
      this.emit('cache:miss', { key });
      return null;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.misses++;
      this.stats.evictions++;
      this.emit('cache:expired', { key });
      return null;
    }

    this.stats.hits++;
    this.emit('cache:hit', { key });
    return entry.value;
  }

  /**
   * Set value in cache with optional TTL
   */
  set(key: string, value: T, ttl?: number): void {
    const effectiveTtl = ttl !== undefined ? ttl : this.defaultTtl;
    const now = Date.now();
    
    const entry: CacheEntry<T> = {
      key,
      value,
      expiresAt: now + effectiveTtl,
      createdAt: now,
    };

    // Check max size and evict oldest if needed
    if (!this.cache.has(key) && this.cache.size >= this.maxSize) {
      this.evictOldest();
    }

    this.cache.set(key, entry);
    this.stats.size = this.cache.size;
  }

  /**
   * Check if key exists and is not expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.evictions++;
      this.emit('cache:expired', { key });
      return false;
    }
    
    return true;
  }

  /**
   * Delete entry from cache
   */
  delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.stats.size = this.cache.size;
    }
    return deleted;
  }

  /**
   * Clear all entries
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.stats.size = 0;
    this.stats.evictions += size;
  }

  /**
   * Get all keys
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Get cache statistics
   */
  getStats(): Readonly<CacheStats> {
    return { ...this.stats };
  }

  /**
   * Get cache size
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Get or set pattern (fetch if not in cache)
   */
  async getOrSet(
    key: string,
    fetcher: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    const cached = this.get(key);
    if (cached !== null) {
      return cached;
    }

    const value = await fetcher();
    this.set(key, value, ttl);
    return value;
  }

  /**
   * Start automatic cleanup of expired entries
   */
  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.cleanupInterval);
    
    // Don't block process exit
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Manually trigger cleanup
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        removed++;
        this.stats.evictions++;
        this.emit('cache:expired', { key });
      }
    }

    this.stats.size = this.cache.size;
    return removed;
  }

  /**
   * Evict oldest entry
   */
  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.stats.evictions++;
    }
  }

  /**
   * Stop cleanup timer
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.clear();
  }
}

/**
 * Create a new cache manager
 */
export function createCache<T>(options?: CacheOptions): CacheManager<T> {
  return new CacheManager<T>(options);
}
