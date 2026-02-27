/**
 * MarketPricingService
 * Combines Binance spot prices + Deribit IV + Polymarket markets
 * Supports slug-based market setup like the old pricing_deribit_binance code
 */

import axios from 'axios';

export interface MarketMetadata {
  slug: string;
  title: string;
  endDate: string;
  strike: number;
  clobTokenIds: string[];
  outcomes: string[];
}

export interface PricingSnapshot {
  timestamp: Date;
  spot: number | null;
  iv: number | null;
  strike: number;
  tte: number; // Time to expiry in years
  fairPrice: number | null;
  probAbove: number | null;
}

export class MarketPricingService {
  private gammaApiUrl: string;

  constructor(gammaApiUrl: string = 'https://gamma-api.polymarket.com') {
    this.gammaApiUrl = gammaApiUrl;
  }

  /**
   * Fetch top markets from Gamma API
   * Useful for discovery
   */
  async getTopMarkets(limit: number = 20): Promise<any[]> {
    try {
      // Query Gamma for active markets, sorted by 24h volume
      const url = `${this.gammaApiUrl}/markets?limit=${limit}&active=true&closed=false&order=volume24h:desc`;
      const response = await axios.get(url);
      return response.data; // Gamma usually returns array or { data: [] }
    } catch (error) {
      console.error('Error fetching top markets:', error);
      return [];
    }
  }

  /**
   * Fetch market metadata from Gamma API using slug
   * Mimics the old aggregator.js fetchMarketMetadata behavior
   */
  async fetchMarketMetadata(slug: string): Promise<MarketMetadata> {
    const url = `${this.gammaApiUrl}/markets/slug/${encodeURIComponent(slug)}`;

    try {
      const response = await axios.get(url);
      const data = response.data;

      // Navigate response structure
      const market = data.result || data.data || data;
      if (!market) {
        throw new Error('Invalid Gamma API response structure');
      }

      // Extract endDate (required)
      const endDate = market.endDate || market.end_date;
      if (!endDate) {
        throw new Error('Market missing endDate field');
      }

      const title = market.title || '';

      // Extract strike from multiple sources (same logic as old code)
      let strike = this.extractStrike(slug, title, market);

      // Parse clobTokenIds
      let clobTokenIds = market.clobTokenIds || market.clob_token_ids || [];

      if (typeof clobTokenIds === 'string') {
        try {
          clobTokenIds = JSON.parse(clobTokenIds);
        } catch {
          clobTokenIds = [];
        }
      }

      if (Array.isArray(clobTokenIds)) {
        clobTokenIds = clobTokenIds.map(String);
      } else {
        clobTokenIds = [];
      }

      return {
        slug,
        title,
        endDate,
        strike,
        clobTokenIds,
        outcomes: market.outcomes || [],
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Gamma API HTTP ${error.response?.status}: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Extract strike price from slug, title, or market metadata
   * Uses same multi-fallback approach as old code
   */
  private extractStrike(slug: string, title: string, market: any): number {
    // Try from slug first (most reliable for format: {crypto}-above-{strike}-on-{date})
    // Handles: 100k -> 100000, 50.5k -> 50500, 100 -> 100
    let match = slug.match(/above[- ]([\d.]+)k?(?:[- ]|$)/i);
    if (match) {
      let value = parseFloat(match[1]);
      // If the original had 'k', multiply by 1000
      if (slug.match(/above[- ][\d.]+k/i)) {
        value *= 1000;
      }
      return value;
    }

    // Fallback: Try regex from title
    match = title.match(/above[- ](\d+(?:\.\d+)?)/i);
    if (match) {
      return parseFloat(match[1]);
    }

    // Fallback: try "above $X" or just "$X" pattern
    match = title.match(/\$(\d+(?:,\d{3})*(?:\.\d+)?)/);
    if (match) {
      return parseFloat(match[1].replace(/,/g, ''));
    }

    // Fallback: try from tokenMetadata
    if (market.tokenMetadata) {
      for (const meta of Object.values(market.tokenMetadata)) {
        if ((meta as any).strike !== undefined) {
          return parseFloat((meta as any).strike);
        }
      }
    }

    // Fallback: try from questions array
    if (market.questions && Array.isArray(market.questions)) {
      for (const q of market.questions) {
        if (q.strike !== undefined) {
          return parseFloat(q.strike);
        }
      }
    }

    console.warn(`Warning: Could not extract strike from slug "${slug}" or title "${title}". Using 0.`);
    return 0;
  }

  /**
   * Calculate time to expiry in years
   */
  calculateTimeToExpiry(endDate: string): number {
    const now = new Date();
    const expiry = new Date(endDate);
    const diffMs = expiry.getTime() - now.getTime();
    const diffYears = diffMs / (1000 * 60 * 60 * 24 * 365.25);
    return Math.max(0, diffYears);
  }

  /**
   * Calculate risk-neutral probability using Black-Scholes
   * Same implementation as old code
   */
  calculateRiskNeutralProb(
    spot: number,
    strike: number,
    sigma: number,
    tte: number,
    r: number = 0
  ): number {
    if (tte <= 0) return spot > strike ? 1 : 0;
    if (sigma <= 0) return spot > strike ? 1 : 0;

    const sqrtT = Math.sqrt(tte);
    const d2 = (Math.log(spot / strike) + (r - 0.5 * sigma * sigma) * tte) / (sigma * sqrtT);
    return this.normCdf(d2);
  }

  /**
   * Normal cumulative distribution function
   * Using Abramowitz and Stegun approximation (same as old code)
   */
  private normCdf(x: number): number {
    return 0.5 * (1 + this.erf(x / Math.sqrt(2)));
  }

  /**
   * Error function approximation
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
   * Create a pricing snapshot using live market data
   */
  createSnapshot(
    market: MarketMetadata,
    spot: number | null,
    iv: number | null
  ): PricingSnapshot {
    const tte = this.calculateTimeToExpiry(market.endDate);

    let fairPrice: number | null = null;
    let probAbove: number | null = null;

    if (spot !== null && iv !== null && market.strike > 0) {
      probAbove = this.calculateRiskNeutralProb(spot, market.strike, iv / 100, tte);
      fairPrice = probAbove;
    }

    return {
      timestamp: new Date(),
      spot,
      iv,
      strike: market.strike,
      tte,
      fairPrice,
      probAbove,
    };
  }

  /**
   * Calculate Greeks for a position
   */
  calculateGreeks(
    spot: number,
    strike: number,
    iv: number,
    tte: number,
    r: number = 0
  ): {
    delta: number;
    gamma: number;
    vega: number;
    theta: number;
  } {
    const sigma = iv / 100;
    const sqrtT = Math.sqrt(tte);
    const d1 = (Math.log(spot / strike) + (r + 0.5 * sigma * sigma) * tte) / (sigma * sqrtT);
    const d2 = d1 - sigma * sqrtT;

    const delta = this.normCdf(d1);
    const gamma = Math.exp(-d1 * d1 / 2) / (spot * sigma * sqrtT * Math.sqrt(2 * Math.PI));
    const vega = spot * sqrtT * Math.exp(-d1 * d1 / 2) / Math.sqrt(2 * Math.PI) / 100;
    const theta = -(spot * sigma * Math.exp(-d1 * d1 / 2) / (2 * sqrtT * Math.sqrt(2 * Math.PI)) +
      r * strike * Math.exp(-r * tte) * this.normCdf(d2)) / 365;

    return {
      delta,
      gamma,
      vega,
      theta,
    };
  }
}
