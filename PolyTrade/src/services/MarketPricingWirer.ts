/**
 * Market Pricing Wirer
 *
 * Orchestrates automatic pricing setup for discovered crypto prediction markets.
 * Connects markets to:
 * 1. Binance spot price feed (for underlying price)
 * 2. Deribit IV feed (for implied volatility matched to expiry)
 * 3. Polymarket orderbook streaming
 * 4. Greeks calculation
 */

import { Logger } from "../lib/logger/index.js";
import { ServiceRegistry } from "../lib/ServiceRegistry.js";
import { CacheManager } from "../lib/cache/CacheManager.js";
import {
  calculateBinaryGreeks,
  BinaryGreeks,
  BinaryPricing,
} from "../pricing/BinaryGreeksCalculator.js";
import type {
  StrikeMarket,
  CryptoTicker,
} from "./polymarket/MarketFinderService.js";
import type { HybridStreamManager } from "./polymarket/streaming/HybridStreamManager.js";
import type { DeribitListener } from "./deribit/DeribitListener.js";
import type { BinancePriceListener } from "./binance/BinancePriceListener.js";
import type { BinanceWsClient } from "./binance/BinanceWsClient.js";
import { Strategy } from "./market-maker/Strategy.js";
import type {
  PricingConfig,
  MarketMakerConfig,
  SafetyConfig,
  PerformanceConfig,
} from "../lib/config/schema.js";

// Binance symbol mapping
const BINANCE_SYMBOLS: Record<CryptoTicker, string> = {
  BTC: "BTCUSDT",
  ETH: "ETHUSDT",
  SOL: "SOLUSDT",
  XRP: "XRPUSDT",
};

// Data source types for visibility
export type DataSource = 'binance' | 'deribit' | 'fallback' | 'cache';

// Wired market with live pricing data
export interface WiredMarket {
  tokenId: string;
  crypto: CryptoTicker;
  strike: number;
  expiry: Date;
  slug: string;

  // Live data
  spotPrice: number | null;
  spotSource?: DataSource; // Where spot price came from
  impliedVolatility: number | null;
  ivSource?: DataSource; // Where IV came from
  timeToExpiry: number; // In years

  // Pricing
  fairPrice: number | null;
  greeks: BinaryGreeks | null;

  // Market data
  marketBid: number | null;
  marketAsk: number | null;
  spread: number | null;
  edge: number | null; // fairPrice - midMarket

  // Derived quotes from Strategy
  derivedBid?: number;
  derivedAsk?: number;
  derivedMid?: number;
  derivedSpread?: number;
  derivedEdge?: number; // derivedMid - marketMid

  // Inventory tracking
  inventory?: number; // Net position quantity
  avgEntryPrice?: number;
  realizedPnL?: number;
  unrealizedPnL?: number;

  // Safety monitoring
  safeToQuote?: boolean;
  unsafeReasons?: string[];
  lastOrderbookUpdate?: number;
  orderbookBidSize?: number;
  orderbookAskSize?: number;

  // Status
  status: "initializing" | "active" | "stale" | "error";
  lastUpdate: Date;
  errors: string[];
}

// Pricing update event
export interface PricingUpdate {
  tokenId: string;
  timestamp: number;
  spotPrice: number;
  impliedVolatility: number;
  timeToExpiry: number;
  pricing: BinaryPricing;
  marketMid: number | null;
  edge: number | null;
}

// Callback for pricing updates
export type PricingCallback = (update: PricingUpdate) => void;

export interface WirerConfig {
  updateInterval?: number; // Pricing update interval in ms (default: 1000)
  staleThreshold?: number; // Time without update before considered stale (default: 60000)
  autoStartServices?: boolean; // Auto-start Binance/Deribit services (default: true)
  pricing?: PricingConfig; // Pricing configuration (risk-free rate, etc.)
  marketMaker?: MarketMakerConfig; // Market maker configuration (spreads, limits)
  safety?: SafetyConfig; // Safety configuration (staleness thresholds)
  performance?: PerformanceConfig; // Performance configuration (batch size, cache TTLs)
  spotPriceFallback?: (crypto: CryptoTicker) => number | null; // Fallback spot price provider
}

