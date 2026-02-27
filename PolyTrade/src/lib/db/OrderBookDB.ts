/**
 * OrderBook Storage Layer - File-based JSON persistence
 * Lightweight alternative to SQLite for local development
 * Stores ticks and candles in JSON format with automatic pruning
 */

import { Logger } from '../logger/index.js';
import { OrderBookTick, OrderBookCandle, Timeframe } from '../types/index.js';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';

// Use process.cwd() for data directory - more portable across module systems
const DATA_DIR = path.join(process.cwd(), 'data');
const TICKS_FILE = path.join(DATA_DIR, 'orderbook-ticks.json');
const CANDLES_FILE = path.join(DATA_DIR, 'orderbook-candles.json');
const TICK_RETENTION_MS = 2 * 60 * 60 * 1000; // 2 hours
const CANDLE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

type TicksByToken = Record<string, OrderBookTick[]>;
type CandlesByToken = Record<string, Record<Timeframe, OrderBookCandle[]>>;

export class OrderBookDB {
  private ticks: TicksByToken = {};
  private candles: CandlesByToken = {};
  private logger: Logger;
  private saveInterval: NodeJS.Timeout;

  constructor(logger?: Logger) {
    this.logger = logger || new Logger({ service: 'OrderBookDB' });

    // Ensure data directory exists
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }

    // Load existing data
    this.loadData();

    // Auto-save every 10 seconds
    this.saveInterval = setInterval(() => this.saveData(), 10000);
    
    this.logger.debug('OrderBookDB initialized (file-based)', { path: DATA_DIR });
  }

  /**
   * Load data from files
   */
  private loadData(): void {
    try {
      if (existsSync(TICKS_FILE)) {
        this.ticks = JSON.parse(readFileSync(TICKS_FILE, 'utf-8'));
      }
      if (existsSync(CANDLES_FILE)) {
        this.candles = JSON.parse(readFileSync(CANDLES_FILE, 'utf-8'));
      }
      this.logger.debug('Data loaded from disk');
    } catch (err) {
      this.logger.warn('Could not load data files, starting fresh', { error: err });
      this.ticks = {};
      this.candles = {};
    }
  }

  /**
   * Save data to files
   */
  private saveData(): void {
    try {
      writeFileSync(TICKS_FILE, JSON.stringify(this.ticks, null, 2));
      writeFileSync(CANDLES_FILE, JSON.stringify(this.candles, null, 2));
    } catch (err) {
      this.logger.error('Failed to save data', { error: err });
    }
  }

  /**
   * Insert a raw orderbook tick
   */
  insertTick(tick: OrderBookTick): void {
    try {
      if (!this.ticks[tick.tokenId]) {
        this.ticks[tick.tokenId] = [];
      }

      this.ticks[tick.tokenId].push(tick);

      // Keep only recent ticks (in-memory pruning)
      const cutoff = Date.now() - TICK_RETENTION_MS;
      this.ticks[tick.tokenId] = this.ticks[tick.tokenId].filter(t => t.timestamp > cutoff);

      if (this.ticks[tick.tokenId].length === 0) {
        delete this.ticks[tick.tokenId];
      }
    } catch (err) {
      this.logger.error('Failed to insert tick', { error: err, tokenId: tick.tokenId });
    }
  }

  /**
   * Upsert a candle (update if exists, insert if not)
   */
  upsertCandle(candle: OrderBookCandle): void {
    try {
      if (!this.candles[candle.tokenId]) {
        this.candles[candle.tokenId] = {} as Record<Timeframe, OrderBookCandle[]>;
      }

      if (!this.candles[candle.tokenId][candle.timeframe]) {
        this.candles[candle.tokenId][candle.timeframe] = [];
      }

      // Find and update or insert
      const candleArray = this.candles[candle.tokenId][candle.timeframe];
      const existingIndex = candleArray.findIndex(c => c.timestamp === candle.timestamp);
      
      if (existingIndex >= 0) {
        candleArray[existingIndex] = candle;
      } else {
        candleArray.push(candle);
      }

      // Keep candles sorted by timestamp
      candleArray.sort((a, b) => a.timestamp - b.timestamp);
    } catch (err) {
      this.logger.error('Failed to upsert candle', { error: err, tokenId: candle.tokenId });
    }
  }

  /**
   * Get candles for a token within time range
   */
  getCandles(tokenId: string, timeframe: Timeframe, startTime: number, endTime: number): OrderBookCandle[] {
    try {
      const candleArray = this.candles[tokenId]?.[timeframe] || [];
      return candleArray.filter(c => c.timestamp >= startTime && c.timestamp <= endTime);
    } catch (err) {
      this.logger.error('Failed to get candles', { error: err, tokenId, timeframe });
      return [];
    }
  }

  /**
   * Get latest candle for each timeframe
   */
  getLatestCandles(tokenId: string): Record<Timeframe, OrderBookCandle | null> {
    try {
      const timeframes: Timeframe[] = ['1m', '5m', '10m'];
      const result: Record<Timeframe, OrderBookCandle | null> = {
        '1m': null,
        '5m': null,
        '10m': null,
      };

      for (const tf of timeframes) {
        const candleArray = this.candles[tokenId]?.[tf] || [];
        if (candleArray.length > 0) {
          result[tf] = candleArray[candleArray.length - 1];
        }
      }

      return result;
    } catch (err) {
      this.logger.error('Failed to get latest candles', { error: err, tokenId });
      return { '1m': null, '5m': null, '10m': null };
    }
  }

  /**
   * Get raw ticks for aggregation (within time range)
   */
  getTicks(tokenId: string, startTime: number, endTime: number): OrderBookTick[] {
    try {
      const tickArray = this.ticks[tokenId] || [];
      return tickArray.filter(t => t.timestamp >= startTime && t.timestamp <= endTime);
    } catch (err) {
      this.logger.error('Failed to get ticks', { error: err, tokenId });
      return [];
    }
  }

  /**
   * Get database statistics
   */
  getStats(): { tickCount: number; candleCount: number; dbSize: string } {
    let tickCount = 0;
    let candleCount = 0;

    for (const ticks of Object.values(this.ticks)) {
      tickCount += ticks.length;
    }

    for (const tokenCandles of Object.values(this.candles)) {
      for (const timeframeCandles of Object.values(tokenCandles)) {
        candleCount += timeframeCandles.length;
      }
    }

    // Estimate size
    const estimatedSize = (tickCount * 200 + candleCount * 300) / (1024 * 1024); // Rough estimate in MB
    
    return {
      tickCount,
      candleCount,
      dbSize: `${estimatedSize.toFixed(2)} MB (estimated)`,
    };
  }

  /**
   * Close database connection
   */
  close(): void {
    try {
      clearInterval(this.saveInterval);
      this.saveData(); // Final save
      this.logger.debug('OrderBookDB closed');
    } catch (err) {
      this.logger.error('Failed to close database', { error: err });
    }
  }
}
