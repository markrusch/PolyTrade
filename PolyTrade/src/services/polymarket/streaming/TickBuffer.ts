/**
 * Tick Buffer & Deduplication Service
 * Manages incoming ticks from both REST and WebSocket sources
 * Deduplicates based on hash/timestamp and merges for best depth
 */

import { createHash } from 'crypto';
import { Logger } from '../../../lib/logger/index.js';
import { OrderBookTick, OrderBookLevel } from '../../../lib/types/index.js';
import {
  EnrichedTick,
  TickSource,
  TickDeduplicationResult,
  MergedTickResult,
  HybridStreamConfig,
  DEFAULT_STREAM_CONFIG,
} from './types.js';

interface TickEntry {
  tick: EnrichedTick;
  expiresAt: number;
}

export class TickBuffer {
  private restBuffer: Map<string, TickEntry> = new Map();   // tokenId -> latest REST tick
  private wsBuffer: Map<string, TickEntry> = new Map();     // tokenId -> latest WS tick
  private recentHashes: Map<string, number> = new Map();    // hash -> timestamp (for dedup)
  private logger: Logger;
  private config: HybridStreamConfig;
  private cleanupInterval: NodeJS.Timeout;

  constructor(config: Partial<HybridStreamConfig> = {}, logger?: Logger) {
    this.config = { ...DEFAULT_STREAM_CONFIG, ...config };
    this.logger = logger || new Logger({ service: 'TickBuffer' });

    // Cleanup expired entries every second
    this.cleanupInterval = setInterval(() => this.cleanup(), 1000);
  }

  /**
   * Generate hash for tick deduplication
   * Uses price levels + timestamp to detect duplicates
   */
  private generateTickHash(tick: OrderBookTick): string {
    const bidStr = tick.bidLevels.slice(0, 5).map(b => `${b.price}:${b.size}`).join('|');
    const askStr = tick.askLevels.slice(0, 5).map(a => `${a.price}:${a.size}`).join('|');
    const data = `${tick.tokenId}:${bidStr}:${askStr}:${tick.bestBid}:${tick.bestAsk}`;
    return createHash('md5').update(data).digest('hex').slice(0, 16);
  }

  /**
   * Enrich a raw tick with metadata
   */
  enrichTick(tick: OrderBookTick): EnrichedTick {
    const hash = this.generateTickHash(tick);
    return {
      ...tick,
      hash,
      receivedAt: Date.now(),
      isComplete: tick.bidLevels.length > 0 && tick.askLevels.length > 0,
    };
  }

  /**
   * Check if tick is duplicate within dedup window
   */
  isDuplicate(tick: EnrichedTick): TickDeduplicationResult {
    const existingTime = this.recentHashes.get(tick.hash);
    
    if (existingTime && (Date.now() - existingTime) < this.config.tickDedupeWindowMs) {
      return {
        isDuplicate: true,
        source: tick.source as TickSource,
      };
    }

    // Not duplicate, record hash
    this.recentHashes.set(tick.hash, Date.now());
    
    return {
      isDuplicate: false,
      source: tick.source as TickSource,
    };
  }

  /**
   * Add tick to appropriate buffer (REST or WS)
   */
  addTick(tick: EnrichedTick): TickDeduplicationResult {
    const dedupResult = this.isDuplicate(tick);
    
    if (dedupResult.isDuplicate) {
      this.logger.debug(`Duplicate tick skipped`, { tokenId: tick.tokenId, hash: tick.hash });
      return dedupResult;
    }

    const entry: TickEntry = {
      tick,
      expiresAt: Date.now() + this.config.tickDedupeWindowMs * 2,
    };

    if (tick.source === 'rest') {
      this.restBuffer.set(tick.tokenId, entry);
    } else if (tick.source === 'ws') {
      this.wsBuffer.set(tick.tokenId, entry);
    }

    return dedupResult;
  }

  /**
   * Get merged tick combining REST (full depth) with WS (real-time top)
   * Strategy: Use WS for top-of-book, REST for deeper levels
   */
  getMergedTick(tokenId: string): MergedTickResult | null {
    const restEntry = this.restBuffer.get(tokenId);
    const wsEntry = this.wsBuffer.get(tokenId);

    if (!restEntry && !wsEntry) {
      return null;
    }

    // If only one source, return that
    if (!restEntry && wsEntry) {
      return {
        tick: { ...wsEntry.tick, source: 'ws' },
        wsTick: wsEntry.tick,
        mergeStrategy: 'ws-priority',
      };
    }

    if (restEntry && !wsEntry) {
      return {
        tick: { ...restEntry.tick, source: 'rest' },
        restTick: restEntry.tick,
        mergeStrategy: 'rest-priority',
      };
    }

    // Both available - merge strategies
    const restTick = restEntry!.tick;
    const wsTick = wsEntry!.tick;

    // If WS is more recent, use WS top-of-book with REST depth
    if (wsTick.receivedAt > restTick.receivedAt) {
      const merged = this.mergeDepth(wsTick, restTick);
      return {
        tick: merged,
        restTick,
        wsTick,
        mergeStrategy: 'depth-merge',
      };
    }

    // Otherwise use REST as base (fresher full depth)
    return {
      tick: { ...restTick, source: 'merged' as any },
      restTick,
      wsTick,
      mergeStrategy: 'rest-priority',
    };
  }