export class MarketPricingWirer {
  private logger: Logger;
  private serviceRegistry: ServiceRegistry;
  private streamManager: HybridStreamManager;
  private config: Required<Omit<WirerConfig, 'spotPriceFallback'>>;
  private spotPriceFallback?: (crypto: CryptoTicker) => number | null;
  private strategy: Strategy;

  private wiredMarkets: Map<string, WiredMarket> = new Map();
  private callbacks: Map<string, Set<PricingCallback>> = new Map();
  private updateIntervals: Map<string, NodeJS.Timeout> = new Map();

  // Cache for spot prices and IV
  private spotCache: CacheManager<number>;
  private ivCache: CacheManager<number>;

  // Batched pricing and performance monitoring
  private batchInterval?: NodeJS.Timeout;
  private performanceMetrics = {
    batchUpdateCount: 0,
    totalBatchDuration: 0,
    avgBatchDuration: 0,
    maxBatchDuration: 0,
    marketCount: 0,
    cacheHits: 0,
    cacheMisses: 0,
    cacheHitRate: 0,
    lastMetricsLog: Date.now(),
  };

  constructor(
    logger: Logger,
    serviceRegistry: ServiceRegistry,
    streamManager: HybridStreamManager,
    config: WirerConfig = {},
  ) {
    this.logger = logger.child("MarketPricingWirer");
    this.serviceRegistry = serviceRegistry;
    this.streamManager = streamManager;

    this.spotPriceFallback = config.spotPriceFallback;

    this.config = {
      updateInterval: config.updateInterval ?? 1000,
      staleThreshold: config.staleThreshold ?? 60000,
      autoStartServices: config.autoStartServices ?? true,
      pricing: config.pricing ?? {
        riskFreeRate: 0.04,
        enableCarryCost: true,
      },
      marketMaker: config.marketMaker ?? {
        maxQuantityPerMarket: 1000,
        maxNotionalPerCrypto: 10000,
        maxGammaExposure: 0.5,
        baseSpread: 0.02,
        gammaCoefficient: 100,
        inventoryCoefficient: 0.0001,
      },
      safety: config.safety ?? {
        maxSpotStalenessMs: 5000,
        maxIvStalenessMs: 60000,
        maxSpotGapPercent: 0.02,
        maxOrderbookStalenessMs: 10000,
        minOrderbookDepth: 100,
      },
      performance: config.performance ?? {
        batchSize: 50,
        cacheSpotTtl: 30000,
        cacheIvTtl: 120000,
      },
    };

    this.spotCache = new CacheManager<number>({ defaultTtl: 30000 }); // 30s (was 5s)
    this.ivCache = new CacheManager<number>({ defaultTtl: 120000 }); // 120s (was 30s)

    // Initialize Strategy with QP services and config
    this.strategy = new Strategy(
      logger,
      serviceRegistry.getPortfolioGreeks(),
      serviceRegistry.getInventoryTracker(),
      {
        baseSpread: this.config.marketMaker?.baseSpread,
        gammaCoefficient: this.config.marketMaker?.gammaCoefficient,
        inventoryCoefficient: this.config.marketMaker?.inventoryCoefficient,
        minSpread: 0.005,
        maxSpread: 0.10,
      },
    );
  }

