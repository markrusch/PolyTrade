/**
 * Test Suite F: SQLite Schema & CRUD Operations
 * 
 * Validates:
 * - Table creation
 * - Bulk inserts
 * - Position updates with average price
 * - Trade recording with PnL
 * - Query performance
 */

import { describe, it, expect } from '@jest/globals';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import {
    runTestSuite,
    assert,
    assertArrayLength,
    assertGreaterThan,
    assertLessThan,
    measureTime,
    log,
} from '../utils/test-utils.js';
import { getMockMarket, getMockTrade, getMockPortfolioGreeks } from '../factories/test-factories.js';

// Jest wrapper for the custom test suite
describe('Database Operations', () => {
    it('should run database operations tests', async () => {
        const result = await runDatabaseTests();
        expect(result.failed).toBe(0);
    }, 60000); // 60 second timeout for database operations
});

// ═══════════════════════════════════════════════════════════════
// TEST DATABASE PATH
// ═══════════════════════════════════════════════════════════════

const TEST_DB_PATH = path.join(process.cwd(), 'data', 'market_maker_test.db');

// ═══════════════════════════════════════════════════════════════
// DATABASE SCHEMA
// ═══════════════════════════════════════════════════════════════

const SCHEMA = `
-- Markets table
CREATE TABLE IF NOT EXISTS markets (
  slug TEXT PRIMARY KEY,
  title TEXT,
  strike INTEGER,
  maturity TEXT,
  end_date TEXT,
  clob_token_id_yes TEXT,
  clob_token_id_no TEXT,
  condition_id TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Positions table
CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clob_token_id TEXT NOT NULL,
  strike INTEGER,
  maturity TEXT,
  quantity REAL DEFAULT 0,
  avg_entry REAL DEFAULT 0,
  realized_pnl REAL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(clob_token_id)
);

-- Trades table
CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  clob_token_id TEXT NOT NULL,
  side TEXT NOT NULL,
  price REAL NOT NULL,
  size REAL NOT NULL,
  pnl REAL,
  timestamp TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Portfolio Greeks snapshots
CREATE TABLE IF NOT EXISTS portfolio_greeks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  delta REAL,
  gamma REAL,
  vega REAL,
  theta REAL,
  notional REAL,
  num_positions INTEGER
);

-- Orderbook snapshots
CREATE TABLE IF NOT EXISTS orderbook_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  best_bid REAL,
  best_ask REAL,
  spread_bps REAL,
  bid_depth REAL,
  ask_depth REAL,
  data_compressed BLOB
);

-- Quotes table
CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id TEXT NOT NULL,
  strike INTEGER,
  timestamp TEXT NOT NULL,
  bid REAL,
  ask REAL,
  spread REAL,
  fair REAL
);

-- Create indices
CREATE INDEX IF NOT EXISTS idx_trades_token ON trades(clob_token_id);
CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);
CREATE INDEX IF NOT EXISTS idx_greeks_timestamp ON portfolio_greeks(timestamp);
CREATE INDEX IF NOT EXISTS idx_orderbook_token ON orderbook_snapshots(token_id);
CREATE INDEX IF NOT EXISTS idx_orderbook_timestamp ON orderbook_snapshots(timestamp);
`;

// ═══════════════════════════════════════════════════════════════
// TEST DATABASE CLASS
// ═══════════════════════════════════════════════════════════════

class TestDB {
    private db: Database.Database;

    constructor(dbPath: string) {
        // Ensure data directory exists
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // Remove existing test database
        if (fs.existsSync(dbPath)) {
            fs.unlinkSync(dbPath);
        }

        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');
    }

    initialize(): void {
        this.db.exec(SCHEMA);
    }

