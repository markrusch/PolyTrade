/**
 * OrderBookAggregator - Rate-Limited Multi-Strike OrderBook Fetching
 * 
 * Features:
 * - Rate-limited parallel fetching (5 concurrent)
 * - Exponential backoff retry
 * - Caching with TTL
 * - Graceful handling of rate limits and errors
 */

import pLimit from 'p-limit';
import axios from 'axios';
import { createLogger } from '../../lib/logger/index.js';

const logger = createLogger({ service: 'OrderBookAggregator' });

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface OrderBookLevel {
  price: number;
  size: number;
}

export interface OrderBookSnapshot {
  tokenId: string;
  timestamp: number;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  bestBid: number;
  bestAsk: number;
  spread: number;
  spreadBps: number;
  mid: number;
  totalBidSize: number;
  totalAskSize: number;
}

export interface OrderBookFetchResult {
  results: Map<string, OrderBookSnapshot>;
  successCount: number;
  failCount: number;
  duration: number;
}

// ═══════════════════════════════════════════════════════════════
// ORDERBOOK AGGREGATOR
// ═══════════════════════════════════════════════════════════════

export class OrderBookAggregator {
  private clobUrl = 'https://clob.polymarket.com';
  private cache = new Map<string, { data: OrderBookSnapshot; timestamp: number }>();
  private cacheTTL = 5000; // 5 seconds
  private rateLimiter = pLimit(5); // Max 5 concurrent requests
  private minRequestDelay = 100; // Min 100ms between requests
  private consecutiveFailures = 0;
  private maxConsecutiveFailures = 5;
  private backoffMultiplier = 1;

  /**
   * Fetch multiple orderbooks with rate limiting, retry, and graceful degradation
   */
  async fetchOrderBooksForStrikes(
    markets: Array<{ slug: string; tokenId: string }>
  ): Promise<OrderBookFetchResult> {
    const start = Date.now();
    const results = new Map<string, OrderBookSnapshot>();
    let successCount = 0;
    let failCount = 0;

    // Reset consecutive failures at start of batch
    this.consecutiveFailures = 0;
    this.backoffMultiplier = 1;

    logger.info(`Fetching ${markets.length} orderbooks with rate limiting...`);

    // Process in smaller batches to avoid overwhelming the API
    const batchSize = 10;
    const batches = [];
    for (let i = 0; i < markets.length; i += batchSize) {
      batches.push(markets.slice(i, i + batchSize));
    }

    for (const batch of batches) {
      // Check if we should back off due to consecutive failures
      if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
        logger.warn(`Too many consecutive failures (${this.consecutiveFailures}), adding delay`);
        await new Promise(r => setTimeout(r, 2000 * this.backoffMultiplier));
        this.backoffMultiplier = Math.min(this.backoffMultiplier * 2, 8);
      }

      const promises = batch.map((market, index) =>
        this.rateLimiter(async () => {
          // Add staggered delay within batch
          await new Promise(r => setTimeout(r, index * this.minRequestDelay));

          try {
            const orderbook = await this.fetchOrderBook(market.tokenId);

            if (orderbook) {
              results.set(market.slug, orderbook);
              successCount++;
              this.consecutiveFailures = 0; // Reset on success
              this.backoffMultiplier = Math.max(1, this.backoffMultiplier / 2);
              logger.debug(`✓ ${market.slug}`);
            } else {
              failCount++;
              this.consecutiveFailures++;
              logger.warn(`✗ ${market.slug} - no data`);
            }

            return orderbook;
          } catch (error) {
            failCount++;
            this.consecutiveFailures++;
            logger.error(`✗ ${market.slug}:`, error);
            return null;
          }
        })
      );

      await Promise.allSettled(promises);

      // Add delay between batches
      if (batches.indexOf(batch) < batches.length - 1) {
        await new Promise(r => setTimeout(r, 200 * this.backoffMultiplier));
      }
    }

    const duration = Date.now() - start;
    const successRate = markets.length > 0 ? (successCount / markets.length) * 100 : 0;
    logger.info(
      `Fetched ${successCount}/${markets.length} orderbooks in ${duration}ms (${successRate.toFixed(1)}%)`
    );

