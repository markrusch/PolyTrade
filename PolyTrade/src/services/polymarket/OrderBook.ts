import axios from 'axios';
import WebSocket from 'ws';
import { OrderBookDB } from '../../lib/db/OrderBookDB.js';
import { OrderBookAggregator } from './OrderBookAggregator.js';
import { Logger } from '../../lib/logger/index.js';
import { OrderBookTick, OrderBookCandle, Timeframe } from '../../lib/types/index.js';

export interface OrderBookLevel {
  price: string;
  size: string;
}

export interface OrderBookSnapshot {
  market: string;
  asset_id: string;
  timestamp: string;
  hash: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  min_order_size: string;
  tick_size: string;
  neg_risk: boolean;
}

export interface OrderBook {
  tokenId: string;
  market?: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  spread?: number;
  mid?: number;
  lastUpdate: Date;
  source: 'rest' | 'ws' | 'snapshot';
}

export class OrderBookService {
  private readonly clobUrl = 'https://clob.polymarket.com';
  private orderBooks: Map<string, OrderBook> = new Map();
  private wsClient: WebSocket | null = null;
  private subscriptions: Set<string> = new Set();
  private db: OrderBookDB;
  private aggregator: OrderBookAggregator;
  private logger: Logger;
  private activeMarkets: Set<string> = new Set();
  private pollingIntervals: Map<string, NodeJS.Timeout> = new Map();

  constructor(db?: OrderBookDB, logger?: Logger) {
    this.db = db || new OrderBookDB();
    this.logger = logger || new Logger({ service: 'OrderBookService' });
    // OrderBookAggregator is used for multi-strike fetching, not candle aggregation
    this.aggregator = new OrderBookAggregator();
  }

  /**
   * Fetch order book snapshot via REST API
   */
  async fetchOrderBookSnapshot(tokenId: string): Promise<OrderBookSnapshot> {
    try {
      const response = await axios.get(`${this.clobUrl}/book`, {
        params: { token_id: tokenId },
        timeout: 5000,
      });

      return response.data as OrderBookSnapshot;
    } catch (error) {
      throw new Error(`Failed to fetch order book for token ${tokenId}: ${(error as any).message}`);
    }
  }

  /**
   * Convert REST snapshot to OrderBook format
   */
  private snapshotToOrderBook(snapshot: OrderBookSnapshot): OrderBook {
    const mid = this.calculateMid(snapshot.bids, snapshot.asks);
    const spread = this.calculateSpread(snapshot.bids, snapshot.asks);

    // Parse timestamp safely, use current time if invalid
    let lastUpdate: Date;
    try {
      const parsedDate = new Date(snapshot.timestamp);
      lastUpdate = Number.isFinite(parsedDate.getTime()) ? parsedDate : new Date();
    } catch {
      lastUpdate = new Date();
    }

    return {
      tokenId: snapshot.asset_id,
      market: snapshot.market,
      bids: snapshot.bids,
      asks: snapshot.asks,
      mid,
      spread,
      lastUpdate,
      source: 'snapshot',
    };
  }

  /**
   * Convert OrderBook to OrderBookTick for storage
   * Note: bids should be DESCENDING (best/highest at [0]), asks ASCENDING (best/lowest at [0])
   */
  private orderBookToTick(orderBook: OrderBook, source: 'rest' | 'ws'): OrderBookTick {
    // Sort bids descending and asks ascending before extracting best prices
    const sortedBids = [...orderBook.bids].sort((a, b) => Number(b.price) - Number(a.price));
    const sortedAsks = [...orderBook.asks].sort((a, b) => Number(a.price) - Number(b.price));
    
    const bestBid = sortedBids.length > 0 ? Number(sortedBids[0].price) : 0;
    const bestAsk = sortedAsks.length > 0 ? Number(sortedAsks[0].price) : 0;
    const spreadBps = bestBid > 0 ? ((bestAsk - bestBid) / bestBid) * 10000 : 0;
    const topBidSize = sortedBids.length > 0 ? Number(sortedBids[0].size) : 0;
    const topAskSize = sortedAsks.length > 0 ? Number(sortedAsks[0].size) : 0;

    return {
      tokenId: orderBook.tokenId,
      timestamp: orderBook.lastUpdate.getTime(),
      bestBid,
      bestAsk,
      spreadBps,
      topBidSize,
      topAskSize,
      bidLevels: sortedBids.map(b => ({ price: Number(b.price), size: Number(b.size) })),
      askLevels: sortedAsks.map(a => ({ price: Number(a.price), size: Number(a.size) })),
      source,
    };
  }

