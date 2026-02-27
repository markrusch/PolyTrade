/**
 * Market Utilities
 * Functions for detecting market types, parsing outcomes, and market analysis
 */

import type { CryptoTicker, StrikeMarketInfo, WiredMarketInfo } from '../api';

// Supported crypto tickers
export const CRYPTO_TICKERS: CryptoTicker[] = ['BTC', 'ETH', 'SOL', 'XRP'];

/**
 * Check if a market is a crypto prediction market
 * Crypto markets have a crypto ticker and strike price
 */
export function isCryptoMarket(market: {
  crypto?: CryptoTicker | string | null;
  strike?: number | null;
}): boolean {
  return !!market.crypto && !!market.strike && market.strike > 0;
}

/**
 * Check if a string is a valid crypto ticker
 */
export function isValidCryptoTicker(ticker: string | undefined | null): ticker is CryptoTicker {
  if (!ticker) return false;
  return CRYPTO_TICKERS.includes(ticker.toUpperCase() as CryptoTicker);
}

/**
 * Get the outcome (YES/NO) for a token ID given the market's clob token IDs
 * clobTokenIds[0] = YES, clobTokenIds[1] = NO
 */
export function getMarketOutcome(
  tokenId: string,
  clobTokenIds?: string[] | string | null
): 'YES' | 'NO' | 'UNKNOWN' {
  if (!clobTokenIds) return 'UNKNOWN';

  // Parse if string
  const tokens = typeof clobTokenIds === 'string'
    ? JSON.parse(clobTokenIds)
    : clobTokenIds;

  if (!Array.isArray(tokens) || tokens.length < 2) return 'UNKNOWN';

  if (tokenId === tokens[0]) return 'YES';
  if (tokenId === tokens[1]) return 'NO';

  return 'UNKNOWN';
}

/**
 * Get the outcome from a StrikeMarketInfo based on token ID
 */
export function getOutcomeFromStrikeMarket(
  tokenId: string,
  market: StrikeMarketInfo
): 'YES' | 'NO' | 'UNKNOWN' {
  if (tokenId === market.yesTokenId) return 'YES';
  if (tokenId === market.noTokenId) return 'NO';
  return 'UNKNOWN';
}

/**
 * Parse outcome from position or order that may have outcome string
 */
export function parseOutcome(outcome?: string | null): 'YES' | 'NO' | 'UNKNOWN' {
  if (!outcome) return 'UNKNOWN';
  const upper = outcome.toUpperCase();
  if (upper === 'YES' || upper === 'Y') return 'YES';
  if (upper === 'NO' || upper === 'N') return 'NO';
  return 'UNKNOWN';
}

/**
 * Get CSS class for outcome badge styling
 */
export function getOutcomeClass(outcome: 'YES' | 'NO' | 'UNKNOWN'): string {
  switch (outcome) {
    case 'YES': return 'outcome-yes';
    case 'NO': return 'outcome-no';
    default: return 'outcome-unknown';
  }
}

/**
 * Get display text for outcome
 */
export function getOutcomeDisplay(outcome: 'YES' | 'NO' | 'UNKNOWN'): string {
  switch (outcome) {
    case 'YES': return '✓ YES';
    case 'NO': return '✗ NO';
    default: return '? Unknown';
  }
}

/**
 * Determine status of a market based on subscription and data state
 */
export type MarketStatus = 'subscribed' | 'unsubscribed' | 'stale' | 'error';

export function getMarketStatus(market: {
  isSubscribed?: boolean;
  status?: string;
  lastUpdate?: string | Date | number | null;
  staleThreshold?: number; // ms
}): MarketStatus {
  const staleThreshold = market.staleThreshold || 60000; // Default 60s

  if (market.status === 'error') return 'error';
  if (!market.isSubscribed) return 'unsubscribed';

  // Check staleness
  if (market.lastUpdate) {
    const lastUpdateTime = typeof market.lastUpdate === 'number'
      ? market.lastUpdate
      : new Date(market.lastUpdate).getTime();

    if (Date.now() - lastUpdateTime > staleThreshold) {
      return 'stale';
    }
  }

  return 'subscribed';
}

/**
 * Get status badge CSS class
 */
export function getStatusClass(status: MarketStatus): string {
  switch (status) {
    case 'subscribed': return 'status-active';
    case 'unsubscribed': return 'status-inactive';
    case 'stale': return 'status-warning';
    case 'error': return 'status-error';
    default: return '';
  }
}

