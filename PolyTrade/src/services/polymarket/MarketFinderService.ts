/**
 * Market Finder Service
 * Discovers multi-strike crypto prediction markets on Polymarket
 *
 * Supports finding markets like "Will BTC be above $100,000 on January 28?"
 * for BTC, ETH, SOL, and XRP cryptocurrencies.
 */

import { Logger } from '../../lib/logger/index.js';
import { CacheManager } from '../../lib/cache/CacheManager.js';

// Supported cryptocurrencies
export type CryptoTicker = 'BTC' | 'ETH' | 'SOL' | 'XRP';

// Raw market data from Polymarket API
export interface RawMarket {
  id: string;
  question: string;
  slug: string;
  conditionId: string;
  endDate: string;
  startDate: string;
  clobTokenIds: string;
  outcomes: string;
  outcomePrices: string;
  groupItemTitle: string;
  groupItemThreshold: string;
  volume: string;
  liquidity: string;
  active: boolean;
  closed: boolean;
  archived?: boolean;
  restricted: boolean;
  questionID: string;
  enableOrderBook: boolean;
  orderPriceMinTickSize: number;
  orderMinSize: number;
  volumeNum: number;
  liquidityNum: number;
  endDateIso: string;
  startDateIso: string;
  volume24hr?: number | string;
  volume1wk?: number | string;
  liquidityClob?: number | string;
  spread?: number | string;
  bestBid?: number | string;
  bestAsk?: number | string;
  negRisk: boolean;
  acceptingOrders: boolean;
}

// Raw event data from Polymarket API
export interface RawEvent {
  id: string;
  ticker: string;
  slug: string;
  title: string;
  endDate: string;
  active: boolean;
  closed: boolean;
  markets: RawMarket[];
}

// Parsed strike market
export interface StrikeMarket {
  strike: number;
  slug: string;
  question: string;
  yesTokenId: string;
  noTokenId: string;
  yesPrice: number;
  noPrice: number;
  bestBid: number | null;
  bestAsk: number | null;
  volume24hr: number;
  liquidity: number;
  spread: number;
  active: boolean;
  acceptingOrders: boolean;
}

// Event with all strikes for a specific date
export interface CryptoEvent {
  crypto: CryptoTicker;
  eventSlug: string;
  eventTitle: string;
  eventDate: Date;
  endDate: Date;
  strikes: StrikeMarket[];
}

// Discovery result for a crypto over multiple dates
export interface DiscoveryResult {
  crypto: CryptoTicker;
  events: CryptoEvent[];
  totalStrikes: number;
  discoveredAt: Date;
}

// Configuration for market finder
export interface MarketFinderConfig {
  cacheTtl?: number;           // Cache TTL in ms (default: 5 min)
  maxDaysAhead?: number;       // Max days to scan (default: 100)
  consecutiveEmptyDays?: number; // Stop after N consecutive empty days (default: 5)
  requestDelay?: number;       // Delay between API requests in ms (default: 100)
}

const GAMMA_API_BASE = 'https://gamma-api.polymarket.com';

const CRYPTO_SLUGS: Record<CryptoTicker, string> = {
  'BTC': 'bitcoin',
  'ETH': 'ethereum',
  'SOL': 'solana',
  'XRP': 'xrp'
};

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'
];

export class MarketFinderService {
  private logger: Logger;
  private cache: CacheManager<DiscoveryResult>;
  private config: Required<MarketFinderConfig>;

  constructor(logger: Logger, config: MarketFinderConfig = {}) {
    this.logger = logger.child('MarketFinder');
    this.config = {
      cacheTtl: config.cacheTtl ?? 300000, // 5 minutes
      maxDaysAhead: config.maxDaysAhead ?? 100,
      consecutiveEmptyDays: config.consecutiveEmptyDays ?? 5,
      requestDelay: config.requestDelay ?? 100,
    };
    this.cache = new CacheManager<DiscoveryResult>({
      defaultTtl: this.config.cacheTtl,
    });
  }

