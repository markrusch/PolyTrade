/**
 * Binance Price Listener
 * Polling-based listener for Binance spot prices
 */

import { BaseListener } from '../../lib/comm/index.js';
import { Logger } from '../../lib/logger/index.js';
import { BinanceConfig } from '../../lib/config/schema.js';
import { SpotPrice } from '../../lib/types/index.js';
import { BinanceRequestor } from './BinanceRequestor.js';
import { CacheManager } from '../../lib/cache/CacheManager.js';
import { RateLimiter, createRateLimiter } from '../../lib/rate-limit/index.js';

export interface BinancePriceEvent {
  type: 'price:updated' | 'error:connection';
  timestamp: number;
  data: SpotPrice | Error;
}

/**
 * Polling-based price listener for Binance
 */
export class BinancePriceListener extends BaseListener<BinancePriceEvent> {
  private requestor: BinanceRequestor;
  private logger: Logger;
  private config: BinanceConfig;
  private cache: CacheManager<SpotPrice>;
  private rateLimiter: RateLimiter;
  private symbols: string[];
  private pollingInterval?: NodeJS.Timeout;
  private lastPrices: Map<string, number> = new Map();

  // Data readiness tracking
  private dataReady = false;
  private dataReadyResolve: (() => void) | null = null;
  private dataReadyPromise: Promise<void>;

  // Timestamp tracking for data freshness
  private lastPriceTimestamp: Map<string, number> = new Map();

  constructor(
    config: BinanceConfig,
    requestor: BinanceRequestor,
    logger: Logger,
    symbols: string[] = ['ETHUSDT', 'BTCUSDT']
  ) {
    super();
    this.config = config;
    this.requestor = requestor;
    this.logger = logger.child('BinancePriceListener');
    this.symbols = symbols;
    this.cache = new CacheManager<SpotPrice>({ defaultTtl: 10000 }); // 10 second cache

    // Initialize rate limiter with Binance preset
    this.rateLimiter = createRateLimiter('binance', logger);
    this.rateLimiter.setAssetCount(symbols.length);

    // Initialize data readiness promise
    this.dataReadyPromise = new Promise<void>((resolve) => {
      this.dataReadyResolve = resolve;
    });
  }

  /**
   * Start polling for prices
   */
  async start(): Promise<void> {
    if (this.connected) {
      this.logger.warn('Listener already started');
      return;
    }

    const stats = this.rateLimiter.getStats();
    this.logger.info(`Starting Binance price listener for ${this.symbols.join(', ')}`, {
      symbols: this.symbols.length,
      interval: stats.currentInterval,
      requestsPerMinute: stats.requestsPerMinute,
      utilizationPercent: stats.utilizationPercent.toFixed(1),
    });

    this.connected = true;

    // Initial fetch
    await this.pollPrices();

    // Start polling with dynamic interval
    this.schedulePoll();
  }

  /**
   * Schedule next poll based on current rate limiter settings
   */
  private schedulePoll(): void {
    if (!this.connected) return;

    const interval = this.rateLimiter.getInterval();
    
    this.pollingInterval = setTimeout(async () => {
      await this.pollPrices();
      this.schedulePoll(); // Schedule next poll
    }, interval);
    
    // Don't block process exit
    if (this.pollingInterval.unref) {
      this.pollingInterval.unref();
    }
  }

  /**
   * Poll for current prices
   */
  private async pollPrices(): Promise<void> {
    try {
      // Fetch prices for all symbols
      const prices = await this.requestor.fetchSpotPrices(this.symbols);

      for (const price of prices) {
        // Check if price changed
        const lastPrice = this.lastPrices.get(price.symbol);
        const priceChanged = lastPrice === undefined || Math.abs(lastPrice - price.price) > 0.0001;

        if (priceChanged) {
          this.lastPrices.set(price.symbol, price.price);

          // Track timestamp for freshness checks
          this.lastPriceTimestamp.set(price.symbol, Date.now());

          // Cache the price
          this.cache.set(price.symbol, price);

          // Emit event
          const event: BinancePriceEvent = {
            type: 'price:updated',
            timestamp: price.timestamp,
            data: price,
          };

          this.logger.debug(`Price updated: ${price.symbol} = $${price.price}`, {
            symbol: price.symbol,
            price: price.price,
          });

          this.emit(event);
        }
      }

      // Mark data as ready after first successful fetch
      if (!this.dataReady && prices.length > 0) {
        this.markDataReady();
      }
    } catch (error) {
      this.logger.error('Failed to poll prices', error as Error);

      // Try to use cached price as fallback
      for (const symbol of this.symbols) {
        const cached = this.cache.get(symbol);
        if (cached) {
          this.logger.warn(`Using cached price for ${symbol}`, {
            age: Date.now() - cached.timestamp,
          });
        }
      }

      // Emit error event
      const errorEvent: BinancePriceEvent = {
        type: 'error:connection',
        timestamp: Date.now(),
        data: error instanceof Error ? error : new Error(String(error)),
      };

      this.emit(errorEvent);
    }
  }

