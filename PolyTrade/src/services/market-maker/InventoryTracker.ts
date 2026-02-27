/**
 * Inventory Tracker
 *
 * Tracks net positions (inventory) and P&L for each wired market.
 * Enforces inventory limits to prevent excessive risk accumulation.
 */

import { Logger } from '../../lib/logger/index.js';

export interface InventoryPosition {
  tokenId: string;
  crypto: string;
  strike: number;
  quantity: number; // Net position: buys - sells
  avgEntryPrice: number; // VWAP of fills
  realizedPnL: number; // Closed P&L
  unrealizedPnL: number; // Mark-to-market P&L
  lastUpdate: number;
}

export interface InventoryLimits {
  maxQuantityPerMarket: number; // e.g., 1000 contracts
  maxNotionalPerCrypto: number; // e.g., $10,000
  maxGammaExposure: number; // Portfolio-level gamma limit
}

export interface FillRecord {
  tokenId: string;
  crypto: string;
  strike: number;
  quantity: number; // Signed: + for buy, - for sell
  price: number;
  timestamp: number;
}

/**
 * Tracks inventory positions across all markets
 */
export class InventoryTracker {
  private logger: Logger;
  private positions: Map<string, InventoryPosition> = new Map();
  private limits: InventoryLimits;
  private fillHistory: FillRecord[] = [];

  constructor(logger: Logger, limits: InventoryLimits) {
    this.logger = logger.child('InventoryTracker');
    this.limits = limits;

    this.logger.info('InventoryTracker initialized', {
      maxQuantityPerMarket: limits.maxQuantityPerMarket,
      maxNotionalPerCrypto: limits.maxNotionalPerCrypto,
      maxGammaExposure: limits.maxGammaExposure,
    });
  }

  /**
   * Record a fill (buy or sell)
   */
  recordFill(
    tokenId: string,
    crypto: string,
    strike: number,
    quantity: number, // Signed: + for buy, - for sell
    price: number,
  ): void {
    const timestamp = Date.now();

    // Record in fill history
    this.fillHistory.push({
      tokenId,
      crypto,
      strike,
      quantity,
      price,
      timestamp,
    });

    let pos = this.positions.get(tokenId);

    if (!pos) {
      // New position
      pos = {
        tokenId,
        crypto,
        strike,
        quantity,
        avgEntryPrice: price,
        realizedPnL: 0,
        unrealizedPnL: 0,
        lastUpdate: timestamp,
      };
      this.positions.set(tokenId, pos);

      this.logger.info(`New position: ${tokenId}`, {
        quantity,
        price: price.toFixed(4),
      });
    } else {
      // Update existing position
      const prevQty = pos.quantity;
      const newQty = prevQty + quantity;

      // Calculate realized P&L if reducing position
      if (Math.sign(prevQty) !== Math.sign(quantity) && prevQty !== 0) {
        const closedQty = Math.min(Math.abs(quantity), Math.abs(prevQty));
        const pnlPerContract = (price - pos.avgEntryPrice) * Math.sign(prevQty);
        const realizedPnL = pnlPerContract * closedQty;
        pos.realizedPnL += realizedPnL;

        this.logger.info(`Realized P&L: ${tokenId}`, {
          closedQty,
          pnlPerContract: pnlPerContract.toFixed(4),
          realizedPnL: realizedPnL.toFixed(2),
          totalRealized: pos.realizedPnL.toFixed(2),
        });
      }

      // Update VWAP entry price if adding to position
      if (Math.sign(newQty) === Math.sign(quantity) || prevQty === 0) {
        const totalCost =
          pos.avgEntryPrice * Math.abs(prevQty) + price * Math.abs(quantity);
        pos.avgEntryPrice = Math.abs(newQty) > 0 ? totalCost / Math.abs(newQty) : price;
      }

      pos.quantity = newQty;
      pos.lastUpdate = timestamp;

      this.logger.info(`Position updated: ${tokenId}`, {
        quantity: newQty,
        avgEntry: pos.avgEntryPrice.toFixed(4),
        realizedPnL: pos.realizedPnL.toFixed(2),
      });
    }
  }

  /**
   * Update unrealized P&L based on current mark price
   */
  updateMtM(tokenId: string, markPrice: number): void {
    const pos = this.positions.get(tokenId);
    if (!pos) return;

    const previousUnrealized = pos.unrealizedPnL;
    pos.unrealizedPnL = (markPrice - pos.avgEntryPrice) * pos.quantity;

    // Log significant changes
    if (Math.abs(pos.unrealizedPnL - previousUnrealized) > 1.0) {
      this.logger.debug(`Unrealized P&L updated: ${tokenId}`, {
        markPrice: markPrice.toFixed(4),
        avgEntry: pos.avgEntryPrice.toFixed(4),
        unrealizedPnL: pos.unrealizedPnL.toFixed(2),
      });
    }
  }

