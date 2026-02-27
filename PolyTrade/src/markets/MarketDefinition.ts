/**
 * MarketDefinition Interface
 *
 * Type-agnostic market definition supporting:
 * - Binary price markets (crypto above/below X)
 * - Binary event markets (political, sports, etc.)
 * - Categorical markets (multi-outcome)
 * - Continuous markets (range predictions)
 *
 * @see REDESIGN_V2.md Section 5.2
 */

import type { PlatformName } from '../platforms/TradingPlatform.js';

// ============================================================================
// Market Type Enumeration
// ============================================================================

/**
 * Market type classification.
 * Determines which pricing strategies and data sources are applicable.
 */
export type MarketType =
  | 'binary_price'    // "Will ETH be above $4000?" - Uses Black-Scholes
  | 'binary_event'    // "Will Trump win?" - Uses statistical/poll-based pricing
  | 'categorical'     // "Which team wins Super Bowl?" - Multi-outcome
  | 'continuous';     // "What will ETH price be?" - Range prediction

// ============================================================================
// Outcome Types
// ============================================================================

/**
 * Represents a single outcome in a market.
 * Binary markets have 2 outcomes (YES/NO), categorical can have many.
 */
export interface Outcome {
  id: string;                   // Internal outcome ID
  platformTokenId?: string;     // Platform-specific token/contract ID
  name: string;                 // Display name: "YES", "NO", "Lakers", "Trump"
  description?: string;         // Extended description
  currentPrice?: number;        // Latest price (0-1)
  lastTradePrice?: number;      // Last traded price
  volume24h?: number;           // 24-hour trading volume
  metadata?: Record<string, unknown>; // Platform-specific data
}

// ============================================================================
// Platform-Specific Metadata Types
// ============================================================================

/**
 * Polymarket-specific metadata
 */
export interface PolymarketMetadata {
  conditionId: string;          // Condition ID for the market
  clobTokenIds: string[];       // CLOB token IDs for each outcome
  negRisk: boolean;             // Whether this is a negative risk market
  slug?: string;                // Market slug for URL
  questionId?: string;          // Question ID
  feePercentage?: number;       // Trading fee percentage
}

/**
 * Kalshi-specific metadata
 */
export interface KalshiMetadata {
  ticker: string;               // e.g., "PRES-2024-DEM"
  seriesId: string;             // Series this market belongs to
  rangeStart?: number;          // For range markets
  rangeEnd?: number;            // For range markets
  strikePrice?: number;         // For price threshold markets
  settlementSource?: string;    // Data source for settlement
}

/**
 * PredictIt-specific metadata
 */
export interface PredictItMetadata {
  marketId: number;
  contractIds: number[];        // Contract IDs for each outcome
  url?: string;
}

// ============================================================================
// Price-Based Market Metadata
// ============================================================================

/**
 * Metadata for binary price markets (crypto, commodities, etc.)
 */
export interface PriceMarketMetadata {
  underlying: string;           // "ETH", "BTC", "GOLD", etc.
  strike: number;               // Strike/threshold price
  direction: 'above' | 'below' | 'between';
  upperBound?: number;          // For "between" markets
  lowerBound?: number;          // For "between" markets
  settlementTime?: 'close' | 'expiry' | 'exact'; // When to check price
  priceSource?: string;         // Where price is sourced from
}

/**
 * Metadata for binary event markets
 */
export interface EventMarketMetadata {
  eventType: 'election' | 'sports' | 'weather' | 'regulatory' | 'custom';
  region?: string;              // Geographic region
  sport?: string;               // For sports events
  league?: string;              // For sports events
  settlementSource?: string;    // How outcome is determined
}

/**
 * Metadata for categorical markets
 */
export interface CategoricalMarketMetadata {
  category: string;             // Category type
  mutuallyExclusive: boolean;   // Whether only one outcome can win
  allowMultipleWinners?: boolean;
}

// ============================================================================
// Core Market Definition
// ============================================================================

/**
 * Unified market definition supporting all market types and platforms.
 */
export interface MarketDefinition {
  // =========================================================================
  // Core Identity
  // =========================================================================

  /** Internal unique identifier (UUID) */
  id: string;

  /** Platform-specific market ID */
  platformMarketId: string;

  /** Which platform this market is on */
  platform: PlatformName;

  /** Market classification */
  type: MarketType;

  // =========================================================================
  // Question & Description
  // =========================================================================

  /** The market question */
  question: string;

  /** Extended description */
  description?: string;

  /** Category/tag for grouping */
  category?: string;

  // =========================================================================
  // Outcomes
  // =========================================================================

  /** Available outcomes for this market */
  outcomes: Outcome[];

  // =========================================================================
  // Timing
  // =========================================================================

  /** When the market expires/closes for trading */
  expiresAt: Date;

  /** When the market resolves (if different from expiry) */
  resolvesAt?: Date;

  /** When trading stops (if different from expiry) */
  closesAt?: Date;

  /** When the market was created */
  createdAt?: Date;

  // =========================================================================
  // Resolution Status
  // =========================================================================

  /** Whether the market is currently active for trading */
  active: boolean;

  /** Whether the market has been resolved */
  resolved: boolean;

  /** Which outcome won (outcome ID) */
  resolutionOutcome?: string;

  /** Resolution value for continuous markets */
  resolutionValue?: number;

