/**
 * Binance WebSocket Client
 * Real-time price updates via WebSocket with automatic fallback to REST
 */

import WebSocket from 'ws';
import { BaseListener } from '../../lib/comm/index.js';
import { Logger } from '../../lib/logger/index.js';
import { BinanceConfig } from '../../lib/config/schema.js';
import { SpotPrice } from '../../lib/types/index.js';
import { BinanceRequestor } from './BinanceRequestor.js';
import { BinancePriceListener, BinancePriceEvent } from './BinancePriceListener.js';
import { CacheManager } from '../../lib/cache/CacheManager.js';

interface BookTickerMessage {
  u: number;           // Update ID
  s: string;           // Symbol (e.g., "BTCUSDT")
  b: string;           // Best bid price
  B: string;           // Best bid quantity
  a: string;           // Best ask price
  A: string;           // Best ask quantity
}

type ConnectionMode = 'websocket' | 'rest_fallback';
type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/**
 * WebSocket-based price listener for Binance with REST fallback
 */
export class BinanceWsClient extends BaseListener<BinancePriceEvent> {
  private config: BinanceConfig;
  private requestor: BinanceRequestor;
  private logger: Logger;
  private symbols: string[];
  private cache: CacheManager<SpotPrice>;

  // WebSocket connection
  private ws: WebSocket | null = null;
  private wsUrl: string;
  private state: ConnectionState = 'disconnected';
  private mode: ConnectionMode = 'websocket';

  // Reconnection management
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelays = [1000, 2000, 4000, 8000, 16000]; // Exponential backoff
  private reconnectTimeout: NodeJS.Timeout | null = null;

  // Heartbeat management
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private heartbeatTimeout: NodeJS.Timeout | null = null;
  private lastHeartbeat = 0;

  // REST fallback
  private restListener: BinancePriceListener | null = null;
  private wsRetryInterval: NodeJS.Timeout | null = null;

  // Throttling
  private lastEmit: Map<string, number> = new Map();
  private throttleMs = 200; // Emit at most every 200ms per symbol

  // Track last received data (separate from last emitted for staleness checks)
  private lastReceived: Map<string, number> = new Map();

  // Price change detection
  private lastPrices: Map<string, number> = new Map();

  // Data readiness tracking
  private dataReady = false;
  private initialDataPromise: Promise<void> | null = null;

  constructor(
    config: BinanceConfig,
    requestor: BinanceRequestor,
    logger: Logger,
    symbols: string[] = ['ETHUSDT', 'BTCUSDT']
  ) {
    super();
    this.config = config;
    this.requestor = requestor;
    this.logger = logger.child('BinanceWsClient');
    this.symbols = symbols;
    this.cache = new CacheManager<SpotPrice>({ defaultTtl: 10000 });

    // Build WebSocket URL with combined streams
    const streams = symbols.map(s => `${s.toLowerCase()}@bookTicker`).join('/');
    this.wsUrl = `wss://stream.binance.com:9443/stream?streams=${streams}`;
  }

  /**
   * Start WebSocket connection
   */
  async start(): Promise<void> {
    if (this.connected) {
      this.logger.warn('Client already started');
      return;
    }

    this.logger.info('Starting Binance WebSocket client', {
      symbols: this.symbols,
      url: this.wsUrl,
    });

    this.connected = true;
    await this.connectWebSocket();
  }