  /**
   * Get position for a market
   */
  getPosition(tokenId: string): InventoryPosition | null {
    return this.positions.get(tokenId) ?? null;
  }

  /**
   * Get net quantity for a market
   */
  getQuantity(tokenId: string): number {
    return this.positions.get(tokenId)?.quantity ?? 0;
  }

  /**
   * Check if adding quantity would breach limits
   */
  wouldBreachLimits(
    tokenId: string,
    crypto: string,
    additionalQuantity: number,
    spotPrice: number,
    portfolioGamma: number,
  ): { breached: boolean; reason?: string } {
    const currentQty = this.getQuantity(tokenId);
    const newQty = currentQty + additionalQuantity;

    // Per-market quantity limit
    if (Math.abs(newQty) > this.limits.maxQuantityPerMarket) {
      return {
        breached: true,
        reason: `Quantity limit: ${Math.abs(newQty)} > ${this.limits.maxQuantityPerMarket}`,
      };
    }

    // Per-crypto notional limit
    const cryptoNotional =
      this.getCryptoNotional(crypto, spotPrice) +
      Math.abs(additionalQuantity) * spotPrice;

    if (cryptoNotional > this.limits.maxNotionalPerCrypto) {
      return {
        breached: true,
        reason: `Notional limit: $${cryptoNotional.toFixed(0)} > $${this.limits.maxNotionalPerCrypto}`,
      };
    }

    // Portfolio gamma limit
    if (Math.abs(portfolioGamma) > this.limits.maxGammaExposure) {
      return {
        breached: true,
        reason: `Gamma limit: ${Math.abs(portfolioGamma).toFixed(4)} > ${this.limits.maxGammaExposure}`,
      };
    }

    return { breached: false };
  }

  /**
   * Get total notional for a crypto
   */
  private getCryptoNotional(crypto: string, spotPrice: number): number {
    let total = 0;
    for (const pos of this.positions.values()) {
      if (pos.crypto === crypto) {
        total += Math.abs(pos.quantity) * spotPrice;
      }
    }
    return total;
  }

  /**
   * Get all positions
   */
  getAllPositions(): InventoryPosition[] {
    return Array.from(this.positions.values());
  }

  /**
   * Get positions for a specific crypto
   */
  getPositionsForCrypto(crypto: string): InventoryPosition[] {
    return Array.from(this.positions.values()).filter(
      (pos) => pos.crypto === crypto,
    );
  }

  /**
   * Get total P&L (realized + unrealized)
   */
  getTotalPnL(): { realized: number; unrealized: number; total: number } {
    let realized = 0;
    let unrealized = 0;

    for (const pos of this.positions.values()) {
      realized += pos.realizedPnL;
      unrealized += pos.unrealizedPnL;
    }

    return {
      realized,
      unrealized,
      total: realized + unrealized,
    };
  }

  /**
   * Clear position (e.g., market expired)
   */
  clearPosition(tokenId: string): void {
    const pos = this.positions.get(tokenId);
    if (pos) {
      this.logger.info(`Position cleared: ${tokenId}`, {
        finalQuantity: pos.quantity,
        realizedPnL: pos.realizedPnL.toFixed(2),
        unrealizedPnL: pos.unrealizedPnL.toFixed(2),
      });
      this.positions.delete(tokenId);
    }
  }

  /**
   * Get fill history
   */
  getFillHistory(limit?: number): FillRecord[] {
    if (limit) {
      return this.fillHistory.slice(-limit);
    }
    return [...this.fillHistory];
  }

  /**
   * Get summary statistics
   */
  getSummary(): {
    totalPositions: number;
    totalRealizedPnL: number;
    totalUnrealizedPnL: number;
    totalPnL: number;
    cryptos: Map<string, { positions: number; notional: number }>;
  } {
    const pnl = this.getTotalPnL();
    const cryptos = new Map<string, { positions: number; notional: number }>();

    for (const pos of this.positions.values()) {
      if (!cryptos.has(pos.crypto)) {
        cryptos.set(pos.crypto, { positions: 0, notional: 0 });
      }
      const cryptoStats = cryptos.get(pos.crypto)!;
      cryptoStats.positions++;
      // Note: We'd need spotPrice to calculate exact notional, so this is approximate
      cryptoStats.notional += Math.abs(pos.quantity) * pos.avgEntryPrice;
    }

    return {
      totalPositions: this.positions.size,
      totalRealizedPnL: pnl.realized,
      totalUnrealizedPnL: pnl.unrealized,
      totalPnL: pnl.total,
      cryptos,
    };
  }

  /**
   * Clear all positions and history (use with caution)
   */
  reset(): void {
    const summary = this.getSummary();
    this.logger.warn('Resetting inventory tracker', {
      clearedPositions: summary.totalPositions,
      finalPnL: summary.totalPnL.toFixed(2),
    });

    this.positions.clear();
    this.fillHistory = [];
  }
}
