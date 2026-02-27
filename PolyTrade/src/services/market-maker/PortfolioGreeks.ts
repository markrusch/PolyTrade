/**
 * Portfolio Greeks Aggregator
 *
 * Aggregates Greeks (delta, gamma, vega, theta) across all wired markets
 * for portfolio-level risk management and quote adjustment.
 */

import { Logger } from '../../lib/logger/index.js';
import type { BinaryGreeks } from '../../pricing/BinaryGreeksCalculator.js';

export interface PositionGreeks {
  tokenId: string;
  crypto: string;
  strike: number;
  quantity: number; // Signed: positive = long, negative = short
  greeks: BinaryGreeks;
  spotPrice: number;
  lastUpdate: number;
}

export interface CryptoExposure {
  delta: number;
  gamma: number;
  vega: number;
  theta: number;
  notional: number;
}

export interface PortfolioExposure {
  totalDelta: number;
  totalGamma: number;
  totalVega: number;
  totalTheta: number;
  netNotional: number; // Sum of |quantity * spotPrice|
  marketCount: number;
  byCrypto: Map<string, CryptoExposure>;
}

/**
 * Aggregates Greeks across all positions for risk management
 */
export class PortfolioGreeks {
  private logger: Logger;
  private positions: Map<string, PositionGreeks> = new Map();
  private cachedExposure: PortfolioExposure | null = null;
  private cacheExpiry = 0;
  private cacheTtl = 1000; // 1s cache

  constructor(logger: Logger) {
    this.logger = logger.child('PortfolioGreeks');
  }

  /**
   * Update position greeks for a market
   */
  updatePosition(tokenId: string, position: PositionGreeks): void {
    this.positions.set(tokenId, position);
    this.cachedExposure = null; // Invalidate cache

    this.logger.debug(`Position updated: ${tokenId}`, {
      quantity: position.quantity,
      gamma: position.greeks.gamma.toFixed(6),
      delta: position.greeks.delta.toFixed(4),
    });
  }

  /**
   * Remove position (market unwired or position closed)
   */
  removePosition(tokenId: string): void {
    const removed = this.positions.delete(tokenId);
    if (removed) {
      this.cachedExposure = null;
      this.logger.debug(`Position removed: ${tokenId}`);
    }
  }

  /**
   * Get current portfolio exposure
   */
  getExposure(): PortfolioExposure {
    const now = Date.now();

    // Return cached if valid
    if (this.cachedExposure && now < this.cacheExpiry) {
      return this.cachedExposure;
    }

    // Aggregate across all positions
    let totalDelta = 0;
    let totalGamma = 0;
    let totalVega = 0;
    let totalTheta = 0;
    let netNotional = 0;
    const byCrypto = new Map<string, CryptoExposure>();

    for (const pos of this.positions.values()) {
      // Scale Greeks by quantity
      const scaledDelta = pos.greeks.delta * pos.quantity;
      const scaledGamma = pos.greeks.gamma * pos.quantity;
      const scaledVega = pos.greeks.vega * pos.quantity;
      const scaledTheta = pos.greeks.theta * pos.quantity;
      const notional = Math.abs(pos.quantity * pos.spotPrice);

      totalDelta += scaledDelta;
      totalGamma += scaledGamma;
      totalVega += scaledVega;
      totalTheta += scaledTheta;
      netNotional += notional;

      // Aggregate by crypto
      if (!byCrypto.has(pos.crypto)) {
        byCrypto.set(pos.crypto, {
          delta: 0,
          gamma: 0,
          vega: 0,
          theta: 0,
          notional: 0,
        });
      }

      const cryptoAgg = byCrypto.get(pos.crypto)!;
      cryptoAgg.delta += scaledDelta;
      cryptoAgg.gamma += scaledGamma;
      cryptoAgg.vega += scaledVega;
      cryptoAgg.theta += scaledTheta;
      cryptoAgg.notional += notional;
    }

    this.cachedExposure = {
      totalDelta,
      totalGamma,
      totalVega,
      totalTheta,
      netNotional,
      marketCount: this.positions.size,
      byCrypto,
    };

    this.cacheExpiry = now + this.cacheTtl;

    this.logger.debug('Portfolio exposure calculated', {
      totalGamma: totalGamma.toFixed(6),
      totalDelta: totalDelta.toFixed(4),
      totalVega: totalVega.toFixed(4),
      marketCount: this.positions.size,
    });

    return this.cachedExposure;
  }

  /**
   * Get gamma exposure for specific crypto
   */
  getGammaForCrypto(crypto: string): number {
    const exposure = this.getExposure();
    return exposure.byCrypto.get(crypto)?.gamma ?? 0;
  }

  /**
   * Get delta exposure for specific crypto
   */
  getDeltaForCrypto(crypto: string): number {
    const exposure = this.getExposure();
    return exposure.byCrypto.get(crypto)?.delta ?? 0;
  }

  /**
   * Get all positions
   */
  getPositions(): Map<string, PositionGreeks> {
    return new Map(this.positions);
  }

  /**
   * Get position count
   */
  getPositionCount(): number {
    return this.positions.size;
  }

  /**
   * Clear all positions
   */
  clear(): void {
    const count = this.positions.size;
    this.positions.clear();
    this.cachedExposure = null;
    this.logger.info(`Cleared ${count} positions`);
  }

  /**
   * Get summary statistics
   */
  getSummary(): {
    totalPositions: number;
    totalGamma: number;
    totalDelta: number;
    cryptos: string[];
  } {
    const exposure = this.getExposure();
    return {
      totalPositions: exposure.marketCount,
      totalGamma: exposure.totalGamma,
      totalDelta: exposure.totalDelta,
      cryptos: Array.from(exposure.byCrypto.keys()),
    };
  }
}