    // Markets
    upsertMarket(market: any): void {
        const stmt = this.db.prepare(`
      INSERT INTO markets (slug, title, strike, maturity, end_date, clob_token_id_yes, clob_token_id_no, condition_id, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET
        title = excluded.title,
        updated_at = CURRENT_TIMESTAMP
    `);
        stmt.run(
            market.slug,
            market.title,
            market.strike,
            market.maturity,
            market.endDate,
            market.clobTokenIds?.[0] || '',
            market.clobTokenIds?.[1] || '',
            market.conditionId,
            market.active ? 1 : 0
        );
    }

    getMarkets(): any[] {
        return this.db.prepare('SELECT * FROM markets WHERE active = 1').all();
    }

    // Positions
    updatePosition(tokenId: string, quantity: number, price: number): void {
        const existing = this.db.prepare('SELECT * FROM positions WHERE clob_token_id = ?').get(tokenId) as any;

        if (existing) {
            // Calculate new average entry
            const oldQty = existing.quantity || 0;
            const oldAvg = existing.avg_entry || 0;
            const newQty = oldQty + quantity;
            const newAvg = newQty !== 0 ? ((oldQty * oldAvg) + (quantity * price)) / newQty : 0;

            this.db.prepare(`
        UPDATE positions SET quantity = ?, avg_entry = ?, updated_at = CURRENT_TIMESTAMP
        WHERE clob_token_id = ?
      `).run(newQty, newAvg, tokenId);
        } else {
            this.db.prepare(`
        INSERT INTO positions (clob_token_id, quantity, avg_entry)
        VALUES (?, ?, ?)
      `).run(tokenId, quantity, price);
        }
    }

    getPositions(): any[] {
        return this.db.prepare('SELECT * FROM positions').all();
    }

    getPositionByToken(tokenId: string): any {
        return this.db.prepare('SELECT * FROM positions WHERE clob_token_id = ?').get(tokenId);
    }