/**
 * Format time ago string
 */
export function formatTimeAgo(timestamp: Date | string | number | null | undefined): string {
  if (!timestamp) return 'Never';

  const time = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
  const seconds = Math.floor((Date.now() - time) / 1000);

  if (seconds < 5) return 'Just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Check if market data is fresh (not stale)
 */
export function isDataFresh(
  lastUpdate: Date | string | number | null | undefined,
  thresholdMs: number = 60000
): boolean {
  if (!lastUpdate) return false;
  const time = typeof lastUpdate === 'number' ? lastUpdate : new Date(lastUpdate).getTime();
  return Date.now() - time < thresholdMs;
}

/**
 * Get freshness indicator color
 */
export function getFreshnessColor(
  lastUpdate: Date | string | number | null | undefined,
  thresholds: { fresh: number; stale: number } = { fresh: 30000, stale: 60000 }
): 'green' | 'yellow' | 'red' | 'gray' {
  if (!lastUpdate) return 'gray';

  const time = typeof lastUpdate === 'number' ? lastUpdate : new Date(lastUpdate).getTime();
  const age = Date.now() - time;

  if (age < thresholds.fresh) return 'green';
  if (age < thresholds.stale) return 'yellow';
  return 'red';
}

/**
 * Extract crypto ticker from market title/question
 * Matches patterns like "BTC above $90,000" or "Will ETH be above..."
 */
export function extractCryptoFromTitle(title: string): CryptoTicker | null {
  const upperTitle = title.toUpperCase();

  for (const ticker of CRYPTO_TICKERS) {
    if (upperTitle.includes(ticker)) {
      return ticker;
    }
  }

  // Also check common full names
  if (upperTitle.includes('BITCOIN')) return 'BTC';
  if (upperTitle.includes('ETHEREUM')) return 'ETH';
  if (upperTitle.includes('SOLANA')) return 'SOL';
  if (upperTitle.includes('RIPPLE')) return 'XRP';

  return null;
}

/**
 * Extract strike price from market title
 * Matches patterns like "above $90,000" or "$3,500"
 */
export function extractStrikeFromTitle(title: string): number | null {
  // Match dollar amounts like $90,000 or $3500 or $90000
  const match = title.match(/\$([0-9,]+(?:\.[0-9]+)?)/);
  if (match) {
    const value = parseFloat(match[1].replace(/,/g, ''));
    if (!isNaN(value) && value > 0) return value;
  }
  return null;
}

/**
 * Unified market row type for display
 */
export interface MarketRow {
  tokenId: string;
  title: string;
  outcome: 'YES' | 'NO' | 'UNKNOWN';
  crypto: CryptoTicker | null;
  strike: number | null;
  expiry: Date | null;
  slug?: string;

  // Status
  isSubscribed: boolean;
  isCryptoMarket: boolean;
  hasPosition: boolean;
  hasOrders: boolean;
  positionSize?: number;
  orderCount?: number;

  // Data freshness
  lastOrderbookUpdate: Date | null;
  lastPricingUpdate: Date | null;

  // Pricing (only if crypto market & subscribed)
  spotPrice: number | null;
  impliedVolatility: number | null;
  fairPrice: number | null;
  greeks: {
    delta: number;
    gamma: number;
    vega: number;
    theta: number;
  } | null;
  edge: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
}

/**
 * Create a MarketRow from a WiredMarketInfo
 */
export function wiredMarketToRow(market: WiredMarketInfo): Partial<MarketRow> {
  return {
    tokenId: market.tokenId,
    crypto: market.crypto,
    strike: market.strike,
    expiry: market.expiry ? new Date(market.expiry) : null,
    isSubscribed: market.status === 'active',
    isCryptoMarket: true,
    spotPrice: market.spotPrice,
    impliedVolatility: market.impliedVolatility,
    fairPrice: market.fairPrice,
    greeks: market.greeks ? {
      delta: market.greeks.delta,
      gamma: market.greeks.gamma,
      vega: market.greeks.vega,
      theta: market.greeks.theta,
    } : null,
    edge: market.edge,
    bestBid: market.bestBid,
    bestAsk: market.bestAsk,
    spread: market.spread,
    lastPricingUpdate: market.lastUpdate ? new Date(market.lastUpdate) : null,
  };
}
