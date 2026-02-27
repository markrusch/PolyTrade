/**
 * BlackScholesStrategy
 *
 * Pricing strategy for binary price markets using Black-Scholes model.
 * Calculates risk-neutral probability for "above strike" binary options.
 *
 * Wraps the existing implementation from MarketPricingService.
 *
 * @see REDESIGN_V2.md Section 5.3
 */

import {
  BasePricingStrategy,
  type PricingData,
  type PricingResult,
  type Greeks,
} from '../PricingStrategy.js';
import type { MarketDefinition, MarketType } from '../../markets/MarketDefinition.js';

// ============================================================================
// BlackScholesStrategy Implementation
// ============================================================================

export class BlackScholesStrategy extends BasePricingStrategy {
  readonly name = 'black_scholes';
  readonly displayName = 'Black-Scholes Model';
  readonly supportedMarketTypes: MarketType[] = ['binary_price'];

  /**
   * Calculate fair price using Black-Scholes N(d2) formula
   */
  calculateFairPrice(
    market: MarketDefinition,
    data: PricingData
  ): PricingResult {
    const validation = this.validateData(market, data);
    if (!validation.valid) {
      return this.createResult(
        0.5, // Default to 50% if missing data
        0,
        'missing_data',
        { missingFields: validation.missingFields }
      );
    }

    const { spotPrice, impliedVolatility, riskFreeRate } = data;
    const spot = spotPrice!;
    const iv = impliedVolatility!;
    const r = riskFreeRate ?? 0;

    // Get strike from market metadata
    const strike = market.metadata.priceMarket?.strike;
    if (!strike || strike <= 0) {
      return this.createResult(
        0.5,
        0,
        'no_strike',
        { error: 'Market missing strike price in metadata' }
      );
    }

    // Calculate time to expiry in years
    const tte = this.calculateTimeToExpiry(market.expiresAt);
    if (tte <= 0) {
      // Expired: return 1 if above strike, 0 if below
      const expiredPrice = spot > strike ? 1 : 0;
      return this.createResult(
        expiredPrice,
        1,
        'expired',
        { spot, strike, expired: true }
      );
    }

    // Calculate risk-neutral probability using N(d2)
    const probAbove = this.calculateRiskNeutralProb(spot, strike, iv, tte, r);

    // Determine fair price based on market direction
    const direction = market.metadata.priceMarket?.direction ?? 'above';
    const fairPrice = direction === 'above' ? probAbove : 1 - probAbove;

    // Calculate Greeks
    const greeks = this.calculateGreeks(market, data);

    // Calculate confidence based on data quality and time to expiry
    const confidence = this.calculateConfidence(data, tte);

    return this.createResult(
      fairPrice,
      confidence,
      'black_scholes_nd2',
      {
        spot,
        strike,
        iv,
        tte,
        riskFreeRate: r,
        direction,
        probAbove,
      },
      greeks ?? undefined
    );
  }

  /**
   * Calculate Greeks for the binary option
   */
  calculateGreeks(market: MarketDefinition, data: PricingData): Greeks | null {
    const { spotPrice, impliedVolatility, riskFreeRate } = data;
    if (!spotPrice || !impliedVolatility) return null;

    const strike = market.metadata.priceMarket?.strike;
    if (!strike || strike <= 0) return null;

    const spot = spotPrice;
    const sigma = impliedVolatility; // Already as decimal (0.65 = 65%)
    const r = riskFreeRate ?? 0;
    const tte = this.calculateTimeToExpiry(market.expiresAt);

    if (tte <= 0 || sigma <= 0) {
      return { delta: 0, gamma: 0, vega: 0, theta: 0 };
    }

    const sqrtT = Math.sqrt(tte);
    const d1 = (Math.log(spot / strike) + (r + 0.5 * sigma * sigma) * tte) / (sigma * sqrtT);
    const d2 = d1 - sigma * sqrtT;

    // Binary option Greeks (cash-or-nothing)
    const nPrimeD2 = this.normalPdf(d2);
    const nD2 = this.normCdf(d2);

    // Delta: derivative of N(d2) with respect to spot
    const delta = nPrimeD2 / (spot * sigma * sqrtT);

    // Gamma: derivative of delta
    const gamma = -nPrimeD2 * d1 / (spot * spot * sigma * sigma * tte);

    // Vega: derivative with respect to IV (scaled to 1% move)
    const vega = -nPrimeD2 * d1 / sigma / 100;

    // Theta: time decay (per day)
    const theta = -(
      nPrimeD2 * (
        (Math.log(spot / strike) / (2 * sigma * tte * sqrtT)) +
        (r + 0.5 * sigma * sigma) / (sigma * sqrtT)
      )
    ) / 365;

    return {
      delta,
      gamma,
      vega,
      theta,
    };
  }