  /**
   * Merge depth: WS top-of-book + REST deeper levels
   * WS typically has 5-10 levels, REST has full depth
   * Bids are DESCENDING (best/highest at [0]), Asks are ASCENDING (best/lowest at [0])
   */
  private mergeDepth(wsTick: EnrichedTick, restTick: EnrichedTick): EnrichedTick {
    // Use WS for top 5 levels (most recent) - bids[0:5] are best bids, asks[0:5] are best asks
    const wsTopBids = wsTick.bidLevels.slice(0, 5);
    const wsTopAsks = wsTick.askLevels.slice(0, 5);

    // Use REST for deeper levels - skip top 5 which we're replacing with WS
    const restDeepBids = restTick.bidLevels.slice(5);
    const restDeepAsks = restTick.askLevels.slice(5);

    // Merge: WS top + REST deep (preserve proper ordering)
    const mergedBids = this.mergeLevels([...wsTopBids, ...restDeepBids], 'desc');
    const mergedAsks = this.mergeLevels([...wsTopAsks, ...restDeepAsks], 'asc');

    // Recalculate best bid/ask from merged data - both at index 0
    const bestBid = mergedBids.length > 0 ? mergedBids[0].price : wsTick.bestBid;
    const bestAsk = mergedAsks.length > 0 ? mergedAsks[0].price : wsTick.bestAsk;
    const spreadBps = bestBid > 0 ? ((bestAsk - bestBid) / bestBid) * 10000 : 0;

    return {
      ...wsTick,
      bidLevels: mergedBids,
      askLevels: mergedAsks,
      bestBid,
      bestAsk,
      spreadBps,
      topBidSize: mergedBids.length > 0 ? mergedBids[0].size : 0,
      topAskSize: mergedAsks.length > 0 ? mergedAsks[0].size : 0,
      source: 'ws', // Primary source
      hash: this.generateTickHash({ ...wsTick, bidLevels: mergedBids, askLevels: mergedAsks }),
      isComplete: true,
    };
  }

  /**
   * Merge price levels, preferring later entries for same price
   * @param order 'asc' for asks (lowest first), 'desc' for bids (highest first)
   */
  private mergeLevels(levels: OrderBookLevel[], order: 'asc' | 'desc' = 'asc'): OrderBookLevel[] {
    const map = new Map<number, number>(); // price -> size

    for (const level of levels) {
      if (level.size > 0) {
        map.set(level.price, level.size);
      } else {
        map.delete(level.price); // Size 0 means level removed
      }
    }

    return Array.from(map.entries())
      .map(([price, size]) => ({ price, size }))
      .sort((a, b) => order === 'desc' ? b.price - a.price : a.price - b.price);
  }

  /**
   * Get latest tick for a market (any source)
   */
  getLatestTick(tokenId: string): EnrichedTick | null {
    const restEntry = this.restBuffer.get(tokenId);
    const wsEntry = this.wsBuffer.get(tokenId);

    if (!restEntry && !wsEntry) return null;
    if (!restEntry) return wsEntry!.tick;
    if (!wsEntry) return restEntry.tick;

    // Return more recent
    return wsEntry.tick.receivedAt > restEntry.tick.receivedAt
      ? wsEntry.tick
      : restEntry.tick;
  }

  /**
   * Check if market has recent data from either source
   */
  hasRecentData(tokenId: string, maxAgeMs: number = 60000): boolean {
    const latest = this.getLatestTick(tokenId);
    if (!latest) return false;
    return (Date.now() - latest.receivedAt) < maxAgeMs;
  }

  /**
   * Get source freshness for a market
   */
  getSourceStatus(tokenId: string): { rest: number | null; ws: number | null } {
    const restEntry = this.restBuffer.get(tokenId);
    const wsEntry = this.wsBuffer.get(tokenId);

    return {
      rest: restEntry ? restEntry.tick.receivedAt : null,
      ws: wsEntry ? wsEntry.tick.receivedAt : null,
    };
  }

  /**
   * Cleanup expired entries
   */
  private cleanup(): void {
    const now = Date.now();

    // Cleanup REST buffer
    for (const [tokenId, entry] of this.restBuffer) {
      if (entry.expiresAt < now) {
        this.restBuffer.delete(tokenId);
      }
    }

    // Cleanup WS buffer
    for (const [tokenId, entry] of this.wsBuffer) {
      if (entry.expiresAt < now) {
        this.wsBuffer.delete(tokenId);
      }
    }

    // Cleanup hash dedup cache (keep last N seconds)
    const hashCutoff = now - this.config.tickDedupeWindowMs * 2;
    for (const [hash, timestamp] of this.recentHashes) {
      if (timestamp < hashCutoff) {
        this.recentHashes.delete(hash);
      }
    }
  }

  /**
   * Clear all buffers for a specific market
   */
  clearMarket(tokenId: string): void {
    this.restBuffer.delete(tokenId);
    this.wsBuffer.delete(tokenId);
  }

  /**
   * Get buffer statistics
   */
  getStats(): {
    restCount: number;
    wsCount: number;
    hashCacheSize: number;
  } {
    return {
      restCount: this.restBuffer.size,
      wsCount: this.wsBuffer.size,
      hashCacheSize: this.recentHashes.size,
    };
  }

  /**
   * Shutdown and cleanup
   */
  shutdown(): void {
    clearInterval(this.cleanupInterval);
    this.restBuffer.clear();
    this.wsBuffer.clear();
    this.recentHashes.clear();
  }
}
