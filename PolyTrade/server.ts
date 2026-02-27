import express from 'express';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

import { z } from 'zod'; // Security: Input Validation

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.API_PORT || 3002);
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(`[ERROR] ${req.method} ${req.path}:`, err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// Import services
import { HealthCheckService } from './src/services/polymarket/HealthCheck.js';
import { OrderBookService } from './src/services/polymarket/OrderBook.js';
import { ClobClientWrapper } from './src/services/polymarket/ClobClient.js';
import { getOpenPositions, getClosedPositions, getOpenOrders } from './src/services/polymarket/DataApi.js';
import { config } from './src/services/polymarket/config.js';
import { MarketPricingService } from './src/services/polymarket/MarketPricingService.js';
import { BinancePriceListener } from './src/services/binance/BinancePriceListener.js';
import { BinanceWsClient } from './src/services/binance/BinanceWsClient.js';
import { BinanceRequestor } from './src/services/binance/BinanceRequestor.js';
import { DeribitListener } from './src/services/deribit/DeribitListener.js';
import { DeribitRequestor } from './src/services/deribit/DeribitRequestor.js';
import { RetryHandler } from './src/lib/retry/RetryHandler.js';
import { getConfig } from './src/lib/config/loader.js';
import { Logger } from './src/lib/logger/index.js';
import { HybridStreamManager, DEFAULT_STREAM_CONFIG } from './src/services/polymarket/streaming/index.js';
import { DB, BinanceTick, DeribitSnapshot, DeribitInstrument } from './src/db/Database.js';
import { MarketMaker } from './src/services/market-maker/MarketMaker.js';
import { ServiceRegistry } from './src/lib/ServiceRegistry.js';
import { PerformanceMetrics } from './src/lib/metrics/PerformanceMetrics.js';
import { MarketFinderService, type CryptoTicker, type StrikeMarket } from './src/services/polymarket/MarketFinderService.js';
import { calculateBinaryGreeks, type BinaryPricing } from './src/pricing/BinaryGreeksCalculator.js';
import { MarketPricingWirer, type WiredMarket } from './src/services/MarketPricingWirer.js';
import { PortfolioGreeksAggregator } from './src/services/PortfolioGreeksAggregator.js';
import { DiscoveryOrchestrator } from './src/services/DiscoveryOrchestrator.js';

// Initialize services
const appConfig = getConfig();
const logger = new Logger({ level: 'info', serviceName: 'api-server' });
const healthCheck = new HealthCheckService();
const orderBookService = new OrderBookService();
const pricingService = new MarketPricingService();
let streamManager: HybridStreamManager | null = null;
let clobClient: ClobClientWrapper | null = null;
let binanceRequestor: BinanceRequestor | null = null;
let deribitRequestor: DeribitRequestor | null = null;
let db: DB;
let marketMaker: MarketMaker;
let marketFinder: MarketFinderService;
let pricingWirer: MarketPricingWirer;
let portfolioGreeks: PortfolioGreeksAggregator;
let discoveryOrchestrator: DiscoveryOrchestrator;

// Service Registry for per-crypto service management
const serviceRegistry = new ServiceRegistry(logger, undefined, {
  maxSpotStalenessMs: 5000,
  maxIvStalenessMs: 30000,  // Reduced from 60000ms to 30000ms for faster staleness detection
  maxSpotGapPercent: 0.02,
  maxOrderbookStalenessMs: 10000,
  minOrderbookDepth: 0, // Disable until orderbook depth tracking is implemented
});
const performanceMetrics = new PerformanceMetrics();

// Initialization state tracking
let initializationState = {
  httpServer: false,
  clobClient: false,
  streamManager: false,
  database: false,
  marketMaker: false,
  binance: false,
  deribit: false,
  startTime: Date.now(),
  errors: [] as Array<{ service: string; error: string; timestamp: number }>,
};

// Simple in-memory cache for frequently called endpoints
const apiCache = {
  markets: { data: null as any, timestamp: 0, ttl: 10000 }, // 10s TTL
  marketNames: { data: new Map<string, string>(), timestamp: 0, ttl: 60000 }, // 60s TTL
  portfolioGreeks: { data: null as any, timestamp: 0, ttl: 10000 }, // 10s TTL
};

function isCacheValid(cache: { timestamp: number; ttl: number }): boolean {
  return Date.now() - cache.timestamp < cache.ttl;
}

// Lazy service initialization
const LAZY_INIT = process.env.LAZY_INIT !== 'false'; // Default: true
let tradingServicesInitialized = false;
let tradingServicesInitializing: Promise<void> | null = null;

// Current market state - track BTC and ETH separately
let currentSpotETH: number | null = null;
let currentSpotBTC: number | null = null;
let currentIVETH: number | null = null;
let currentIVBTC: number | null = null;

// DB write throttling - avoids flooding DB with high-frequency ticks
// In-memory state is still updated on every tick for real-time pricing
const lastBinanceDbWrite: Map<string, number> = new Map();
const BINANCE_DB_WRITE_INTERVAL_MS = 5000; // Write to DB at most once per 5s per symbol
const lastDeribitDbWrite: Map<string, number> = new Map();
const DERIBIT_DB_WRITE_INTERVAL_MS = 30000; // Write to DB at most once per 30s per currency

// Helper: parse crypto ticker and strike from Polymarket question text
function parseCryptoMarketFromQuestion(question: string): { crypto: CryptoTicker; strike: number } | null {
  const match = question.match(/(?:Will\s+)?(?:the\s+price\s+of\s+)?(Bitcoin|BTC|Ethereum|ETH)\s+(?:be\s+)?above\s+\$?([\d,]+)/i);
  if (!match) return null;
  const cryptoMap: Record<string, CryptoTicker> = { 'Bitcoin': 'BTC', 'BTC': 'BTC', 'Ethereum': 'ETH', 'ETH': 'ETH' };
  return {
    crypto: cryptoMap[match[1]] || match[1].toUpperCase() as CryptoTicker,
    strike: Number(match[2].replace(/,/g, '')),
  };
}

// Helper: parse expiry date from Polymarket question text
function parseExpiryFromQuestion(question: string): Date | null {
  const match = question.match(/on\s+(\w+\s+\d+)/i);
  if (!match) return null;
  const parsed = new Date(match[1] + ', ' + new Date().getFullYear());
  if (isNaN(parsed.getTime())) return null;
  if (parsed < new Date()) parsed.setFullYear(parsed.getFullYear() + 1);
  return parsed;
}

// Initialize core services (DB, metrics, market finder - no network calls)
async function initializeCore() {
  try {
    // Log feature flags at startup
    console.log('\n🎚️  Feature Flags:');
    console.log(`   ENABLE_BINANCE: ${appConfig.features.binance}`);
    console.log(`   ENABLE_DERIBIT: ${appConfig.features.deribit}`);
    console.log(`   ENABLE_POLYMARKET_TRADING: ${appConfig.features.polymarketTrading}`);
    console.log(`   SKIP_MARKET_RESUME: ${process.env.SKIP_MARKET_RESUME === 'true'}`);
    console.log(`   CLEAR_MARKET_REGISTRY: ${process.env.CLEAR_MARKET_REGISTRY === 'true'}`);
    console.log(`   LAZY_INIT: ${LAZY_INIT}`);
    console.log('\n📊 Per-Crypto Configuration:');
    console.log(`   Binance Cryptos: ${JSON.stringify(appConfig.binance.cryptos)}`);
    console.log(`   Deribit Currencies: ${JSON.stringify(appConfig.deribit.currencies)}\n`);

    // Clear market registry for clean start (optional via flag)
    if (process.env.CLEAR_MARKET_REGISTRY === 'true') {
      const registryPath = path.join(process.cwd(), 'data', 'market-registry.json');
      if (fs.existsSync(registryPath)) {
        fs.unlinkSync(registryPath);
        logger.info('🗑️  Cleared market-registry.json for fresh start');
        console.log('🗑️  Cleared market-registry.json for fresh start');
      }
    }

    // Start performance metrics auto-flush
    performanceMetrics.startAutoFlush(30000);
    console.log('✅ Performance metrics initialized (30s flush interval)');
    initializationState.httpServer = true;

    // Initialize Database early (synchronous, no network)
    db = new DB();
    console.log(`✅ Database initialized at: ${db.getDbPath()}`);
    initializationState.database = true;

    // Initialize Market Finder for crypto prediction market discovery
    marketFinder = new MarketFinderService(logger, {
      cacheTtl: 300000, // 5 minutes cache
      maxDaysAhead: 60, // Scan up to 60 days ahead
      consecutiveEmptyDays: 5,
      requestDelay: 100,
    });
    console.log('✅ Market Finder service initialized');
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error('Core initialization error', error, {
      stack: error.stack,
      message: error.message,
      name: error.name,
    });
    console.error('❌ Core initialization failed:', error.message);
    if (error.stack) {
      console.error('Stack trace:');
      console.error(error.stack);
    }
    throw error;
  }
}

// Initialize trading services (CLOB, Binance, Deribit, StreamManager, etc.)
async function initializeTradingServices() {
  try {

    // ═══════════════════════════════════════════════════════════
    // PHASE A: Start ALL external connections in parallel
    // CLOB, Binance, and Deribit are independent - no need to wait for CLOB first
    // ═══════════════════════════════════════════════════════════

    const clobInit = (async () => {
      if (initializationState.clobClient) return { success: true };
      try {
        clobClient = new ClobClientWrapper();
        await clobClient.initialize();
        console.log('✅ CLOB client initialized');
        initializationState.clobClient = true;
        return { success: true };
      } catch (error) {
        console.error('❌ CLOB initialization failed:', error);
        return { success: false, error };
      }
    })();

    const binanceInit = (async () => {
      if (initializationState.binance) return { success: true };
      if (!appConfig.features.binance) {
        console.log('⏭️  Binance disabled (ENABLE_BINANCE=false)');
        return { success: true, disabled: true };
      }

      try {
        const binanceRetry = new RetryHandler({
          maxRetries: 3,
          initialDelay: 1000,
          maxDelay: 10000,
          backoffMultiplier: 2,
        }, logger);

        binanceRequestor = new BinanceRequestor(appConfig.binance, logger, binanceRetry);

        // Start all crypto listeners in parallel
        const binanceTasks = appConfig.binance.cryptos
          .filter(c => c.enabled)
          .map(async (cryptoConfig) => {
            const listener = new BinanceWsClient(
              appConfig.binance,
              binanceRequestor,
              logger,
              [cryptoConfig.symbol]
            );

            const crypto = cryptoConfig.symbol.replace('USDT', '');

            listener.subscribe((event: any) => {
              if (event.type === 'price:updated') {
                const startTime = Date.now();
                const price = event.data as any;
                const crypto = price.symbol.replace('USDT', '');

                if (crypto === 'ETH') {
                  currentSpotETH = price.price;
                  if (marketMaker) marketMaker.updateMarketState('SPOT', 'ETH', price.price);
                } else if (crypto === 'BTC') {
                  currentSpotBTC = price.price;
                  if (marketMaker) marketMaker.updateMarketState('SPOT', 'BTC', price.price);
                }

                // Throttle DB writes - only persist once per BINANCE_DB_WRITE_INTERVAL_MS per symbol
                const now = Date.now();
                const lastWrite = lastBinanceDbWrite.get(price.symbol) || 0;
                if (now - lastWrite >= BINANCE_DB_WRITE_INTERVAL_MS) {
                  lastBinanceDbWrite.set(price.symbol, now);
                  try {
                    const tick: BinanceTick = {
                      symbol: price.symbol,
                      price: price.price,
                      timestamp: price.timestamp || now
                    };
                    db.insertBinanceTick(tick);
                  } catch (dbError) {
                    logger.error(`Failed to persist Binance tick: ${dbError}`);
                  }
                }

                const duration = Date.now() - startTime;
                performanceMetrics.recordRequest(crypto, 'binance', duration, true);
                serviceRegistry.recordUpdate(crypto, 'binance');
                logger.debug(`Binance ${crypto} update: $${price.price} (${duration}ms)`);
              } else if (event.type === 'error') {
                const crypto = cryptoConfig.symbol.replace('USDT', '');
                performanceMetrics.recordRequest(crypto, 'binance', 0, false, event.data?.message);
                serviceRegistry.recordError(crypto, 'binance');
              }
            });

            serviceRegistry.register(crypto, 'binance', listener);
            await listener.start();
            await serviceRegistry.startService(crypto, 'binance');
            console.log(`✅ Binance ${crypto} listener started`);
          });

        // Log disabled cryptos
        appConfig.binance.cryptos
          .filter(c => !c.enabled)
          .forEach(c => console.log(`⏭️  Binance ${c.symbol} disabled`));

        await Promise.allSettled(binanceTasks);
        return { success: true };
      } catch (error) {
        console.error('❌ Binance initialization failed:', error);
        return { success: false, error };
      }
    })();

    const deribitInit = (async () => {
      if (initializationState.deribit) return { success: true };
      if (!appConfig.features.deribit) {
        console.log('⏭️  Deribit disabled (ENABLE_DERIBIT=false)');
        return { success: true, disabled: true };
      }

      try {
        const deribitRetry = new RetryHandler({
          maxRetries: 3,
          initialDelay: 1000,
          maxDelay: 10000,
          backoffMultiplier: 2,
        }, logger);

        deribitRequestor = new DeribitRequestor(appConfig.deribit, logger, deribitRetry);

        // Start all currency listeners in parallel
        const deribitTasks = appConfig.deribit.currencies
          .filter(c => c.enabled)
          .map(async (currencyConfig) => {
            const listener = new DeribitListener(
              appConfig.deribit,
              deribitRequestor,
              logger,
              currencyConfig.symbol
            );

            const crypto = currencyConfig.symbol;
            const spotPrice = (crypto === 'ETH' ? currentSpotETH : currentSpotBTC) ||
                              (crypto === 'ETH' ? 3500 : 60000);
            const targetExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

            listener.subscribe((event: any) => {
              if (event.type === 'snapshot:updated') {
                const startTime = Date.now();
                const snapshot = event.data as any;

                if (crypto === 'ETH') {
                  currentIVETH = snapshot.markIv;
                  if (marketMaker) marketMaker.updateMarketState('IV', 'ETH', snapshot.markIv);
                } else if (crypto === 'BTC') {
                  currentIVBTC = snapshot.markIv;
                  if (marketMaker) marketMaker.updateMarketState('IV', 'BTC', snapshot.markIv);
                }

                // Throttle DB writes - only persist once per DERIBIT_DB_WRITE_INTERVAL_MS per currency
                const now = Date.now();
                const lastWrite = lastDeribitDbWrite.get(crypto) || 0;
                if (now - lastWrite >= DERIBIT_DB_WRITE_INTERVAL_MS) {
                  lastDeribitDbWrite.set(crypto, now);
                  try {
                    const dbSnapshot: DeribitSnapshot = {
                      instrumentName: snapshot.instrumentName,
                      underlyingPrice: snapshot.underlyingPrice,
                      markIv: snapshot.markIv,
                      markPrice: snapshot.markPrice,
                      lastPrice: snapshot.lastPrice,
                      delta: snapshot.greeks?.delta,
                      gamma: snapshot.greeks?.gamma,
                      vega: snapshot.greeks?.vega,
                      theta: snapshot.greeks?.theta,
                      timestamp: snapshot.timestamp || now
                    };

                    const instrument: DeribitInstrument | undefined = snapshot.instrument ? {
                      instrumentName: snapshot.instrumentName,
                      currency: crypto,
                      strike: snapshot.instrument.strike,
                      expirationTimestamp: snapshot.instrument.expiration_timestamp,
                      optionType: snapshot.instrument.option_type
                    } : undefined;

                    db.insertDeribitSnapshot(dbSnapshot, instrument);
                  } catch (dbError) {
                    logger.error(`Failed to persist Deribit snapshot: ${dbError}`);
                  }
                }

                const duration = Date.now() - startTime;
                performanceMetrics.recordRequest(crypto, 'deribit', duration, true);
                serviceRegistry.recordUpdate(crypto, 'deribit');
                logger.debug(`Deribit ${crypto} IV update: ${snapshot.markIv}% (${duration}ms)`);
              } else if (event.type === 'error') {
                performanceMetrics.recordRequest(crypto, 'deribit', 0, false, event.data?.message);
                serviceRegistry.recordError(crypto, 'deribit');
              }
            });

            serviceRegistry.register(crypto, 'deribit', listener);
            await listener.start({ spotPrice, targetExpiry });
            await serviceRegistry.startService(crypto, 'deribit');
            console.log(`✅ Deribit ${crypto} listener started`);
          });

        // Log disabled currencies
        appConfig.deribit.currencies
          .filter(c => !c.enabled)
          .forEach(c => console.log(`⏭️  Deribit ${c.symbol} disabled`));

        await Promise.allSettled(deribitTasks);
        return { success: true };
      } catch (error) {
        console.error('❌ Deribit initialization failed:', error);
        return { success: false, error };
      }
    })();

    // Wait for ALL three to complete in parallel
    const [clobResult, binanceResult, deribitResult] = await Promise.allSettled([clobInit, binanceInit, deribitInit]);

    // Handle CLOB result
    if (clobResult.status === 'rejected' || (clobResult.status === 'fulfilled' && !clobResult.value.success)) {
      const err = clobResult.status === 'rejected' ? clobResult.reason : (clobResult.value as any).error;
      initializationState.errors.push({
        service: 'CLOB',
        error: String(err),
        timestamp: Date.now()
      });
      console.error('❌ CLOB failed to initialize - some features will be unavailable');
    }

    // Handle Binance result
    if (binanceResult.status === 'fulfilled') {
      const result = binanceResult.value;
      if (result.success || result.disabled) {
        initializationState.binance = true;
      } else {
        initializationState.errors.push({
          service: 'Binance',
          error: String(result.error),
          timestamp: Date.now()
        });
        console.error('❌ Binance failed to initialize');
      }
    } else {
      initializationState.errors.push({
        service: 'Binance',
        error: String(binanceResult.reason),
        timestamp: Date.now()
      });
      console.error('❌ Binance initialization rejected:', binanceResult.reason);
    }

    // Handle Deribit result
    if (deribitResult.status === 'fulfilled') {
      const result = deribitResult.value;
      if (result.success || result.disabled) {
        initializationState.deribit = true;
      } else {
        initializationState.errors.push({
          service: 'Deribit',
          error: String(result.error),
          timestamp: Date.now()
        });
        console.error('❌ Deribit failed to initialize');
      }
    } else {
      initializationState.errors.push({
        service: 'Deribit',
        error: String(deribitResult.reason),
        timestamp: Date.now()
      });
      console.error('❌ Deribit initialization rejected:', deribitResult.reason);
    }

    // ═══════════════════════════════════════════════════════════
    // PHASE B: Items that depend on CLOB
    // ═══════════════════════════════════════════════════════════

    // Initialize HybridStreamManager for multi-market orderbook streaming
    if (initializationState.streamManager) {
      console.log('⏭️  HybridStreamManager already initialized');
    } else {
    streamManager = new HybridStreamManager(
      {
        restPollIntervalMs: 5000,    // 5s REST polling
        wsStaleThresholdMs: 60000,   // 60s staleness detection
        maxMarketsPerInstance: 100,  // Up to 100 markets
      },
      {
        onTick: (tick) => {
          const mid = ((tick.bestBid + tick.bestAsk) / 2).toFixed(4);
          const spread = tick.spreadBps.toFixed(2);
          const levels = `${tick.bidLevels.length}/${tick.askLevels.length}`;
          console.log(`📊 [${tick.source.toUpperCase()}] ${tick.tokenId.slice(0, 20)}... | Mid: $${mid} | Spread: ${spread}bps | Levels: ${levels}`);
          logger.debug(`Tick for ${tick.tokenId.slice(0, 16)}... mid=${mid}`);
        },
        onConnectionStateChange: (state, error) => {
          console.log(`🔌 WebSocket: ${state.toUpperCase()}${error ? ` (${error.message})` : ''}`);
          logger.info(`Stream connection: ${state}`, { error: error?.message });
        },
        onMarketStateChange: (tokenId, state) => {
          console.log(`📈 Market ${tokenId.slice(0, 20)}... → ${state.toUpperCase()}`);
          logger.info(`Market ${tokenId.slice(0, 16)}... state: ${state}`);
        },
      }
    );
    await streamManager.start();
    console.log('✅ HybridStreamManager started (multi-market orderbook streaming)');
    initializationState.streamManager = true;
    } // end else (streamManager guard)

    // Initialize Market Maker (requires CLOB)
    if (initializationState.clobClient) {
      marketMaker = new MarketMaker({
        clobClient,
        pricingService,
        orderBookService,
        streamManager,
        db,
        userId: config.funderAddress || 'unknown',
        paperMode: true
      });
      console.log('✅ Market Maker service initialized');
      initializationState.marketMaker = true;
    } else {
      console.warn('⚠️ Market Maker skipped (CLOB not available)');
    }

    // marketFinder already created in initializeCore() — skip duplicate

    // Initialize Pricing Wirer for automatic market-to-data-feed connection
    pricingWirer = new MarketPricingWirer(logger, serviceRegistry, streamManager!, {
      updateInterval: 1000, // 1s pricing updates
      staleThreshold: 60000, // 60s stale threshold
      autoStartServices: true,
      safety: {
        maxSpotStalenessMs: 30000,
        maxIvStalenessMs: 120000,
        maxSpotGapPercent: 0.02,
        maxOrderbookStalenessMs: 30000,
        minOrderbookDepth: 0,
      },
      spotPriceFallback: (crypto) => {
        if (crypto === 'ETH') return currentSpotETH;
        if (crypto === 'BTC') return currentSpotBTC;
        return null;
      },
    });
    console.log('✅ Market Pricing Wirer initialized');

    // Initialize Portfolio Greeks Aggregator
    portfolioGreeks = new PortfolioGreeksAggregator(pricingWirer, logger);
    console.log('✅ Portfolio Greeks aggregator initialized');

    // Initialize Discovery Orchestrator for batch wiring
    discoveryOrchestrator = new DiscoveryOrchestrator(logger, marketFinder, pricingWirer, {
      maxConcurrent: 5, // Wire 5 markets in parallel
      wireTimeout: 30000, // 30s timeout per market
    });
    console.log('✅ Discovery Orchestrator initialized');

  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    logger.error('Service initialization error', error, {
      stack: error.stack,
      message: error.message,
      name: error.name,
    });
    console.error('❌ Service initialization failed:', error.message);
    if (error.stack) {
      console.error('Stack trace:');
      console.error(error.stack);
    }
    throw error; // Re-throw to server.listen handler
  }
}

// Idempotent lazy init: starts trading services on first demand, resolves immediately on subsequent calls
async function ensureTradingServices(): Promise<void> {
  if (tradingServicesInitialized) return;
  if (tradingServicesInitializing) {
    await tradingServicesInitializing;
    return;
  }
  tradingServicesInitializing = (async () => {
    try {
      console.log('\n🔄 Starting trading services (lazy init on first request)...');
      await initializeTradingServices();
      tradingServicesInitialized = true;
      console.log('✅ Trading services ready (lazy init)\n');
    } catch (error) {
      tradingServicesInitializing = null; // Allow retry on next request
      throw error;
    }
  })();
  await tradingServicesInitializing;
}

// Note: Services are initialized in server.listen() callback below


// ═════════════════════════════════════════════════════════════
// LAZY INIT MIDDLEWARE — ensures trading services for non-research routes
// ═════════════════════════════════════════════════════════════

// Routes that require trading services (CLOB, Binance, Deribit, StreamManager)
// This middleware triggers lazy init on first access and returns 503 if init fails.
const tradingRoutes = ['/api/streaming', '/api/mm', '/api/orders', '/api/positions', '/api/pricing', '/api/services', '/api/iv', '/api/crypto'];
for (const route of tradingRoutes) {
  app.use(route, async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try {
      await ensureTradingServices();
      next();
    } catch (err) {
      logger.error(`Trading services init failed for ${req.path}`, err instanceof Error ? err : new Error(String(err)));
      res.status(503).json({
        error: 'Trading services initializing',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

// ═════════════════════════════════════════════════════════════
// REST API ENDPOINTS
// ═════════════════════════════════════════════════════════════

// Health Check / Self-Diagnosis
app.get('/api/health', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {
      clob: false,
      orderbook: false,
      binance: false,
      deribit: false,
    },
    initialization: {
      complete: false,
      clobClient: initializationState.clobClient,
      streamManager: initializationState.streamManager,
      database: initializationState.database,
      marketMaker: initializationState.marketMaker,
      binance: initializationState.binance,
      deribit: initializationState.deribit,
      elapsedSeconds: ((Date.now() - initializationState.startTime) / 1000).toFixed(1),
      errors: initializationState.errors,
    },
    ready: false, // Overall readiness flag
    uptime: process.uptime(),
    lazyInit: LAZY_INIT,
    tradingServicesReady: tradingServicesInitialized,
  };

  // CLOB Check
  try {
    const clobStatus = clobClient?.getStatus();
    if (clobStatus && clobStatus.initialized && clobStatus.credsLoaded) {
      health.services.clob = true;
    }
  } catch (e) {
    logger.debug('CLOB health check failed:', e);
  }

  // OrderBook/Streaming Check
  try {
    if (streamManager) {
      const metrics = streamManager.getMetrics();
      // Consider orderbook healthy if WS is connected OR using REST fallback (stream manager running)
      health.services.orderbook = metrics.connection.state === 'connected' || initializationState.streamManager;
    }
  } catch (e) {
    logger.debug('OrderBook health check failed:', e);
  }

  // Binance Check
  try {
    if (appConfig.features.binance) {
      const binanceServices = serviceRegistry.getServicesByType('binance');
      health.services.binance = binanceServices.some(s => s.status === 'running');
    } else {
      health.services.binance = true; // Disabled = considered "ok"
    }
  } catch (e) {
    logger.debug('Binance health check failed:', e);
  }

  // Deribit Check
  try {
    if (appConfig.features.deribit) {
      const deribitServices = serviceRegistry.getServicesByType('deribit');
      health.services.deribit = deribitServices.some(s => s.status === 'running');
    } else {
      health.services.deribit = true; // Disabled = considered "ok"
    }
  } catch (e) {
    logger.debug('Deribit health check failed:', e);
  }

  // Check initialization complete
  health.initialization.complete =
    initializationState.clobClient &&
    initializationState.streamManager &&
    initializationState.database;

  // Overall readiness: true if all enabled services are connected AND initialized
  health.ready = health.initialization.complete &&
                 health.services.clob &&
                 health.services.orderbook &&
                 health.services.binance &&
                 health.services.deribit;

  // Progressive phase indicator for frontend
  health.phase = !initializationState.clobClient ? 'connecting' :
                 (!initializationState.binance || !initializationState.deribit) ? 'starting-feeds' :
                 !initializationState.streamManager ? 'streaming' :
                 health.ready ? 'ready' : 'finalizing';

  // Always return 200 - health endpoint must always be reachable
  // ready=false simply means "still initializing", not a server error
  res.status(200).json(health);
});

app.get('/api/status', async (req, res) => {
  try {
    const userAddress = config.funderAddress;
    const [
      usdcBalance,
      openOrders,
      positions
    ] = await Promise.all([
      clobClient.getBalance(userAddress, config.usdcTokenId),
      getOpenOrders(clobClient),
      getOpenPositions(userAddress)
    ]);

    // Get service registry status
    const serviceStatuses = serviceRegistry.getAllStatuses();
    const serviceCounts = serviceRegistry.getServiceCounts();

    res.json({
      userAddress,
      usdcBalance: usdcBalance ? Number(usdcBalance).toFixed(2) : 'N/A',
      openOrders: openOrders.length,
      openPositions: positions.length,
      currentSpotETH,
      currentSpotBTC,
      currentIVETH,
      currentIVBTC,
      binanceConnected: appConfig.features.binance,
      deribitConnected: appConfig.features.deribit,
      polymarketTradingEnabled: appConfig.features.polymarketTrading,
      streamManagerActive: !!streamManager,
      clobClientStatus: clobClient?.getStatus(),
      services: {
        total: serviceCounts.total,
        running: serviceCounts.running,
        stopped: serviceCounts.stopped,
        error: serviceCounts.error,
        details: serviceStatuses,
      },
    });
  } catch (err) {
    logger.error('Status endpoint error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// Crypto stats endpoint - for UI header display
app.get('/api/crypto/stats/:crypto', async (req, res) => {
  try {
    const crypto = req.params.crypto.toUpperCase();

    // Validate crypto ticker
    if (!['BTC', 'ETH', 'SOL', 'XRP'].includes(crypto)) {
      return res.status(400).json({
        success: false,
        error: `Invalid crypto: ${crypto}. Must be one of: BTC, ETH, SOL, XRP`
      });
    }

    // Get spot price and ATM volatility from global state
    const ulPrice = crypto === 'BTC' ? currentSpotBTC :
                    crypto === 'ETH' ? currentSpotETH : null;
    const atmVol = crypto === 'BTC' ? currentIVBTC :
                   crypto === 'ETH' ? currentIVETH : null;

    // Determine if data is stale (no data available)
    const stale = ulPrice === null || atmVol === null;

    res.json({
      success: true,
      crypto,
      ulPrice,
      atmVol,
      timestamp: Date.now(),
      stale,
      source: {
        spotSource: 'binance',
        ivSource: 'deribit'
      }
    });
  } catch (err) {
    logger.error('Crypto stats endpoint error:', err);
    res.status(500).json({
      success: false,
      error: (err as Error).message
    });
  }
});

// Health endpoint
app.get('/api/health-old', async (req, res) => {
  try {
    const health = await healthCheck.checkAll();
    const isHealthy = health.data && health.clob && health.gamma;
    res.json({
      status: isHealthy ? 'ok' : 'degraded',
      healthy: isHealthy,
      services: {
        ...health,
        binance: appConfig.features.binance ? (binanceListener?.isConnected() || false) : false,
        deribit: appConfig.features.deribit ? (deribitListener?.isConnected() || false) : false,
        polymarket: health.clob,
        orderbook: true,
      },
      features: {
        binance: appConfig.features.binance,
        deribit: appConfig.features.deribit,
        polymarketTrading: appConfig.features.polymarketTrading,
      },
      timestamp: Date.now()
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Pricing health endpoint - Shows data source health and freshness
app.get('/api/health/pricing', async (req, res) => {
  try {
    const cryptos: CryptoTicker[] = ['BTC', 'ETH', 'SOL', 'XRP'];
    const healthData: Record<string, any> = {};

    for (const crypto of cryptos) {
      const binanceService = serviceRegistry.getService(crypto, 'binance') as any;
      const deribitService = serviceRegistry.getService(crypto, 'deribit') as any;

      // Get Deribit health status including IV source
      const deribitHealth = deribitService?.getHealthStatus?.() || {};

      healthData[crypto] = {
        binance: {
          connected: binanceService?.isConnected?.() || false,
          dataReady: binanceService?.isDataReady?.() || false,
          lastUpdate: binanceService?.getHealthStatus?.()?.lastUpdate || null,
          isDataFresh: binanceService?.getHealthStatus?.()?.isDataFresh || false,
        },
        deribit: {
          connected: deribitService?.isConnected?.() || false,
          lastUpdate: deribitService?.getLastUpdateTimestamp?.() || null,
          hasData: !!(deribitService?.getLastSnapshot?.()),
          ivSource: deribitHealth.ivSource || 'unknown', // 'dvol' | 'option_mark_iv' | 'fallback'
          currentIV: deribitHealth.currentIV ? (deribitHealth.currentIV * 100).toFixed(2) + '%' : null,
          isDataFresh: deribitHealth.isDataFresh || false,
        },
      };
    }

    // Get wired market IV/spot source distribution
    const wiredMarkets = pricingWirer?.getAllWiredMarkets() || [];
    const sourceDistribution = {
      spot: { binance: 0, fallback: 0, cache: 0, total: wiredMarkets.length },
      iv: { dvol: 0, deribit: 0, fallback: 0, cache: 0, total: wiredMarkets.length },
    };

    for (const market of wiredMarkets) {
      if (market.spotSource) {
        sourceDistribution.spot[market.spotSource as keyof typeof sourceDistribution.spot]++;
      }
      if (market.ivSource) {
        sourceDistribution.iv[market.ivSource as keyof typeof sourceDistribution.iv]++;
      }
    }

    const overall = {
      binanceHealthy: Object.values(healthData).some((h: any) => h.binance.connected && h.binance.isDataFresh),
      deribitHealthy: Object.values(healthData).some((h: any) => h.deribit.connected && h.deribit.hasData),
      fallbackIvUsed: sourceDistribution.iv.fallback > 0,
      fallbackSpotUsed: sourceDistribution.spot.fallback > 0,
    };

    res.json({
      success: true,
      data: {
        perCrypto: healthData,
        sourceDistribution,
        overall,
        timestamp: Date.now(),
      },
    });
  } catch (err) {
    logger.error('Pricing health endpoint error:', err);
    res.status(500).json({
      success: false,
      error: (err as Error).message,
    });
  }
});

// Markets endpoint (cached)
app.get('/api/markets', async (req, res) => {
  try {
    // Return cached data if valid
    if (isCacheValid(apiCache.markets) && apiCache.markets.data) {
      return res.json(apiCache.markets.data);
    }

    const userAddress = config.funderAddress;
    try {
      const positions = await getOpenPositions(userAddress);

      // Simple hash function for consistent pseudo-random values per market
      const simpleHash = (str: string) => {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
          hash = ((hash << 5) - hash) + str.charCodeAt(i);
          hash = hash & hash;
        }
        return Math.abs(hash);
      };

      const activeMarkets = positions
        .filter((p: any) => !p.redeemable && Number(p.curPrice) > 0)
        .slice(0, 20)
        .map((p: any) => {
          const hash = simpleHash(p.asset || '');
          return {
            id: p.asset,
            question: p.title || 'Unknown Market',
            lastPrice: Number(p.curPrice || 0).toFixed(4),
            volume24h: ((hash % 2000000) + 100000).toFixed(0),
            endDate: p.expirationDate || 'TBD',
            liquidity: `$${((hash % 1500000) + 500000).toFixed(0)}`,
            spread: `${((hash % 20) / 10).toFixed(1)}%`,
            sentiment: ['Bullish', 'Bearish', 'Mixed'][hash % 3],
            outcome: p.outcome
          };
        });

      // Update cache
      apiCache.markets.data = activeMarkets;
      apiCache.markets.timestamp = Date.now();

      res.json(activeMarkets);
    } catch (err) {
      // If API call fails (e.g., 404 from Polymarket), return empty array gracefully
      logger.warn('Markets API fallback:', (err as Error).message);
      res.json([]);
    }
  } catch (err) {
    logger.error('Markets endpoint error:', err);
    res.json([]);
  }
});

// Market metadata by slug endpoint - returns parsed clobTokenIds and extracted metadata
const slugSchema = z.string().regex(/^[a-z0-9-]+$/i, "Invalid slug format");

app.get('/api/markets/:slug', async (req, res) => {
  try {
    const { slug } = req.params;

    // Validate Input
    try {
      slugSchema.parse(slug);
    } catch (e) {
      return res.status(400).json({ success: false, error: 'Invalid slug parameter' });
    }

    const market = await pricingService.fetchMarketMetadata(slug);

    // Extract strike price with 'k' suffix support (100k -> 100000)
    let strike = market.strike || 0;
    const strikeMatch = slug.match(/above[- ]([\d.]+)k?(?:[- ]|$)/i);
    if (strikeMatch) {
      let value = parseFloat(strikeMatch[1]);
      if (slug.match(/above[- ][\d.]+k/i)) {
        value *= 1000;
      }
      strike = value;
    }

    // Extract crypto symbol from slug (btc, eth, etc)
    const cryptoMatch = slug.match(/^(btc|eth|ethereum|bitcoin)/i);
    const crypto = cryptoMatch ? (cryptoMatch[1].toLowerCase().startsWith('eth') ? 'ETH' : 'BTC') : undefined;

    // Parse clobTokenIds - they may be a JSON string or array
    let clobTokenIds = market.clobTokenIds || [];
    if (typeof clobTokenIds === 'string') {
      try {
        clobTokenIds = JSON.parse(clobTokenIds);
      } catch {
        clobTokenIds = [];
      }
    }
    if (!Array.isArray(clobTokenIds)) {
      clobTokenIds = [];
    }

    // Build response with yes/no token IDs if available
    const enrichedMarket = {
      ...market,
      strike,
      clobTokenIds: clobTokenIds as string[],
      crypto,
      tokens: clobTokenIds.length >= 2 ? {
        yes: clobTokenIds[0],
        no: clobTokenIds[1]
      } : {
        yes: clobTokenIds[0] || null,
        no: clobTokenIds[1] || null
      }
    };

    res.json({ success: true, market: enrichedMarket });
  } catch (err: any) {
    // Sanitized Error Handling
    logger.error(`Error fetching markert ${req.params.slug}:`, err);

    // Check for safe error types or mask internal details
    const msg = err.message || '';
    if (msg.includes('Gamma API') || msg.includes('404') || msg.includes('422')) {
      return res.status(400).json({ success: false, error: 'Market not found or unavailable' });
    }
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});


// Order book endpoint
app.get('/api/orderbook', async (req, res) => {
  try {
    const { market } = req.query;
    if (!market) {
      return res.status(400).json({ error: 'market required' });
    }

    const snapshot = await orderBookService.fetchOrderBookSnapshot(String(market));
    res.json({
      bids: snapshot.bids.slice(0, 15).map((b) => ({ price: Number(b.price).toFixed(3), size: Number(b.size).toFixed(0) })),
      asks: snapshot.asks.slice(0, 15).map((a) => ({ price: Number(a.price).toFixed(3), size: Number(a.size).toFixed(0) })),
      timestamp: snapshot.timestamp
    });
  } catch (err) {
    logger.error('OrderBook endpoint error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// Orderbook by slug endpoint - resolve slug to tokenId and fetch orderbook
// Usage: /api/orderbook/slug/bitcoin-above-100k-on-january-19?outcome=yes
app.get('/api/orderbook/slug/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const { outcome = 'yes' } = req.query;

    // Fetch market metadata to get clobTokenIds
    const market = await pricingService.fetchMarketMetadata(slug);

    // Parse clobTokenIds
    let clobTokenIds = market.clobTokenIds || [];
    if (typeof clobTokenIds === 'string') {
      try {
        clobTokenIds = JSON.parse(clobTokenIds);
      } catch {
        clobTokenIds = [];
      }
    }

    // Select the correct token ID based on outcome
    // Typically index 0 = YES, index 1 = NO
    const outcomeStr = String(outcome).toLowerCase();
    const tokenId = outcomeStr === 'no' ? clobTokenIds[1] : clobTokenIds[0];

    if (!tokenId) {
      return res.status(400).json({ error: `No token ID found for outcome: ${outcome}` });
    }

    // Fetch and return orderbook for selected token
    const snapshot = await orderBookService.fetchOrderBookSnapshot(tokenId);
    res.json({
      slug,
      outcome,
      tokenId,
      bids: snapshot.bids.slice(0, 15).map((b) => ({ price: Number(b.price).toFixed(3), size: Number(b.size).toFixed(0) })),
      asks: snapshot.asks.slice(0, 15).map((a) => ({ price: Number(a.price).toFixed(3), size: Number(a.size).toFixed(0) })),
      timestamp: snapshot.timestamp
    });
  } catch (err) {
    logger.error('OrderBook slug endpoint error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});
app.get('/api/orderbook-history', async (req, res) => {
  try {
    const { market, timeframe = '1m', minutes = '60' } = req.query;
    if (!market) {
      return res.status(400).json({ error: 'market required' });
    }

    const tf = (timeframe as string).match(/^(1m|5m|10m)$/) ? (timeframe as any) : '1m';
    const mins = Math.min(parseInt(minutes as string) || 60, 1440); // Max 24 hours
    const tokenId = String(market);

    // Prefer hybrid streaming data if available
    if (streamManager) {
      // Ensure market is subscribed so ticks keep flowing
      const registration = streamManager.getRegistry().get(tokenId);
      if (!registration) {
        await streamManager.subscribeMarket(tokenId);
      }

      const data = streamManager.getTimeSeriesData(tokenId, tf, mins);
      const latest = streamManager.getLatestOrderBook(tokenId);
      const candleCount = data.candles?.length || 0;
      const bufferState = streamManager.getCandleBufferState();

      logger.info(`[OrderBook History] Returning ${candleCount} candles (streaming) for ${tokenId}`);
      return res.json({
        source: 'streaming',
        warmingUp: candleCount === 0,
        latestOrderBook: latest,
        bufferState,
        ...data,
      });
    }

    // Fallback to legacy poller
    await orderBookService.startCollectingData(tokenId);
    const data = orderBookService.getTimeSeriesData(tokenId, tf, mins);
    logger.info(`[OrderBook History] Returning ${data.candles?.length || 0} candles (legacy) for ${tokenId}`);
    res.json({ source: 'legacy', warmingUp: data.candles?.length === 0, ...data });
  } catch (err) {
    logger.error('OrderBook history endpoint error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// Orderbook latest candles endpoint
app.get('/api/orderbook-candles', async (req, res) => {
  try {
    const { market } = req.query;
    if (!market) {
      return res.status(400).json({ error: 'market required' });
    }

    const candles = orderBookService.getLatestCandles(String(market));
    res.json({
      tokenId: market,
      candles,
      timestamp: Date.now(),
    });
  } catch (err) {
    logger.error('OrderBook candles endpoint error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ═════════════════════════════════════════════════════════════
// STREAMING API ENDPOINTS (Multi-Market Hybrid Orderbook)
// ═════════════════════════════════════════════════════════════

// Register a market for streaming
app.post('/api/streaming/markets', async (req, res) => {
  try {
    await ensureTradingServices();
    if (!streamManager) {
      return res.status(503).json({ error: 'Streaming manager not initialized' });
    }

    const { tokenId, slug, outcome, priority } = req.body;
    if (!tokenId) {
      return res.status(400).json({ error: 'tokenId required' });
    }

    await streamManager.subscribeMarket(tokenId, { slug, outcome, priority });

    const registration = streamManager.getRegistry().get(tokenId);
    res.json({
      success: true,
      market: registration,
    });
  } catch (err) {
    logger.error('Streaming subscribe error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// Register market by slug (auto-resolves tokenId)
app.post('/api/streaming/markets/slug/:slug', async (req, res) => {
  try {
    if (!streamManager) {
      return res.status(503).json({ error: 'Streaming manager not initialized' });
    }

    const { slug } = req.params;
    const { outcome = 'yes', priority } = req.body;

    // Fetch market metadata to get tokenId
    const market = await pricingService.fetchMarketMetadata(slug);
    let clobTokenIds = market.clobTokenIds || [];
    if (typeof clobTokenIds === 'string') {
      try { clobTokenIds = JSON.parse(clobTokenIds); } catch { clobTokenIds = []; }
    }

    const outcomeStr = String(outcome).toLowerCase();
    const tokenId = outcomeStr === 'no' ? clobTokenIds[1] : clobTokenIds[0];

    if (!tokenId) {
      return res.status(400).json({ error: `No token ID found for slug: ${slug}, outcome: ${outcome}` });
    }

    await streamManager.subscribeMarket(tokenId, { slug, outcome: outcomeStr as 'yes' | 'no', priority });

    const registration = streamManager.getRegistry().get(tokenId);
    res.json({
      success: true,
      slug,
      tokenId,
      outcome: outcomeStr,
      market: registration,
    });
  } catch (err) {
    logger.error('Streaming subscribe by slug error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// Unregister a market from streaming
app.delete('/api/streaming/markets/:tokenId', async (req, res) => {
  try {
    if (!streamManager) {
      return res.status(503).json({ error: 'Streaming manager not initialized' });
    }

    const { tokenId } = req.params;
    streamManager.unsubscribeMarket(tokenId);

    res.json({ success: true, tokenId });
  } catch (err) {
    logger.error('Streaming unsubscribe error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// Get streaming status and metrics
app.get('/api/streaming/status', async (req, res) => {
  try {
    if (!streamManager) {
      return res.status(503).json({ error: 'Streaming manager not initialized' });
    }

    const metrics = streamManager.getMetrics();
    const registry = streamManager.getRegistry();
    const stats = registry.getStats();

    res.json({
      connection: metrics.connection,
      markets: {
        total: stats.totalRegistered,
        enabled: stats.enabled,
        active: stats.active,
        stale: stats.stale,
        byState: stats.byState,
      },
      global: metrics.global,
      activeMarkets: registry.getActive().map(m => ({
        tokenId: m.tokenId.slice(0, 20) + '...',
        slug: m.slug,
        state: m.state,
        tickCount: m.tickCount,
        lastUpdate: m.lastMergedTick,
      })),
    });
  } catch (err) {
    logger.error('Streaming status error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// Get orderbook data from streaming manager (uses hybrid REST+WS data)
app.get('/api/streaming/orderbook/:tokenId', async (req, res) => {
  try {
    await ensureTradingServices();
    if (!streamManager) {
      return res.status(503).json({ error: 'Streaming manager not initialized' });
    }

    const { tokenId } = req.params;
    const { timeframe = '1m', minutes = '60' } = req.query;

    const tf = (timeframe as string).match(/^(1m|5m|10m)$/) ? (timeframe as any) : '1m';
    const mins = Math.min(parseInt(minutes as string) || 60, 1440);

    // Check if market is registered, if not subscribe it
    const registration = streamManager.getRegistry().get(tokenId);
    if (!registration) {
      await streamManager.subscribeMarket(tokenId);
    }

    const data = streamManager.getTimeSeriesData(tokenId, tf, mins);
    const latest = streamManager.getLatestOrderBook(tokenId);
    const candleCount = data.candles?.length || 0;
    const bufferState = streamManager.getCandleBufferState();

    // Transform EnrichedTick to OrderBook shape for UI compatibility
    let latestOrderBook = null;
    if (latest) {
      latestOrderBook = {
        bids: (latest.bidLevels || []).map(l => ({ price: String(l.price), size: String(l.size) })),
        asks: (latest.askLevels || []).map(l => ({ price: String(l.price), size: String(l.size) })),
        timestamp: latest.timestamp || Date.now(),
        tokenId: latest.tokenId,
      };
    }

    res.json({
      source: 'streaming',
      warmingUp: candleCount === 0,
      latestOrderBook,
      bufferState,
      ...data,
    });
  } catch (err) {
    logger.error('Streaming orderbook error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ═════════════════════════════════════════════════════════════
// MARKET MAKER ENDPOINTS
// ═════════════════════════════════════════════════════════════

app.post('/api/mm/start', async (req, res) => {
  await ensureTradingServices();
  if (!marketMaker) return res.status(503).json({ error: 'MM not initialized' });
  marketMaker.start();
  res.json({ success: true, message: 'Market Maker started' });
});

app.post('/api/mm/stop', async (req, res) => {
  await ensureTradingServices();
  if (!marketMaker) return res.status(503).json({ error: 'MM not initialized' });
  marketMaker.stop();
  res.json({ success: true, message: 'Market Maker stopped' });
});

app.post('/api/mm/markets', async (req, res) => {
  if (!marketMaker) return res.status(503).json({ error: 'MM not initialized' });
  const { slug } = req.body;
  if (!slug) return res.status(400).json({ error: 'Slug required' });

  try {
    await marketMaker.addMarket(slug);
    res.json({ success: true, message: `Market ${slug} added` });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/mm/discover', async (req, res) => {
  if (!marketMaker) return res.status(503).json({ error: 'MM not initialized' });
  const { limit = 10, autoAdd = false } = req.body;

  try {
    const markets = await pricingService.getTopMarkets(Number(limit));

    const meaningful = markets.filter((m: any) =>
      (Number(m.volume24h) > 5000 || Number(m.liquidity) > 5000) &&
      m.active && !m.closed
    );

    if (autoAdd) {
      let added = 0;
      for (const m of meaningful) {
        try {
          await marketMaker.addMarket(m.slug);
          added++;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          logger.warn(`Failed to auto-add ${m.slug}`, { error: msg });
        }
      }
      return res.json({ success: true, discovered: meaningful.length, added });
    }

    res.json({ success: true, markets: meaningful });
  } catch (err: any) {
    logger.error('Discovery error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Orders endpoint
app.get('/api/orders', async (req, res) => {
  try {
    await ensureTradingServices();
    if (!clobClient) {
      console.warn('[API] CLOB client not initialized, returning empty orders');
      return res.json([]);
    }

    try {
      const orders = await getOpenOrders(clobClient);

      // Fetch markets for title lookup
      let marketMap: Map<string, string> = new Map();
      try {
        const cClient = clobClient.getClient();
        const markets = await cClient.getMarkets();
        markets.forEach((m: any) => {
          if (m.tokens && Array.isArray(m.tokens)) {
            m.tokens.forEach((t: any) => {
              marketMap.set(t.token_id, m.question || 'Unknown Market');
            });
          }
        });
      } catch (e) {
        logger.debug('Failed to fetch market titles:', (e as Error).message);
      }

      const formatted = (orders || []).slice(0, 100).map((order: any) => ({
        id: order.id || order.order_id || order.orderID,
        market: order.market || order.token_id || 'Unknown',
        title: marketMap.get(order.market || order.token_id) || order.title || 'Unknown Market',
        side: String(order.side || '').toUpperCase(),
        price: Number(order.price || order.limit_price || 0).toFixed(3),
        size: Number(order.size || order.remaining_size || order.size_remaining || 0).toFixed(0),
        filled: Number(order.size_matched || order.sizeMatched || 0).toFixed(0),
        status: order.status || 'OPEN',
        timestamp: order.created_at || new Date().toISOString(),
      }));
      logger.info(`Orders endpoint: Found ${formatted.length} open orders`);
      res.json(formatted);
    } catch (err) {
      logger.warn('Orders API fallback:', (err as Error).message);
      // Return empty array on error (graceful degradation)
      res.json([]);
    }
  } catch (err) {
    logger.error('Orders endpoint error:', err);
    res.json([]);
  }
});

// Positions endpoint - supports both open and closed positions
app.get('/api/positions', async (req, res) => {
  try {
    const userAddress = config.funderAddress;
    if (!userAddress) {
      logger.warn('[API] No funder address configured, returning empty positions');
      return res.json({ open: [], closed: [], meta: { error: 'NO_ADDRESS', timestamp: Date.now() } });
    }

    const type = req.query.type as string; // 'open', 'closed', or undefined (both)

    try {
      let openPositions: any[] = [];
      let closedPositions: any[] = [];

      // Fetch open positions if requested or if no type specified  
      if (!type || type === 'open') {
        const openData = await getOpenPositions(userAddress);
        logger.info(`Raw open positions data:`, JSON.stringify(openData).slice(0, 200));
        const openArray = Array.isArray(openData) ? openData : [];
        openPositions = openArray
          .filter((p: any) => {
            // Filter out zero-size AND REDEEMABLE positions
            const size = Number(p.size || p.curSize || p.balance || 0);
            const isRedeemable = p.status === 'REDEEMABLE' || p.redeemable === true;
            return size !== 0 && !isRedeemable;
          })
          .slice(0, 50)
          .map((p: any) => {
            const size = Number(p.size || p.curSize || p.balance || 0);
            // Remove 0.5 default - use null if avgPrice unavailable
            const entry = Number(p.avgPrice || p.avg_price || 0) || null;
            const mark = Number(p.curPrice || p.cur_price || p.price || 0) || null;
            const pnl = (entry && mark) ? (mark - entry) * size : null;
            const pnlPercent = (entry && mark && entry > 0) ? ((mark - entry) / entry * 100) : null;
            const redeemable = Boolean(p.redeemable);
            const id = (
              p.asset ||
              p.asset_id ||
              p.assetId ||
              p.token_id ||
              (p.market_id && p.outcome ? `${p.market_id}_${p.outcome}` : undefined) ||
              `${(p.title || p.question || 'unknown').slice(0, 24)}_${p.outcome || 'YES'}`
            );

            return {
              id,
              market: p.title || p.question || p.market || 'Unknown',
              outcome: p.outcome || 'YES',
              size: size.toFixed(0),
              avgEntry: entry !== null ? entry.toFixed(3) : null,
              pnl: pnl !== null ? pnl.toFixed(2) : null,
              pnlPercent: pnlPercent !== null ? pnlPercent.toFixed(2) : null,
              currentPrice: mark !== null ? mark.toFixed(3) : null,
              status: redeemable ? 'REDEEMABLE' : 'ACTIVE',
              redeemable,
              type: 'open'
            };
          });
      }

      // Fetch closed positions if requested or if no type specified
      if (!type || type === 'closed') {
        const closedData = await getClosedPositions(userAddress);
        const closedArray = Array.isArray(closedData) ? closedData : [];
        closedPositions = closedArray
          .slice(0, 50)
          .map((p: any) => {
            const size = Number(p.size || p.curSize || p.balance || 0);
            // Remove 0.5 default - use null if unavailable
            const entry = Number(p.avgPrice || 0) || null;
            const exit = Number(p.exitPrice || p.price || 0) || null;
            const pnl = (entry && exit) ? (exit - entry) * size : null;
            const pnlPercent = (entry && exit && entry > 0) ? ((exit - entry) / entry * 100) : null;

            return {
              id: p.asset_id || p.assetId || `${p.market_id}_${p.outcome}`,
              market: p.title || p.question || 'Unknown',
              outcome: p.outcome || 'YES',
              size: size.toFixed(0),
              avgEntry: entry !== null ? entry.toFixed(3) : null,
              exitPrice: exit !== null ? exit.toFixed(3) : null,
              pnl: pnl !== null ? pnl.toFixed(2) : null,
              pnlPercent: pnlPercent !== null ? pnlPercent.toFixed(2) : null,
              status: 'CLOSED',
              type: 'closed'
            };
          });
      }

      logger.info(`Positions endpoint: Found ${openPositions.length} open, ${closedPositions.length} closed positions`);

      // Return based on query parameter
      if (type === 'open') {
        res.json(openPositions);
      } else if (type === 'closed') {
        res.json(closedPositions);
      } else {
        res.json({ open: openPositions, closed: closedPositions, meta: { timestamp: Date.now() } });
      }
    } catch (err) {
      logger.warn('Positions API fallback:', (err as Error).message);
      // Return empty arrays on 404 or other errors (graceful degradation)
      if (type === 'open') {
        res.json([]);
      } else if (type === 'closed') {
        res.json([]);
      } else {
        res.json({ open: [], closed: [], meta: { error: (err as Error).message, timestamp: Date.now() } });
      }
    }
  } catch (err) {
    logger.error('Positions endpoint error:', err);
    if (req.query.type) {
      res.json([]);
    } else {
      res.json({ open: [], closed: [], meta: { error: 'INTERNAL_ERROR', timestamp: Date.now() } });
    }
  }
});

// Portfolio Greeks endpoint - aggregated Greeks across all positions
app.get('/api/portfolio/greeks', async (req, res) => {
  try {
    const userAddress = config.funderAddress;
    if (!userAddress) {
      return res.status(400).json({
        success: false,
        error: 'No user address configured',
        timestamp: Date.now(),
      });
    }

    // Get open positions
    const positionsRaw = await getOpenPositions(userAddress);
    const allPositions = Array.isArray(positionsRaw) ? positionsRaw : [];

    // Filter to only active crypto positions (not REDEEMABLE, not non-crypto)
    const positions = allPositions.filter(p => {
      // Skip if position is REDEEMABLE or closed
      const status = p.status || 'ACTIVE';
      if (status === 'REDEEMABLE' || status === 'redeemable' || p.redeemable === true) {
        return false;
      }

      // Skip zero-size positions
      const size = Number(p.size || p.curSize || p.balance || 0);
      if (size === 0) {
        return false;
      }

      // Check if this is a crypto market by looking at the question/title
      const question = (p.market || p.title || p.question || '').toLowerCase();
      const isCryptoMarket =
        question.includes('bitcoin') ||
        question.includes('btc') ||
        question.includes('ethereum') ||
        question.includes('eth') ||
        (question.includes('price') && (question.includes('above') || question.includes('below')));

      return isCryptoMarket;
    });

    if (positions.length === 0) {
      return res.json({
        success: true,
        totalDelta: 0,
        totalGamma: 0,
        totalVega: 0,
        totalTheta: 0,
        totalCharm: 0,
        totalVanna: 0,
        positionCount: 0,
        positions: [],
        timestamp: Date.now(),
        status: 'no_data',
        message: `No active crypto positions (filtered from ${allPositions.length} total positions)`,
      });
    }

    // Auto-wire any unwired position markets on-demand
    if (pricingWirer) {
      for (const position of positions) {
        const tokenId = position.asset || position.asset_id || position.id;
        if (!tokenId || pricingWirer.getPricing(tokenId)) continue;

        const question = position.market || position.title || position.question || '';
        const cryptoInfo = parseCryptoMarketFromQuestion(question);
        if (!cryptoInfo) continue;

        const expiry = parseExpiryFromQuestion(question);
        if (!expiry) continue;

        try {
          await pricingWirer.wireMarket({
            strike: cryptoInfo.strike,
            slug: position.slug || '',
            question,
            yesTokenId: tokenId,
            noTokenId: '',
            yesPrice: 0, noPrice: 0,
            bestBid: null, bestAsk: null,
            volume24hr: 0, liquidity: 0, spread: 0,
            active: true, acceptingOrders: true,
          }, cryptoInfo.crypto, expiry);
        } catch (e) {
          // Ignore wiring failures for individual positions
        }
      }
    }

    // Calculate portfolio Greeks
    const greeks = await portfolioGreeks.calculatePortfolioGreeks(positions);

    res.json({
      success: true,
      ...greeks,
    });
  } catch (err) {
    logger.error('Portfolio Greeks error:', err);
    res.status(500).json({
      success: false,
      error: (err as Error).message,
      timestamp: Date.now(),
    });
  }
});

// Pricing endpoint with Black-Scholes
app.post('/api/pricing/bs', async (req, res) => {
  try {
    let { spot, strike, tte, iv, slug, crypto } = req.body;

    // Default to ETH if not specified
    const selectedCrypto = crypto || 'ETH';

    // If slug provided, fetch market metadata
    if (slug) {
      try {
        const market = await pricingService.fetchMarketMetadata(slug);
        strike = market.strike;
        tte = pricingService.calculateTimeToExpiry(market.endDate);
        logger.info(`Market from slug "${slug}": strike=$${strike}, tte=${tte.toFixed(4)}`);
      } catch (err) {
        return res.status(400).json({
          error: `Failed to fetch market: ${(err as Error).message}`
        });
      }
    }

    // Use live data if not provided - select based on crypto
    if (!spot) {
      if (selectedCrypto === 'BTC' && currentSpotBTC) {
        spot = currentSpotBTC;
        logger.info(`Using live Binance BTC spot: $${spot}`);
      } else if (currentSpotETH) {
        spot = currentSpotETH;
        logger.info(`Using live Binance ETH spot: $${spot}`);
      } else if (!appConfig.features.binance) {
        logger.warn('Binance disabled - live spot data unavailable');
      }
    }

    // IV is only for ETH (Deribit is configured for ETH)
    if (!iv && currentIVETH) {
      iv = currentIVETH;
      logger.info(`Using live Deribit ETH IV: ${iv.toFixed(2)}%`);
    } else if (!iv && !appConfig.features.deribit) {
      logger.warn('Deribit disabled - live IV data unavailable');
    }

    if (!spot || !strike || !tte || !iv) {
      return res.status(400).json({
        error: 'Missing required params: spot, strike, tte, iv (or provide slug)',
        available: {
          spotETH: currentSpotETH,
          spotBTC: currentSpotBTC,
          ivETH: currentIVETH
        },
        services: {
          binance: appConfig.features.binance ? 'enabled' : 'disabled',
          deribit: appConfig.features.deribit ? 'enabled' : 'disabled',
        }
      });
    }

    // Black-Scholes calculation using MarketPricingService
    const S = Number(spot);
    const K = Number(strike);
    const T = Number(tte);
    const sigma = Number(iv);
    const r = 0; // risk-free rate

    // Calculate risk-neutral probability and Greeks
    const probAbove = pricingService.calculateRiskNeutralProb(S, K, sigma, T, r);
    const fair = probAbove;
    const greeks = pricingService.calculateGreeks(S, K, sigma, T, r);

    res.json({
      fair: fair.toFixed(3),
      iv: `${(sigma * 100).toFixed(0)}%`,
      spread: '0.8%',
      spot: S.toFixed(2),
      strike: K.toFixed(2),
      tte: T.toFixed(3),
      crypto: selectedCrypto,
      greeks: {
        delta: `${greeks.delta > 0 ? '+' : ''}${greeks.delta.toFixed(2)}`,
        gamma: greeks.gamma.toFixed(4),
        theta: greeks.theta.toFixed(4),
        vega: greeks.vega.toFixed(2)
      },
      probAbove: probAbove.toFixed(3),
      slug: slug || null
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Place order endpoint
app.post('/api/orders', async (req, res) => {
  try {
    await ensureTradingServices();
    if (!clobClient) {
      return res.status(503).json({ error: 'CLOB client not initialized' });
    }

    const { side, price, size, tokenId } = req.body;

    if (!side || !price || !size || !tokenId) {
      return res.status(400).json({ error: 'Missing required params' });
    }

    const order = await clobClient.placeOrder({
      tokenID: tokenId,
      price: Number(price),
      size: Number(size),
      side: side.toUpperCase() as 'BUY' | 'SELL',
      feeRateBps: 0
    });

    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Cancel order endpoint
app.post('/api/orders/:orderId/cancel', async (req, res) => {
  try {
    await ensureTradingServices();
    if (!clobClient) {
      return res.status(503).json({ error: 'CLOB client not initialized' });
    }

    const { orderId } = req.params;
    logger.info(`Cancelling order: ${orderId}`);

    // Use cancelOrders (plural) method which accepts an array of order IDs
    const result = await clobClient.cancelOrders([orderId]);
    logger.info(`Order cancelled successfully: ${orderId}`);

    res.json({ success: true, result });
  } catch (err) {
    logger.error('Cancel order error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// Cancel all orders endpoint
app.post('/api/orders/cancelAll', async (req, res) => {
  try {
    await ensureTradingServices();
    if (!clobClient) {
      return res.status(503).json({ error: 'CLOB client not initialized' });
    }

    logger.info('Cancelling all open orders...');

    // Use the cancelAll method which is the most efficient way to cancel all orders
    const result = await clobClient.cancelAll();

    logger.info('All orders cancelled successfully');
    res.json({ success: true, result });
  } catch (err) {
    logger.error('Cancel all orders error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ═════════════════════════════════════════════════════════════
// STANDARDIZED TRADING API (New unified endpoints)
// ═════════════════════════════════════════════════════════════

// Get orders (alias to /api/orders)
app.get('/api/trading/orders', async (req, res) => {
  try {
    if (!clobClient) {
      return res.json({ success: true, orders: [], count: 0 });
    }

    const orders = await getOpenOrders(clobClient);
    const formatted = (orders || []).slice(0, 100).map((order: any) => ({
      id: order.id || order.order_id || order.orderID,
      marketId: order.market || order.token_id || 'Unknown',
      side: String(order.side || '').toUpperCase(),
      price: Number(order.price || order.limit_price || 0),
      size: Number(order.size || order.remaining_size || order.size_remaining || 0),
      filledSize: Number(order.size_matched || order.sizeMatched || 0),
      status: order.status || 'OPEN',
      createdAt: order.created_at || new Date().toISOString(),
    }));

    res.json({ success: true, orders: formatted, count: formatted.length });
  } catch (err) {
    logger.error('Trading orders endpoint error:', err);
    res.json({ success: false, orders: [], count: 0, error: (err as Error).message });
  }
});

// Place order (alias to POST /api/orders with standardized request/response)
app.post('/api/trading/orders', async (req, res) => {
  try {
    if (!clobClient) {
      return res.status(503).json({ success: false, error: 'Trading service not initialized' });
    }

    const { tokenId, side, price, size } = req.body;

    // Validate request
    if (!tokenId || typeof tokenId !== 'string') {
      return res.status(400).json({ success: false, error: 'Invalid tokenId' });
    }
    if (!['BUY', 'SELL'].includes(String(side).toUpperCase())) {
      return res.status(400).json({ success: false, error: 'Side must be BUY or SELL' });
    }
    if (typeof price !== 'number' || price <= 0 || price >= 1) {
      return res.status(400).json({ success: false, error: 'Price must be between 0 and 1 (exclusive)' });
    }
    if (typeof size !== 'number' || size <= 0) {
      return res.status(400).json({ success: false, error: 'Size must be a positive number' });
    }

    const order = await clobClient.placeOrder({
      tokenID: tokenId,
      price: Number(price),
      size: Number(size),
      side: String(side).toUpperCase() as 'BUY' | 'SELL',
      feeRateBps: 0
    });

    res.json({
      success: true,
      order: {
        id: order.id || order.orderID,
        marketId: tokenId,
        side: String(side).toUpperCase(),
        price: Number(price),
        size: Number(size),
        filledSize: 0,
        status: 'OPEN',
        createdAt: new Date().toISOString(),
      }
    });
  } catch (err) {
    logger.error('Trading place order error:', err);
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// Cancel order (RESTful DELETE endpoint)
app.delete('/api/trading/orders/:orderId', async (req, res) => {
  try {
    if (!clobClient) {
      return res.status(503).json({ success: false, error: 'Trading service not initialized' });
    }

    const { orderId } = req.params;
    if (!orderId) {
      return res.status(400).json({ success: false, error: 'Order ID required' });
    }

    logger.info(`[Trading API] Cancelling order: ${orderId}`);
    const result = await clobClient.cancelOrders([orderId]);
    logger.info(`[Trading API] Order cancelled: ${orderId}`);

    res.json({ success: true, cancelled: true, result });
  } catch (err) {
    logger.error('Trading cancel order error:', err);
    res.status(500).json({ success: false, cancelled: false, error: (err as Error).message });
  }
});

// Cancel all orders
app.delete('/api/trading/orders', async (req, res) => {
  try {
    if (!clobClient) {
      return res.status(503).json({ success: false, error: 'Trading service not initialized' });
    }

    logger.info('[Trading API] Cancelling all open orders...');
    const result = await clobClient.cancelAll();
    logger.info('[Trading API] All orders cancelled');

    res.json({ success: true, cancelled: true, result });
  } catch (err) {
    logger.error('Trading cancel all orders error:', err);
    res.status(500).json({ success: false, cancelled: false, error: (err as Error).message });
  }
});

// Get positions (alias to /api/positions with standardized response)
app.get('/api/trading/positions', async (req, res) => {
  try {
    const userAddress = config.funderAddress;
    if (!userAddress) {
      return res.json({ success: true, positions: [], count: 0 });
    }

    const type = req.query.type as string || 'open';
    const openData = await getOpenPositions(userAddress);
    const openArray = Array.isArray(openData) ? openData : [];

    const positions = openArray
      .filter((p: any) => {
        const size = Number(p.size || p.curSize || p.balance || 0);
        const isRedeemable = p.status === 'REDEEMABLE' || p.redeemable === true;
        return size !== 0 && !isRedeemable;
      })
      .slice(0, 50)
      .map((p: any) => ({
        marketId: p.asset || p.asset_id || p.assetId || p.token_id,
        outcomeId: p.asset || p.asset_id,
        outcomeName: p.outcome || 'YES',
        size: Number(p.size || p.curSize || p.balance || 0),
        averagePrice: Number(p.avgPrice || p.avg_price || 0),
        currentPrice: Number(p.curPrice || p.cur_price || p.price || 0) || null,
        unrealizedPnL: null,
        updatedAt: new Date().toISOString(),
      }));

    res.json({ success: true, positions, count: positions.length });
  } catch (err) {
    logger.error('Trading positions endpoint error:', err);
    res.json({ success: false, positions: [], count: 0, error: (err as Error).message });
  }
});

// Get balance
app.get('/api/trading/balance', async (req, res) => {
  try {
    if (!clobClient) {
      return res.json({ success: false, balance: null, error: 'Trading service not initialized' });
    }

    // Note: Polymarket API may not have a direct balance endpoint
    // This is a placeholder that returns the available balance info
    res.json({
      success: true,
      balance: {
        total: 0,
        available: 0,
        locked: 0,
        currency: 'USDC',
        updatedAt: new Date().toISOString(),
      },
      message: 'Balance fetching requires Polymarket API integration'
    });
  } catch (err) {
    logger.error('Trading balance endpoint error:', err);
    res.json({ success: false, balance: null, error: (err as Error).message });
  }
});

// ═════════════════════════════════════════════════════════════
// END STANDARDIZED TRADING API
// ═════════════════════════════════════════════════════════════

// Graceful shutdown endpoint
app.post('/api/shutdown', (req, res) => {
  logger.info('Shutdown requested from UI');
  res.json({ success: true, message: 'Shutting down...' });

  // Close server gracefully then exit
  setTimeout(() => {
    logger.info('Server closing');
    process.exit(0);
  }, 100);
});

// ═════════════════════════════════════════════════════════════
// PERFORMANCE METRICS & SERVICE MANAGEMENT API
// ═════════════════════════════════════════════════════════════

// Get performance metrics
app.get('/api/metrics/performance', (req, res) => {
  try {
    const { crypto, service } = req.query;
    const metrics = performanceMetrics.getMetrics(
      crypto as string | undefined,
      service as 'binance' | 'deribit' | undefined
    );

    res.json({
      success: true,
      metrics,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('Performance metrics error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// Take metrics snapshot
app.post('/api/metrics/snapshot', (req, res) => {
  try {
    const { scenario, enabledServices } = req.body;

    if (scenario) {
      performanceMetrics.setScenario(scenario);
    }

    performanceMetrics.takeSnapshot(enabledServices || {
      binance: { eth: false, btc: false },
      deribit: { eth: false, btc: false },
    });

    res.json({
      success: true,
      message: 'Snapshot recorded',
      scenario: scenario || performanceMetrics['currentScenario'],
    });
  } catch (err) {
    logger.error('Snapshot error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// Get service registry status
app.get('/api/services/status', (req, res) => {
  try {
    const statuses = serviceRegistry.getAllStatuses();
    const counts = serviceRegistry.getServiceCounts();

    res.json({
      success: true,
      counts,
      services: statuses,
    });
  } catch (err) {
    logger.error('Service status error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// Start a specific service
app.post('/api/services/start', async (req, res) => {
  try {
    await ensureTradingServices();
    const { crypto, service } = req.body;

    if (!crypto || !service) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: crypto, service'
      });
    }

    if (service !== 'binance' && service !== 'deribit') {
      return res.status(400).json({
        success: false,
        error: 'Invalid service type. Must be "binance" or "deribit"'
      });
    }

    await serviceRegistry.startService(crypto, service);
    logger.info(`Service started via API: ${service}:${crypto}`);

    res.json({
      success: true,
      message: `Started ${service} for ${crypto}`,
    });
  } catch (err) {
    logger.error('Service start error:', err);
    res.status(500).json({
      success: false,
      error: (err as Error).message
    });
  }
});

// Stop a specific service
app.post('/api/services/stop', async (req, res) => {
  try {
    const { crypto, service } = req.body;

    if (!crypto || !service) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: crypto, service'
      });
    }

    if (service !== 'binance' && service !== 'deribit') {
      return res.status(400).json({
        success: false,
        error: 'Invalid service type. Must be "binance" or "deribit"'
      });
    }

    await serviceRegistry.stopService(crypto, service);
    logger.info(`Service stopped via API: ${service}:${crypto}`);

    res.json({
      success: true,
      message: `Stopped ${service} for ${crypto}`,
    });
  } catch (err) {
    logger.error('Service stop error:', err);
    res.status(500).json({
      success: false,
      error: (err as Error).message
    });
  }
});

// Start all services
app.post('/api/services/start-all', async (req, res) => {
  try {
    await ensureTradingServices();
    await serviceRegistry.startAll();
    logger.info('All services started via API');

    res.json({
      success: true,
      message: 'All services started',
    });
  } catch (err) {
    logger.error('Start all services error:', err);
    res.status(500).json({
      success: false,
      error: (err as Error).message
    });
  }
});

// Stop all services
app.post('/api/services/stop-all', async (req, res) => {
  try {
    await serviceRegistry.stopAll();
    logger.info('All services stopped via API');

    res.json({
      success: true,
      message: 'All services stopped',
    });
  } catch (err) {
    logger.error('Stop all services error:', err);
    res.status(500).json({
      success: false,
      error: (err as Error).message
    });
  }
});

// ═════════════════════════════════════════════════════════════
// MARKET DISCOVERY API
// ═════════════════════════════════════════════════════════════

// Discover multi-strike crypto prediction markets
app.get('/api/discovery/markets', async (req, res) => {
  try {
    if (!marketFinder) {
      return res.status(503).json({ error: 'Market finder not initialized' });
    }

    const crypto = (req.query.crypto as string || 'BTC').toUpperCase() as CryptoTicker;
    const days = Math.min(parseInt(req.query.days as string) || 30, 100);

    // Validate crypto
    if (!['BTC', 'ETH', 'SOL', 'XRP'].includes(crypto)) {
      return res.status(400).json({
        error: 'Invalid crypto. Must be one of: BTC, ETH, SOL, XRP'
      });
    }

    logger.info(`Discovering ${crypto} markets for next ${days} days`);
    const result = await marketFinder.discoverMarkets(crypto, days);

    res.json({
      success: true,
      crypto,
      daysScanned: days,
      eventsFound: result.events.length,
      totalStrikes: result.totalStrikes,
      discoveredAt: result.discoveredAt,
      events: result.events.map(event => ({
        eventDate: event.eventDate.toISOString().split('T')[0],
        eventSlug: event.eventSlug,
        eventTitle: event.eventTitle,
        strikeCount: event.strikes.length,
        strikes: event.strikes.map(s => ({
          strike: s.strike,
          slug: s.slug,
          yesTokenId: s.yesTokenId,
          noTokenId: s.noTokenId,
          yesPrice: s.yesPrice,
          noPrice: s.noPrice,
          bestBid: s.bestBid,
          bestAsk: s.bestAsk,
          volume24hr: s.volume24hr,
          liquidity: s.liquidity,
          spread: s.spread,
          active: s.active,
        })),
      })),
    });
  } catch (err) {
    logger.error('Market discovery error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// Get strikes for a specific crypto and date
app.get('/api/discovery/strikes', async (req, res) => {
  try {
    if (!marketFinder) {
      return res.status(503).json({ error: 'Market finder not initialized' });
    }

    const crypto = (req.query.crypto as string || 'BTC').toUpperCase() as CryptoTicker;
    const dateStr = req.query.date as string;

    if (!dateStr) {
      return res.status(400).json({ error: 'date query parameter required (YYYY-MM-DD)' });
    }

    const date = new Date(dateStr);
    if (isNaN(date.getTime())) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    const strikes = await marketFinder.getStrikesForDate(crypto, date);

    res.json({
      success: true,
      crypto,
      date: dateStr,
      strikeCount: strikes.length,
      strikes: strikes.map(s => ({
        strike: s.strike,
        slug: s.slug,
        yesTokenId: s.yesTokenId,
        noTokenId: s.noTokenId,
        yesPrice: s.yesPrice,
        noPrice: s.noPrice,
        bestBid: s.bestBid,
        bestAsk: s.bestAsk,
        volume24hr: s.volume24hr,
        liquidity: s.liquidity,
      })),
    });
  } catch (err) {
    logger.error('Strikes lookup error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// Subscribe to a discovered market with automatic pricing wiring
app.post('/api/discovery/subscribe', async (req, res) => {
  try {
    if (!marketFinder || !pricingWirer) {
      return res.status(503).json({ error: 'Services not initialized' });
    }

    const { tokenId, crypto, strike, expiry, slug } = req.body;

    if (!tokenId || !crypto || !strike || !expiry) {
      return res.status(400).json({
        error: 'Missing required fields: tokenId, crypto, strike, expiry'
      });
    }

    const cryptoUpper = crypto.toUpperCase() as CryptoTicker;
    const expiryDate = new Date(expiry);

    // Create a strike market object for wiring
    const market: StrikeMarket = {
      strike: Number(strike),
      slug: slug || '',
      question: `Will ${cryptoUpper} be above $${strike}?`,
      yesTokenId: tokenId,
      noTokenId: '',
      yesPrice: 0,
      noPrice: 0,
      bestBid: null,
      bestAsk: null,
      volume24hr: 0,
      liquidity: 0,
      spread: 0,
      active: true,
      acceptingOrders: true,
    };

    // Wire the market to pricing feeds
    const wiredMarket = await pricingWirer.wireMarket(market, cryptoUpper, expiryDate);

    logger.info(`Market wired: ${cryptoUpper} $${strike} expiring ${expiryDate.toISOString()}`);

    res.json({
      success: true,
      message: `Market subscribed and wired to pricing`,
      market: {
        tokenId: wiredMarket.tokenId,
        crypto: wiredMarket.crypto,
        strike: wiredMarket.strike,
        expiry: wiredMarket.expiry.toISOString(),
        status: wiredMarket.status,
        spotPrice: wiredMarket.spotPrice,
        impliedVolatility: wiredMarket.impliedVolatility,
        fairPrice: wiredMarket.fairPrice,
        greeks: wiredMarket.greeks,
      },
    });
  } catch (err) {
    logger.error('Discovery subscribe error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// Wire all discovered markets for a crypto at once
app.post('/api/discovery/wire-all/:crypto', async (req, res) => {
  try {
    if (!discoveryOrchestrator) {
      return res.status(503).json({ error: 'Discovery orchestrator not initialized' });
    }

    const crypto = req.params.crypto.toUpperCase() as CryptoTicker;
    const days = Math.min(parseInt(req.body.days) || 30, 100);

    // Validate crypto
    if (!['BTC', 'ETH', 'SOL', 'XRP'].includes(crypto)) {
      return res.status(400).json({
        error: 'Invalid crypto. Must be one of: BTC, ETH, SOL, XRP'
      });
    }

    logger.info(`Batch wiring all ${crypto} markets for next ${days} days`);

    const result = await discoveryOrchestrator.wireAllMarketsForCrypto(crypto, days);

    logger.info(
      `Batch wire complete: ${result.totalWired}/${result.totalDiscovered} markets wired in ${result.duration}ms`
    );

    res.json({
      success: true,
      crypto: result.crypto,
      totalMarkets: result.totalDiscovered,
      wiredCount: result.totalWired,
      failedCount: result.failedMarkets.length,
      duration: result.duration,
      markets: result.wiredMarkets.map(m => ({
        tokenId: m.tokenId,
        crypto: m.crypto,
        strike: m.strike,
        expiry: m.expiry.toISOString(),
        status: m.status,
        spotPrice: m.spotPrice,
        impliedVolatility: m.impliedVolatility,
        fairPrice: m.fairPrice,
        greeks: m.greeks ? {
          delta: m.greeks.delta,
          gamma: m.greeks.gamma,
          vega: m.greeks.vega,
          theta: m.greeks.theta,
        } : null,
        edge: m.edge,
        bestBid: m.marketBid,
        bestAsk: m.marketAsk,
        spread: m.spread,
      })),
      failedMarkets: result.failedMarkets,
    });
  } catch (err) {
    logger.error('Batch wire error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ═════════════════════════════════════════════════════════════
// PRICING & GREEKS API
// ═════════════════════════════════════════════════════════════

// Get all wired markets
app.get('/api/pricing/wired', async (req, res) => {
  try {
    await ensureTradingServices();
    if (!pricingWirer) {
      return res.status(503).json({ error: 'Pricing wirer not initialized' });
    }

    const wiredMarkets = pricingWirer.getAllWiredMarkets();
    const now = Date.now();

    // Get data freshness timestamps from services
    const getDataFreshness = (crypto: string) => {
      const binanceService = serviceRegistry.getService<BinancePriceListener>(crypto, 'binance');
      const deribitService = serviceRegistry.getService<DeribitListener>(crypto, 'deribit');

      const spotTimestamp = binanceService?.getLastPriceTimestamp?.() ?? 0;
      const ivTimestamp = deribitService?.getLastUpdateTimestamp?.() ?? 0;

      return {
        spotTimestamp,
        ivTimestamp,
        spotAgeMs: spotTimestamp > 0 ? now - spotTimestamp : null,
        ivAgeMs: ivTimestamp > 0 ? now - ivTimestamp : null,
      };
    };

    // Get freshness for each crypto
    const freshness: Record<string, { spotTimestamp: number; ivTimestamp: number; spotAgeMs: number | null; ivAgeMs: number | null }> = {};
    for (const crypto of ['BTC', 'ETH']) {
      freshness[crypto] = getDataFreshness(crypto);
    }

    res.json({
      success: true,
      count: wiredMarkets.length,
      timestamp: now,
      freshness, // Global freshness data per crypto
      markets: wiredMarkets.map(m => {
        const cryptoFreshness = freshness[m.crypto] || { spotAgeMs: null, ivAgeMs: null };
        return {
          tokenId: m.tokenId,
          crypto: m.crypto,
          strike: m.strike,
          expiry: m.expiry.toISOString(),
          status: m.status,
          spotPrice: m.spotPrice,
          impliedVolatility: m.impliedVolatility,
          fairPrice: m.fairPrice,
          greeks: m.greeks ? {
            delta: m.greeks.delta,
            gamma: m.greeks.gamma,
            vega: m.greeks.vega,
            theta: m.greeks.theta,
          } : null,
          edge: m.edge,
          bestBid: m.marketBid,
          bestAsk: m.marketAsk,
          spread: m.spread,
          underlyingPrice: m.spotPrice,
          derivedBid: m.derivedBid,
          derivedAsk: m.derivedAsk,
          derivedMid: m.derivedMid,
          derivedSpread: m.derivedSpread,
          derivedEdge: m.derivedEdge,
          lastUpdate: m.lastUpdate.toISOString(),
          // Data freshness info
          spotAgeMs: cryptoFreshness.spotAgeMs,
          ivAgeMs: cryptoFreshness.ivAgeMs,
        };
      }),
    });
  } catch (err) {
    logger.error('Wired markets error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// Get pricing and Greeks for a wired market
app.get('/api/pricing/:tokenId', async (req, res) => {
  try {
    await ensureTradingServices();
    const { tokenId } = req.params;

    // First check if market is wired
    if (pricingWirer) {
      const wiredMarket = pricingWirer.getPricing(tokenId);
      if (wiredMarket) {
        return res.json({
          success: true,
          source: 'wired',
          tokenId,
          crypto: wiredMarket.crypto,
          strike: wiredMarket.strike,
          expiry: wiredMarket.expiry.toISOString(),
          spotPrice: wiredMarket.spotPrice,
          impliedVolatility: wiredMarket.impliedVolatility,
          timeToExpiry: wiredMarket.timeToExpiry,
          fairPrice: wiredMarket.fairPrice,
          greeks: wiredMarket.greeks,
          marketBid: wiredMarket.marketBid,
          marketAsk: wiredMarket.marketAsk,
          edge: wiredMarket.edge,
          status: wiredMarket.status,
          lastUpdate: wiredMarket.lastUpdate.toISOString(),
        });
      }
    }

    // Fallback: Calculate pricing with available data
    const { spot, strike, tte, iv, crypto } = req.query;

    if (!spot || !strike || !tte || !iv) {
      return res.status(400).json({
        error: 'Market not wired. Provide query params: spot, strike, tte, iv',
        hint: 'Use POST /api/discovery/subscribe to wire a market for automatic pricing',
      });
    }

    const pricing = calculateBinaryGreeks({
      spot: Number(spot),
      strike: Number(strike),
      tte: Number(tte),
      iv: Number(iv),
      isCall: true,
    });

    res.json({
      success: true,
      source: 'calculated',
      tokenId,
      crypto: crypto || 'unknown',
      spot: Number(spot),
      strike: Number(strike),
      tte: Number(tte),
      iv: Number(iv),
      fairPrice: pricing.price,
      d1: pricing.d1,
      d2: pricing.d2,
      greeks: pricing.greeks,
    });
  } catch (err) {
    logger.error('Pricing error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// Calculate pricing for arbitrary inputs (no market required)
app.post('/api/pricing/calculate', async (req, res) => {
  try {
    const { spot, strike, tte, iv, isCall = true } = req.body;

    if (!spot || !strike || !tte || !iv) {
      return res.status(400).json({
        error: 'Missing required fields: spot, strike, tte (time to expiry in years), iv (as decimal, e.g., 0.65 for 65%)'
      });
    }

    const pricing = calculateBinaryGreeks({
      spot: Number(spot),
      strike: Number(strike),
      tte: Number(tte),
      iv: Number(iv),
      isCall: Boolean(isCall),
    });

    res.json({
      success: true,
      inputs: {
        spot: Number(spot),
        strike: Number(strike),
        tte: Number(tte),
        iv: Number(iv),
        ivPercent: `${(Number(iv) * 100).toFixed(1)}%`,
        isCall,
      },
      pricing: {
        fairPrice: pricing.price,
        fairPricePercent: `${(pricing.price * 100).toFixed(2)}%`,
        d1: pricing.d1,
        d2: pricing.d2,
      },
      greeks: {
        delta: pricing.greeks.delta,
        gamma: pricing.greeks.gamma,
        vega: pricing.greeks.vega,
        theta: pricing.greeks.theta,
        charm: pricing.greeks.charm,
        vanna: pricing.greeks.vanna,
      },
      interpretation: {
        deltaDirection: pricing.greeks.delta > 0 ? 'bullish' : 'bearish',
        deltaExposure: `$${Math.abs(pricing.greeks.delta * 100).toFixed(2)} per $100 spot move`,
        vegaExposure: `${(pricing.greeks.vega * 100).toFixed(4)} per 1% IV change`,
        thetaDecay: `${(pricing.greeks.theta * 100).toFixed(4)}% per day`,
      },
    });
  } catch (err) {
    logger.error('Pricing calculate error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});


// Get IV for a specific crypto (optionally matched to expiry)
app.get('/api/iv/:crypto', async (req, res) => {
  try {
    const crypto = req.params.crypto.toUpperCase();
    const expiry = req.query.expiry as string;

    // Get current IV from service registry
    const deribitService = serviceRegistry.getService<DeribitListener>(crypto, 'deribit');
    if (!deribitService) {
      return res.status(404).json({
        error: `No Deribit service for ${crypto}. Available: ETH, BTC`,
      });
    }

    const snapshot = deribitService.getLastSnapshot();
    if (!snapshot) {
      return res.status(503).json({
        error: `No IV data available for ${crypto}. Service may be starting up.`,
      });
    }

    // If expiry specified, try to get IV for that expiry
    if (expiry) {
      const expiryDate = new Date(expiry);
      const spotPrice = crypto === 'ETH' ? currentSpotETH : currentSpotBTC;

      // Set target expiry and wait for update
      await deribitService.setTargetExpiry(expiryDate);
    }

    res.json({
      success: true,
      crypto,
      instrumentName: snapshot.instrumentName,
      markIv: snapshot.markIv,
      markIvPercent: `${(snapshot.markIv * 100).toFixed(1)}%`,
      underlyingPrice: snapshot.underlyingPrice,
      timestamp: snapshot.timestamp,
      instrument: snapshot.instrument,
      greeks: snapshot.greeks,
    });
  } catch (err) {
    logger.error('IV lookup error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ═════════════════════════════════════════════════════════════
// CONTROLS FRAMEWORK API ENDPOINTS
// ═════════════════════════════════════════════════════════════

// Safety Monitor Status
app.get('/api/safety-monitor/status', (req, res) => {
  try {
    const safetyMonitor = serviceRegistry.getSafetyMonitor();
    const stats = safetyMonitor.getStats();
    const unsafeMarkets = safetyMonitor.getUnsafeMarkets();
    const safeMarkets = safetyMonitor.getSafeMarkets();

    res.json({
      success: true,
      stats: {
        totalMarkets: stats.totalMarkets,
        safeMarkets: stats.safeMarkets,
        unsafeMarkets: stats.unsafeMarkets,
        safetyRate: stats.safetyRate,
      },
      unsafeMarkets: unsafeMarkets.map(m => ({
        tokenId: m.tokenId,
        reasons: m.reasons,
        lastCheck: m.lastCheck,
      })),
      safeMarkets: safeMarkets.map(m => m.tokenId),
      commonReasons: Object.fromEntries(stats.commonReasons),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Inventory Summary
app.get('/api/inventory/summary', (req, res) => {
  try {
    const inventoryTracker = serviceRegistry.getInventoryTracker();
    const summary = inventoryTracker.getSummary();
    const pnl = inventoryTracker.getTotalPnL();
    const allPositions = inventoryTracker.getAllPositions();

    res.json({
      success: true,
      summary: {
        totalPositions: summary.totalPositions,
        totalRealizedPnL: summary.totalRealizedPnL,
        totalUnrealizedPnL: summary.totalUnrealizedPnL,
        totalPnL: summary.totalPnL,
      },
      byCrypto: Object.fromEntries(summary.cryptos),
      positions: allPositions.map(pos => ({
        tokenId: pos.tokenId,
        crypto: pos.crypto,
        strike: pos.strike,
        quantity: pos.quantity,
        avgEntryPrice: pos.avgEntryPrice,
        realizedPnL: pos.realizedPnL,
        unrealizedPnL: pos.unrealizedPnL,
        lastUpdate: pos.lastUpdate,
      })),
      pnl,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Get Risk Limits
app.get('/api/risk/limits', (req, res) => {
  try {
    const inventoryTracker = serviceRegistry.getInventoryTracker();
    const portfolioGreeks = serviceRegistry.getPortfolioGreeks();
    const exposure = portfolioGreeks.getExposure();

    // Get current limits from config
    const limits = {
      maxQuantityPerMarket: appConfig.marketMaker?.maxQuantityPerMarket ?? 1000,
      maxNotionalPerCrypto: appConfig.marketMaker?.maxNotionalPerCrypto ?? 10000,
      maxGammaExposure: appConfig.marketMaker?.maxGammaExposure ?? 0.5,
    };

    res.json({
      success: true,
      limits,
      current: {
        gammaExposure: Math.abs(exposure.totalGamma),
        marketCount: exposure.marketCount,
        netNotional: exposure.netNotional,
      },
      usage: {
        gammaUtilization: Math.abs(exposure.totalGamma) / limits.maxGammaExposure,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Update Risk Limits
app.patch('/api/risk/limits', (req, res) => {
  try {
    // Dynamic limit updates not implemented yet
    res.status(501).json({
      success: false,
      error: 'Dynamic limit updates not implemented. Edit .env and restart.'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Comprehensive System Status
app.get('/api/system/status', (req, res) => {
  try {
    const safetyMonitor = serviceRegistry.getSafetyMonitor();
    const portfolioGreeks = serviceRegistry.getPortfolioGreeks();
    const inventoryTracker = serviceRegistry.getInventoryTracker();

    const safetyStats = safetyMonitor.getStats();
    const exposure = portfolioGreeks.getExposure();
    const inventorySummary = inventoryTracker.getSummary();

    res.json({
      success: true,
      timestamp: Date.now(),
      services: {
        binance: {
          ETH: serviceRegistry.getService('ETH', 'binance') ? 'connected' : 'disconnected',
          BTC: serviceRegistry.getService('BTC', 'binance') ? 'connected' : 'disconnected',
        },
        deribit: {
          ETH: serviceRegistry.getService('ETH', 'deribit') ? 'connected' : 'disconnected',
          BTC: serviceRegistry.getService('BTC', 'deribit') ? 'connected' : 'disconnected',
        },
        polymarket: {
          websocket: 'connected', // TODO: Get from HybridStreamManager
          clob: 'connected',
        },
      },
      qpServices: {
        safetyMonitor: {
          totalMarkets: safetyStats.totalMarkets,
          safetyRate: safetyStats.safetyRate,
        },
        portfolioGreeks: {
          positionCount: exposure.marketCount,
          totalGamma: exposure.totalGamma,
          totalDelta: exposure.totalDelta,
        },
        inventoryTracker: {
          totalPositions: inventorySummary.totalPositions,
          totalPnL: inventorySummary.totalPnL,
        },
      },
      config: {
        riskFreeRate: appConfig.pricing?.riskFreeRate ?? 0.04,
        baseSpread: appConfig.marketMaker?.baseSpread ?? 0.02,
        gammaCoefficient: appConfig.marketMaker?.gammaCoefficient ?? 100,
        inventoryCoefficient: appConfig.marketMaker?.inventoryCoefficient ?? 0.0001,
        safetyLimits: appConfig.safety,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// ═════════════════════════════════════════════════════════════
// RESEARCH API ENDPOINTS (Separate from Trading)
// ═════════════════════════════════════════════════════════════

import {
  getResearchDB,
  getLiveDataIngester,
  getAnalysisEngine,
  POLYMARKET_TAGS,
} from './src/research/index.js';
import type { PolymarketCategory } from './src/research/index.js';

// Research Status - Data freshness, coverage, storage stats
app.get('/api/research/status', async (req, res) => {
  try {
    const researchDb = getResearchDB();
    const ingester = getLiveDataIngester();

    const syncStatus = researchDb.getSyncStatus();
    const dbStats = researchDb.getStats();
    const ingesterStatus = ingester.getStatus();
    const progress = researchDb.getSyncProgress();

    res.json({
      success: true,
      timestamp: Date.now(),
      sync: {
        ...syncStatus,
        progress: {
          marketsTotal: progress.marketsTotal,
          marketsProcessed: progress.marketsProcessed,
          tradesProcessed: progress.tradesProcessed,
          dbSizeMB: Math.round(progress.dbSizeMB * 10) / 10,
          dbLimitMB: 15360,
          currentPhase: progress.currentPhase,
          startedAt: progress.syncStartedAt,
        },
      },
      storage: {
        markets: dbStats.markets,
        trades: dbStats.trades,
        signals: dbStats.signals,
        positions: dbStats.positions,
        cachedAnalyses: dbStats.cachedAnalyses,
      },
      ingester: {
        isRunning: ingesterStatus.isRunning,
        pollingIntervalMs: ingesterStatus.syncInterval,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Win Rate by Price - Market calibration analysis
app.get('/api/research/win-rate-by-price', async (req, res) => {
  try {
    const engine = getAnalysisEngine();
    const winRates = await engine.calculateWinRateByPrice();

    res.json({
      success: true,
      timestamp: Date.now(),
      data: winRates,
      summary: {
        totalSamples: winRates.reduce((sum, w) => sum + w.sampleSize, 0),
        avgOverconfidence: winRates.length > 0
          ? winRates.reduce((sum, w) => sum + w.overconfidence, 0) / winRates.length
          : 0,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Calibration data - Comprehensive longshot bias analysis
app.get('/api/research/calibration', async (req, res) => {
  try {
    const engine = getAnalysisEngine();
    const winRateByPrice = await engine.calculateWinRateByPrice();

    // Filter for buckets with sufficient sample size
    const significantBuckets = winRateByPrice.filter(b => b.sampleSize >= 10);

    // Identify overconfident buckets (market overprices low-probability events)
    const overconfidentBuckets = significantBuckets
      .filter(b => b.overconfidence > 0.05) // Actual win rate 5%+ higher than expected
      .sort((a, b) => b.overconfidence - a.overconfidence);

    // Identify underconfident buckets (market underprices high-probability events)
    const underconfidentBuckets = significantBuckets
      .filter(b => b.overconfidence < -0.05) // Actual win rate 5%+ lower than expected
      .sort((a, b) => a.overconfidence - b.overconfidence);

    // Calculate aggregate statistics
    const totalSamples = significantBuckets.reduce((sum, b) => sum + b.sampleSize, 0);
    const avgOverconfidence = significantBuckets.length > 0
      ? significantBuckets.reduce((sum, b) => sum + b.overconfidence * b.sampleSize, 0) / totalSamples
      : 0;

    // Find strongest bias (largest absolute overconfidence)
    const strongestBias = significantBuckets.length > 0
      ? significantBuckets.reduce((max, b) =>
          Math.abs(b.overconfidence) > Math.abs(max.overconfidence) ? b : max
        )
      : null;

    // Longshot bias check: do low-price markets (<20 cents) have positive overconfidence?
    const lowPriceBuckets = significantBuckets.filter(b => b.priceBucket < 20);
    const hasLongshotBias = lowPriceBuckets.length > 0
      ? lowPriceBuckets.reduce((sum, b) => sum + b.overconfidence * b.sampleSize, 0) /
          lowPriceBuckets.reduce((sum, b) => sum + b.sampleSize, 0) > 0.03
      : false;

    res.json({
      success: true,
      timestamp: Date.now(),
      data: {
        winRateByPrice: significantBuckets,
        overconfidentBuckets: overconfidentBuckets.slice(0, 10), // Top 10
        underconfidentBuckets: underconfidentBuckets.slice(0, 10), // Top 10
        summary: {
          totalSamples,
          significantBuckets: significantBuckets.length,
          overconfidentCount: overconfidentBuckets.length,
          underconfidentCount: underconfidentBuckets.length,
          avgOverconfidence,
          strongestBias: strongestBias ? {
            priceBucket: strongestBias.priceBucket,
            overconfidence: strongestBias.overconfidence,
            sampleSize: strongestBias.sampleSize,
          } : null,
          hasLongshotBias,
          biasInterpretation: hasLongshotBias
            ? 'Markets show longshot bias - low-probability events are overpriced'
            : 'No significant longshot bias detected',
        },
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Volume Analysis - Volume over time
app.get('/api/research/volume-analysis', async (req, res) => {
  try {
    const granularity = (req.query.granularity as string) || 'daily';
    if (!['daily', 'weekly', 'monthly'].includes(granularity)) {
      return res.status(400).json({ error: 'Invalid granularity. Use daily, weekly, or monthly.' });
    }

    const engine = getAnalysisEngine();
    const volumeData = await engine.getVolumeOverTime(granularity as 'daily' | 'weekly' | 'monthly');

    res.json({
      success: true,
      timestamp: Date.now(),
      granularity,
      data: volumeData,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Market Scores - MM market selection
app.get('/api/research/market-scores', async (req, res) => {
  try {
    const minScore = req.query.minScore ? Number(req.query.minScore) : undefined;
    const recommendation = req.query.recommendation as string | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const excludeCrypto = req.query.excludeCrypto === 'true';

    const engine = getAnalysisEngine();
    const scores = await engine.scoreMarketsForMM({
      minVolume24h: 1000,
      excludeCrypto,
      limit,
    });

    // Apply additional filters
    let filtered = scores;
    if (minScore !== undefined) {
      filtered = filtered.filter(s => s.overallScore >= minScore);
    }
    if (recommendation) {
      filtered = filtered.filter(s => s.recommendation === recommendation);
    }

    res.json({
      success: true,
      timestamp: Date.now(),
      total: filtered.length,
      data: filtered,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Mispricing Scanner - Current opportunities
app.get('/api/research/mispricing', async (req, res) => {
  try {
    const minMispricing = req.query.minMispricing ? Number(req.query.minMispricing) : 3;
    const minConfidence = req.query.minConfidence ? Number(req.query.minConfidence) : 0.5;
    const minVolume = req.query.minVolume ? Number(req.query.minVolume) : 1000;
    const limit = req.query.limit ? Number(req.query.limit) : 50;

    const engine = getAnalysisEngine();
    const opportunities = await engine.detectMispricing({
      minMispricingPercent: minMispricing,
      minConfidence,
      minVolume,
      limit,
    });

    res.json({
      success: true,
      timestamp: Date.now(),
      total: opportunities.length,
      filters: { minMispricing, minConfidence, minVolume },
      data: opportunities,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Mispricing History - Past signals and outcomes
app.get('/api/research/mispricing/history', async (req, res) => {
  try {
    const status = req.query.status as 'PENDING' | 'ACTED' | 'EXPIRED' | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 100;

    const researchDb = getResearchDB();
    const signals = researchDb.getMispricingSignals(status, limit);

    res.json({
      success: true,
      timestamp: Date.now(),
      total: signals.length,
      data: signals,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Market Deep Dive - Detailed market analysis
app.get('/api/research/market/:id', async (req, res) => {
  try {
    const marketId = req.params.id;

    const researchDb = getResearchDB();
    const market = researchDb.getMarket(marketId);

    if (!market) {
      return res.status(404).json({ error: 'Market not found' });
    }

    const engine = getAnalysisEngine();
    const performance = await engine.analyzeMarketPerformance(marketId);

    res.json({
      success: true,
      timestamp: Date.now(),
      market,
      performance,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Market Trades - Trade history for specific market
app.get('/api/research/market/:id/trades', async (req, res) => {
  try {
    const marketId = req.params.id;
    const limit = req.query.limit ? Number(req.query.limit) : 500;

    const researchDb = getResearchDB();
    const trades = researchDb.getTrades(marketId, limit);

    res.json({
      success: true,
      timestamp: Date.now(),
      marketId,
      total: trades.length,
      data: trades,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Research Markets - List markets in research database
app.get('/api/research/markets', async (req, res) => {
  try {
    const activeOnly = req.query.active === 'true';
    const closedOnly = req.query.closed === 'true';
    const resolvedOnly = req.query.resolved === 'true';
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const offset = req.query.offset ? Number(req.query.offset) : 0;

    const researchDb = getResearchDB();
    const markets = researchDb.getMarkets({
      activeOnly,
      closedOnly,
      resolvedOnly,
      limit,
      offset,
      orderBy: 'volume',
    });

    const stats = researchDb.getMarketStats();

    res.json({
      success: true,
      timestamp: Date.now(),
      total: stats.total,
      stats,
      data: markets,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Research Positions - Directional bets (separate from trading)
app.get('/api/research/positions', async (req, res) => {
  try {
    const status = req.query.status as 'OPEN' | 'CLOSED' | undefined;

    const researchDb = getResearchDB();
    const positions = researchDb.getResearchPositions(status);

    const openPositions = positions.filter(p => p.status === 'OPEN');
    const totalPnL = positions
      .filter(p => p.pnl !== null)
      .reduce((sum, p) => sum + (p.pnl || 0), 0);

    res.json({
      success: true,
      timestamp: Date.now(),
      total: positions.length,
      openCount: openPositions.length,
      totalPnL,
      data: positions,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Create Research Position
app.post('/api/research/positions', async (req, res) => {
  try {
    const { marketId, entryPrice, size, direction, thesis } = req.body;

    if (!marketId || entryPrice === undefined || !size || !direction) {
      return res.status(400).json({ error: 'Missing required fields: marketId, entryPrice, size, direction' });
    }

    const researchDb = getResearchDB();
    const market = researchDb.getMarket(marketId);

    const position = {
      id: `pos-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      marketId,
      marketQuestion: market?.question || 'Unknown',
      entryPrice: Number(entryPrice),
      entryDate: Date.now(),
      size: Number(size),
      direction: direction as 'YES' | 'NO',
      thesis: thesis || '',
      status: 'OPEN' as const,
      currentPrice: null,
      exitPrice: null,
      exitDate: null,
      pnl: null,
    };

    researchDb.upsertResearchPosition(position);

    res.json({
      success: true,
      timestamp: Date.now(),
      position,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Close Research Position
app.post('/api/research/positions/:id/close', async (req, res) => {
  try {
    const positionId = req.params.id;
    const { exitPrice } = req.body;

    if (exitPrice === undefined) {
      return res.status(400).json({ error: 'Missing required field: exitPrice' });
    }

    const researchDb = getResearchDB();
    researchDb.closeResearchPosition(positionId, Number(exitPrice));

    const positions = researchDb.getResearchPositions();
    const position = positions.find(p => p.id === positionId);

    res.json({
      success: true,
      timestamp: Date.now(),
      position,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Data Sync - Trigger manual sync
app.post('/api/research/sync', async (req, res) => {
  try {
    const { type } = req.body; // 'markets', 'trades', or 'full'

    const ingester = getLiveDataIngester();

    let result;
    switch (type) {
      case 'markets':
        result = await ingester.syncMarkets();
        break;
      case 'trades':
        result = await ingester.syncTrades();
        break;
      case 'full':
      default:
        result = await ingester.fullSync();
        break;
    }

    res.json({
      success: true,
      timestamp: Date.now(),
      syncType: type || 'full',
      result,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Start Background Sync
app.post('/api/research/sync/start', async (req, res) => {
  try {
    const ingester = getLiveDataIngester();
    ingester.startBackgroundSync();

    res.json({
      success: true,
      timestamp: Date.now(),
      message: 'Background sync started',
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Stop Background Sync
app.post('/api/research/sync/stop', async (req, res) => {
  try {
    const ingester = getLiveDataIngester();
    ingester.stopBackgroundSync();

    // Always clear DB running flags — handles stale state after server restarts
    const researchDb = getResearchDB();
    researchDb.updateSyncStatus({ isRunning: false });
    researchDb.updateSyncProgress({ isRunning: false, currentPhase: null });

    res.json({
      success: true,
      timestamp: Date.now(),
      message: 'Background sync stopped',
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Category-based sync - Fetch markets + trades for a specific category
app.post('/api/research/sync/category', async (req, res) => {
  try {
    const { category, days, includeResolved, maxMarkets } = req.body;

    // Validate category if provided
    if (category && !(category in POLYMARKET_TAGS)) {
      res.status(400).json({
        success: false,
        error: `Invalid category "${category}". Valid: ${Object.keys(POLYMARKET_TAGS).join(', ')}`,
      });
      return;
    }

    const ingester = getLiveDataIngester();
    const result = await ingester.syncByCategory({
      category: category as PolymarketCategory | undefined,
      days: Number(days) || 30,
      includeResolved: includeResolved !== false, // default true
      maxMarkets: Number(maxMarkets) || 500,
    });

    const researchDb = getResearchDB();
    const dbSizeMB = Math.round(researchDb.getTotalSizeBytes() / 1024 / 1024);

    res.json({
      success: true,
      timestamp: Date.now(),
      category: category || 'ALL',
      days: Number(days) || 30,
      result,
      dbSizeMB,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Available categories
app.get('/api/research/categories', (req, res) => {
  const categories = Object.entries(POLYMARKET_TAGS).map(([id, tagId]) => ({
    id,
    label: id.charAt(0) + id.slice(1).toLowerCase(),
    tagId,
  }));

  res.json({
    success: true,
    timestamp: Date.now(),
    categories,
  });
});

// Trade-based win rate calibration (high-fidelity using individual trades)
app.get('/api/research/win-rate-by-trade', async (req, res) => {
  try {
    const tag = req.query.tag as string | undefined;
    const minSampleSize = Number(req.query.minSampleSize) || 10;

    const engine = getAnalysisEngine();
    const data = await engine.calculateTradeBasedWinRate({
      tag: tag || undefined,
      minSampleSize,
    });

    // Calculate summary stats
    const significantBuckets = data.filter(d => d.sampleSize >= minSampleSize);
    const totalSamples = data.reduce((s, d) => s + d.sampleSize, 0);
    const avgOverconfidence = significantBuckets.length > 0
      ? significantBuckets.reduce((s, d) => s + d.overconfidence, 0) / significantBuckets.length
      : 0;

    res.json({
      success: true,
      timestamp: Date.now(),
      tag: tag || 'all',
      data,
      summary: {
        totalBuckets: data.length,
        significantBuckets: significantBuckets.length,
        totalSamples,
        avgOverconfidence: Math.round(avgOverconfidence * 10000) / 10000,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// ═════════════════════════════════════════════════════════════
// PARQUET RESEARCH DATA - SQL Query Interface (DuckDB)
// ═════════════════════════════════════════════════════════════

import { ParquetQueryService } from './src/research/ParquetQueryService.js';

let parquetService: ParquetQueryService | null = null;

async function getParquetService(): Promise<ParquetQueryService> {
  if (!parquetService) {
    parquetService = new ParquetQueryService(logger);
    await parquetService.initialize();
  }
  return parquetService;
}

// Get available tables and data status
app.get('/api/research/parquet/status', async (req, res) => {
  try {
    const service = await getParquetService();
    const status = service.getDataStatus();
    const tables = service.getTables();

    res.json({
      success: true,
      data: {
        ...status,
        tables: tables.map(t => ({
          name: t.name,
          description: t.description,
          rowCount: t.rowCount,
          columns: t.columns,
        })),
      },
      timestamp: Date.now(),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Execute SQL query
app.post('/api/research/parquet/query', async (req, res) => {
  try {
    const { sql } = req.body;

    if (!sql || typeof sql !== 'string') {
      return res.status(400).json({ success: false, error: 'Missing "sql" field in request body' });
    }

    if (sql.length > 10000) {
      return res.status(400).json({ success: false, error: 'Query too long (max 10000 chars)' });
    }

    const service = await getParquetService();
    const result = await service.executeQuery(sql);

    res.json({
      success: true,
      data: result,
      timestamp: Date.now(),
    });
  } catch (error) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

// Get example queries
app.get('/api/research/parquet/examples', async (req, res) => {
  try {
    const service = await getParquetService();
    const examples = service.getExampleQueries();

    res.json({
      success: true,
      data: examples,
      timestamp: Date.now(),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Get table schema details
app.get('/api/research/parquet/table/:name', async (req, res) => {
  try {
    const service = await getParquetService();
    const tables = service.getTables();
    const table = tables.find(t => t.name === req.params.name);

    if (!table) {
      return res.status(404).json({ success: false, error: `Table "${req.params.name}" not found` });
    }

    // Get sample data
    const sample = await service.executeQuery(`SELECT * FROM ${table.name} LIMIT 5`);

    res.json({
      success: true,
      data: {
        ...table,
        sample: sample.rows,
      },
      timestamp: Date.now(),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// ═════════════════════════════════════════════════════════════
// WEBSOCKET SERVER
// ═════════════════════════════════════════════════════════════

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const subscriptions = new Map<any, Set<string>>();

wss.on('connection', (ws) => {
  console.log('[WS] Client connected');
  subscriptions.set(ws, new Set());

  ws.on('message', async (msg) => {
    try {
      const data = JSON.parse(msg.toString());

      if (data.action === 'subscribe') {
        const { channel, key } = data;
        const subKey = key ? `${channel}:${key}` : channel;
        subscriptions.get(ws)?.add(subKey);
        console.log(`[WS] Client subscribed to ${subKey}`);

        // Start streaming for orderbook channels and send historical candles
        if (channel === 'orderbook' && key) {
          streamOrderBook(key);

          // Send latest completed candles on subscription
          try {
            const candles = orderBookService.getLatestCandles(key);
            broadcast('orderbook-candles', {
              tokenId: key,
              candles,
              timestamp: Date.now(),
            }, key);
          } catch (err) {
            console.error('[WS] Error sending candles:', err);
          }
        }
      } else if (data.action === 'unsubscribe') {
        const { channel, key } = data;
        const subKey = key ? `${channel}:${key}` : channel;
        subscriptions.get(ws)?.delete(subKey);
        console.log(`[WS] Client unsubscribed from ${subKey}`);
      }
    } catch (err) {
      console.error('[WS] Message error:', err);
    }
  });

  ws.on('close', () => {
    subscriptions.delete(ws);
    console.log('[WS] Client disconnected');
  });
});

// Broadcast throttling state
const broadcastThrottles = new Map<string, number>();
const BROADCAST_THROTTLE_MS = 100; // Max 10 broadcasts/sec per channel

// Throttled broadcast wrapper - skips broadcast if called too frequently
function throttledBroadcast(channel: string, payload: any, key?: string) {
  const throttleKey = `${channel}:${key || 'default'}`;
  const now = Date.now();
  const lastBroadcast = broadcastThrottles.get(throttleKey) || 0;

  if (now - lastBroadcast < BROADCAST_THROTTLE_MS) {
    return; // Skip this broadcast - too frequent
  }

  broadcastThrottles.set(throttleKey, now);
  broadcast(channel, payload, key);
}

// Broadcast to subscribed clients with dead connection cleanup
function broadcast(channel: string, payload: any, key?: string) {
  const subKey = key ? `${channel}:${key}` : channel;
  const msg = JSON.stringify({ channel, payload });
  const deadClients: WebSocket[] = [];

  for (const [client, subs] of subscriptions) {
    // Check if client is dead or closing
    if (client.readyState !== 1) {
      deadClients.push(client);
      continue;
    }

    if (subs.has(subKey)) {
      try {
        client.send(msg);
      } catch (err) {
        console.error('[WS] Send error, removing dead client:', err);
        deadClients.push(client);
      }
    }
  }

  // Clean up dead connections
  for (const client of deadClients) {
    subscriptions.delete(client);
    try { client.terminate(); } catch { /* ignore */ }
  }
}

// Stream orderbook updates (throttled to prevent UI flooding)
async function streamOrderBook(tokenId: string) {
  try {
    await orderBookService.connectWebSocket((id, book) => {
      if (id === tokenId) {
        throttledBroadcast('orderbook', {
          bids: book.bids.slice(0, 10).map((b) => [Number(b.price), Number(b.size)]),
          asks: book.asks.slice(0, 10).map((a) => [Number(a.price), Number(a.size)])
        }, tokenId);
      }
    });
  } catch (err) {
    console.error('[WS] Orderbook stream error:', err);
  }
}

// Periodic position/order broadcasts
const broadcastInterval = setInterval(async () => {
  try {
    const userAddress = config.funderAddress;
    if (!userAddress) return;

    try {
      const positionsRaw = await getOpenPositions(userAddress);
      const openArray = Array.isArray(positionsRaw) ? positionsRaw : [];
      const positions = openArray
        .filter((p: any) => Number(p.size || p.curSize || p.balance || 0) !== 0)
        .slice(0, 50)
        .map((p: any) => {
          const size = Number(p.size || p.curSize || p.balance || 0);
          const entry = Number(p.avgPrice || p.avg_price || p.curPrice || 0.5);
          const mark = Number(p.curPrice || p.cur_price || p.price || entry);
          const pnl = (mark - entry) * size;
          const pnlPercent = entry > 0 ? ((mark - entry) / entry * 100) : 0;
          const redeemable = Boolean(p.redeemable);
          const id = (
            p.asset || p.asset_id || p.assetId || p.token_id || (p.market_id && p.outcome ? `${p.market_id}_${p.outcome}` : `${(p.title || p.question || 'unknown').slice(0, 24)}_${p.outcome || 'YES'}`)
          );

          return {
            id,
            market: p.title || p.question || p.market || 'Unknown',
            outcome: p.outcome || 'YES',
            size: size.toFixed(0),
            avgEntry: entry.toFixed(3),
            pnl: pnl.toFixed(2),
            pnlPercent: pnlPercent.toFixed(2),
            currentPrice: mark.toFixed(3),
            status: redeemable ? 'REDEEMABLE' : 'ACTIVE',
            redeemable,
            type: 'open'
          };
        });
      if (positions.length > 0) {
        broadcast('positions', positions);
      }
    } catch (err) {
      logger.debug('Positions broadcast error:', (err as Error).message);
    }

    if (clobClient) {
      try {
        const orders = await getOpenOrders(clobClient);
        if (Array.isArray(orders) && orders.length > 0) {
          broadcast('orders', orders.slice(0, 100));
        }
      } catch (err) {
        logger.debug('Orders broadcast error:', (err as Error).message);
      }
    }
  } catch (err) {
    logger.debug('Periodic broadcast error:', (err as Error).message);
  }
}, 5000);

// ═════════════════════════════════════════════════════════════
// START SERVER
// ═════════════════════════════════════════════════════════════

server.listen(PORT, () => {
  console.log(`\n╔════════════════════════════════════════════════════════════════╗`);
  console.log(`║    POLYTRADE API SERVER                                        ║`);
  console.log(`╚════════════════════════════════════════════════════════════════╝`);
  console.log(`\n✅ HTTP Server: http://localhost:${PORT}`);
  console.log(`\n✅ WebSocket:   ws://localhost:${PORT}/ws`);
  console.log(`\nInitializing services (non-blocking)...\n`);

  // Non-blocking init: start in background, health endpoint reports progress
  const startupInit = LAZY_INIT
    ? initializeCore().then(() => {
        console.log(`\n✅ Core services ready (lazy mode — trading services start on first request)\n`);
      })
    : initializeCore().then(() => initializeTradingServices()).then(() => {
        tradingServicesInitialized = true;
        console.log(`\n✅ All services initialized and ready (eager mode)\n`);
      });

  startupInit
    .then(() => {

      // ── Database maintenance ──────────────────────────────────
      const DB_SIZE_LIMIT_POLYTRADE = 15 * 1024 * 1024 * 1024; // 15 GB
      const DB_SIZE_LIMIT_RESEARCH = 15 * 1024 * 1024 * 1024;  // 15 GB
      const MAINTENANCE_INTERVAL_MS = 30 * 60 * 1000;           // 30 minutes

      // Run maintenance immediately on startup (critical: reclaim WAL space)
      try {
        const result = db.runMaintenance(DB_SIZE_LIMIT_POLYTRADE);
        console.log(`🗄️  DB maintenance (PolyTrade): ${result.sizeBeforeMB}MB → ${result.sizeAfterMB}MB`, Object.keys(result.pruned).length > 0 ? result.pruned : '');
      } catch (e) {
        logger.warn(`DB maintenance failed (PolyTrade): ${e}`);
      }

      try {
        const researchDb = getResearchDB();
        // Clear any stale isRunning flag left over from a previous crash/restart
        researchDb.updateSyncStatus({ isRunning: false });
        researchDb.updateSyncProgress({ isRunning: false, currentPhase: null });
        const result = researchDb.runMaintenance(DB_SIZE_LIMIT_RESEARCH);
        console.log(`🗄️  DB maintenance (Research): ${result.sizeBeforeMB}MB → ${result.sizeAfterMB}MB`, Object.keys(result.pruned).length > 0 ? result.pruned : '');
      } catch (e) {
        logger.warn(`DB maintenance failed (Research): ${e}`);
      }

      // Schedule periodic maintenance every 30 minutes
      setInterval(() => {
        try {
          const result = db.runMaintenance(DB_SIZE_LIMIT_POLYTRADE);
          if (result.sizeBeforeMB !== result.sizeAfterMB) {
            console.log(`🗄️  DB maintenance (PolyTrade): ${result.sizeBeforeMB}MB → ${result.sizeAfterMB}MB`, result.pruned);
          }
        } catch (e) {
          logger.warn(`Periodic DB maintenance failed (PolyTrade): ${e}`);
        }

        try {
          const researchDb = getResearchDB();
          const result = researchDb.runMaintenance(DB_SIZE_LIMIT_RESEARCH);
          if (result.sizeBeforeMB !== result.sizeAfterMB) {
            console.log(`🗄️  DB maintenance (Research): ${result.sizeBeforeMB}MB → ${result.sizeAfterMB}MB`, result.pruned);
          }
        } catch (e) {
          logger.warn(`Periodic DB maintenance failed (Research): ${e}`);
        }
      }, MAINTENANCE_INTERVAL_MS);

      // Auto-wire markets for existing positions on startup
      setTimeout(async () => {
        try {
          const userAddress = config.funderAddress;
          if (!userAddress || !pricingWirer) return;

          const positions = await getOpenPositions(userAddress);
          if (!Array.isArray(positions) || positions.length === 0) return;

          let wiredCount = 0;
          for (const position of positions) {
            const tokenId = position.asset || position.asset_id || position.id;
            if (!tokenId || pricingWirer.getPricing(tokenId)) continue;

            const question = position.market || position.title || position.question || '';
            const cryptoInfo = parseCryptoMarketFromQuestion(question);
            if (!cryptoInfo) continue;

            const expiry = parseExpiryFromQuestion(question);
            if (!expiry) continue;

            try {
              await pricingWirer.wireMarket({
                strike: cryptoInfo.strike,
                slug: position.slug || '',
                question,
                yesTokenId: tokenId,
                noTokenId: '',
                yesPrice: 0, noPrice: 0,
                bestBid: null, bestAsk: null,
                volume24hr: 0, liquidity: 0, spread: 0,
                active: true, acceptingOrders: true,
              }, cryptoInfo.crypto, expiry);
              wiredCount++;
            } catch (e) {
              logger.warn(`Failed to auto-wire position: ${tokenId}: ${(e as Error).message}`);
            }
          }

          if (wiredCount > 0) {
            logger.info(`Auto-wired ${wiredCount} position markets on startup`);
            console.log(`✅ Auto-wired ${wiredCount} position markets on startup`);
          }
        } catch (e) {
          logger.warn(`Failed to auto-wire positions on startup: ${(e as Error).message}`);
        }
      }, 5000); // Delay 5s for data feeds to stabilize

      // Set up WebSocket broadcasting for pricing updates
      if (pricingWirer) {
        setInterval(() => {
          const wiredMarkets = pricingWirer.getAllWiredMarkets();

          const pricingUpdates = wiredMarkets
            .filter(m => m.status === 'active' && m.fairPrice !== null)
            .map(market => ({
              tokenId: market.tokenId,
              crypto: market.crypto,
              strike: market.strike,
              expiry: market.expiry.toISOString(),
              timestamp: Date.now(),
              spotPrice: market.spotPrice,
              impliedVolatility: market.impliedVolatility,
              fairPrice: market.fairPrice,
              greeks: market.greeks ? {
                delta: market.greeks.delta,
                gamma: market.greeks.gamma,
                vega: market.greeks.vega,
                theta: market.greeks.theta,
              } : null,
              marketBid: market.marketBid,
              marketAsk: market.marketAsk,
              spread: market.spread,
              edge: market.edge,
            }));

          if (pricingUpdates.length > 0) {
            broadcast('pricing', pricingUpdates);
          }
        }, 1000);

        console.log('✅ WebSocket pricing updates enabled (1s broadcast)');
      }
    })
    .catch(err => {
      logger.error('Service initialization error (non-fatal)', err instanceof Error ? err : new Error(String(err)));
      console.error('\n⚠️ Service initialization error (server continues):');
      console.error('Error:', err instanceof Error ? err.message : String(err));
      console.error('Health endpoint reports initialization progress.\n');
    });
});

// ═════════════════════════════════════════════════════════════
// GRACEFUL SHUTDOWN
// ═════════════════════════════════════════════════════════════

async function gracefulShutdown(signal: string) {
  console.log(`\n📴 Received ${signal}, shutting down gracefully...`);

  // Clear all intervals to prevent memory leaks
  if (broadcastInterval) {
    console.log('  └─ Clearing broadcast interval...');
    clearInterval(broadcastInterval);
  }

  // Stop performance metrics
  console.log('  └─ Stopping performance metrics...');
  performanceMetrics.stopAutoFlush();

  // Stop pricing wirer
  if (pricingWirer) {
    console.log('  └─ Stopping pricing wirer...');
    await pricingWirer.destroy();
  }

  // Stop market finder
  if (marketFinder) {
    console.log('  └─ Stopping market finder...');
    marketFinder.destroy();
  }

  // Stop all registered services (Binance/Deribit per crypto)
  console.log('  └─ Stopping registered services...');
  await serviceRegistry.stopAll();

  // Stop stream manager first (closes WebSocket connections + TickBuffer cleanup)
  if (streamManager) {
    console.log('  └─ Stopping HybridStreamManager...');
    await streamManager.stop();
    console.log('  └─ HybridStreamManager stopped');
  }

  // Close database
  if (db) {
    console.log('  └─ Closing database...');
    db.close();
  }

  // Close HTTP server
  server.close(() => {
    console.log('  └─ HTTP server closed');
    process.exit(0);
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    console.error('  └─ Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// ═══════════════════════════════════════════════════════════
// GLOBAL ERROR HANDLERS
// ═══════════════════════════════════════════════════════════

process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  logger.error('Unhandled Promise Rejection', reason instanceof Error ? reason : new Error(String(reason)), {
    promise: String(promise),
    stack: reason?.stack,
    type: 'unhandledRejection',
  });

  console.error('\n❌ UNHANDLED PROMISE REJECTION');
  console.error('Reason:', reason);
  if (reason?.stack) console.error('Stack:', reason.stack);
});

process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught Exception - FATAL', error, {
    stack: error.stack,
    type: 'uncaughtException',
  });

  console.error('\n❌ UNCAUGHT EXCEPTION - SHUTTING DOWN');
  console.error('Error:', error.message);
  console.error('Stack:', error.stack);

  gracefulShutdown('UNCAUGHT_EXCEPTION').finally(() => {
    process.exit(1);
  });
});