    return { results, successCount, failCount, duration };
  }

  /**
   * Fetch orderbooks for multiple token IDs
   */
  async fetchOrderBooksForTokens(
    tokenIds: string[]
  ): Promise<Map<string, OrderBookSnapshot>> {
    const markets = tokenIds.map(tokenId => ({ slug: tokenId, tokenId }));
    const result = await this.fetchOrderBooksForStrikes(markets);
    return result.results;
  }

  /**
   * Fetch single orderbook with retry and exponential backoff
   * Handles rate limits gracefully with dynamic delays
   */
  async fetchOrderBook(tokenId: string, retries = 3): Promise<OrderBookSnapshot | null> {
    // Check cache first
    const cacheKey = `book:${tokenId}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      logger.debug(`Cache hit for ${tokenId.slice(0, 20)}...`);
      return cached.data;
    }

    // Fetch with retry
    for (let i = 0; i < retries; i++) {
      try {
        const url = `${this.clobUrl}/book`;
        const response = await axios.get(url, {
          params: { token_id: tokenId },
          timeout: 8000, // Increased timeout
          validateStatus: (status) => status < 500, // Don't throw on 4xx
        });

        // Handle rate limiting
        if (response.status === 429) {
          const waitTime = Math.pow(2, i + 1) * 1000 * this.backoffMultiplier;
          logger.warn(`Rate limited on ${tokenId.slice(0, 20)}..., waiting ${waitTime}ms`);
          await new Promise(r => setTimeout(r, waitTime));
          continue;
        }

        // Handle not found
        if (response.status === 404) {
          logger.debug(`Token ${tokenId.slice(0, 20)}... not found (404)`);
          return null;
        }

        // Handle other client errors
        if (response.status >= 400) {
          logger.warn(`Client error ${response.status} for ${tokenId.slice(0, 20)}...`);
          return null;
        }

        const data = response.data;
        
        // Validate response has expected structure
        if (!data || (typeof data !== 'object')) {
          logger.warn(`Invalid response data for ${tokenId.slice(0, 20)}...`);
          continue;
        }

        const snapshot = this.parseOrderBook(data, tokenId);

        // Cache result
        this.cache.set(cacheKey, { data: snapshot, timestamp: Date.now() });

        return snapshot;
      } catch (error: any) {
        // Network errors or timeouts
        const isTimeout = error.code === 'ECONNABORTED' || error.message?.includes('timeout');
        const isNetworkError = error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED';
        
        if (isTimeout) {
          logger.debug(`Timeout for ${tokenId.slice(0, 20)}..., retry ${i + 1}`);
        } else if (isNetworkError) {
          logger.warn(`Network error for ${tokenId.slice(0, 20)}...`);
          return null; // Don't retry network errors
        }

        if (i === retries - 1) {
          logger.error(`Failed after ${retries} retries for ${tokenId.slice(0, 20)}...`);
          return null;
        }

        const backoff = 500 * Math.pow(2, i);
        logger.debug(`Retry ${i + 1} for ${tokenId.slice(0, 20)}..., waiting ${backoff}ms`);
        await new Promise(r => setTimeout(r, backoff));
      }
    }

    return null;
  }

  /**
   * Parse and validate orderbook data
   */
  private parseOrderBook(data: any, tokenId: string): OrderBookSnapshot {
    const bids = (data.bids || [])
      .map((b: any) => ({
        price: parseFloat(b.price),
        size: parseFloat(b.size),
      }))
      .filter((b: OrderBookLevel) => !isNaN(b.price) && !isNaN(b.size) && b.size > 0)
      .sort((a: OrderBookLevel, b: OrderBookLevel) => b.price - a.price); // Descending

    const asks = (data.asks || [])
      .map((a: any) => ({
        price: parseFloat(a.price),
        size: parseFloat(a.size),
      }))
      .filter((a: OrderBookLevel) => !isNaN(a.price) && !isNaN(a.size) && a.size > 0)
      .sort((a: OrderBookLevel, b: OrderBookLevel) => a.price - b.price); // Ascending

    const bestBid = bids.length > 0 ? bids[0].price : 0;
    const bestAsk = asks.length > 0 ? asks[0].price : 1;
    const mid = (bestBid + bestAsk) / 2;
    const spread = bestAsk - bestBid;
    const spreadBps = mid > 0 ? (spread / mid) * 10000 : 0;

    const totalBidSize = bids.reduce((sum: number, b: OrderBookLevel) => sum + b.size, 0);
    const totalAskSize = asks.reduce((sum: number, a: OrderBookLevel) => sum + a.size, 0);

    return {
      tokenId,
      timestamp: Date.now(),
      bids,
      asks,
      bestBid,
      bestAsk,
      spread,
      spreadBps,
      mid,
      totalBidSize,
      totalAskSize,
    };
  }

  /**
   * Calculate spread statistics across multiple orderbooks
   */
  calculateSpreadStats(orderbooks: OrderBookSnapshot[]): {
    tightest: { tokenId: string; spreadBps: number };
    widest: { tokenId: string; spreadBps: number };
    average: number;
    median: number;
  } {
    const validBooks = orderbooks.filter(ob => ob.spreadBps > 0 && ob.spreadBps < 10000);

    if (validBooks.length === 0) {
      return {
        tightest: { tokenId: '', spreadBps: 0 },
        widest: { tokenId: '', spreadBps: 0 },
        average: 0,
        median: 0,
      };
    }

    const sorted = [...validBooks].sort((a, b) => a.spreadBps - b.spreadBps);
    const tightest = sorted[0];
    const widest = sorted[sorted.length - 1];
    const average =
      validBooks.reduce((sum, ob) => sum + ob.spreadBps, 0) / validBooks.length;
    const median = sorted[Math.floor(sorted.length / 2)].spreadBps;

    return {
      tightest: { tokenId: tightest.tokenId, spreadBps: tightest.spreadBps },
      widest: { tokenId: widest.tokenId, spreadBps: widest.spreadBps },
      average,
      median,
    };
  }

  /**
   * Validate orderbook structure
   */
  validateOrderBook(ob: OrderBookSnapshot): boolean {
    if (!ob.bids || !ob.asks) return false;
    if (!Array.isArray(ob.bids) || !Array.isArray(ob.asks)) return false;

    // Accept empty orderbooks (market might be illiquid)
    if (ob.bids.length === 0 && ob.asks.length === 0) return true;

    // Validate bid < ask
    if (ob.bestBid > 0 && ob.bestAsk < 1 && ob.bestBid >= ob.bestAsk) {
      return false;
    }

    return true;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
    logger.debug('OrderBook cache cleared');
  }

  /**
   * Set cache TTL (for testing)
   */
  setCacheTTL(ttl: number): void {
    this.cacheTTL = ttl;
  }
}

// Export singleton instance
export const orderBookAggregator = new OrderBookAggregator();