  /**
   * Wire a discovered market to pricing feeds
   */
  async wireMarket(
    market: StrikeMarket,
    crypto: CryptoTicker,
    expiry: Date,
  ): Promise<WiredMarket> {
    const tokenId = market.yesTokenId;

    // Validate crypto ticker
    const validCryptos = ["BTC", "ETH", "SOL", "XRP"];
    if (!validCryptos.includes(crypto)) {
      this.logger.warn(
        `Skipping wiring for invalid/non-crypto market: ${crypto} (${market.slug})`,
      );
      return {
        tokenId,
        crypto,
        strike: market.strike,
        expiry,
        slug: market.slug,
        spotPrice: null,
        impliedVolatility: null,
        timeToExpiry: 0,
        fairPrice: null,
        greeks: null,
        marketBid: null,
        marketAsk: null,
        spread: null,
        edge: null,
        status: "error",
        lastUpdate: new Date(),
        errors: [`Invalid crypto ticker: ${crypto}`],
      };
    }

    this.logger.info(
      `Wiring market: ${crypto} $${market.strike} expiring ${expiry.toISOString()}`,
    );

    // Create wired market entry
    const wiredMarket: WiredMarket = {
      tokenId,
      crypto,
      strike: market.strike,
      expiry,
      slug: market.slug,
      spotPrice: null,
      impliedVolatility: null,
      timeToExpiry: this.calculateTTE(expiry),
      fairPrice: null,
      greeks: null,
      marketBid: market.bestBid,
      marketAsk: market.bestAsk,
      spread: null,
      edge: null,
      status: "initializing",
      lastUpdate: new Date(),
      errors: [],
    };

    this.wiredMarkets.set(tokenId, wiredMarket);

    try {
      // 1. Ensure Binance service is running for this crypto
      await this.ensureBinanceService(crypto);

      // 2. Ensure Deribit service is running with matching expiry
      await this.ensureDeribitService(crypto, expiry);

      // 3. Wait for initial data from services
      await this.waitForInitialData(crypto, 15000);

      // 4. Subscribe to orderbook streaming
      await this.subscribeOrderbook(tokenId, market.slug);

      // 5. Start pricing updates
      this.startPricingUpdates(tokenId);

      // 6. Trigger initial pricing calculation
      await this.updatePricing(tokenId);

      wiredMarket.status = "active";
      this.logger.info(`Market wired successfully: ${tokenId}`);
    } catch (error) {
      wiredMarket.status = "error";
      wiredMarket.errors.push(
        error instanceof Error ? error.message : String(error),
      );
      this.logger.error(`Failed to wire market: ${tokenId}`, error as Error);
    }

    return wiredMarket;
  }

  /**
   * Unwire a market (stop pricing updates)
   */
  async unwireMarket(tokenId: string): Promise<void> {
    this.logger.info(`Unwiring market: ${tokenId}`);

    // Stop pricing updates
    const interval = this.updateIntervals.get(tokenId);
    if (interval) {
      clearInterval(interval);
      this.updateIntervals.delete(tokenId);
    }

    // Remove callbacks
    this.callbacks.delete(tokenId);

    // Remove from wired markets
    this.wiredMarkets.delete(tokenId);
  }

  /**
   * Subscribe to pricing updates for a market
   */
  onPricingUpdate(tokenId: string, callback: PricingCallback): () => void {
    let callbacks = this.callbacks.get(tokenId);
    if (!callbacks) {
      callbacks = new Set();
      this.callbacks.set(tokenId, callbacks);
    }
    callbacks.add(callback);

    // Return unsubscribe function
    return () => {
      callbacks?.delete(callback);
    };
  }

  /**
   * Get current pricing for a market
   */
  getPricing(tokenId: string): WiredMarket | null {
    return this.wiredMarkets.get(tokenId) || null;
  }

  /**
   * Get all wired markets
   */
  getAllWiredMarkets(): WiredMarket[] {
    return Array.from(this.wiredMarkets.values());
  }

  /**
   * Calculate pricing for a market with given inputs
   */
  calculatePricingForMarket(
    spot: number,
    strike: number,
    tte: number,
    iv: number,
  ): BinaryPricing {
    return calculateBinaryGreeks({
      spot,
      strike,
      tte,
      iv,
      isCall: true, // "above" markets are calls
      riskFreeRate: this.config.pricing?.riskFreeRate ?? 0.04, // 4% Polymarket holding rate
      enableCarryCost: this.config.pricing?.enableCarryCost ?? true, // Apply carry cost (r=0 when disabled)
    });
  }