  /**
   * Get last known price for a symbol
   */
  getLastPrice(symbol: string): SpotPrice | null {
    return this.cache.get(symbol);
  }

  /**
   * Disconnect and stop polling
   */
  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }

    this.logger.info('Disconnecting Binance price listener');

    if (this.pollingInterval) {
      clearTimeout(this.pollingInterval);
      this.pollingInterval = undefined;
    }

    this.connected = false;
    this.handlers.clear();
    this.cache.destroy();
  }

  /**
   * Add a symbol to track
   */
  addSymbol(symbol: string): void {
    if (!this.symbols.includes(symbol)) {
      this.symbols.push(symbol);
      this.rateLimiter.setAssetCount(this.symbols.length);
      
      const stats = this.rateLimiter.getStats();
      this.logger.info(`Added symbol: ${symbol}`, {
        totalSymbols: this.symbols.length,
        newInterval: stats.currentInterval,
        requestsPerMinute: stats.requestsPerMinute,
      });
    }
  }

  /**
   * Remove a symbol from tracking
   */
  removeSymbol(symbol: string): void {
    const index = this.symbols.indexOf(symbol);
    if (index > -1) {
      this.symbols.splice(index, 1);
      this.lastPrices.delete(symbol);
      this.cache.delete(symbol);
      
      if (this.symbols.length > 0) {
        this.rateLimiter.setAssetCount(this.symbols.length);
        
        const stats = this.rateLimiter.getStats();
        this.logger.info(`Removed symbol: ${symbol}`, {
          totalSymbols: this.symbols.length,
          newInterval: stats.currentInterval,
          requestsPerMinute: stats.requestsPerMinute,
        });
      }
    }
  }

  /**
   * Set polling interval (with rate limit validation)
   */
  setInterval(intervalMs: number): boolean {
    const success = this.rateLimiter.setInterval(intervalMs);
    if (success) {
      const stats = this.rateLimiter.getStats();
      this.logger.info('Interval updated', {
        newInterval: intervalMs,
        requestsPerMinute: stats.requestsPerMinute,
        utilizationPercent: stats.utilizationPercent.toFixed(1),
      });
    }
    return success;
  }

  /**
   * Get current rate limit statistics
   */
  getRateLimitStats() {
    return this.rateLimiter.getStats();
  }

  /**
   * Get safe interval bounds
   */
  getSafeBounds() {
    return this.rateLimiter.getSafeBounds();
  }

  // =========================================================================
  // Data Readiness Methods
  // =========================================================================

  /**
   * Mark data as ready (called when first price arrives)
   */
  private markDataReady(): void {
    if (!this.dataReady) {
      this.dataReady = true;
      this.dataReadyResolve?.();
      this.logger.info('Data ready - first prices received');
    }
  }

  /**
   * Wait for data to be ready
   * @param timeoutMs Maximum time to wait (default: 5000ms)
   * @returns true if data is ready, false if timeout
   */
  async waitForData(timeoutMs = 5000): Promise<boolean> {
    if (this.dataReady) return true;

    const timeout = new Promise<boolean>((resolve) =>
      setTimeout(() => resolve(false), timeoutMs)
    );
    const ready = this.dataReadyPromise.then(() => true);

    return Promise.race([ready, timeout]);
  }

  /**
   * Check if data is ready (first prices received)
   */
  isDataReady(): boolean {
    return this.dataReady;
  }

  /**
   * Get the timestamp of the last price update for a symbol
   */
  getLastPriceTimestamp(symbol: string): number | null {
    return this.lastPriceTimestamp.get(symbol) || null;
  }

  /**
   * Check if data is fresh (received within maxAgeMs)
   * @param symbol The symbol to check
   * @param maxAgeMs Maximum age in milliseconds (default: 60000 = 1 minute)
   */
  isDataFresh(symbol: string, maxAgeMs = 60000): boolean {
    const timestamp = this.lastPriceTimestamp.get(symbol);
    if (!timestamp) return false;
    return Date.now() - timestamp < maxAgeMs;
  }

  /**
   * Get health status for monitoring
   */
  getHealthStatus(): {
    connected: boolean;
    isDataFresh: boolean;
    lastUpdate: number | null;
    symbols: string[];
  } {
    // Find most recent timestamp across all symbols
    let mostRecentTimestamp: number | null = null;
    for (const timestamp of this.lastPriceTimestamp.values()) {
      if (!mostRecentTimestamp || timestamp > mostRecentTimestamp) {
        mostRecentTimestamp = timestamp;
      }
    }

    // Data is fresh if any symbol was updated within 60 seconds
    const isDataFresh = mostRecentTimestamp
      ? Date.now() - mostRecentTimestamp < 60000
      : false;

    return {
      connected: this.connected,
      isDataFresh,
      lastUpdate: mostRecentTimestamp,
      symbols: this.symbols,
    };
  }
}