  // =========================================================================
  // Flexible Metadata (JSON)
  // =========================================================================

  /**
   * Type-specific and platform-specific metadata.
   * Contains all the additional data needed for pricing and trading.
   */
  metadata: {
    // For binary_price markets
    priceMarket?: PriceMarketMetadata;

    // For binary_event markets
    eventMarket?: EventMarketMetadata;

    // For categorical markets
    categoricalMarket?: CategoricalMarketMetadata;

    // Platform-specific data
    polymarket?: PolymarketMetadata;
    kalshi?: KalshiMetadata;
    predictit?: PredictItMetadata;

    // Generic additional data
    [key: string]: unknown;
  };

  // =========================================================================
  // Trading Parameters
  // =========================================================================

  /** Minimum order size */
  minOrderSize?: number;

  /** Price tick size (e.g., 0.01 for 1 cent) */
  tickSize?: number;

  /** Maximum position size */
  maxPositionSize?: number;
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a binary price market definition (e.g., "ETH above $4000")
 */
export function createBinaryPriceMarket(params: {
  id: string;
  platformMarketId: string;
  platform: PlatformName;
  question: string;
  underlying: string;
  strike: number;
  direction: 'above' | 'below';
  expiresAt: Date;
  outcomes: Outcome[];
  platformMetadata?: Record<string, unknown>;
}): MarketDefinition {
  return {
    id: params.id,
    platformMarketId: params.platformMarketId,
    platform: params.platform,
    type: 'binary_price',
    question: params.question,
    outcomes: params.outcomes,
    expiresAt: params.expiresAt,
    active: true,
    resolved: false,
    metadata: {
      priceMarket: {
        underlying: params.underlying,
        strike: params.strike,
        direction: params.direction,
      },
      ...params.platformMetadata,
    },
    tickSize: 0.01,
    minOrderSize: 1,
  };
}

/**
 * Create a binary event market (e.g., "Will Trump win?")
 */
export function createBinaryEventMarket(params: {
  id: string;
  platformMarketId: string;
  platform: PlatformName;
  question: string;
  eventType: 'election' | 'sports' | 'weather' | 'regulatory' | 'custom';
  expiresAt: Date;
  outcomes: Outcome[];
  platformMetadata?: Record<string, unknown>;
}): MarketDefinition {
  return {
    id: params.id,
    platformMarketId: params.platformMarketId,
    platform: params.platform,
    type: 'binary_event',
    question: params.question,
    outcomes: params.outcomes,
    expiresAt: params.expiresAt,
    active: true,
    resolved: false,
    metadata: {
      eventMarket: {
        eventType: params.eventType,
      },
      ...params.platformMetadata,
    },
    tickSize: 0.01,
    minOrderSize: 1,
  };
}

/**
 * Create a categorical market (e.g., "Which team wins Super Bowl?")
 */
export function createCategoricalMarket(params: {
  id: string;
  platformMarketId: string;
  platform: PlatformName;
  question: string;
  category: string;
  expiresAt: Date;
  outcomes: Outcome[];
  mutuallyExclusive?: boolean;
  platformMetadata?: Record<string, unknown>;
}): MarketDefinition {
  return {
    id: params.id,
    platformMarketId: params.platformMarketId,
    platform: params.platform,
    type: 'categorical',
    question: params.question,
    outcomes: params.outcomes,
    expiresAt: params.expiresAt,
    active: true,
    resolved: false,
    metadata: {
      categoricalMarket: {
        category: params.category,
        mutuallyExclusive: params.mutuallyExclusive ?? true,
      },
      ...params.platformMetadata,
    },
    tickSize: 0.01,
    minOrderSize: 1,
  };
}

// ============================================================================
// Type Guards
// ============================================================================

export function isBinaryPriceMarket(market: MarketDefinition): boolean {
  return market.type === 'binary_price' && !!market.metadata.priceMarket;
}

export function isBinaryEventMarket(market: MarketDefinition): boolean {
  return market.type === 'binary_event' && !!market.metadata.eventMarket;
}

export function isCategoricalMarket(market: MarketDefinition): boolean {
  return market.type === 'categorical';
}

export function isContinuousMarket(market: MarketDefinition): boolean {
  return market.type === 'continuous';
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get the primary outcome (YES) for binary markets
 */
export function getPrimaryOutcome(market: MarketDefinition): Outcome | undefined {
  if (market.type !== 'binary_price' && market.type !== 'binary_event') {
    return undefined;
  }
  return market.outcomes.find(o =>
    o.name.toUpperCase() === 'YES' ||
    o.name.toUpperCase() === 'ABOVE' ||
    o.name.toUpperCase() === 'TRUE'
  ) || market.outcomes[0];
}

/**
 * Get time to expiry in years (for Black-Scholes calculations)
 */
export function getTimeToExpiry(market: MarketDefinition): number {
  const now = new Date();
  const expiry = market.expiresAt;
  const diffMs = expiry.getTime() - now.getTime();
  const diffYears = diffMs / (1000 * 60 * 60 * 24 * 365.25);
  return Math.max(0, diffYears);
}

/**
 * Check if market is expired
 */
export function isExpired(market: MarketDefinition): boolean {
  return new Date() > market.expiresAt;
}

/**
 * Check if market is tradeable
 */
export function isTradeable(market: MarketDefinition): boolean {
  return market.active && !market.resolved && !isExpired(market);
}