  /**
   * Wait for initial data from services (Binance + Deribit in parallel)
   */
  private async waitForInitialData(
    crypto: CryptoTicker,
    timeout = 15000,
  ): Promise<void> {
    this.logger.info(`Waiting for initial data for ${crypto}...`, { timeout });

    const startTime = Date.now();
    const waits: Promise<void>[] = [];

    // Wait for Binance and Deribit in PARALLEL (not sequentially)
    const binanceService = this.serviceRegistry.getService(crypto, "binance");
    if (binanceService && typeof (binanceService as any).waitForData === "function") {
      waits.push(
        (binanceService as any).waitForData(timeout)
          .then(() => this.logger.info(`Binance data ready for ${crypto}`, { elapsed: Date.now() - startTime }))
          .catch((error: Error) => this.logger.warn(`Binance data timeout for ${crypto}`, error))
      );
    }

    const deribitService = this.serviceRegistry.getService(crypto, "deribit");
    if (deribitService && typeof (deribitService as any).waitForData === "function") {
      waits.push(
        (deribitService as any).waitForData(timeout)
          .then(() => this.logger.info(`Deribit IV ready for ${crypto}`, { elapsed: Date.now() - startTime }))
          .catch((error: Error) => this.logger.warn(`Deribit IV timeout for ${crypto}`, error))
      );
    }

    await Promise.allSettled(waits);

    this.logger.info(`Initial data ready for ${crypto}`, {
      totalElapsed: Date.now() - startTime,
    });
  }

  /**
   * Ensure Binance price service is running for crypto
   */
  private async ensureBinanceService(crypto: CryptoTicker): Promise<void> {
    if (!this.config.autoStartServices) return;

    const symbol = BINANCE_SYMBOLS[crypto];
    const status = this.serviceRegistry.getServiceStatus(crypto, "binance");

    if (status?.status === "running") {
      this.logger.debug(`Binance service already running for ${crypto}`);
      return;
    }

    this.logger.info(`Starting Binance service for ${crypto}`);

    try {
      const binanceService = this.serviceRegistry.getService(
        crypto,
        "binance",
      ) as BinancePriceListener | null;

      if (binanceService) {
        // Add symbol if not already tracked
        if (typeof binanceService.addSymbol === "function") {
          binanceService.addSymbol(BINANCE_SYMBOLS[crypto]);
        }
        await this.serviceRegistry.startService(crypto, "binance");
      } else {
        this.logger.warn(`No Binance service registered for ${crypto}`);
      }
    } catch (error) {
      this.logger.error(
        `Failed to start Binance service for ${crypto}`,
        error as Error,
      );
      throw error;
    }
  }

  /**
   * Ensure Deribit IV service is running for crypto with matching expiry
   */
  private async ensureDeribitService(
    crypto: CryptoTicker,
    expiry: Date,
  ): Promise<void> {
    if (!this.config.autoStartServices) return;

    const status = this.serviceRegistry.getServiceStatus(crypto, "deribit");

    if (status?.status === "running") {
      // Update target expiry if different
      const deribitService = this.serviceRegistry.getService(
        crypto,
        "deribit",
      ) as DeribitListener | null;
      if (
        deribitService &&
        typeof deribitService.setTargetExpiry === "function"
      ) {
        await deribitService.setTargetExpiry(expiry);
      }
      this.logger.debug(
        `Deribit service already running for ${crypto}, updated expiry`,
      );
      return;
    }

    this.logger.info(
      `Starting Deribit service for ${crypto} with expiry ${expiry.toISOString()}`,
    );

    try {
      const deribitService = this.serviceRegistry.getService(
        crypto,
        "deribit",
      ) as DeribitListener | null;

      if (deribitService) {
        // Get current spot price for ATM selection
        const spotResult = await this.getSpotPrice(crypto);
        const spotPrice = spotResult?.price ?? this.getDefaultSpotPrice(crypto);
        if (typeof deribitService.start === "function") {
          await deribitService.start({
            spotPrice,
            targetExpiry: expiry,
          });
        }
        await this.serviceRegistry.startService(crypto, "deribit");
      } else {
        this.logger.warn(`No Deribit service registered for ${crypto}`);
      }
    } catch (error) {
      this.logger.error(
        `Failed to start Deribit service for ${crypto}`,
        error as Error,
      );
      throw error;
    }
  }