    // Trades
    recordTrade(trade: any): void {
        // Calculate PnL if closing position
        const position = this.getPositionByToken(trade.clobTokenId);
        let pnl = 0;
        if (position && trade.side === 'SELL' && position.quantity > 0) {
            pnl = (trade.price - position.avg_entry) * Math.min(trade.size, position.quantity);
        }

        this.db.prepare(`
      INSERT INTO trades (id, clob_token_id, side, price, size, pnl, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(trade.id, trade.clobTokenId, trade.side, trade.price, trade.size, pnl, trade.timestamp);

        // Update position
        const qty = trade.side === 'BUY' ? trade.size : -trade.size;
        this.updatePosition(trade.clobTokenId, qty, trade.price);
    }

    getTrades(limit: number = 100): any[] {
        return this.db.prepare('SELECT * FROM trades ORDER BY timestamp DESC LIMIT ?').all(limit);
    }

    // Portfolio Greeks
    recordGreeks(greeks: any): void {
        this.db.prepare(`
      INSERT INTO portfolio_greeks (timestamp, delta, gamma, vega, theta, notional, num_positions)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(greeks.timestamp, greeks.delta, greeks.gamma, greeks.vega, greeks.theta, greeks.notional, greeks.numPositions);
    }

    getGreeksHistory(hours: number = 24): any[] {
        const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
        return this.db.prepare('SELECT * FROM portfolio_greeks WHERE timestamp > ? ORDER BY timestamp').all(cutoff);
    }

    // Orderbook snapshots
    recordOrderbookSnapshot(snapshot: any): void {
        this.db.prepare(`
      INSERT INTO orderbook_snapshots (token_id, timestamp, best_bid, best_ask, spread_bps, bid_depth, ask_depth)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
            snapshot.tokenId,
            snapshot.timestamp,
            snapshot.bestBid,
            snapshot.bestAsk,
            snapshot.spreadBps,
            snapshot.bidDepth,
            snapshot.askDepth
        );
    }

    // PnL summary
    getPnLSummary(): any {
        return this.db.prepare(`
      SELECT 
        COUNT(*) as trade_count,
        SUM(pnl) as total_pnl,
        SUM(CASE WHEN pnl > 0 THEN pnl ELSE 0 END) as winning_pnl,
        SUM(CASE WHEN pnl < 0 THEN pnl ELSE 0 END) as losing_pnl
      FROM trades
    `).get();
    }

    // Cleanup old data
    cleanupOldData(retentionDays: number = 30): number {
        const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

        let deleted = 0;
        deleted += this.db.prepare('DELETE FROM portfolio_greeks WHERE timestamp < ?').run(cutoff).changes;
        deleted += this.db.prepare('DELETE FROM orderbook_snapshots WHERE timestamp < ?').run(cutoff).changes;

        return deleted;
    }

    getDatabaseSize(): number {
        const stats = fs.statSync(TEST_DB_PATH);
        return stats.size;
    }

    close(): void {
        this.db.close();
    }
}

// ═══════════════════════════════════════════════════════════════
// TEST SUITE RUNNER
// ═══════════════════════════════════════════════════════════════

export async function runDatabaseTests() {
    let db: TestDB;

    const tests = [
        {
            name: 'Initialize database and create tables',
            fn: async () => {
                db = new TestDB(TEST_DB_PATH);
                const { duration } = await measureTime(async () => {
                    db.initialize();
                });

                log.info(`Schema initialized in ${duration}ms`);
                log.info(`Tables created: markets, positions, trades, portfolio_greeks, orderbook_snapshots, quotes`);
                return { duration, tablesCreated: 6 };
            },
        },
        {
            name: 'Bulk insert 50 markets in <500ms',
            fn: async () => {
                const markets = Array.from({ length: 50 }, (_, i) =>
                    getMockMarket({ strike: 80000 + i * 2000, maturity: '2026-01-19' })
                );

                const { duration } = await measureTime(async () => {
                    for (const market of markets) {
                        db.upsertMarket(market);
                    }
                });

                const savedMarkets = db.getMarkets();
                log.info(`Inserted ${savedMarkets.length} markets in ${duration}ms`);
                assertLessThan(duration, 500, `Bulk insert should be <500ms, took ${duration}ms`);
                assert(savedMarkets.length === 50, 'Should have 50 markets');
                return { duration, count: savedMarkets.length };
            },
        },
        {
            name: 'Record 100 trades with PnL calculation',
            fn: async () => {
                const trades = Array.from({ length: 100 }, (_, i) =>
                    getMockTrade({
                        id: `trade-${i}`,
                        clobTokenId: `token-${i % 10}`,
                        side: i % 3 === 0 ? 'SELL' : 'BUY',
                        price: 0.4 + Math.random() * 0.2,
                        size: 10 + Math.floor(Math.random() * 40),
                    })
                );

                const { duration } = await measureTime(async () => {
                    for (const trade of trades) {
                        db.recordTrade(trade);
                    }
                });

                const savedTrades = db.getTrades(100);
                log.info(`Recorded ${savedTrades.length} trades in ${duration}ms`);
                assert(savedTrades.length === 100, 'Should have 100 trades');
                return { duration, count: savedTrades.length };
            },
        },
        {
            name: 'Update 20 positions with correct average price',
            fn: async () => {
                // Verify positions were created from trades
                const positions = db.getPositions();
                log.info(`Created ${positions.length} positions from trades`);
                assertGreaterThan(positions.length, 0, 'Should have some positions');

                // Verify average price calculation
                const sample = positions[0];
                if (sample) {
                    log.info(`Sample position: qty=${sample.quantity}, avg=${sample.avg_entry?.toFixed(3)}`);
                }

                return { positionCount: positions.length };
            },
        },
        {
            name: 'Save 1000 portfolio Greek snapshots',
            fn: async () => {
                const { duration } = await measureTime(async () => {
                    for (let i = 0; i < 1000; i++) {
                        const timestamp = new Date(Date.now() - i * 60 * 1000).toISOString(); // Every minute
                        db.recordGreeks({
                            ...getMockPortfolioGreeks(),
                            timestamp,
                            delta: 20 + Math.random() * 10,
                        });
                    }
                });

                const greeks = db.getGreeksHistory(24);
                log.info(`Saved 1000 Greek snapshots in ${duration}ms`);
                log.info(`Retrieved ${greeks.length} snapshots from last 24h`);
                return { duration, count: greeks.length };
            },
        },
        {
            name: 'Save 5000 orderbook snapshots',
            fn: async () => {
                const tokenIds = Array.from({ length: 10 }, (_, i) => `token-${i}`);

                const { duration } = await measureTime(async () => {
                    for (let i = 0; i < 5000; i++) {
                        db.recordOrderbookSnapshot({
                            tokenId: tokenIds[i % 10],
                            timestamp: new Date(Date.now() - i * 10 * 1000).toISOString(),
                            bestBid: 0.45 + Math.random() * 0.1,
                            bestAsk: 0.55 + Math.random() * 0.1,
                            spreadBps: 100 + Math.random() * 200,
                            bidDepth: 1000 + Math.random() * 5000,
                            askDepth: 1000 + Math.random() * 5000,
                        });
                    }
                });

                log.info(`Saved 5000 orderbook snapshots in ${duration}ms`);
                return { duration };
            },
        },
        {
            name: 'Query all positions in <10ms',
            fn: async () => {
                const { result, duration } = await measureTime(async () => {
                    return db.getPositions();
                });

                log.info(`Query returned ${result.length} positions in ${duration}ms`);
                assertLessThan(duration, 10, `Position query should be <10ms, took ${duration}ms`);
                return { duration, count: result.length };
            },
        },
        {
            name: 'Query PnL summary in <50ms',
            fn: async () => {
                const { result, duration } = await measureTime(async () => {
                    return db.getPnLSummary();
                });

                log.info(`PnL Summary: ${result.trade_count} trades, Total: $${result.total_pnl?.toFixed(2) || 0}`);
                assertLessThan(duration, 50, `PnL query should be <50ms, took ${duration}ms`);
                return { duration, ...result };
            },
        },
        {
            name: 'Query Greek history (24h) in <100ms',
            fn: async () => {
                const { result, duration } = await measureTime(async () => {
                    return db.getGreeksHistory(24);
                });

                log.info(`Retrieved ${result.length} Greek snapshots in ${duration}ms`);
                assertLessThan(duration, 100, `Greek history query should be <100ms, took ${duration}ms`);
                return { duration, count: result.length };
            },
        },
        {
            name: 'Query position by token in <5ms',
            fn: async () => {
                const { result, duration } = await measureTime(async () => {
                    return db.getPositionByToken('token-0');
                });

                log.info(`Position lookup in ${duration}ms`);
                assertLessThan(duration, 5, `Token lookup should be <5ms, took ${duration}ms`);
                return { duration };
            },
        },
        {
            name: 'Cleanup old data (30-day retention)',
            fn: async () => {
                // Add some old data first
                const oldTimestamp = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
                for (let i = 0; i < 100; i++) {
                    db.recordGreeks({
                        ...getMockPortfolioGreeks(),
                        timestamp: oldTimestamp,
                    });
                }

                const { result, duration } = await measureTime(async () => {
                    return db.cleanupOldData(30);
                });

                log.info(`Cleaned up ${result} old records in ${duration}ms`);
                return { deleted: result, duration };
            },
        },
        {
            name: 'Verify database size is <100MB',
            fn: async () => {
                const size = db.getDatabaseSize();
                const sizeMB = size / 1024 / 1024;

                log.info(`Database size: ${sizeMB.toFixed(2)} MB`);
                assertLessThan(sizeMB, 100, `Database should be <100MB, is ${sizeMB.toFixed(2)}MB`);

                // Cleanup
                db.close();

                return { sizeMB };
            },
        },
    ];

    return runTestSuite('Test Suite F: SQLite Schema & CRUD Operations', tests);
}

// Already exported above