  /**
   * Get confidence score based on data quality and market conditions
   */
  getConfidence(market: MarketDefinition, data: PricingData): number {
    return this.calculateConfidence(data, this.calculateTimeToExpiry(market.expiresAt));
  }

  /**
   * Check if this strategy can price the given market
   */
  canPrice(market: MarketDefinition): boolean {
    if (!this.supportedMarketTypes.includes(market.type)) {
      return false;
    }
    // Must have price market metadata with strike
    return !!market.metadata.priceMarket?.strike;
  }

  /**
   * Validate required data is present
   */
  validateData(
    market: MarketDefinition,
    data: PricingData
  ): { valid: boolean; missingFields: string[] } {
    const missingFields: string[] = [];

    if (data.spotPrice === undefined || data.spotPrice === null) {
      missingFields.push('spotPrice');
    }
    if (data.impliedVolatility === undefined || data.impliedVolatility === null) {
      missingFields.push('impliedVolatility');
    }
    if (!market.metadata.priceMarket?.strike) {
      missingFields.push('strike (in market metadata)');
    }

    return {
      valid: missingFields.length === 0,
      missingFields,
    };
  }

  // =========================================================================
  // Private Calculation Methods
  // =========================================================================

  /**
   * Calculate time to expiry in years
   */
  private calculateTimeToExpiry(expiresAt: Date): number {
    const now = new Date();
    const diffMs = expiresAt.getTime() - now.getTime();
    const diffYears = diffMs / (1000 * 60 * 60 * 24 * 365.25);
    return Math.max(0, diffYears);
  }

  /**
   * Calculate risk-neutral probability using Black-Scholes N(d2)
   * P(S_T > K) = N(d2)
   */
  private calculateRiskNeutralProb(
    spot: number,
    strike: number,
    sigma: number,
    tte: number,
    r: number
  ): number {
    if (tte <= 0) return spot > strike ? 1 : 0;
    if (sigma <= 0) return spot > strike ? 1 : 0;

    const sqrtT = Math.sqrt(tte);
    const d2 = (Math.log(spot / strike) + (r - 0.5 * sigma * sigma) * tte) / (sigma * sqrtT);
    return this.normCdf(d2);
  }

  /**
   * Normal cumulative distribution function
   * Using Abramowitz and Stegun approximation
   */
  private normCdf(x: number): number {
    return 0.5 * (1 + this.erf(x / Math.sqrt(2)));
  }

  /**
   * Normal probability density function
   */
  private normalPdf(x: number): number {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  }

  /**
   * Error function approximation
   * Abramowitz and Stegun formula 7.1.26
   */
  private erf(x: number): number {
    const sign = x >= 0 ? 1 : -1;
    x = Math.abs(x);

    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

    return sign * y;
  }

  /**
   * Calculate confidence based on data quality and time to expiry
   */
  private calculateConfidence(data: PricingData, tte: number): number {
    let confidence = 1.0;

    // Reduce confidence for stale data
    switch (data.dataQuality) {
      case 'high':
        confidence *= 1.0;
        break;
      case 'medium':
        confidence *= 0.8;
        break;
      case 'low':
        confidence *= 0.5;
        break;
      case 'stale':
        confidence *= 0.2;
        break;
    }

    // Reduce confidence for very short or very long dated options
    if (tte < 1 / 365) { // Less than 1 day
      confidence *= 0.7;
    } else if (tte > 1) { // More than 1 year
      confidence *= 0.8;
    }

    // Reduce confidence for extreme IV
    const iv = data.impliedVolatility ?? 0;
    if (iv > 2) { // > 200% IV
      confidence *= 0.7;
    } else if (iv < 0.1) { // < 10% IV
      confidence *= 0.8;
    }

    return Math.max(0, Math.min(1, confidence));
  }
}