  /**
   * Subscribe market to orderbook streaming
   */
  private async subscribeOrderbook(
    tokenId: string,
    slug: string,
  ): Promise<void> {
    try {
      await this.streamManager.subscribeMarket(tokenId, {
        slug,
        outcome: "yes",
        priority: 1, // High priority for wired markets
      });
    } catch (error) {
      this.logger.warn(
        `Failed to subscribe orderbook for ${tokenId}`,
        error as Error,
      );
      // Non-fatal - continue without orderbook
    }
  }

  /**
   * Start periodic pricing updates for a market
   */
  private startPricingUpdates(tokenId: string): void {
    // Clear existing interval if any
    const existing = this.updateIntervals.get(tokenId);
    if (existing) {
      clearInterval(existing);
    }

    const interval = setInterval(async () => {
      await this.updatePricing(tokenId);
    }, this.config.updateInterval);

    // Don't block process exit
    if (interval.unref) {
      interval.unref();
    }

    this.updateIntervals.set(tokenId, interval);
  }

  /**
   * Update pricing for a wired market
   */
  private async updatePricing(tokenId: string): Promise<void> {
    const market = this.wiredMarkets.get(tokenId);
    if (!market) return;

    try {
      // Get current spot price with source tracking
      const spotResult = await this.getSpotPrice(market.crypto);
      if (spotResult !== null) {
        market.spotPrice = spotResult.price;
        market.spotSource = spotResult.source;
      }

      // Get current IV with source tracking
      const ivResult = await this.getImpliedVolatility(market.crypto);
      market.impliedVolatility = ivResult.iv;
      market.ivSource = ivResult.source;

      // Update time to expiry
      market.timeToExpiry = this.calculateTTE(market.expiry);

      // Get latest orderbook data
      const tick = this.streamManager.getLatestOrderBook(tokenId);
      const orderbookTimestamp = Date.now();
      let orderbookDepth = 0;

      if (tick) {
        market.marketBid = tick.bestBid;
        market.marketAsk = tick.bestAsk;
        market.spread = tick.spreadBps;
        market.lastOrderbookUpdate = orderbookTimestamp;

        // Calculate orderbook depth (sum of bid and ask sizes if available)
        // Note: OrderBookTick may not have size info, default to 0
        orderbookDepth = 0; // TODO: Add size tracking if available
      }

      // Safety check: Verify it's safe to quote before pricing calculation
      const safetyMonitor = this.serviceRegistry.getSafetyMonitor();

      // Get actual timestamps from Binance and Deribit services
      let spotTimestamp = Date.now();
      const binanceService = this.serviceRegistry.getService(
        market.crypto,
        'binance',
      ) as BinanceWsClient | null;
      if (binanceService && typeof binanceService.getLastPriceTimestamp === 'function') {
        const symbol = BINANCE_SYMBOLS[market.crypto];
        spotTimestamp = binanceService.getLastPriceTimestamp(symbol);
      }

      let ivTimestamp = Date.now();
      const deribitService = this.serviceRegistry.getService(
        market.crypto,
        'deribit',
      ) as DeribitListener | null;
      if (deribitService && typeof deribitService.getLastUpdateTimestamp === 'function') {
        ivTimestamp = deribitService.getLastUpdateTimestamp();
      }

      const health = safetyMonitor.isSafeToQuote(
        tokenId,
        market.crypto,
        market.spotPrice ?? 0,
        spotTimestamp,
        ivTimestamp,
        orderbookTimestamp,
        orderbookDepth,
      );

      market.safeToQuote = health.safe;
      market.unsafeReasons = health.reasons;

      if (!health.safe) {
        this.logger.warn(`Unsafe to quote: ${tokenId}`, {
          reasons: health.reasons,
        });
        market.status = "error";
        return; // Skip pricing calculation
      }

      // Calculate pricing if we have all inputs
      if (
        market.spotPrice &&
        market.impliedVolatility &&
        market.timeToExpiry > 0
      ) {
        const pricing = this.calculatePricingForMarket(
          market.spotPrice,
          market.strike,
          market.timeToExpiry,
          market.impliedVolatility,
        );

        market.fairPrice = pricing.price;
        market.greeks = pricing.greeks;

        // Update portfolio Greeks
        const portfolioGreeks = this.serviceRegistry.getPortfolioGreeks();
        portfolioGreeks.updatePosition(tokenId, {
          tokenId,
          crypto: market.crypto,
          strike: market.strike,
          quantity: market.inventory ?? 0,
          greeks: pricing.greeks,
          spotPrice: market.spotPrice,
          lastUpdate: Date.now(),
        });

        // Sync inventory and update mark-to-market
        const inventoryTracker = this.serviceRegistry.getInventoryTracker();
        const position = inventoryTracker.getPosition(tokenId);
        if (position) {
          market.inventory = position.quantity;
          market.avgEntryPrice = position.avgEntryPrice;
          market.realizedPnL = position.realizedPnL;
          market.unrealizedPnL = position.unrealizedPnL;

          // Update unrealized P&L based on current fair price
          inventoryTracker.updateMtM(tokenId, market.fairPrice);
        } else {
          // No position yet
          market.inventory = 0;
        }

        // Generate derived quotes using Strategy
        const quote = this.strategy.generateQuote(
          {
            timestamp: new Date(),
            fairPrice: market.fairPrice,
            probAbove: market.fairPrice, // For binary options, fair price = probability
            spot: market.spotPrice,
            strike: market.strike,
            tte: market.timeToExpiry,
            iv: market.impliedVolatility,
          },
          tokenId, // For inventory tracking
          market.crypto, // For gamma risk
        );

        if (quote) {
          market.derivedBid = quote.bid;
          market.derivedAsk = quote.ask;
          market.derivedMid = quote.mid;
          market.derivedSpread = quote.spread;

          // Calculate derived edge vs market mid
          const marketMid = market.marketBid && market.marketAsk
            ? (market.marketBid + market.marketAsk) / 2
            : null;
          market.derivedEdge = marketMid ? quote.mid - marketMid : undefined;

          this.logger.debug(`Derived quotes for ${tokenId}`, {
            bid: quote.bid,
            ask: quote.ask,
            spread: quote.spread,
            edge: market.derivedEdge
          });
        }

        // Calculate edge vs market
        if (
          market.marketBid !== null &&
          market.marketAsk !== null &&
          market.marketBid > 0
        ) {
          // Check bid > 0 to avoid bad edge
          const midMarket = (market.marketBid + market.marketAsk) / 2;
          market.edge = pricing.price - midMarket;
        }

        // Emit pricing update to callbacks
        const update: PricingUpdate = {
          tokenId,
          timestamp: Date.now(),
          spotPrice: market.spotPrice,
          impliedVolatility: market.impliedVolatility,
          timeToExpiry: market.timeToExpiry,
          pricing,
          marketMid:
            market.marketBid !== null && market.marketAsk !== null
              ? (market.marketBid + market.marketAsk) / 2
              : null,
          edge: market.edge,
        };

        const callbacks = this.callbacks.get(tokenId);
        if (callbacks) {
          for (const callback of callbacks) {
            try {
              callback(update);
            } catch (err) {
              this.logger.error("Callback error", err as Error);
            }
          }
        }

        market.status = "active";
      } else {
        // Enhanced logging for missing inputs
        this.logger.warn(`Pricing blocked for ${tokenId}`, {
          tokenId,
          spotPrice: market.spotPrice ?? 'MISSING',
          impliedVolatility: market.impliedVolatility ?? 'MISSING',
          timeToExpiry: market.timeToExpiry <= 0 ? 'EXPIRED' : market.timeToExpiry,
          reason: !market.spotPrice ? 'No spot price' :
                  !market.impliedVolatility ? 'No IV' :
                  'Expired'
        });
      }

      market.lastUpdate = new Date();
    } catch (error) {
      this.logger.debug(`Pricing update failed for ${tokenId}`, { error });

      // Check if stale
      const timeSinceUpdate = Date.now() - market.lastUpdate.getTime();
      if (timeSinceUpdate > this.config.staleThreshold) {
        market.status = "stale";
      }
    }
  }

