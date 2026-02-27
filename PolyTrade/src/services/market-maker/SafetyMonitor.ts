/**
 * Safety Monitor
 *
 * Monitors market health and halts quoting in unsafe conditions:
 * - Stale data (spot price, IV, orderbook)
 * - Gapping markets (sudden price jumps)
 * - Insufficient liquidity
 */

import { Logger } from '../../lib/logger/index.js';

export interface SafetyConfig {
  maxSpotStalenessMs: number; // e.g., 5000ms (5s)
  maxIvStalenessMs: number; // e.g., 60000ms (60s)
  maxSpotGapPercent: number; // e.g., 0.02 (2% gap detection)
  maxOrderbookStalenessMs: number; // e.g., 10000ms (10s)
  minOrderbookDepth: number; // Minimum liquidity to quote
}

export interface MarketHealth {
  tokenId: string;
  safe: boolean;
  reasons: string[]; // Why unsafe
  lastCheck: number;
}

interface SpotPriceRecord {
  price: number;
  timestamp: number;
}

/**
 * Monitors market health and halts quoting in unsafe conditions
 */
export class SafetyMonitor {
  private logger: Logger;
  private config: SafetyConfig;
  private lastSpotPrices: Map<string, SpotPriceRecord> = new Map();
  private marketHealth: Map<string, MarketHealth> = new Map();

  constructor(logger: Logger, config: SafetyConfig) {
    this.logger = logger.child('SafetyMonitor');
    this.config = config;

    this.logger.info('SafetyMonitor initialized', {
      maxSpotStalenessMs: config.maxSpotStalenessMs,
      maxIvStalenessMs: config.maxIvStalenessMs,
      maxSpotGapPercent: (config.maxSpotGapPercent * 100).toFixed(1) + '%',
      maxOrderbookStalenessMs: config.maxOrderbookStalenessMs,
      minOrderbookDepth: config.minOrderbookDepth,
    });
  }

  /**
   * Check if it's safe to quote for a market
   */
  isSafeToQuote(
    tokenId: string,
    crypto: string,
    spotPrice: number,
    spotTimestamp: number,
    ivTimestamp: number,
    orderbookTimestamp: number,
    orderbookDepth: number,
  ): MarketHealth {
    const now = Date.now();
    const reasons: string[] = [];

    // 1. Check spot price staleness
    const spotAge = now - spotTimestamp;
    if (spotAge > this.config.maxSpotStalenessMs) {
      reasons.push(
        `Stale spot: ${spotAge}ms > ${this.config.maxSpotStalenessMs}ms`,
      );
    }

    // 2. Check IV staleness
    const ivAge = now - ivTimestamp;
    if (ivAge > this.config.maxIvStalenessMs) {
      reasons.push(`Stale IV: ${ivAge}ms > ${this.config.maxIvStalenessMs}ms`);
    }

    // 3. Check orderbook staleness
    const obAge = now - orderbookTimestamp;
    if (obAge > this.config.maxOrderbookStalenessMs) {
      reasons.push(
        `Stale orderbook: ${obAge}ms > ${this.config.maxOrderbookStalenessMs}ms`,
      );
    }

    // 4. Check orderbook depth
    if (orderbookDepth < this.config.minOrderbookDepth) {
      reasons.push(
        `Insufficient liquidity: ${orderbookDepth} < ${this.config.minOrderbookDepth}`,
      );
    }

    // 5. Check for gapping market (sudden price jump)
    const lastSpot = this.lastSpotPrices.get(crypto);
    if (lastSpot && spotPrice > 0) {
      const pctChange = Math.abs((spotPrice - lastSpot.price) / lastSpot.price);
      const timeDelta = now - lastSpot.timestamp;

      // Only flag as gap if change happened quickly (< 1s)
      if (pctChange > this.config.maxSpotGapPercent && timeDelta < 1000) {
        reasons.push(
          `Market gapping: ${(pctChange * 100).toFixed(2)}% move in ${timeDelta}ms`,
        );
      }
    }

    // Update last spot price
    if (spotPrice > 0) {
      this.lastSpotPrices.set(crypto, { price: spotPrice, timestamp: now });
    }

    const health: MarketHealth = {
      tokenId,
      safe: reasons.length === 0,
      reasons,
      lastCheck: now,
    };

    // Cache result
    this.marketHealth.set(tokenId, health);

    // Log unsafe conditions
    if (!health.safe) {
      this.logger.warn(`Unsafe to quote: ${tokenId}`, {
        reasons: health.reasons,
        spotPrice,
        spotAge,
        ivAge,
        obAge,
      });
    }

    return health;
  }

  /**
   * Get cached health status
   */
  getHealth(tokenId: string): MarketHealth | null {
    return this.marketHealth.get(tokenId) ?? null;
  }

  /**
   * Clear health status (e.g., market unwired)
   */
  clearHealth(tokenId: string): void {
    this.marketHealth.delete(tokenId);
    this.logger.debug(`Health status cleared: ${tokenId}`);
  }

  /**
   * Get all unsafe markets
   */
  getUnsafeMarkets(): MarketHealth[] {
    return Array.from(this.marketHealth.values()).filter((h) => !h.safe);
  }

  /**
   * Get all safe markets
   */
  getSafeMarkets(): MarketHealth[] {
    return Array.from(this.marketHealth.values()).filter((h) => h.safe);
  }

  /**
   * Get safety statistics
   */
  getStats(): {
    totalMarkets: number;
    safeMarkets: number;
    unsafeMarkets: number;
    safetyRate: number;
    commonReasons: Map<string, number>;
  } {
    const total = this.marketHealth.size;
    const safe = this.getSafeMarkets().length;
    const unsafe = this.getUnsafeMarkets().length;

    // Count common reasons for unsafe markets
    const reasonCounts = new Map<string, number>();
    for (const health of this.getUnsafeMarkets()) {
      for (const reason of health.reasons) {
        // Extract reason type (before colon)
        const reasonType = reason.split(':')[0];
        reasonCounts.set(reasonType, (reasonCounts.get(reasonType) ?? 0) + 1);
      }
    }

    return {
      totalMarkets: total,
      safeMarkets: safe,
      unsafeMarkets: unsafe,
      safetyRate: total > 0 ? safe / total : 1,
      commonReasons: reasonCounts,
    };
  }

  /**
   * Reset spot price history (useful for testing or after prolonged disconnect)
   */
  resetSpotHistory(): void {
    const count = this.lastSpotPrices.size;
    this.lastSpotPrices.clear();
    this.logger.info(`Spot price history reset (${count} entries cleared)`);
  }

  /**
   * Update configuration dynamically
   */
  updateConfig(newConfig: Partial<SafetyConfig>): void {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...newConfig };

    this.logger.info('Safety config updated', {
      old: oldConfig,
      new: this.config,
    });
  }
}
