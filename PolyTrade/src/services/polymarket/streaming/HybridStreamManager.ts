/**
 * Hybrid Stream Manager
 * Main orchestrator for multi-market orderbook streaming
 * Combines REST polling + WebSocket updates with intelligent fallback
 */

import axios from 'axios';
import { Logger } from '../../../lib/logger/index.js';
import { OrderBookDB } from '../../../lib/db/OrderBookDB.js';
import { OrderBookTick, OrderBookLevel, Timeframe } from '../../../lib/types/index.js';
import { TickBuffer } from './TickBuffer.js';
import { MarketRegistry } from './MarketRegistry.js';
import { ConnectionPool } from './ConnectionPool.js';
import {
  EnrichedTick,
  MarketState,
  ConnectionState,
  WsMarketEvent,
  WsBookEvent,
  WsPriceChangeEvent,
  StreamEventHandlers,
  StreamingMetrics,
  MarketMetrics,
  HybridStreamConfig,
  DEFAULT_STREAM_CONFIG,
} from './types.js';

const CLOB_API_URL = 'https://clob.polymarket.com';

interface RESTSnapshot {
  market: string;
  asset_id: string;
  timestamp: string;
  hash: string;
  bids: Array<{ price: string; size: string }>;
  asks: Array<{ price: string; size: string }>;
  min_order_size: string;
  tick_size: string;
  neg_risk: boolean;
}

export class HybridStreamManager {
  private tickBuffer: TickBuffer;
  private registry: MarketRegistry;
  private connectionPool: ConnectionPool;
  private db: OrderBookDB;
  private logger: Logger;
  private config: HybridStreamConfig;
  private handlers: StreamEventHandlers;
  
  // REST polling state
  private restPollers: Map<string, NodeJS.Timeout> = new Map();
  private restBackoff: Map<string, number> = new Map();
  
  // Staleness monitoring
  private stalenessChecker: NodeJS.Timeout | null = null;
  
  // Metrics
  private metrics: StreamingMetrics;
  private startTime: number = 0;

  constructor(
    config: Partial<HybridStreamConfig> = {},
    handlers: StreamEventHandlers = {},
    db?: OrderBookDB,
    logger?: Logger
  ) {
    this.config = { ...DEFAULT_STREAM_CONFIG, ...config };
    this.handlers = handlers;
    this.logger = logger || new Logger({ service: 'HybridStreamManager' });
    this.db = db || new OrderBookDB();

    // Initialize components
    this.tickBuffer = new TickBuffer(this.config, this.logger);
    this.registry = new MarketRegistry(this.config, this.logger);
    this.connectionPool = new ConnectionPool(this.config, this.logger);

    // Initialize metrics
    this.metrics = {
      connection: this.connectionPool.getHealth(),
      markets: new Map(),
      global: {
        totalMarkets: 0,
        activeMarkets: 0,
        totalTicksProcessed: 0,
        totalDuplicatesSkipped: 0,
        uptimeMs: 0,
        memoryUsageMb: 0,
      },
    };
  }

  /**
   * Start the streaming manager
   * Connects to WebSocket and resumes all enabled markets
   */
  async start(): Promise<void> {
    this.startTime = Date.now();
    this.logger.info('🚀 Starting HybridStreamManager...');

    // Connect to WebSocket
    try {
      await this.connectionPool.connect({
        onMessage: (event) => this.handleWsMessage(event),
        onStateChange: (state, error) => this.handleConnectionStateChange(state, error),
      });
    } catch (err) {
      this.logger.error('Failed to connect WebSocket', { error: (err as Error).message });
      // Continue anyway - REST will still work
    }

    // Resume enabled markets from registry (skip if SKIP_MARKET_RESUME=true)
    if (process.env.SKIP_MARKET_RESUME === 'true') {
      this.logger.info('⏭️ SKIP_MARKET_RESUME=true, not resuming previous subscriptions');
    } else {
      const enabledMarkets = this.registry.getEnabledMarkets();
      this.logger.info(`Resuming ${enabledMarkets.length} markets from registry`);

      // Parallel subscription with batching to avoid overwhelming the API
      const BATCH_SIZE = 10;
      for (let i = 0; i < enabledMarkets.length; i += BATCH_SIZE) {
        const batch = enabledMarkets.slice(i, i + BATCH_SIZE);
        await Promise.all(
          batch.map(market =>
            this.subscribeMarket(market.tokenId, {
              slug: market.slug,
              outcome: market.outcome,
            }).catch(err => {
              // Log but don't fail the entire batch on individual market errors
              this.logger.warn(`Failed to subscribe ${market.tokenId.slice(0, 20)}...`, {
                error: (err as Error).message,
              });
            })
          )
        );
      }
    }

    // Start staleness monitoring
    this.startStalenessMonitor();

    this.logger.info('✅ HybridStreamManager started');
  }

