/**
 * Portfolio Greeks Aggregator
 *
 * Calculates position-weighted Greeks across an entire portfolio of binary options.
 * Provides portfolio-level risk metrics (delta, gamma, vega, theta) by aggregating
 * individual position Greeks scaled by position size.
 */

import { Logger } from '../lib/logger/index.js';
import type { MarketPricingWirer, WiredMarket } from './MarketPricingWirer.js';

export interface PositionGreeks {
  tokenId: string;
  market: string;
  outcome: string;
  size: number;
  crypto?: string;
  delta: number;
  gamma: number;
  vega: number;
  theta: number;
  charm: number;
  vanna: number;
}

export interface CryptoGreeks {
  delta: number;
  gamma: number;
  vega: number;
  theta: number;
  positionCount: number;
}

export interface PortfolioGreeks {
  totalDelta: number;
  totalGamma: number;
  totalVega: number;
  totalTheta: number;
  totalCharm: number;
  totalVanna: number;
  positionCount: number;
  positions: PositionGreeks[];
  byCrypto: Record<string, CryptoGreeks>;
  timestamp: number;
  status: 'ok' | 'partial' | 'no_data';
  message?: string;
}

export class PortfolioGreeksAggregator {
  private logger: Logger;
  private pricingWirer: MarketPricingWirer;

  constructor(pricingWirer: MarketPricingWirer, logger?: Logger) {
    this.pricingWirer = pricingWirer;
    this.logger = logger || new Logger({ service: 'PortfolioGreeks' });
  }

  /**
   * Calculate aggregated Greeks across all positions
   */
  async calculatePortfolioGreeks(positions: any[]): Promise<PortfolioGreeks> {
    const positionGreeks: PositionGreeks[] = [];
    const byCrypto: Record<string, CryptoGreeks> = {};
    let totalDelta = 0;
    let totalGamma = 0;
    let totalVega = 0;
    let totalTheta = 0;
    let totalCharm = 0;
    let totalVanna = 0;
    let positionsWithPricing = 0;

    for (const position of positions) {
      // Extract tokenId from various possible field names
      const tokenId =
        position.id ||
        position.asset ||
        position.asset_id ||
        position.assetId ||
        position.token_id;

      // Extract position size from various possible field names
      const size = Number(position.size || position.curSize || position.balance || 0);

      if (!tokenId || size === 0) {
        this.logger.debug(`Skipping position: tokenId=${tokenId}, size=${size}`);
        continue;
      }

      // Get pricing data for this position from the pricing wirer
      const wiredMarket: WiredMarket | null = this.pricingWirer.getPricing(tokenId);

      if (!wiredMarket || !wiredMarket.greeks) {
        this.logger.debug(`No pricing data for position ${tokenId} (${position.market || position.title || 'unknown'})`);
        continue;
      }

      const { greeks } = wiredMarket;
      positionsWithPricing++;

      // Scale Greeks by position size
      // For binary options, Greeks are per-contract, so we multiply by size
      const scaledDelta = greeks.delta * size;
      const scaledGamma = greeks.gamma * size;
      const scaledVega = greeks.vega * size;
      const scaledTheta = greeks.theta * size;
      const scaledCharm = greeks.charm * size;
      const scaledVanna = greeks.vanna * size;

      const marketCrypto = wiredMarket.crypto || 'unknown';

      positionGreeks.push({
        tokenId,
        market: position.market || position.title || position.question || 'Unknown',
        outcome: position.outcome || 'YES',
        size,
        crypto: marketCrypto,
        delta: scaledDelta,
        gamma: scaledGamma,
        vega: scaledVega,
        theta: scaledTheta,
        charm: scaledCharm,
        vanna: scaledVanna,
      });

      totalDelta += scaledDelta;
      totalGamma += scaledGamma;
      totalVega += scaledVega;
      totalTheta += scaledTheta;
      totalCharm += scaledCharm;
      totalVanna += scaledVanna;

      // Accumulate per-crypto breakdown
      if (!byCrypto[marketCrypto]) {
        byCrypto[marketCrypto] = { delta: 0, gamma: 0, vega: 0, theta: 0, positionCount: 0 };
      }
      byCrypto[marketCrypto].delta += scaledDelta;
      byCrypto[marketCrypto].gamma += scaledGamma;
      byCrypto[marketCrypto].vega += scaledVega;
      byCrypto[marketCrypto].theta += scaledTheta;
      byCrypto[marketCrypto].positionCount++;
    }

    // Determine status
    let status: 'ok' | 'partial' | 'no_data' = 'ok';
    let message: string | undefined;

    if (positionsWithPricing === 0) {
      status = 'no_data';
      message = 'No positions have pricing data available';
    } else if (positionsWithPricing < positions.length) {
      status = 'partial';
      message = `Greeks calculated for ${positionsWithPricing} of ${positions.length} positions`;
    }

    this.logger.info(`Portfolio Greeks calculated: ${positionsWithPricing}/${positions.length} positions, delta=${totalDelta.toFixed(4)}, gamma=${totalGamma.toFixed(6)}, vega=${totalVega.toFixed(4)}, theta=${totalTheta.toFixed(4)}`);

    return {
      totalDelta,
      totalGamma,
      totalVega,
      totalTheta,
      totalCharm,
      totalVanna,
      positionCount: positionGreeks.length,
      positions: positionGreeks,
      byCrypto,
      timestamp: Date.now(),
      status,
      message,
    };
  }

  /**
   * Get a summary of portfolio risk exposure
   */
  getPortfolioRiskSummary(greeks: PortfolioGreeks): {
    deltaExposure: string;
    gammaRisk: string;
    vegaExposure: string;
    thetaDecay: string;
  } {
    const { totalDelta, totalGamma, totalVega, totalTheta } = greeks;

    // Delta interpretation
    let deltaExposure: string;
    if (Math.abs(totalDelta) < 0.1) {
      deltaExposure = 'Delta neutral (minimal directional exposure)';
    } else if (totalDelta > 0) {
      deltaExposure = `Bullish exposure (delta +${totalDelta.toFixed(2)})`;
    } else {
      deltaExposure = `Bearish exposure (delta ${totalDelta.toFixed(2)})`;
    }

    // Gamma interpretation
    let gammaRisk: string;
    if (Math.abs(totalGamma) < 0.01) {
      gammaRisk = 'Low convexity (minimal gamma)';
    } else if (totalGamma > 0) {
      gammaRisk = `Positive gamma (benefits from volatility)`;
    } else {
      gammaRisk = `Negative gamma (hurt by volatility)`;
    }

    // Vega interpretation
    let vegaExposure: string;
    if (Math.abs(totalVega) < 0.1) {
      vegaExposure = 'Vega neutral (minimal IV sensitivity)';
    } else if (totalVega > 0) {
      vegaExposure = `Long volatility (vega +${totalVega.toFixed(2)})`;
    } else {
      vegaExposure = `Short volatility (vega ${totalVega.toFixed(2)})`;
    }

    // Theta interpretation
    let thetaDecay: string;
    if (Math.abs(totalTheta) < 0.01) {
      thetaDecay = 'Minimal time decay';
    } else if (totalTheta > 0) {
      thetaDecay = `Positive theta: earning $${totalTheta.toFixed(2)}/day from time decay`;
    } else {
      thetaDecay = `Negative theta: losing $${Math.abs(totalTheta).toFixed(2)}/day to time decay`;
    }

    return {
      deltaExposure,
      gammaRisk,
      vegaExposure,
      thetaDecay,
    };
  }
}