  /**
   * Get current spot price for crypto with source tracking
   */
  private async getSpotPrice(crypto: CryptoTicker): Promise<{ price: number; source: DataSource } | null> {
    const cacheKey = `spot:${crypto}`;
    const cached = this.spotCache.get(cacheKey);
    if (cached !== null && cached !== undefined) {
      return { price: cached, source: 'cache' };
    }

    // Try to get from Binance service
    const binanceService = this.serviceRegistry.getService(
      crypto,
      "binance",
    ) as BinancePriceListener | null;
    if (binanceService && typeof binanceService.getLastPrice === "function") {
      const symbol = BINANCE_SYMBOLS[crypto];
      const spotPrice = binanceService.getLastPrice(symbol);
      if (spotPrice) {
        this.spotCache.set(cacheKey, spotPrice.price);
        return { price: spotPrice.price, source: 'binance' };
      }
    }

    // Fallback: use injected spot price provider (global state from Binance WS)
    if (this.spotPriceFallback) {
      const fallbackPrice = this.spotPriceFallback(crypto);
      if (fallbackPrice !== null && fallbackPrice > 0) {
        this.logger.debug(`[${crypto}] Using fallback spot price: $${fallbackPrice}`);
        this.spotCache.set(cacheKey, fallbackPrice);
        return { price: fallbackPrice, source: 'fallback' };
      }
    }

    return null;
  }