  /**
   * Subscribe to a market for streaming
   */
  async subscribeMarket(
    tokenId: string,
    options: {
      slug?: string;
      outcome?: 'yes' | 'no';
      priority?: number;
    } = {}
  ): Promise<void> {
    // Check limits
    if (this.registry.getActive().length >= this.config.maxMarketsPerInstance) {
      throw new Error(`Max markets limit reached (${this.config.maxMarketsPerInstance})`);
    }

    // Register market
    const registration = this.registry.register(tokenId, options);
    this.registry.updateState(tokenId, 'subscribing');

    this.logger.info(`📊 Subscribing to market: ${tokenId.slice(0, 20)}...`, { 
      slug: options.slug 
    });

    // Initialize metrics for this market
    this.initMarketMetrics(tokenId);

    // Fetch initial REST snapshot
    try {
      await this.fetchRESTSnapshot(tokenId);
    } catch (err) {
      this.logger.warn(`Initial REST fetch failed for ${tokenId}`, { 
        error: (err as Error).message 
      });
    }

    // Subscribe via WebSocket
    if (this.connectionPool.isConnected()) {
      this.connectionPool.subscribe(tokenId);
    }

    // Start REST poller
    this.startRESTPoller(tokenId);

    this.registry.updateState(tokenId, 'active');
    this.logger.info(`✅ Market active: ${tokenId.slice(0, 20)}...`);
  }

  /**
   * Unsubscribe from a market
   */
  unsubscribeMarket(tokenId: string): void {
    this.logger.info(`Unsubscribing from market: ${tokenId.slice(0, 20)}...`);

    // Stop REST poller
    this.stopRESTPoller(tokenId);

    // Unsubscribe from WebSocket
    this.connectionPool.unsubscribe(tokenId);

    // Remove from registry
    this.registry.unregister(tokenId);

    // Clear buffers
    this.tickBuffer.clearMarket(tokenId);

    // Remove metrics
    this.metrics.markets.delete(tokenId);
  }

  /**
   * Fetch REST snapshot for a market
   */
  private async fetchRESTSnapshot(tokenId: string): Promise<void> {
    try {
      const response = await axios.get<RESTSnapshot>(`${CLOB_API_URL}/book`, {
        params: { token_id: tokenId },
        timeout: this.config.restTimeoutMs,
      });

      const snapshot = response.data;
      
      // Convert to tick
      const tick = this.snapshotToTick(snapshot, tokenId);
      const enriched = this.tickBuffer.enrichTick(tick);
      enriched.source = 'rest';

      // Add to buffer
      const result = this.tickBuffer.addTick(enriched);
      
      if (!result.isDuplicate) {
        this.processTick(enriched);
        this.registry.recordTick(tokenId, 'rest');
        
        // Reset backoff on success
        this.restBackoff.delete(tokenId);
      } else {
        this.metrics.global.totalDuplicatesSkipped++;
      }
    } catch (err) {
      const errorMsg = (err as Error).message;
      this.logger.warn(`REST fetch failed for ${tokenId.slice(0, 20)}...`, { error: errorMsg });
      this.registry.updateState(tokenId, 'active', errorMsg);
      
      // Apply backoff
      const currentBackoff = this.restBackoff.get(tokenId) || this.config.restPollIntervalMs;
      this.restBackoff.set(tokenId, Math.min(currentBackoff * 2, this.config.restPollBackoffMs * 6));
      
      throw err;
    }
  }