  /**
   * Get order book (use cached if recent, else fetch fresh)
   */
  async getOrderBook(tokenId: string, maxAge = 5000): Promise<OrderBook> {
    const cached = this.orderBooks.get(tokenId);
    const age = cached ? Date.now() - cached.lastUpdate.getTime() : Infinity;

    if (cached && age < maxAge) {
      return cached;
    }

    // Fetch fresh snapshot
    this.logger.debug('Fetching fresh orderbook snapshot', { tokenId });
    const snapshot = await this.fetchOrderBookSnapshot(tokenId);
    const orderBook = this.snapshotToOrderBook(snapshot);

    this.orderBooks.set(tokenId, orderBook);

    // Store tick and aggregate
    const tick = this.orderBookToTick(orderBook, 'rest');
    this.db.insertTick(tick);
    // this.aggregator.processTick(tick); // Disabled: method doesn't exist in current OrderBookAggregator

    return orderBook;
  }

  /**
   * Connect to WebSocket and subscribe to orderbook updates
   */
  connectWebSocket(
    onUpdate?: (tokenId: string, orderBook: OrderBook) => void,
    wsUrl: string = 'wss://ws-subscriptions-clob.polymarket.com/ws/market'
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wsClient = new WebSocket(wsUrl);

      this.wsClient.on('open', () => {
        console.log('[OrderBook WS] Connected');
        this.resubscribe();
        resolve();
      });

      this.wsClient.on('message', (data: WebSocket.RawData) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleWebSocketMessage(message, onUpdate);
        } catch (err) {
          console.error('[OrderBook WS] Parse error:', err);
        }
      });

      this.wsClient.on('close', () => {
        console.log('[OrderBook WS] Disconnected');
      });

      this.wsClient.on('error', (err) => {
        console.error('[OrderBook WS] Error:', err);
        reject(err);
      });
    });
  }

  /**
   * Subscribe to orderbook updates for specific tokens
   */
  subscribe(tokenIds: string[]): void {
    tokenIds.forEach((id) => this.subscriptions.add(id));

    if (this.wsClient && this.wsClient.readyState === WebSocket.OPEN) {
      // Try both formats - market format and asset format
      const subscription = {
        markets: tokenIds,
        type: 'market',
        assets_ids: tokenIds, // Include both for compatibility
      };
      console.log(`[OrderBook WS] Subscribing to ${tokenIds.length} markets`);
      this.wsClient.send(JSON.stringify(subscription));
    }
  }

  /**
   * Unsubscribe from orderbook updates
   */
  unsubscribe(tokenIds: string[]): void {
    tokenIds.forEach((id) => this.subscriptions.delete(id));

    if (this.wsClient && this.wsClient.readyState === WebSocket.OPEN) {
      const unsubscription = {
        markets: tokenIds,
        type: 'market',
        assets_ids: tokenIds, // Include both for compatibility
      };
      console.log(`[OrderBook WS] Unsubscribing from ${tokenIds.length} markets`);
      this.wsClient.send(JSON.stringify(unsubscription));
    }
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleWebSocketMessage(
    message: any,
    onUpdate?: (tokenId: string, orderBook: OrderBook) => void
  ): void {
    const eventType = message.event_type || message.type;
    const assetId = String(message.asset_id);

    if (!assetId) return;

    switch (eventType) {
      case 'book':
      case 'book_delta':
        this.updateOrderBookFromWS(assetId, message, eventType === 'book_delta');
        const updated = this.orderBooks.get(assetId);
        if (updated && onUpdate) {
          // Store tick and aggregate
          const tick = this.orderBookToTick(updated, 'ws');
          this.db.insertTick(tick);
          // this.aggregator.processTick(tick); // Disabled: method doesn't exist in current OrderBookAggregator
          
          onUpdate(assetId, updated);
        }
        break;

      case 'last_trade_price':
        // Update mid-price if available
        const current = this.orderBooks.get(assetId);
        if (current && message.data?.price) {
          current.mid = Number(message.data.price);
          current.lastUpdate = new Date();
          if (onUpdate) {
            onUpdate(assetId, current);
          }
        }
        break;

      case 'price_change':
        // Price changed event
        if (message.data?.price) {
          const book = this.orderBooks.get(assetId);
          if (book) {
            book.mid = Number(message.data.price);
            book.lastUpdate = new Date();
            if (onUpdate) {
              onUpdate(assetId, book);
            }
          }
        }
        break;
    }
  }

  /**
   * Update order book from WebSocket message
   */
  private updateOrderBookFromWS(tokenId: string, message: any, isDelta: boolean): void {
    let orderBook = this.orderBooks.get(tokenId);

    if (!orderBook) {
      // Initialize if not exists
      orderBook = {
        tokenId,
        bids: [],
        asks: [],
        lastUpdate: new Date(),
        source: 'ws',
      };
      this.orderBooks.set(tokenId, orderBook);
    }

    const bookData = message.book || message;
    const bids = bookData.bids || bookData.B || [];
    const asks = bookData.asks || bookData.A || [];

    if (isDelta) {
      // Apply delta updates
      this.applyDeltaUpdate(orderBook.bids, bids);
      this.applyDeltaUpdate(orderBook.asks, asks);
    } else {
      // Replace with full snapshot
      orderBook.bids = this.normalizeBook(bids);
      orderBook.asks = this.normalizeBook(asks);
    }

    // Recalculate mid and spread
    orderBook.mid = this.calculateMid(orderBook.bids, orderBook.asks);
    orderBook.spread = this.calculateSpread(orderBook.bids, orderBook.asks);
    orderBook.lastUpdate = new Date();
    orderBook.source = 'ws';
  }

  /**
   * Normalize order book entries
   */
  private normalizeBook(entries: any[]): OrderBookLevel[] {
    if (!Array.isArray(entries)) return [];

    const map = new Map<string, string>();

    for (const entry of entries) {
      if (!entry) continue;

      let price: string;
      let size: string;

      if (Array.isArray(entry)) {
        price = String(entry[0]);
        size = String(entry[1] || entry[2]);
      } else {
        price = String(entry.price || entry.px);
        size = String(entry.size || entry.qty || entry.quantity);
      }

      if (price && size) {
        map.set(price, size);
      }
    }

    return Array.from(map.entries())
      .map(([price, size]) => ({ price, size }))
      .sort((a, b) => Number(a.price) - Number(b.price));
  }

  /**
   * Apply delta update to order book side
   */
  private applyDeltaUpdate(side: OrderBookLevel[], deltas: any[]): void {
    const map = new Map(side.map((l) => [l.price, l.size]));

    for (const delta of deltas) {
      if (!delta) continue;

      let price: string;
      let size: string;

      if (Array.isArray(delta)) {
        price = String(delta[0]);
        size = String(delta[1] || delta[2]);
      } else {
        price = String(delta.price || delta.px);
        size = String(delta.size || delta.qty || delta.quantity);
      }

      if (price) {
        const sizeNum = Number(size) || 0;
        if (sizeNum <= 0) {
          map.delete(price);
        } else {
          map.set(price, size);
        }
      }
    }

    // Rebuild side array
    side.length = 0;
    for (const [price, size] of map) {
      side.push({ price, size });
    }
    side.sort((a, b) => Number(a.price) - Number(b.price));
  }

  /**
   * Calculate mid price
   * Note: bids should be sorted DESCENDING, asks ASCENDING
   */
  private calculateMid(bids: OrderBookLevel[], asks: OrderBookLevel[]): number | undefined {
    // Sort to ensure correct best bid/ask extraction
    const sortedBids = [...bids].sort((a, b) => Number(b.price) - Number(a.price));
    const sortedAsks = [...asks].sort((a, b) => Number(a.price) - Number(b.price));
    
    const bestBid = sortedBids.length > 0 ? Number(sortedBids[0].price) : undefined;
    const bestAsk = sortedAsks.length > 0 ? Number(sortedAsks[0].price) : undefined;

    if (bestBid !== undefined && bestAsk !== undefined) {
      return (bestBid + bestAsk) / 2;
    }

    return bestBid || bestAsk;
  }

  /**
   * Calculate spread
   * Note: bids should be sorted DESCENDING, asks ASCENDING
   */
  private calculateSpread(bids: OrderBookLevel[], asks: OrderBookLevel[]): number | undefined {
    // Sort to ensure correct best bid/ask extraction
    const sortedBids = [...bids].sort((a, b) => Number(b.price) - Number(a.price));
    const sortedAsks = [...asks].sort((a, b) => Number(a.price) - Number(b.price));
    
    const bestBid = sortedBids.length > 0 ? Number(sortedBids[0].price) : undefined;
    const bestAsk = sortedAsks.length > 0 ? Number(sortedAsks[0].price) : undefined;

    if (bestBid !== undefined && bestAsk !== undefined) {
      return bestAsk - bestBid;
    }

    return undefined;
  }

  /**
   * Resubscribe to all tracked tokens
   */
  private resubscribe(): void {
    if (this.subscriptions.size > 0) {
      this.subscribe(Array.from(this.subscriptions));
    }
  }

  /**
   * Get all tracked order books
   */
  getAllOrderBooks(): OrderBook[] {
    return Array.from(this.orderBooks.values());
  }

  /**
   * Get historical candles for a token
   */
  getCandles(tokenId: string, timeframe: Timeframe, startTime: number, endTime: number): OrderBookCandle[] {
    return this.db.getCandles(tokenId, timeframe, startTime, endTime);
  }

  /**
   * Get latest completed candles for all timeframes
   */
  getLatestCandles(tokenId: string): Record<Timeframe, OrderBookCandle | null> {
    return this.db.getLatestCandles(tokenId);
  }

  /**
   * Directly upsert a candle (for demo/backfill data)
   */
  upsertCandle(candle: OrderBookCandle): void {
    this.db.upsertCandle(candle);
  }

  /**
   * Get formatted time-series data for charting
   */
  getTimeSeriesData(tokenId: string, timeframe: Timeframe, minutes: number = 60) {
    const endTime = Math.floor(Date.now() / (timeframe === '1m' ? 60000 : timeframe === '5m' ? 300000 : 600000)) * (timeframe === '1m' ? 60000 : timeframe === '5m' ? 300000 : 600000);
    const startTime = endTime - minutes * 60 * 1000;

    const candles = this.getCandles(tokenId, timeframe, startTime, endTime);

    return {
      tokenId,
      timeframe,
      timestamps: candles.map(c => c.timestamp),
      mids: candles.map(c => (c.openMid + c.closeMid) / 2),
      opens: candles.map(c => c.openMid),
      highs: candles.map(c => c.highMid),
      lows: candles.map(c => c.lowMid),
      closes: candles.map(c => c.closeMid),
      spreads: candles.map(c => c.avgSpread),
      bidDepth: candles.map(c => c.avgTopBidSize),
      askDepth: candles.map(c => c.avgTopAskSize),
      volume: candles.map(c => c.totalVolume),
      candles,
    };
  }

  /**
   * Backfill historical candles from raw ticks
   */
  backfillCandles(tokenId: string, timeframes: Timeframe[] = ['1m', '5m', '10m']): void {
    this.logger.debug('Backfilling candles', { tokenId, timeframes });
    // this.aggregator.aggregateBackfill(tokenId, timeframes); // Disabled: method doesn't exist
  }

  /**
   * Get database statistics
   */
  getDbStats() {
    return this.db.getStats();
  }

  /**
   * Disconnect WebSocket
   */
  disconnect(): void {
    if (this.wsClient) {
      this.wsClient.close();
      this.wsClient = null;
    }
    this.subscriptions.clear();
    console.log('[OrderBook] Disconnected');
  }

  /**
   * Get order book summary (bids/asks with size levels)
   */
  formatOrderBook(tokenId: string, depth = 5): string {
    const book = this.orderBooks.get(tokenId);
    if (!book) return 'Order book not found';

    const lines = [`OrderBook for ${tokenId.slice(0, 20)}... (${book.source}, ${book.lastUpdate.toLocaleTimeString()})`];

    if (book.mid !== undefined) {
      lines.push(`Mid: $${book.mid.toFixed(4)} | Spread: $${(book.spread || 0).toFixed(6)}`);
    }

    lines.push('\nAsks (price | size):');
    book.asks.slice(0, depth).forEach((level) => {
      lines.push(`  $${level.price} | ${level.size}`);
    });

    if (book.mid !== undefined) {
      lines.push(`  ─ Mid: $${book.mid.toFixed(4)} ─`);
    }

    lines.push('\nBids (price | size):');
    book.bids
      .slice(-depth)
      .reverse()
      .forEach((level) => {
        lines.push(`  $${level.price} | ${level.size}`);
      });

    return lines.join('\n');
  }

  /**
   * Start collecting data for a specific market
   */
  async startCollectingData(tokenId: string): Promise<void> {
    if (this.activeMarkets.has(tokenId)) {
      this.logger.debug(`Already collecting data for ${tokenId}`);
      return;
    }

    this.logger.info(`🔄 Starting orderbook data collection for token: ${tokenId}`);
    console.log(`✅ OrderBook service collecting data for token: ${tokenId.slice(0, 20)}...`);
    
    this.activeMarkets.add(tokenId);

    // Fetch initial snapshot
    try {
      const snapshot = await this.fetchOrderBookSnapshot(tokenId);
      const orderBook = this.snapshotToOrderBook(snapshot);
      this.orderBooks.set(tokenId, orderBook);
      
      // Store initial tick
      const tick = this.orderBookToTick(orderBook, 'rest');
      this.db.insertTick(tick);
      // this.aggregator.processTick(tick); // Disabled: method doesn't exist in current OrderBookAggregator
      
      this.logger.info(`📊 Initial orderbook snapshot stored for ${tokenId}`);
      console.log(`📊 OrderBook snapshot: mid=$${orderBook.mid?.toFixed(4)}, spread=$${orderBook.spread?.toFixed(6)}`);
    } catch (error) {
      this.logger.error(`Failed to fetch initial snapshot for ${tokenId}:`, error);
    }

    // Start polling every 30 seconds
    const interval = setInterval(async () => {
      try {
        const snapshot = await this.fetchOrderBookSnapshot(tokenId);
        const orderBook = this.snapshotToOrderBook(snapshot);
        this.orderBooks.set(tokenId, orderBook);
        
        const tick = this.orderBookToTick(orderBook, 'rest');
        this.db.insertTick(tick);
        // this.aggregator.processTick(tick); // Disabled: method doesn't exist in current OrderBookAggregator
        
        this.logger.debug(`Updated orderbook for ${tokenId}`);
      } catch (error) {
        this.logger.warn(`Failed to update orderbook for ${tokenId}:`, error as Error);
      }
    }, 30000); // 30 seconds

    this.pollingIntervals.set(tokenId, interval);
  }

  /**
   * Stop collecting data for a specific market
   */
  stopCollectingData(tokenId: string): void {
    const interval = this.pollingIntervals.get(tokenId);
    if (interval) {
      clearInterval(interval);
      this.pollingIntervals.delete(tokenId);
      this.activeMarkets.delete(tokenId);
      this.logger.info(`Stopped collecting data for ${tokenId}`);
    }
  }

  /**
   * Shutdown service (finalize aggregation, close DB)
   */
  shutdown(): void {
    this.logger.debug('Shutting down OrderBookService');
    // Stop all polling
    for (const tokenId of this.activeMarkets) {
      this.stopCollectingData(tokenId);
    }
    // this.aggregator.finalizeAll(); // Disabled: method doesn't exist
    this.db.close();
    this.disconnect();
  }

}

