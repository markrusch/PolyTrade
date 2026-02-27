/**
 * Unit Tests for OrderBookDB
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { OrderBookDB } from '../src/lib/db/OrderBookDB';
import { OrderBookTick, OrderBookCandle } from '../src/lib/types';

const TEST_DB_PATH = path.join(__dirname, '../test-data/test-orderbook.db');

describe('OrderBookDB', () => {
  let db: OrderBookDB;

  beforeAll(() => {
    // Ensure test directory exists
    const testDir = path.dirname(TEST_DB_PATH);
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterAll(() => {
    if (db) {
      db.close();
    }
    // Cleanup test database
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  describe('insertTick', () => {
    beforeAll(() => {
      db = new OrderBookDB();
    });

    it('should insert a single tick', () => {
      const tick: OrderBookTick = {
        tokenId: 'token-123',
        timestamp: Date.now(),
        bestBid: 0.45,
        bestAsk: 0.55,
        spreadBps: 2222, // (0.55 - 0.45) / 0.45 * 10000
        topBidSize: 100,
        topAskSize: 150,
        bidLevels: [
          { price: 0.45, size: 100 },
          { price: 0.44, size: 200 },
        ],
        askLevels: [
          { price: 0.55, size: 150 },
          { price: 0.56, size: 300 },
        ],
        source: 'ws',
      };

      expect(() => db.insertTick(tick)).not.toThrow();
    });

    it('should insert multiple ticks', () => {
      const now = Date.now();
      for (let i = 0; i < 10; i++) {
        const tick: OrderBookTick = {
          tokenId: 'token-456',
          timestamp: now + i * 1000,
          bestBid: 0.40 + i * 0.01,
          bestAsk: 0.50 + i * 0.01,
          spreadBps: 2500,
          topBidSize: 100 + i * 10,
          topAskSize: 150 + i * 10,
          bidLevels: [{ price: 0.40 + i * 0.01, size: 100 + i * 10 }],
          askLevels: [{ price: 0.50 + i * 0.01, size: 150 + i * 10 }],
          source: 'rest',
        };
        db.insertTick(tick);
      }
    });
  });

  describe('upsertCandle', () => {
    it('should insert a new candle', () => {
      const candle: OrderBookCandle = {
        tokenId: 'token-789',
        timeframe: '1m',
        timestamp: Date.now(),
        openMid: 0.50,
        highMid: 0.55,
        lowMid: 0.48,
        closeMid: 0.52,
        avgSpread: 2000,
        avgTopBidSize: 100,
        avgTopAskSize: 150,
        totalVolume: 25000,
        levelCount: 15,
        tickCount: 60,
      };

      expect(() => db.upsertCandle(candle)).not.toThrow();
    });

    it('should update existing candle', () => {
      const timestamp = Math.floor(Date.now() / 60000) * 60000;
      const candle1: OrderBookCandle = {
        tokenId: 'token-update',
        timeframe: '1m',
        timestamp,
        openMid: 0.50,
        highMid: 0.55,
        lowMid: 0.48,
        closeMid: 0.52,
        avgSpread: 2000,
        avgTopBidSize: 100,
        avgTopAskSize: 150,
        totalVolume: 25000,
        levelCount: 15,
        tickCount: 50,
      };

      const candle2: OrderBookCandle = {
        ...candle1,
        highMid: 0.58,
        closeMid: 0.54,
        tickCount: 60,
      };

      db.upsertCandle(candle1);
      db.upsertCandle(candle2);

      // Verify second candle overwrote the first
      const retrieved = db.getCandles('token-update', '1m', timestamp - 1000, timestamp + 1000);
      expect(retrieved.length).toBe(1);
      expect(retrieved[0].highMid).toBe(0.58);
      expect(retrieved[0].tickCount).toBe(60);
    });
  });

  describe('getCandles', () => {
    beforeAll(() => {
      const now = Math.floor(Date.now() / 60000) * 60000;
      for (let i = 0; i < 5; i++) {
        const candle: OrderBookCandle = {
          tokenId: 'token-candle-query',
          timeframe: '1m',
          timestamp: now - i * 60000,
          openMid: 0.50,
          highMid: 0.55,
          lowMid: 0.48,
          closeMid: 0.52 + i * 0.01,
          avgSpread: 2000,
          avgTopBidSize: 100,
          avgTopAskSize: 150,
          totalVolume: 25000,
          levelCount: 15,
          tickCount: 60,
        };
        db.upsertCandle(candle);
      }
    });

    it('should retrieve candles within time range', () => {
      const now = Date.now();
      const startTime = now - 5 * 60 * 1000;
      const endTime = now;

      const candles = db.getCandles('token-candle-query', '1m', startTime, endTime);
      expect(candles.length).toBe(5);
      expect(candles[0].tokenId).toBe('token-candle-query');
    });

    it('should return empty array for non-existent token', () => {
      const now = Date.now();
      const candles = db.getCandles('nonexistent-token', '1m', now - 60000, now);
      expect(candles.length).toBe(0);
    });

    it('should filter by timeframe', () => {
      const now = Math.floor(Date.now() / 60000) * 60000;
      
      // Insert 5m candles
      for (let i = 0; i < 3; i++) {
        const candle: OrderBookCandle = {
          tokenId: 'token-tf-test',
          timeframe: '5m',
          timestamp: now - i * 300000,
          openMid: 0.50,
          highMid: 0.55,
          lowMid: 0.48,
          closeMid: 0.52,
          avgSpread: 2000,
          avgTopBidSize: 100,
          avgTopAskSize: 150,
          totalVolume: 25000,
          levelCount: 15,
          tickCount: 300,
        };
        db.upsertCandle(candle);
      }

      const candles5m = db.getCandles('token-tf-test', '5m', now - 600000, now);
      const candles1m = db.getCandles('token-tf-test', '1m', now - 600000, now);
      
      expect(candles5m.length).toBe(3);
      expect(candles1m.length).toBe(0);
    });
  });

  describe('getLatestCandles', () => {
    beforeAll(() => {
      const now = Math.floor(Date.now() / 60000) * 60000;
      
      const timeframes: Array<'1m' | '5m' | '10m'> = ['1m', '5m', '10m'];
      for (const tf of timeframes) {
        const candle: OrderBookCandle = {
          tokenId: 'token-latest',
          timeframe: tf,
          timestamp: now,
          openMid: 0.50,
          highMid: 0.55,
          lowMid: 0.48,
          closeMid: 0.52,
          avgSpread: 2000,
          avgTopBidSize: 100,
          avgTopAskSize: 150,
          totalVolume: 25000,
          levelCount: 15,
          tickCount: tf === '1m' ? 60 : tf === '5m' ? 300 : 600,
        };
        db.upsertCandle(candle);
      }
    });

    it('should return latest candle for each timeframe', () => {
      const result = db.getLatestCandles('token-latest');
      
      expect(result['1m']).not.toBeNull();
      expect(result['5m']).not.toBeNull();
      expect(result['10m']).not.toBeNull();
      expect(result['1m']?.timeframe).toBe('1m');
      expect(result['5m']?.timeframe).toBe('5m');
      expect(result['10m']?.timeframe).toBe('10m');
    });

    it('should return null for missing timeframes', () => {
      const result = db.getLatestCandles('nonexistent-token');
      expect(result['1m']).toBeNull();
      expect(result['5m']).toBeNull();
      expect(result['10m']).toBeNull();
    });
  });

  describe('getTicks', () => {
    beforeAll(() => {
      const now = Date.now();
      for (let i = 0; i < 20; i++) {
        const tick: OrderBookTick = {
          tokenId: 'token-ticks',
          timestamp: now - i * 1000,
          bestBid: 0.50 - i * 0.001,
          bestAsk: 0.55 - i * 0.001,
          spreadBps: 2000,
          topBidSize: 100,
          topAskSize: 150,
          bidLevels: [{ price: 0.50 - i * 0.001, size: 100 }],
          askLevels: [{ price: 0.55 - i * 0.001, size: 150 }],
          source: 'ws',
        };
        db.insertTick(tick);
      }
    });

    it('should retrieve ticks within time range', () => {
      const now = Date.now();
      const startTime = now - 10 * 1000;
      const endTime = now;

      const ticks = db.getTicks('token-ticks', startTime, endTime);
      expect(ticks.length).toBeGreaterThan(0);
      expect(ticks.length).toBeLessThanOrEqual(10);
    });

    it('should parse bid/ask levels correctly', () => {
      const now = Date.now();
      const ticks = db.getTicks('token-ticks', now - 5000, now);
      
      expect(ticks.length).toBeGreaterThan(0);
      expect(ticks[0].bidLevels).toBeDefined();
      expect(ticks[0].askLevels).toBeDefined();
      expect(Array.isArray(ticks[0].bidLevels)).toBe(true);
      expect(Array.isArray(ticks[0].askLevels)).toBe(true);
    });
  });

  describe('getStats', () => {
    it('should return database statistics', async () => {
      const stats = db.getStats();
      
      expect(stats).toHaveProperty('tickCount');
      expect(stats).toHaveProperty('candleCount');
      expect(stats).toHaveProperty('dbSize');
      expect(typeof stats.tickCount).toBe('number');
      expect(typeof stats.candleCount).toBe('number');
      expect(typeof stats.dbSize).toBe('string');
    });
  });
});
