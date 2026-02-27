/**
 * Rate Limiter for API requests
 * Dynamically adjusts polling intervals based on asset count and API limits
 */

import { Logger } from '../logger/index.js';

export interface RateLimitConfig {
  maxRequestsPerMinute: number; // API's hard limit
  safetyMargin: number; // Percentage (0-1) to stay under limit
  minInterval: number; // Minimum interval in ms
  maxInterval: number; // Maximum interval in ms
}

export interface RateLimitStats {
  currentInterval: number;
  requestsPerMinute: number;
  assetCount: number;
  utilizationPercent: number;
  safeToIncrease: boolean;
  safeToDecrease: boolean;
}

/**
 * Dynamic rate limiter that adjusts intervals based on asset count
 */
export class RateLimiter {
  private config: RateLimitConfig;
  private logger: Logger;
  private assetCount: number = 1;
  private currentInterval: number;
  private requestCount: number = 0;
  private windowStart: number = Date.now();
  private readonly WINDOW_SIZE = 60000; // 1 minute

  constructor(config: RateLimitConfig, logger: Logger) {
    this.config = config;
    this.logger = logger.child('RateLimiter');
    this.currentInterval = this.calculateSafeInterval(this.assetCount);
  }

  /**
   * Calculate safe polling interval based on asset count
   */
  private calculateSafeInterval(assetCount: number): number {
    // Calculate max requests per minute we want to allow
    const maxAllowedRequests = this.config.maxRequestsPerMinute * this.config.safetyMargin;
    
    // If we fetch all assets in one request (Binance style)
    // Interval = 60000ms / maxAllowedRequests
    const calculatedInterval = Math.ceil(this.WINDOW_SIZE / maxAllowedRequests);
    
    // Enforce bounds
    const boundedInterval = Math.max(
      this.config.minInterval,
      Math.min(this.config.maxInterval, calculatedInterval)
    );

    this.logger.debug('Calculated safe interval', {
      assetCount,
      maxAllowedRequests,
      calculatedInterval,
      boundedInterval,
    });

    return boundedInterval;
  }

  /**
   * Update asset count and recalculate interval
   */
  setAssetCount(count: number): void {
    if (count < 1) {
      throw new Error('Asset count must be at least 1');
    }

    const oldInterval = this.currentInterval;
    this.assetCount = count;
    this.currentInterval = this.calculateSafeInterval(count);

    if (oldInterval !== this.currentInterval) {
      this.logger.info('Interval adjusted for asset count change', {
        assetCount: count,
        oldInterval,
        newInterval: this.currentInterval,
        requestsPerMinute: this.getRequestsPerMinute(),
      });
    }
  }

  /**
   * Manually set interval (with bounds checking)
   */
  setInterval(intervalMs: number): boolean {
    // Check if interval is within safe bounds
    if (intervalMs < this.config.minInterval) {
      this.logger.warn('Interval below minimum, using minimum', {
        requested: intervalMs,
        minimum: this.config.minInterval,
      });
      intervalMs = this.config.minInterval;
    }

    if (intervalMs > this.config.maxInterval) {
      this.logger.warn('Interval above maximum, using maximum', {
        requested: intervalMs,
        maximum: this.config.maxInterval,
      });
      intervalMs = this.config.maxInterval;
    }

    // Check if this interval would exceed rate limit
    const requestsPerMin = this.WINDOW_SIZE / intervalMs;
    const maxAllowed = this.config.maxRequestsPerMinute * this.config.safetyMargin;
    
    if (requestsPerMin > maxAllowed) {
      this.logger.error('Interval would exceed rate limit', {
        interval: intervalMs,
        requestsPerMinute: requestsPerMin,
        maxAllowed,
      });
      return false;
    }

    const oldInterval = this.currentInterval;
    this.currentInterval = intervalMs;

    this.logger.info('Interval manually adjusted', {
      oldInterval,
      newInterval: intervalMs,
      requestsPerMinute: requestsPerMin,
      utilizationPercent: (requestsPerMin / this.config.maxRequestsPerMinute) * 100,
    });

    return true;
  }

  /**
   * Get current interval
   */
  getInterval(): number {
    return this.currentInterval;
  }

