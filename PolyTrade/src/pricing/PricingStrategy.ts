/**
 * PricingStrategy Interface
 *
 * Pluggable pricing strategies for different market types:
 * - BlackScholesStrategy: For binary price markets (crypto, commodities)
 * - StatisticalStrategy: For event-based markets (polls, historical data)
 * - MLStrategy: Machine learning-based pricing (future)
 * - CompositeStrategy: Weighted combination of strategies
 *
 * @see REDESIGN_V2.md Section 5.3
 */

import type { MarketDefinition, MarketType } from '../markets/MarketDefinition.js';

// ============================================================================
// Pricing Data Types
// ============================================================================

/**
 * Data quality assessment
 */
export type DataQuality = 'high' | 'medium' | 'low' | 'stale';

/**
 * Historical outcome data for statistical pricing
 */
export interface HistoricalOutcome {
  date: Date;
  outcome: string;            // Which outcome occurred
  value?: number;             // For continuous outcomes
  source?: string;
}

/**
 * Polling data for event-based pricing
 */
export interface PollData {
  pollster: string;
  date: Date;
  outcomes: {
    name: string;
    percentage: number;
  }[];
  sampleSize?: number;
  marginOfError?: number;
  rating?: 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'D' | 'F';
}

/**
 * Odds data from sports/betting sources
 */
export interface OddsData {
  source: string;             // "DraftKings", "ESPN", etc.
  date: Date;
  outcomes: {
    name: string;
    odds: number;             // American odds or probability
    impliedProb?: number;
  }[];
}

/**
 * Input data for pricing calculations
 */
export interface PricingData {
  // For price-based markets (Black-Scholes inputs)
  spotPrice?: number;           // Current underlying price
  impliedVolatility?: number;   // IV as decimal (0.65 = 65%)
  riskFreeRate?: number;        // Risk-free rate (default: 0)

  // For event-based markets
  historicalOutcomes?: HistoricalOutcome[];
  pollingData?: PollData[];
  oddsData?: OddsData[];

  // Market book data (for market-based pricing)
  currentBid?: number;
  currentAsk?: number;
  volume24h?: number;

  // Generic
  timestamp: Date;
  dataQuality: DataQuality;
}

// ============================================================================
// Pricing Result Types
// ============================================================================

/**
 * Greeks for options-like markets
 */
export interface Greeks {
  delta: number;              // Rate of change of price with spot
  gamma: number;              // Rate of change of delta
  vega: number;               // Sensitivity to volatility
  theta: number;              // Time decay
  rho?: number;               // Interest rate sensitivity
}

/**
 * Result from a pricing calculation
 */
export interface PricingResult {
  /** Calculated fair price (0-1 for prediction markets) */
  fairPrice: number;

  /** Confidence in the estimate (0-1) */
  confidence: number;

  /** Which strategy produced this price */
  strategy: string;

  /** Methodology description */
  method: string;

  /** Inputs used (for audit trail) */
  inputs: Record<string, unknown>;

  /** Greeks if applicable */
  greeks?: Greeks;

  /** Optional price bounds */
  lowerBound?: number;
  upperBound?: number;

  /** Timestamp of calculation */
  timestamp: Date;
}

// ============================================================================
// PricingStrategy Interface
// ============================================================================

/**
 * Interface for pricing strategies.
 * Each strategy implements market-type-specific pricing logic.
 */
export interface PricingStrategy {
  /** Strategy identifier */
  readonly name: string;

  /** Display name for UI */
  readonly displayName: string;

  /** Which market types this strategy supports */
  readonly supportedMarketTypes: MarketType[];

  /**
   * Calculate fair price for a market
   * @param market Market definition
   * @param data Pricing input data
   * @returns Pricing result with fair price and confidence
   */
  calculateFairPrice(
    market: MarketDefinition,
    data: PricingData
  ): PricingResult;

  /**
   * Calculate Greeks for options-like markets
   * Returns null if not applicable to this market type
   */
  calculateGreeks?(
    market: MarketDefinition,
    data: PricingData
  ): Greeks | null;

  /**
   * Get confidence score for this strategy on the given market
   * Used by CompositeStrategy to weight multiple strategies
   */
  getConfidence(
    market: MarketDefinition,
    data: PricingData
  ): number;

  /**
   * Check if this strategy can price the given market
   */
  canPrice(market: MarketDefinition): boolean;

  /**
   * Validate that required data is present
   */
  validateData(
    market: MarketDefinition,
    data: PricingData
  ): { valid: boolean; missingFields: string[] };
}

// ============================================================================
// Abstract Base Strategy
// ============================================================================

/**
 * Base class providing common functionality for strategies
 */
export abstract class BasePricingStrategy implements PricingStrategy {
  abstract readonly name: string;
  abstract readonly displayName: string;
  abstract readonly supportedMarketTypes: MarketType[];

  abstract calculateFairPrice(
    market: MarketDefinition,
    data: PricingData
  ): PricingResult;

  abstract getConfidence(
    market: MarketDefinition,
    data: PricingData
  ): number;

  calculateGreeks?(
    market: MarketDefinition,
    data: PricingData
  ): Greeks | null {
    return null; // Default: no Greeks
  }

  canPrice(market: MarketDefinition): boolean {
    return this.supportedMarketTypes.includes(market.type);
  }