  /**
   * Get current implied volatility for crypto with source tracking
   */
  private async getImpliedVolatility(
    crypto: CryptoTicker,
  ): Promise<{ iv: number; source: DataSource }> {
    const cacheKey = `iv:${crypto}`;
    const cached = this.ivCache.get(cacheKey);
    if (cached !== null && cached !== undefined) {
      return { iv: cached, source: 'cache' };
    }

    // Try to get from Deribit service
    const deribitService = this.serviceRegistry.getService(
      crypto,
      "deribit",
    ) as DeribitListener | null;

    if (!deribitService) {
      this.logger.warn(`[${crypto}] Deribit service not found, using fallback IV=0.8`);
      return { iv: 0.8, source: 'fallback' };
    }

    if (typeof deribitService.getLastSnapshot === "function") {
      const snapshot = deribitService.getLastSnapshot();
      if (snapshot?.markIv && snapshot.markIv > 0) {
        this.ivCache.set(cacheKey, snapshot.markIv);
        return { iv: snapshot.markIv, source: 'deribit' };
      }
    }

    // No valid snapshot available, use fallback
    this.logger.warn(`[${crypto}] Deribit returned invalid/no IV, using fallback IV=0.8`);
    return { iv: 0.8, source: 'fallback' };
  }

  /**
   * Calculate time to expiry in years
   */
  private calculateTTE(expiry: Date): number {
    const now = Date.now();
    const expiryTime = expiry.getTime();
    const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
    return Math.max(0, (expiryTime - now) / msPerYear);
  }

  /**
   * Get default spot price for crypto (fallback)
   */
  private getDefaultSpotPrice(crypto: CryptoTicker): number {
    const defaults: Record<CryptoTicker, number> = {
      BTC: 100000,
      ETH: 3500,
      SOL: 200,
      XRP: 2,
    };
    return defaults[crypto];
  }