  /**
   * Format date to slug format: "january-28"
   */
  private formatDateSlug(date: Date): string {
    return `${MONTHS[date.getMonth()]}-${date.getDate()}`;
  }

  /**
   * Build event slug: "bitcoin-above-on-january-28"
   */
  private getEventSlug(crypto: CryptoTicker, date: Date): string {
    const cryptoSlug = CRYPTO_SLUGS[crypto];
    return `${cryptoSlug}-above-on-${this.formatDateSlug(date)}`;
  }

  /**
   * Safely parse JSON that might already be an object
   */
  private safeParseJSON<T>(value: string | T | undefined | null): T | null {
    if (value === undefined || value === null) return null;
    if (typeof value === 'object') return value as T;
    if (typeof value === 'string') {
      try {
        return JSON.parse(value) as T;
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * Fetch event by crypto and date
   */
  async fetchEventByDate(crypto: CryptoTicker, date: Date): Promise<RawEvent | null> {
    const slug = this.getEventSlug(crypto, date);
    const url = `${GAMMA_API_BASE}/events/slug/${slug}`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(`HTTP ${response.status} for ${slug}`);
      }

      const event = (await response.json()) as RawEvent;

      if (!event.markets || !Array.isArray(event.markets)) {
        return null;
      }

      return event;
    } catch (error) {
      if (error instanceof Error && error.message.includes('404')) {
        return null;
      }
      this.logger.debug(`Failed to fetch ${slug}`, { error });
      return null;
    }
  }

  /**
   * Parse raw market to strike market
   */
  private parseMarket(market: RawMarket): StrikeMarket | null {
    try {
      const tokenIds = this.safeParseJSON<string[]>(market.clobTokenIds);
      const prices = this.safeParseJSON<string[]>(market.outcomePrices);

      // Parse strike from groupItemTitle (e.g., "100,000" -> 100000)
      const strike = parseInt(market.groupItemTitle.replace(/,/g, ''));

      if (isNaN(strike) || !tokenIds || tokenIds.length < 2) {
        return null;
      }

      return {
        strike,
        slug: market.slug,
        question: market.question,
        yesTokenId: tokenIds[0] || '',
        noTokenId: tokenIds[1] || '',
        yesPrice: prices?.[0] ? parseFloat(prices[0]) : 0,
        noPrice: prices?.[1] ? parseFloat(prices[1]) : 0,
        bestBid: market.bestBid ? parseFloat(String(market.bestBid)) : null,
        bestAsk: market.bestAsk ? parseFloat(String(market.bestAsk)) : null,
        volume24hr: market.volume24hr ? parseFloat(String(market.volume24hr)) : 0,
        liquidity: market.liquidityClob ? parseFloat(String(market.liquidityClob)) : parseFloat(market.liquidity),
        spread: market.spread ? parseFloat(String(market.spread)) : 0,
        active: market.active && !market.closed && !market.archived,
        acceptingOrders: market.acceptingOrders,
      };
    } catch (error) {
      this.logger.debug('Failed to parse market', { slug: market.slug, error });
      return null;
    }
  }

  /**
   * Parse event to crypto event with all strikes
   */
  private parseEvent(event: RawEvent, crypto: CryptoTicker): CryptoEvent | null {
    const strikes: StrikeMarket[] = [];

    for (const market of event.markets) {
      const parsed = this.parseMarket(market);
      if (parsed) {
        strikes.push(parsed);
      }
    }

    if (strikes.length === 0) {
      return null;
    }

    // Sort strikes ascending
    strikes.sort((a, b) => a.strike - b.strike);

    return {
      crypto,
      eventSlug: event.slug,
      eventTitle: event.title,
      eventDate: new Date(event.endDate),
      endDate: new Date(event.endDate),
      strikes,
    };
  }

  /**
   * Discover all markets for a cryptocurrency over next N days
   */
  async discoverMarkets(
    crypto: CryptoTicker,
    daysAhead: number = this.config.maxDaysAhead
  ): Promise<DiscoveryResult> {
    // Check cache first
    const cacheKey = `discovery:${crypto}:${daysAhead}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.logger.debug(`Using cached discovery for ${crypto}`);
      return cached;
    }

    this.logger.info(`Discovering ${crypto} markets for next ${daysAhead} days`);

    const events: CryptoEvent[] = [];
    const today = new Date();
    let consecutiveEmpty = 0;

    for (let i = 0; i < daysAhead; i++) {
      const date = new Date(today);
      date.setDate(today.getDate() + i);

      const rawEvent = await this.fetchEventByDate(crypto, date);

      if (!rawEvent || rawEvent.markets.length === 0) {
        consecutiveEmpty++;
        if (consecutiveEmpty >= this.config.consecutiveEmptyDays) {
          this.logger.debug(`Stopping: ${consecutiveEmpty} consecutive empty days`);
          break;
        }
        continue;
      }

      consecutiveEmpty = 0;

      const cryptoEvent = this.parseEvent(rawEvent, crypto);
      if (cryptoEvent) {
        events.push(cryptoEvent);
        this.logger.debug(`Found ${cryptoEvent.strikes.length} strikes for ${this.formatDateSlug(date)}`);
      }

      // Rate limiting
      await this.delay(this.config.requestDelay);
    }

    const result: DiscoveryResult = {
      crypto,
      events,
      totalStrikes: events.reduce((sum, e) => sum + e.strikes.length, 0),
      discoveredAt: new Date(),
    };

    this.cache.set(cacheKey, result);
    this.logger.info(`Discovered ${result.totalStrikes} ${crypto} strikes across ${events.length} dates`);

    return result;
  }

  /**
   * Discover markets for all supported cryptos
   */
  async discoverAllMarkets(
    cryptos: CryptoTicker[] = ['BTC', 'ETH', 'SOL', 'XRP'],
    daysAhead: number = this.config.maxDaysAhead
  ): Promise<Map<CryptoTicker, DiscoveryResult>> {
    const results = new Map<CryptoTicker, DiscoveryResult>();

    for (const crypto of cryptos) {
      const result = await this.discoverMarkets(crypto, daysAhead);
      results.set(crypto, result);
    }

    return results;
  }

  /**
   * Get strikes for a specific crypto and date
   */
  async getStrikesForDate(crypto: CryptoTicker, date: Date): Promise<StrikeMarket[]> {
    const rawEvent = await this.fetchEventByDate(crypto, date);

    if (!rawEvent) {
      return [];
    }

    const cryptoEvent = this.parseEvent(rawEvent, crypto);
    return cryptoEvent?.strikes ?? [];
  }

  /**
   * Find nearest strike to a target price
   */
  findNearestStrike(strikes: StrikeMarket[], targetPrice: number): StrikeMarket | null {
    if (strikes.length === 0) return null;

    return strikes.reduce((nearest, current) => {
      const currentDiff = Math.abs(current.strike - targetPrice);
      const nearestDiff = Math.abs(nearest.strike - targetPrice);
      return currentDiff < nearestDiff ? current : nearest;
    });
  }

  /**
   * Get ATM (at-the-money) and surrounding strikes
   */
  getATMStrikes(strikes: StrikeMarket[], spotPrice: number, count: number = 5): StrikeMarket[] {
    if (strikes.length === 0) return [];

    // Find ATM index
    let atmIndex = 0;
    let minDiff = Infinity;

    for (let i = 0; i < strikes.length; i++) {
      const diff = Math.abs(strikes[i].strike - spotPrice);
      if (diff < minDiff) {
        minDiff = diff;
        atmIndex = i;
      }
    }

    // Get surrounding strikes
    const halfCount = Math.floor(count / 2);
    const startIndex = Math.max(0, atmIndex - halfCount);
    const endIndex = Math.min(strikes.length, startIndex + count);

    return strikes.slice(startIndex, endIndex);
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Destroy service
   */
  destroy(): void {
    this.cache.destroy();
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