  validateData(
    market: MarketDefinition,
    data: PricingData
  ): { valid: boolean; missingFields: string[] } {
    const missingFields: string[] = [];

    if (!data.timestamp) {
      missingFields.push('timestamp');
    }

    return {
      valid: missingFields.length === 0,
      missingFields,
    };
  }

  /**
   * Helper: Create a PricingResult
   */
  protected createResult(
    fairPrice: number,
    confidence: number,
    method: string,
    inputs: Record<string, unknown>,
    greeks?: Greeks
  ): PricingResult {
    return {
      fairPrice: Math.max(0, Math.min(1, fairPrice)), // Clamp to [0, 1]
      confidence: Math.max(0, Math.min(1, confidence)),
      strategy: this.name,
      method,
      inputs,
      greeks,
      timestamp: new Date(),
    };
  }
}

// ============================================================================
// Strategy Registry
// ============================================================================

/**
 * Registry for managing available pricing strategies
 */
export class StrategyRegistry {
  private strategies: Map<string, PricingStrategy> = new Map();

  /**
   * Register a strategy
   */
  register(strategy: PricingStrategy): void {
    this.strategies.set(strategy.name, strategy);
  }

  /**
   * Unregister a strategy
   */
  unregister(name: string): void {
    this.strategies.delete(name);
  }

  /**
   * Get a strategy by name
   */
  get(name: string): PricingStrategy | undefined {
    return this.strategies.get(name);
  }

  /**
   * Get all strategies that can price a given market
   */
  getForMarket(market: MarketDefinition): PricingStrategy[] {
    return Array.from(this.strategies.values())
      .filter(s => s.canPrice(market));
  }

  /**
   * Get all registered strategies
   */
  getAll(): PricingStrategy[] {
    return Array.from(this.strategies.values());
  }

  /**
   * Get best strategy for a market (highest confidence)
   */
  getBest(market: MarketDefinition, data: PricingData): PricingStrategy | undefined {
    const applicable = this.getForMarket(market);
    if (applicable.length === 0) return undefined;

    return applicable.reduce((best, current) => {
      const currentConf = current.getConfidence(market, data);
      const bestConf = best.getConfidence(market, data);
      return currentConf > bestConf ? current : best;
    });
  }
}

// ============================================================================
// Composite Strategy
// ============================================================================

/**
 * Combines multiple strategies with weighted averaging
 */
export class CompositeStrategy implements PricingStrategy {
  readonly name = 'composite';
  readonly displayName = 'Composite Strategy';
  readonly supportedMarketTypes: MarketType[] = [
    'binary_price',
    'binary_event',
    'categorical',
    'continuous',
  ];

  constructor(
    private strategies: PricingStrategy[],
    private weights?: Map<string, number>
  ) {}

  calculateFairPrice(
    market: MarketDefinition,
    data: PricingData
  ): PricingResult {
    const applicable = this.strategies.filter(s => s.canPrice(market));
    if (applicable.length === 0) {
      return {
        fairPrice: 0.5,
        confidence: 0,
        strategy: this.name,
        method: 'no_applicable_strategy',
        inputs: {},
        timestamp: new Date(),
      };
    }

    // Calculate weighted average
    let totalWeight = 0;
    let weightedSum = 0;
    let weightedConfidence = 0;
    const inputs: Record<string, unknown> = { strategies: [] };

    for (const strategy of applicable) {
      const result = strategy.calculateFairPrice(market, data);
      const weight = this.weights?.get(strategy.name) ??
        strategy.getConfidence(market, data);

      weightedSum += result.fairPrice * weight;
      weightedConfidence += result.confidence * weight;
      totalWeight += weight;

      (inputs.strategies as unknown[]).push({
        name: strategy.name,
        fairPrice: result.fairPrice,
        confidence: result.confidence,
        weight,
      });
    }

    const fairPrice = totalWeight > 0 ? weightedSum / totalWeight : 0.5;
    const confidence = totalWeight > 0 ? weightedConfidence / totalWeight : 0;

    return {
      fairPrice,
      confidence,
      strategy: this.name,
      method: 'weighted_average',
      inputs,
      timestamp: new Date(),
    };
  }

  getConfidence(market: MarketDefinition, data: PricingData): number {
    const applicable = this.strategies.filter(s => s.canPrice(market));
    if (applicable.length === 0) return 0;

    // Average confidence of applicable strategies
    const sum = applicable.reduce(
      (acc, s) => acc + s.getConfidence(market, data),
      0
    );
    return sum / applicable.length;
  }

  canPrice(market: MarketDefinition): boolean {
    return this.strategies.some(s => s.canPrice(market));
  }

  validateData(
    market: MarketDefinition,
    data: PricingData
  ): { valid: boolean; missingFields: string[] } {
    const applicable = this.strategies.filter(s => s.canPrice(market));
    const allMissing = new Set<string>();

    for (const strategy of applicable) {
      const { missingFields } = strategy.validateData(market, data);
      missingFields.forEach(f => allMissing.add(f));
    }

    return {
      valid: allMissing.size === 0,
      missingFields: Array.from(allMissing),
    };
  }
}

// ============================================================================
// Global Registry Instance
// ============================================================================

export const strategyRegistry = new StrategyRegistry();