  /**
   * Batch update pricing for all wired markets
   * Processes markets in parallel batches for scalability
   */
  private async batchUpdatePricing(): Promise<void> {
    const startTime = Date.now();
    const markets = Array.from(this.wiredMarkets.keys());
    const batchSize = this.config.performance?.batchSize ?? 50;

    this.performanceMetrics.marketCount = markets.length;

    // Process markets in batches
    for (let i = 0; i < markets.length; i += batchSize) {
      const batch = markets.slice(i, i + batchSize);
      await Promise.all(
        batch.map((tokenId) => this.updatePricing(tokenId).catch((err) => {
          this.logger.error(`Batch pricing error for ${tokenId}`, err as Error);
        }))
      );
    }

    const elapsed = Date.now() - startTime;

    // Update performance metrics
    this.performanceMetrics.batchUpdateCount++;
    this.performanceMetrics.totalBatchDuration += elapsed;
    this.performanceMetrics.avgBatchDuration =
      this.performanceMetrics.totalBatchDuration / this.performanceMetrics.batchUpdateCount;
    this.performanceMetrics.maxBatchDuration = Math.max(
      this.performanceMetrics.maxBatchDuration,
      elapsed
    );

    // Update cache metrics
    const spotCacheStats = this.spotCache.getStats();
    const ivCacheStats = this.ivCache.getStats();
    const totalHits = spotCacheStats.hits + ivCacheStats.hits;
    const totalMisses = spotCacheStats.misses + ivCacheStats.misses;
    const totalRequests = totalHits + totalMisses;

    this.performanceMetrics.cacheHits = totalHits;
    this.performanceMetrics.cacheMisses = totalMisses;
    this.performanceMetrics.cacheHitRate = totalRequests > 0 ? totalHits / totalRequests : 0;

    // Log warning if batch exceeded 1s
    if (elapsed > 1000) {
      this.logger.warn('Batch pricing exceeded 1s', {
        markets: markets.length,
        elapsed: `${elapsed}ms`,
        batchSize,
      });
    }

    // Log performance metrics every 60s
    const now = Date.now();
    if (now - this.performanceMetrics.lastMetricsLog > 60000) {
      this.logPerformanceMetrics();
      this.performanceMetrics.lastMetricsLog = now;
    }
  }

  /**
   * Log performance metrics
   */
  private logPerformanceMetrics(): void {
    this.logger.info('Performance metrics', {
      batchCount: this.performanceMetrics.batchUpdateCount,
      avgDuration: `${this.performanceMetrics.avgBatchDuration.toFixed(0)}ms`,
      maxDuration: `${this.performanceMetrics.maxBatchDuration}ms`,
      marketCount: this.performanceMetrics.marketCount,
      cacheHitRate: `${(this.performanceMetrics.cacheHitRate * 100).toFixed(1)}%`,
      cacheHits: this.performanceMetrics.cacheHits,
      cacheMisses: this.performanceMetrics.cacheMisses,
    });

    // Alert thresholds
    if (this.performanceMetrics.avgBatchDuration > 1000) {
      this.logger.warn('⚠️  Batch duration exceeds 1s threshold', {
        avgDuration: `${this.performanceMetrics.avgBatchDuration.toFixed(0)}ms`,
      });
    }

    if (this.performanceMetrics.cacheHitRate < 0.8) {
      this.logger.warn('⚠️  Cache hit rate below 80%', {
        cacheHitRate: `${(this.performanceMetrics.cacheHitRate * 100).toFixed(1)}%`,
      });
    }

    if (this.performanceMetrics.marketCount > 150) {
      this.logger.warn('⚠️  Market count exceeds 150', {
        marketCount: this.performanceMetrics.marketCount,
      });
    }
  }

  /**
   * Start batched pricing updates (alternative to per-market intervals)
   */
  startBatchUpdates(): void {
    if (this.batchInterval) {
      clearInterval(this.batchInterval);
    }

    const updateInterval = this.config.updateInterval ?? 1000;

    this.batchInterval = setInterval(async () => {
      await this.batchUpdatePricing();
    }, updateInterval);

    // Don't block process exit
    if (this.batchInterval.unref) {
      this.batchInterval.unref();
    }

    this.logger.info('Batch pricing updates started', {
      interval: `${updateInterval}ms`,
      batchSize: this.config.performance?.batchSize ?? 50,
    });
  }

  /**
   * Stop batched pricing updates
   */
  stopBatchUpdates(): void {
    if (this.batchInterval) {
      clearInterval(this.batchInterval);
      this.batchInterval = undefined;
      this.logger.info('Batch pricing updates stopped');
    }
  }

  /**
   * Destroy the wirer and cleanup
   */
  async destroy(): Promise<void> {
    // Stop batch updates
    this.stopBatchUpdates();

    // Stop all per-market pricing updates
    for (const [tokenId, interval] of this.updateIntervals) {
      clearInterval(interval);
    }
    this.updateIntervals.clear();

    // Clear caches
    this.spotCache.destroy();
    this.ivCache.destroy();

    // Clear maps
    this.wiredMarkets.clear();
    this.callbacks.clear();
  }
}