  /**
   * Convert REST snapshot to OrderBookTick
   */
  private snapshotToTick(snapshot: RESTSnapshot, tokenId: string): OrderBookTick {
    // Bids sorted DESCENDING (best/highest bid at index 0)
    const bidLevels: OrderBookLevel[] = snapshot.bids.map(b => ({
      price: parseFloat(b.price),
      size: parseFloat(b.size),
    })).sort((a, b) => b.price - a.price);

    // Asks sorted ASCENDING (best/lowest ask at index 0)
    const askLevels: OrderBookLevel[] = snapshot.asks.map(a => ({
      price: parseFloat(a.price),
      size: parseFloat(a.size),
    })).sort((a, b) => a.price - b.price);

    const bestBid = bidLevels.length > 0 ? bidLevels[0].price : 0;
    const bestAsk = askLevels.length > 0 ? askLevels[0].price : 0;
    const spreadBps = bestBid > 0 ? ((bestAsk - bestBid) / bestBid) * 10000 : 0;
    const topBidSize = bidLevels.length > 0 ? bidLevels[0].size : 0;
    const topAskSize = askLevels.length > 0 ? askLevels[0].size : 0;

    return {
      tokenId,
      timestamp: new Date(snapshot.timestamp).getTime() || Date.now(),
      bestBid,
      bestAsk,
      spreadBps,
      topBidSize,
      topAskSize,
      bidLevels,
      askLevels,
      source: 'rest',
    };
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleWsMessage(event: WsMarketEvent): void {
    // Skip error payloads
    if ((event as any)?.error) {
      this.logger.warn('WS error event received', { error: (event as any).error });
      return;
    }

    const eventType = (event as any).event_type || (event as any).type;
    const assetId = (event as any).asset_id;

    if (!assetId) return;

    // Only process if we're tracking this market
    const registration = this.registry.get(assetId);
    if (!registration) return;

    switch (eventType) {
      case 'book':
        this.handleBookEvent(event as WsBookEvent);
        break;
      case 'price_change':
        this.handlePriceChangeEvent(event as WsPriceChangeEvent);
        break;
      // Ignore other events for now
    }
  }

  /**
   * Handle book snapshot from WebSocket
   */
  private handleBookEvent(event: WsBookEvent): void {
    const tokenId = event.asset_id;
    
    // Bids sorted DESCENDING (best/highest bid at index 0)
    const bidLevels: OrderBookLevel[] = (event.bids || []).map(b => {
      if (Array.isArray(b)) {
        return { price: parseFloat(b[0]), size: parseFloat(b[1]) };
      }
      return { price: parseFloat(b.price), size: parseFloat(b.size) };
    }).sort((a, b) => b.price - a.price);

    // Asks sorted ASCENDING (best/lowest ask at index 0)
    const askLevels: OrderBookLevel[] = (event.asks || []).map(a => {
      if (Array.isArray(a)) {
        return { price: parseFloat(a[0]), size: parseFloat(a[1]) };
      }
      return { price: parseFloat(a.price), size: parseFloat(a.size) };
    }).sort((a, b) => a.price - b.price);

    const bestBid = bidLevels.length > 0 ? bidLevels[0].price : 0;
    const bestAsk = askLevels.length > 0 ? askLevels[0].price : 0;
    const spreadBps = bestBid > 0 ? ((bestAsk - bestBid) / bestBid) * 10000 : 0;
    const topBidSize = bidLevels.length > 0 ? bidLevels[0].size : 0;
    const topAskSize = askLevels.length > 0 ? askLevels[0].size : 0;

    const tick: OrderBookTick = {
      tokenId,
      timestamp: new Date(event.timestamp).getTime() || Date.now(),
      bestBid,
      bestAsk,
      spreadBps,
      topBidSize,
      topAskSize,
      bidLevels,
      askLevels,
      source: 'ws',
    };

    const enriched = this.tickBuffer.enrichTick(tick);
    enriched.source = 'ws';

    const result = this.tickBuffer.addTick(enriched);

    if (!result.isDuplicate) {
      // Get merged tick (combines WS top-of-book with REST depth)
      const merged = this.tickBuffer.getMergedTick(tokenId);
      if (merged) {
        this.processTick(merged.tick);
      } else {
        this.processTick(enriched);
      }
      this.registry.recordTick(tokenId, 'ws');
    } else {
      this.metrics.global.totalDuplicatesSkipped++;
    }
  }

  /**
   * Handle price change event from WebSocket
   */
  private handlePriceChangeEvent(event: WsPriceChangeEvent): void {
    // Price changes provide top-of-book updates
    // Less detailed than book events, but more frequent
    const tokenId = event.asset_id;
    
    for (const change of event.price_changes) {
      if (change.best_bid && change.best_ask) {
        // We have enough info to update top-of-book
        this.registry.recordTick(tokenId, 'ws');
      }
    }
  }

  /**
   * Process a tick through storage
   * Note: Candle aggregation is handled separately - the new OrderBookAggregator
   * focuses on API fetching, not tick processing
   */
  private processTick(tick: EnrichedTick): void {
    // Store in database
    this.db.insertTick(tick);

    // Update metrics
    this.metrics.global.totalTicksProcessed++;
    this.updateMarketMetrics(tick.tokenId, tick);

    // Notify handlers
    if (this.handlers.onTick) {
      this.handlers.onTick(tick);
    }
  }

  /**
   * Start REST poller for a market
   */
  private startRESTPoller(tokenId: string): void {
    if (this.restPollers.has(tokenId)) return;

    const poll = async () => {
      try {
        await this.fetchRESTSnapshot(tokenId);
      } catch {
        // Error already logged
      }

      // Schedule next poll (with potential backoff)
      const interval = this.restBackoff.get(tokenId) || this.config.restPollIntervalMs;
      const timer = setTimeout(poll, interval);
      this.restPollers.set(tokenId, timer);
    };

    // Start first poll after initial delay
    const timer = setTimeout(poll, this.config.restPollIntervalMs);
    this.restPollers.set(tokenId, timer);
  }

  /**
   * Stop REST poller for a market
   */
  private stopRESTPoller(tokenId: string): void {
    const timer = this.restPollers.get(tokenId);
    if (timer) {
      clearTimeout(timer);
      this.restPollers.delete(tokenId);
    }
  }

  /**
   * Handle connection state changes
   */
  private handleConnectionStateChange(state: ConnectionState, error?: Error): void {
    this.logger.info(`Connection state: ${state}`, { error: error?.message });
    this.metrics.connection = this.connectionPool.getHealth();

    if (this.handlers.onConnectionStateChange) {
      this.handlers.onConnectionStateChange(state, error);
    }

    // If disconnected, REST polling becomes primary source
    if (state === 'disconnected') {
      this.logger.warn('WebSocket disconnected, REST polling is now primary');
    }

    // On reconnect, resubscribe to markets
    if (state === 'connected') {
      const activeMarkets = this.registry.getActive();
      for (const market of activeMarkets) {
        this.connectionPool.subscribe(market.tokenId);
      }
    }
  }

  /**
   * Start staleness monitoring
   */
  private startStalenessMonitor(): void {
    this.stalenessChecker = setInterval(() => {
      const staleMarkets = this.registry.getStaleMarkets(this.config.marketStaleThresholdMs);
      
      for (const tokenId of staleMarkets) {
        this.logger.warn(`Market appears stale: ${tokenId.slice(0, 20)}...`);
        this.registry.updateState(tokenId, 'stale');

        if (this.handlers.onMarketStateChange) {
          this.handlers.onMarketStateChange(tokenId, 'stale');
        }

        // Force REST fetch to recover
        this.fetchRESTSnapshot(tokenId).catch(() => {});
      }
    }, 30000); // Check every 30 seconds
  }

  /**
   * Initialize metrics for a market
   */
  private initMarketMetrics(tokenId: string): void {
    this.metrics.markets.set(tokenId, {
      tokenId,
      wsUpdatesPerMinute: 0,
      restUpdatesPerMinute: 0,
      duplicateRate: 0,
      avgLatencyMs: 0,
      candleCompleteness: 1,
      sourceDistribution: { rest: 0, ws: 0, merged: 0 },
      lastHourStats: { tickCount: 0, errorCount: 0, gapCount: 0 },
    });
  }

  /**
   * Update metrics for a market after processing tick
   */
  private updateMarketMetrics(tokenId: string, tick: EnrichedTick): void {
    const metrics = this.metrics.markets.get(tokenId);
    if (!metrics) return;

    metrics.lastHourStats.tickCount++;
    metrics.sourceDistribution[tick.source as 'rest' | 'ws']++;
  }

  /**
   * Get streaming metrics
   */
  getMetrics(): StreamingMetrics {
    this.metrics.connection = this.connectionPool.getHealth();
    this.metrics.global.totalMarkets = this.registry.getStats().totalRegistered;
    this.metrics.global.activeMarkets = this.registry.getStats().active;
    this.metrics.global.uptimeMs = Date.now() - this.startTime;
    this.metrics.global.memoryUsageMb = process.memoryUsage().heapUsed / 1024 / 1024;
    
    return this.metrics;
  }

  /**
   * Get candles for a market
   */
  getCandles(tokenId: string, timeframe: Timeframe, startTime: number, endTime: number) {
    return this.db.getCandles(tokenId, timeframe, startTime, endTime);
  }

  /**
   * Get time-series data for charting
   */
  getTimeSeriesData(tokenId: string, timeframe: Timeframe, minutes: number = 60) {
    const tfMs = timeframe === '1m' ? 60000 : timeframe === '5m' ? 300000 : 600000;
    const endTime = Math.floor(Date.now() / tfMs) * tfMs;
    const startTime = endTime - minutes * 60 * 1000;

    const candles = this.db.getCandles(tokenId, timeframe, startTime, endTime);

    return {
      tokenId,
      timeframe,
      timestamps: candles.map(c => c.timestamp),
      opens: candles.map(c => c.openMid),
      highs: candles.map(c => c.highMid),
      lows: candles.map(c => c.lowMid),
      closes: candles.map(c => c.closeMid),
      spreads: candles.map(c => c.avgSpread),
      candles,
    };
  }

  /**
   * Get the latest merged orderbook view for a market
   * Uses WS top-of-book merged with REST depth from TickBuffer
   */
  getLatestOrderBook(tokenId: string): EnrichedTick | null {
    const merged = this.tickBuffer.getMergedTick(tokenId);
    return merged?.tick ?? null;
  }

  /**
   * Get registry for inspection
   */
  getRegistry(): MarketRegistry {
    return this.registry;
  }

  /**
   * Shutdown the manager
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down HybridStreamManager...');

    // Stop staleness monitor
    if (this.stalenessChecker) {
      clearInterval(this.stalenessChecker);
    }

    // Stop all REST pollers
    for (const tokenId of this.restPollers.keys()) {
      this.stopRESTPoller(tokenId);
    }

    // Disconnect WebSocket
    this.connectionPool.disconnect();

    // Save registry
    this.registry.shutdown();

    // Cleanup buffers
    this.tickBuffer.shutdown();

    // Close database
    this.db.close();

    this.logger.info('HybridStreamManager shutdown complete');
  }

  /**
   * Alias for shutdown - for consistent API
   */
  async stop(): Promise<void> {
    return this.shutdown();
  }

  /**
   * Get detailed market metrics for a specific tokenId
   */
  getMarketMetrics(tokenId: string): MarketMetrics | null {
    return this.metrics.markets.get(tokenId) || null;
  }

  /**
   * Get list of all active market token IDs
   */
  getActiveMarketIds(): string[] {
    return this.registry.getActive().map(r => r.tokenId);
  }

  /**
   * Check if a market is currently subscribed
   */
  isSubscribed(tokenId: string): boolean {
    const market = this.registry.get(tokenId);
    return market !== undefined && market.state === 'active';
  }

  /**
   * Inspect candle buffer state (for debugging/warmup status)
   * Note: The old aggregator-based buffer state is no longer available.
   * Returns tick buffer info instead.
   */
  getCandleBufferState(): Record<string, { ticks: number; elapsed: number }> {
    // Return empty object - candle aggregation was removed from streaming manager
    // The new OrderBookAggregator focuses on API fetching, not tick processing
    return {};
  }
}