  /**
   * Get requests per minute at current interval
   */
  getRequestsPerMinute(): number {
    return Math.floor(this.WINDOW_SIZE / this.currentInterval);
  }

  /**
   * Get safe bounds for interval adjustment
   */
  getSafeBounds(): { min: number; max: number; recommended: number } {
    return {
      min: this.config.minInterval,
      max: this.config.maxInterval,
      recommended: this.calculateSafeInterval(this.assetCount),
    };
  }

  /**
   * Check if we can safely decrease interval (increase speed)
   */
  canDecreaseInterval(byMs: number): boolean {
    const newInterval = this.currentInterval - byMs;
    if (newInterval < this.config.minInterval) {
      return false;
    }

    const requestsPerMin = this.WINDOW_SIZE / newInterval;
    const maxAllowed = this.config.maxRequestsPerMinute * this.config.safetyMargin;
    
    return requestsPerMin <= maxAllowed;
  }

  /**
   * Check if we can safely increase interval (decrease speed)
   */
  canIncreaseInterval(byMs: number): boolean {
    const newInterval = this.currentInterval + byMs;
    return newInterval <= this.config.maxInterval;
  }

  /**
   * Record a request (for tracking actual usage)
   */
  recordRequest(): void {
    const now = Date.now();
    
    // Reset window if needed
    if (now - this.windowStart >= this.WINDOW_SIZE) {
      this.requestCount = 0;
      this.windowStart = now;
    }
    
    this.requestCount++;
  }

  /**
   * Get current rate limit statistics
   */
  getStats(): RateLimitStats {
    const requestsPerMin = this.getRequestsPerMinute();
    const utilizationPercent = (requestsPerMin / this.config.maxRequestsPerMinute) * 100;

    return {
      currentInterval: this.currentInterval,
      requestsPerMinute: requestsPerMin,
      assetCount: this.assetCount,
      utilizationPercent,
      safeToIncrease: this.canIncreaseInterval(100),
      safeToDecrease: this.canDecreaseInterval(100),
    };
  }

  /**
   * Get recommended interval for a specific asset count
   */
  getRecommendedInterval(assetCount: number): number {
    return this.calculateSafeInterval(assetCount);
  }

  /**
   * Auto-tune interval based on actual request patterns
   */
  autoTune(): void {
    const stats = this.getStats();
    
    // If we're using less than 50% capacity and interval > recommended
    if (stats.utilizationPercent < 50 && this.currentInterval > this.calculateSafeInterval(this.assetCount)) {
      const recommended = this.calculateSafeInterval(this.assetCount);
      this.logger.info('Auto-tuning: decreasing interval', {
        current: this.currentInterval,
        recommended,
        utilization: stats.utilizationPercent,
      });
      this.currentInterval = recommended;
    }
    
    // If we're using more than 90% capacity
    if (stats.utilizationPercent > 90) {
      const newInterval = Math.ceil(this.currentInterval * 1.1); // Increase by 10%
      if (newInterval <= this.config.maxInterval) {
        this.logger.warn('Auto-tuning: increasing interval due to high utilization', {
          current: this.currentInterval,
          new: newInterval,
          utilization: stats.utilizationPercent,
        });
        this.currentInterval = newInterval;
      }
    }
  }
}

/**
 * Preset configurations for common APIs
 */
export const RateLimitPresets = {
  binance: {
    maxRequestsPerMinute: 1200,
    safetyMargin: 0.83, // Use 83% of limit (1000 req/min)
    minInterval: 1000, // 1 second
    maxInterval: 60000, // 1 minute
  },
  deribit: {
    maxRequestsPerMinute: 1200, // 20 req/sec * 60
    safetyMargin: 0.25, // Use 25% of limit (5 req/sec)
    minInterval: 200, // 200ms
    maxInterval: 10000, // 10 seconds
  },
  polymarket: {
    maxRequestsPerMinute: 600, // Conservative estimate
    safetyMargin: 0.17, // Use 17% (10 req/min)
    minInterval: 6000, // 6 seconds
    maxInterval: 60000, // 1 minute
  },
};

/**
 * Create a rate limiter with preset configuration
 */
export function createRateLimiter(
  preset: keyof typeof RateLimitPresets,
  logger: Logger
): RateLimiter {
  return new RateLimiter(RateLimitPresets[preset], logger);
}