  /**
   * Wait for initial data to be available
   */
  async waitForData(timeout = 15000): Promise<boolean> {
    if (this.dataReady) return Promise.resolve(true);

    if (!this.initialDataPromise) {
      this.initialDataPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('Timeout waiting for initial data'));
        }, timeout);

        const checkData = () => {
          if (this.lastPrices.size > 0) {
            clearTimeout(timer);
            this.dataReady = true;
            resolve();
          }
        };

        // Check on every price update
        const handler = (event: BinancePriceEvent) => {
          if (event.type === 'price:updated') {
            checkData();
          }
        };

        this.subscribe(handler);

        // Check immediately in case data already arrived
        checkData();
      });
    }

    return this.initialDataPromise
      .then(() => true)
      .catch(() => false);
  }

  /**
   * Connect to Binance WebSocket
   */
  private async connectWebSocket(): Promise<void> {
    if (this.state !== 'disconnected' && this.state !== 'reconnecting') {
      return;
    }

    this.state = 'connecting';
    this.logger.info('Connecting to Binance WebSocket...');

    try {
      this.ws = new WebSocket(this.wsUrl);

      // Connection opened
      this.ws.on('open', () => {
        this.logger.info('WebSocket connected successfully');
        this.state = 'connected';
        this.reconnectAttempts = 0;
        this.mode = 'websocket';
        this.startHeartbeat();
      });

      // Message received
      this.ws.on('message', (data: Buffer) => {
        this.handleMessage(data);
      });

      // Connection error
      this.ws.on('error', (error) => {
        this.logger.error('WebSocket error', error);
        this.handleConnectionFailure();
      });

      // Connection closed
      this.ws.on('close', (code, reason) => {
        this.logger.warn('WebSocket closed', {
          code,
          reason: reason.toString(),
        });
        this.stopHeartbeat();
        this.handleConnectionFailure();
      });

      // Ping/pong for connection health
      this.ws.on('pong', () => {
        this.lastHeartbeat = Date.now();
        this.logger.debug('Heartbeat received');
      });

    } catch (error) {
      this.logger.error('Failed to create WebSocket connection', error as Error);
      this.handleConnectionFailure();
    }
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(data: Buffer): void {
    try {
      const message = JSON.parse(data.toString());

      // Combined stream format: { stream: "btcusdt@bookTicker", data: {...} }
      if (message.stream && message.data) {
        const bookTicker = message.data as BookTickerMessage;
        this.handleBookTicker(bookTicker);
      }
      // Individual stream format (direct bookTicker)
      else if (message.s && message.b && message.a) {
        this.handleBookTicker(message as BookTickerMessage);
      }
    } catch (error) {
      this.logger.error('Failed to parse WebSocket message', error as Error);
    }
  }

  /**
   * Process bookTicker message and emit price update
   */
  private handleBookTicker(ticker: BookTickerMessage): void {
    const symbol = ticker.s;
    const bestBid = parseFloat(ticker.b);
    const bestAsk = parseFloat(ticker.a);
    const midPrice = (bestBid + bestAsk) / 2;
    const now = Date.now();

    // Always update lastReceived timestamp (for staleness checks)
    this.lastReceived.set(symbol, now);

    // Check if price changed significantly (avoid noise)
    const lastPrice = this.lastPrices.get(symbol);
    const priceChanged = lastPrice === undefined || Math.abs(lastPrice - midPrice) > 0.0001;

    if (!priceChanged) {
      return;
    }

    // Throttle emissions (max 200ms per symbol)
    const lastEmitTime = this.lastEmit.get(symbol) || 0;
    if (now - lastEmitTime < this.throttleMs) {
      return;
    }

    this.lastPrices.set(symbol, midPrice);
    this.lastEmit.set(symbol, now);

    // Mark data as ready after first price
    if (this.lastPrices.size > 0 && !this.dataReady) {
      this.dataReady = true;
    }

    // Create SpotPrice object
    const spotPrice: SpotPrice = {
      symbol,
      price: midPrice,
      timestamp: now,
    };

    // Cache the price
    this.cache.set(symbol, spotPrice);

    // Emit event
    const event: BinancePriceEvent = {
      type: 'price:updated',
      timestamp: now,
      data: spotPrice,
    };

    this.logger.debug(`Price updated (WebSocket): ${symbol} = $${midPrice.toFixed(2)}`, {
      symbol,
      bid: bestBid,
      ask: bestAsk,
      mid: midPrice,
    });

    this.emit(event);
  }

  /**
   * Start heartbeat (ping every 30s)
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();

    // Send ping every 30 seconds
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.ping();
        this.logger.debug('Heartbeat sent (ping)');

        // Expect pong within 10 seconds
        this.heartbeatTimeout = setTimeout(() => {
          this.logger.warn('Heartbeat timeout - no pong received');
          this.handleConnectionFailure();
        }, 10000);
      }
    }, 30000);

    // Initial heartbeat
    this.lastHeartbeat = Date.now();
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
  }

  /**
   * Handle connection failure
   */
  private handleConnectionFailure(): void {
    if (this.state === 'disconnected') {
      return; // Already handling disconnect
    }

    this.state = 'reconnecting';

    // Close existing connection
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch (error) {
        // Ignore close errors
      }
      this.ws = null;
    }

    this.stopHeartbeat();

    // NOTE: We preserve lastPrices and cache during reconnection for stability
    // They will only be cleared on explicit disconnect()

    // Check if we should fallback to REST
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.logger.warn(`Max reconnection attempts (${this.maxReconnectAttempts}) reached, switching to REST fallback`);
      this.switchToRestFallback();
      return;
    }

    // Schedule reconnection with exponential backoff
    const delay = this.reconnectDelays[Math.min(this.reconnectAttempts, this.reconnectDelays.length - 1)];
    this.reconnectAttempts++;

    this.logger.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    this.reconnectTimeout = setTimeout(async () => {
      this.reconnectTimeout = null;
      this.state = 'disconnected';
      await this.connectWebSocket();
    }, delay);
  }

  /**
   * Switch to REST polling fallback
   */
  private async switchToRestFallback(): Promise<void> {
    this.logger.warn('Switching to REST polling fallback mode');
    this.mode = 'rest_fallback';
    this.state = 'disconnected';

    // Initialize REST listener
    this.restListener = new BinancePriceListener(
      this.config,
      this.requestor,
      this.logger,
      this.symbols
    );

    // Forward REST events as WebSocket events
    this.restListener.subscribe((event: BinancePriceEvent) => {
      this.emit(event);
    });

    await this.restListener.start();
    this.logger.info('REST fallback active');

    // Schedule periodic retry to restore WebSocket
    this.scheduleWebSocketRetry();
  }

  /**
   * Schedule periodic attempts to restore WebSocket
   */
  private scheduleWebSocketRetry(): void {
    if (this.wsRetryInterval) {
      return;
    }

    this.logger.info('Scheduling WebSocket retry every 60s');

    this.wsRetryInterval = setInterval(async () => {
      if (this.mode === 'rest_fallback') {
        this.logger.info('Attempting to restore WebSocket connection...');
        this.reconnectAttempts = 0;
        await this.attemptWebSocketRestore();
      }
    }, 60000);
  }

  /**
   * Attempt to restore WebSocket from REST fallback
   */
  private async attemptWebSocketRestore(): Promise<void> {
    try {
      this.state = 'disconnected';
      await this.connectWebSocket();

      // If successful (check if ws is connected), disconnect REST listener
      if (this.ws && this.ws.readyState === 1 && this.restListener) {
        this.logger.info('WebSocket restored, disconnecting REST fallback');
        await this.restListener.disconnect();
        this.restListener = null;
        this.mode = 'websocket';

        // Stop retry interval
        if (this.wsRetryInterval) {
          clearInterval(this.wsRetryInterval);
          this.wsRetryInterval = null;
        }
      }
    } catch (error) {
      this.logger.warn('WebSocket restore attempt failed', error as Error);
    }
  }

  /**
   * Get last known price for a symbol
   */
  getLastPrice(symbol: string): SpotPrice | null {
    // Try cache first
    const cached = this.cache.get(symbol);
    if (cached) {
      return cached;
    }

    // Fallback to REST listener if active
    if (this.restListener) {
      return this.restListener.getLastPrice(symbol);
    }

    return null;
  }

  /**
   * Add a symbol to track
   */
  addSymbol(symbol: string): void {
    if (this.symbols.includes(symbol)) {
      return;
    }

    this.symbols.push(symbol);
    this.logger.info(`Added symbol: ${symbol}`, {
      totalSymbols: this.symbols.length,
      mode: this.mode,
    });

    // Rebuild WebSocket URL
    const streams = this.symbols.map(s => `${s.toLowerCase()}@bookTicker`).join('/');
    this.wsUrl = `wss://stream.binance.com:9443/stream?streams=${streams}`;

    // If in REST fallback mode, add to REST listener
    if (this.restListener) {
      this.restListener.addSymbol(symbol);
    }

    // If connected, reconnect with new streams
    if (this.state === 'connected' && this.mode === 'websocket') {
      this.logger.info('Reconnecting with new symbol subscriptions');
      this.handleConnectionFailure();
    }
  }

  /**
   * Get timestamp of last price update (data received, not necessarily emitted)
   * @param symbol - Optional symbol to get timestamp for
   * @returns Timestamp in milliseconds, or 0 if no data
   */
  getLastPriceTimestamp(symbol?: string): number {
    if (symbol) {
      return this.lastReceived.get(symbol) ?? 0;
    }

    // Return most recent timestamp across all symbols
    let latest = 0;
    for (const timestamp of this.lastReceived.values()) {
      latest = Math.max(latest, timestamp);
    }
    return latest;
  }

  /**
   * Get all symbol timestamps
   * @returns Map of symbol to timestamp
   */
  getLastPriceTimestamps(): Map<string, number> {
    return new Map(this.lastReceived);
  }

  /**
   * Remove a symbol from tracking
   */
  removeSymbol(symbol: string): void {
    const index = this.symbols.indexOf(symbol);
    if (index === -1) {
      return;
    }

    this.symbols.splice(index, 1);
    this.lastPrices.delete(symbol);
    this.lastEmit.delete(symbol);
    this.cache.delete(symbol);

    this.logger.info(`Removed symbol: ${symbol}`, {
      totalSymbols: this.symbols.length,
      mode: this.mode,
    });

    // Rebuild WebSocket URL
    const streams = this.symbols.map(s => `${s.toLowerCase()}@bookTicker`).join('/');
    this.wsUrl = `wss://stream.binance.com:9443/stream?streams=${streams}`;

    // If in REST fallback mode, remove from REST listener
    if (this.restListener) {
      this.restListener.removeSymbol(symbol);
    }

    // If connected, reconnect with new streams
    if (this.state === 'connected' && this.mode === 'websocket') {
      this.logger.info('Reconnecting with updated symbol subscriptions');
      this.handleConnectionFailure();
    }
  }

  /**
   * Disconnect and cleanup
   */
  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }

    this.logger.info('Disconnecting Binance WebSocket client');
    this.connected = false;
    this.state = 'disconnected';

    // Stop heartbeat
    this.stopHeartbeat();

    // Clear reconnection timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    // Clear WebSocket retry interval
    if (this.wsRetryInterval) {
      clearInterval(this.wsRetryInterval);
      this.wsRetryInterval = null;
    }

    // Close WebSocket
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch (error) {
        // Ignore close errors
      }
      this.ws = null;
    }

    // Disconnect REST listener if active
    if (this.restListener) {
      await this.restListener.disconnect();
      this.restListener = null;
    }

    // Clear cache, lastPrices, and handlers on intentional disconnect
    this.cache.destroy();
    this.lastPrices.clear();
    this.handlers.clear();
  }

  /**
   * Get current connection mode
   */
  getMode(): ConnectionMode {
    return this.mode;
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Check if using WebSocket (vs REST fallback)
   */
  isUsingWebSocket(): boolean {
    return this.mode === 'websocket' && this.state === 'connected';
  }
}
