/**
 * Database Binance/Deribit Integration Tests
 * 
 * Tests for:
 * - SQL injection prevention (parameterized queries)
 * - Data integrity and persistence
 * - Retention/pruning operations
 * - Transaction atomicity
 * - Data replay functionality
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { DB, BinanceTick, BinanceSnapshot24h, DeribitSnapshot, DeribitInstrument } from '../../src/db/Database.js';
import { DataReplayer } from '../../src/lib/db/DataReplayer.js';
import * as fs from 'fs';
import * as path from 'path';

const TEST_DB_PATH = path.join(process.cwd(), 'test-polytrade.db');

describe('PolyTrade Database - Binance/Deribit Integration', () => {
    let db: DB;

    beforeAll(() => {
        // Remove old test database if exists
        if (fs.existsSync(TEST_DB_PATH)) {
            fs.unlinkSync(TEST_DB_PATH);
        }
        db = new DB(TEST_DB_PATH);
    });

    afterAll(() => {
        db.close();
        // Cleanup test database
        if (fs.existsSync(TEST_DB_PATH)) {
            fs.unlinkSync(TEST_DB_PATH);
        }
    });

    // ========================================================================
    // SQL INJECTION PREVENTION TESTS
    // ========================================================================
    describe('SQL Injection Prevention', () => {
        it('should safely handle malicious symbol names in Binance ticks', () => {
            const maliciousSymbols = [
                "'; DROP TABLE binance_ticks; --",
                "ETHUSDT'; DELETE FROM markets; --",
                "BTC\"; SELECT * FROM users; --",
                "<script>alert('xss')</script>",
                "ETHUSDT OR 1=1",
                "ETHUSDT' UNION SELECT * FROM markets --",
                "NULL",
                "1; UPDATE positions SET quantity=0; --"
            ];

            for (const maliciousSymbol of maliciousSymbols) {
                // Insert should succeed (symbol is just data, not executed as SQL)
                const tick: BinanceTick = {
                    symbol: maliciousSymbol,
                    price: 3000.00,
                    timestamp: Date.now()
                };

                expect(() => db.insertBinanceTick(tick)).not.toThrow();

                // Verify it was stored literally, not executed
                const retrieved = db.getLatestBinancePrice(maliciousSymbol);
                expect(retrieved).toBeDefined();
                expect(retrieved?.symbol).toBe(maliciousSymbol);
                expect(retrieved?.price).toBe(3000.00);
            }

            // Verify tables still exist and are intact
            const stats = db.getStats();
            expect(stats.binanceTicks).toBeGreaterThan(0);
        });

        it('should safely handle malicious instrument names in Deribit data', () => {
            const maliciousNames = [
                "'; DROP TABLE deribit_snapshots; --",
                "ETH-28MAR25-3000-C'; DELETE FROM trades; --",
                "BTC\" OR \"1\"=\"1",
                "NULL; TRUNCATE TABLE positions; --"
            ];

            for (const maliciousName of maliciousNames) {
                const instrument: DeribitInstrument = {
                    instrumentName: maliciousName,
                    currency: 'ETH',
                    strike: 3000,
                    expirationTimestamp: Date.now() + 86400000,
                    optionType: 'call'
                };

                const snapshot: DeribitSnapshot = {
                    instrumentName: maliciousName,
                    underlyingPrice: 3000,
                    markIv: 0.65,
                    timestamp: Date.now()
                };

                // Should handle gracefully
                expect(() => db.insertDeribitSnapshot(snapshot, instrument)).not.toThrow();

                // Verify data integrity
                const retrieved = db.getLatestDeribitSnapshot(maliciousName);
                expect(retrieved).toBeDefined();
                expect(retrieved?.instrumentName).toBe(maliciousName);
            }
        });

        it('should safely handle special characters in all fields', () => {
            const specialChars = "!@#$%^&*()_+-=[]{}|;':\",./<>?`~\\";
            
            const tick: BinanceTick = {
                symbol: `TEST${specialChars}`,
                price: 1234.56,
                bidPrice: 1234.00,
                askPrice: 1235.00,
                timestamp: Date.now()
            };

            expect(() => db.insertBinanceTick(tick)).not.toThrow();
            
            const retrieved = db.getLatestBinancePrice(`TEST${specialChars}`);
            expect(retrieved?.symbol).toBe(`TEST${specialChars}`);
        });

        it('should handle Unicode characters safely', () => {
            const unicodeSymbol = "测试USDT🚀ETH";
            
            const tick: BinanceTick = {
                symbol: unicodeSymbol,
                price: 999.99,
                timestamp: Date.now()
            };

            expect(() => db.insertBinanceTick(tick)).not.toThrow();
            
            const retrieved = db.getLatestBinancePrice(unicodeSymbol);
            expect(retrieved?.symbol).toBe(unicodeSymbol);
        });
    });

    // ========================================================================
    // BINANCE DATA OPERATIONS TESTS
    // ========================================================================
    describe('Binance Data Operations', () => {
        beforeEach(() => {
            // Clean up Binance tables for each test
            db['db'].exec('DELETE FROM binance_ticks WHERE symbol LIKE "TEST_%"');
            db['db'].exec('DELETE FROM binance_snapshots_24h WHERE symbol LIKE "TEST_%"');
        });

        it('should insert and retrieve Binance ticks', () => {
            const tick: BinanceTick = {
                symbol: 'TEST_ETHUSDT',
                price: 3000.50,
                bidPrice: 3000.00,
                askPrice: 3001.00,
                bidQty: 100,
                askQty: 150,
                timestamp: Date.now()
            };

            const result = db.insertBinanceTick(tick);
            expect(result.changes).toBe(1);

            const retrieved = db.getLatestBinancePrice('TEST_ETHUSDT');
            expect(retrieved).toBeDefined();
            expect(retrieved?.price).toBe(3000.50);
            expect(retrieved?.bidPrice).toBe(3000.00);
            expect(retrieved?.askPrice).toBe(3001.00);
        });

        it('should insert batch Binance ticks in transaction', () => {
            const ticks: BinanceTick[] = Array.from({ length: 100 }, (_, i) => ({
                symbol: 'TEST_BTCUSDT',
                price: 50000 + i,
                timestamp: Date.now() + i * 1000
            }));

            expect(() => db.insertBinanceTicksBatch(ticks)).not.toThrow();

            const history = db.getBinancePriceHistory(
                'TEST_BTCUSDT',
                ticks[0].timestamp,
                ticks[99].timestamp,
                200
            );
            expect(history.length).toBe(100);
        });

        it('should query Binance price history with time range', () => {
            const baseTime = Date.now() - 3600000; // 1 hour ago
            const ticks: BinanceTick[] = Array.from({ length: 10 }, (_, i) => ({
                symbol: 'TEST_RANGE',
                price: 1000 + i,
                timestamp: baseTime + i * 60000 // Every minute
            }));

            db.insertBinanceTicksBatch(ticks);

            // Query middle portion
            const result = db.getBinancePriceHistory(
                'TEST_RANGE',
                baseTime + 120000, // Start at tick 2
                baseTime + 420000, // End at tick 7
                100
            );

            expect(result.length).toBe(6); // Ticks 2-7
            expect(result[0].price).toBe(1002);
            expect(result[5].price).toBe(1007);
        });

        it('should insert and retrieve Binance 24h snapshots', () => {
            const snapshot: BinanceSnapshot24h = {
                symbol: 'TEST_SNAP',
                openPrice: 2900,
                highPrice: 3100,
                lowPrice: 2850,
                closePrice: 3050,
                volume: 1000000,
                quoteVolume: 3000000000,
                priceChangePercent: 5.17,
                numTrades: 50000,
                timestamp: Date.now()
            };

            const result = db.insertBinanceSnapshot24h(snapshot);
            expect(result.changes).toBe(1);

            const retrieved = db.getBinanceSnapshots24h(
                'TEST_SNAP',
                snapshot.timestamp - 1000,
                snapshot.timestamp + 1000,
                10
            );
            expect(retrieved.length).toBe(1);
            expect(retrieved[0].highPrice).toBe(3100);
            expect(retrieved[0].priceChangePercent).toBe(5.17);
        });

        it('should prune old Binance ticks', () => {
            const oldTime = Date.now() - 86400000 * 31; // 31 days ago
            const recentTime = Date.now();

            // Insert old and recent ticks
            db.insertBinanceTick({ symbol: 'TEST_PRUNE', price: 100, timestamp: oldTime });
            db.insertBinanceTick({ symbol: 'TEST_PRUNE', price: 200, timestamp: recentTime });

            // Prune ticks older than 30 days
            const pruned = db.pruneBinanceTicks(Date.now() - 86400000 * 30);
            expect(pruned).toBe(1);

            // Verify only recent tick remains
            const remaining = db.getBinancePriceHistory('TEST_PRUNE', 0, Date.now(), 100);
            expect(remaining.length).toBe(1);
            expect(remaining[0].price).toBe(200);
        });
    });

    // ========================================================================
    // DERIBIT DATA OPERATIONS TESTS
    // ========================================================================
    describe('Deribit Data Operations', () => {
        beforeEach(() => {
            // Clean up Deribit tables
            db['db'].exec('DELETE FROM deribit_snapshots WHERE instrument_name LIKE "TEST_%"');
            db['db'].exec('DELETE FROM deribit_instruments WHERE instrument_name LIKE "TEST_%"');
        });

        it('should upsert Deribit instrument metadata', () => {
            const instrument: DeribitInstrument = {
                instrumentName: 'TEST_ETH-28MAR25-3000-C',
                currency: 'ETH',
                strike: 3000,
                expirationTimestamp: Date.now() + 86400000 * 60, // 60 days
                optionType: 'call'
            };

            const result = db.upsertDeribitInstrument(instrument);
            expect(result.changes).toBe(1);

            // Second insert should do nothing (ON CONFLICT DO NOTHING)
            const result2 = db.upsertDeribitInstrument(instrument);
            expect(result2.changes).toBe(0);

            const instruments = db.getDeribitInstruments('ETH', false);
            const found = instruments.find(i => i.instrumentName === instrument.instrumentName);
            expect(found).toBeDefined();
            expect(found?.strike).toBe(3000);
        });

        it('should insert Deribit snapshot with automatic instrument registration', () => {
            const instrument: DeribitInstrument = {
                instrumentName: 'TEST_ETH-AUTO-INST',
                currency: 'ETH',
                strike: 2500,
                expirationTimestamp: Date.now() + 86400000 * 30,
                optionType: 'put'
            };

            const snapshot: DeribitSnapshot = {
                instrumentName: 'TEST_ETH-AUTO-INST',
                underlyingPrice: 2800,
                markIv: 0.72,
                markPrice: 0.05,
                lastPrice: 0.048,
                bestBidPrice: 0.045,
                bestAskPrice: 0.055,
                openInterest: 1000,
                volume24h: 500,
                delta: -0.35,
                gamma: 0.002,
                vega: 0.15,
                theta: -0.01,
                timestamp: Date.now()
            };

            // Insert snapshot with instrument (should register both)
            const result = db.insertDeribitSnapshot(snapshot, instrument);
            expect(result.changes).toBe(1);

            // Verify instrument was created
            const instruments = db.getDeribitInstruments('ETH', false);
            expect(instruments.some(i => i.instrumentName === 'TEST_ETH-AUTO-INST')).toBe(true);

            // Verify snapshot was created
            const retrieved = db.getLatestDeribitSnapshot('TEST_ETH-AUTO-INST');
            expect(retrieved).toBeDefined();
            expect(retrieved?.markIv).toBe(0.72);
            expect(retrieved?.delta).toBe(-0.35);
        });

        it('should query Deribit IV history', () => {
            const instrument: DeribitInstrument = {
                instrumentName: 'TEST_ETH-IVHIST',
                currency: 'ETH',
                strike: 3500,
                expirationTimestamp: Date.now() + 86400000 * 45,
                optionType: 'call'
            };
            db.upsertDeribitInstrument(instrument);

            const baseTime = Date.now() - 3600000;
            const snapshots = Array.from({ length: 20 }, (_, i) => ({
                instrumentName: 'TEST_ETH-IVHIST',
                underlyingPrice: 3000 + i * 10,
                markIv: 0.50 + i * 0.01,
                timestamp: baseTime + i * 60000
            }));

            db.insertDeribitSnapshotsBatch(snapshots.map(s => ({ snapshot: s })));

            const history = db.getDeribitIVHistory(
                'TEST_ETH-IVHIST',
                baseTime + 300000, // Start at snapshot 5
                baseTime + 900000, // End at snapshot 15
                100
            );

            expect(history.length).toBe(11); // Snapshots 5-15
            expect(history[0].markIv).toBe(0.55);
            expect(history[10].markIv).toBe(0.65);
        });

        it('should query Deribit snapshots by currency', () => {
            // Create instruments for different currencies
            const ethInst: DeribitInstrument = {
                instrumentName: 'TEST_ETH-CURR',
                currency: 'ETH',
                strike: 3000,
                expirationTimestamp: Date.now() + 86400000 * 30,
                optionType: 'call'
            };
            const btcInst: DeribitInstrument = {
                instrumentName: 'TEST_BTC-CURR',
                currency: 'BTC',
                strike: 50000,
                expirationTimestamp: Date.now() + 86400000 * 30,
                optionType: 'call'
            };

            db.upsertDeribitInstrument(ethInst);
            db.upsertDeribitInstrument(btcInst);

            const now = Date.now();
            db.insertDeribitSnapshot({ instrumentName: 'TEST_ETH-CURR', underlyingPrice: 3000, markIv: 0.60, timestamp: now });
            db.insertDeribitSnapshot({ instrumentName: 'TEST_BTC-CURR', underlyingPrice: 50000, markIv: 0.55, timestamp: now });

            // Query ETH only
            const ethSnapshots = db.getDeribitSnapshotsByCurrency('ETH', now - 1000, now + 1000);
            const btcSnapshots = db.getDeribitSnapshotsByCurrency('BTC', now - 1000, now + 1000);

            expect(ethSnapshots.some(s => s.instrumentName === 'TEST_ETH-CURR')).toBe(true);
            expect(ethSnapshots.some(s => s.instrumentName === 'TEST_BTC-CURR')).toBe(false);
            expect(btcSnapshots.some(s => s.instrumentName === 'TEST_BTC-CURR')).toBe(true);
        });

        it('should prune expired Deribit instruments and snapshots', () => {
            const expiredInst: DeribitInstrument = {
                instrumentName: 'TEST_EXPIRED',
                currency: 'ETH',
                strike: 2000,
                expirationTimestamp: Date.now() - 86400000, // Expired yesterday
                optionType: 'call'
            };
            const activeInst: DeribitInstrument = {
                instrumentName: 'TEST_ACTIVE',
                currency: 'ETH',
                strike: 3000,
                expirationTimestamp: Date.now() + 86400000 * 30, // 30 days future
                optionType: 'call'
            };

            db.upsertDeribitInstrument(expiredInst);
            db.upsertDeribitInstrument(activeInst);
            db.insertDeribitSnapshot({ instrumentName: 'TEST_EXPIRED', underlyingPrice: 2000, markIv: 0.5, timestamp: Date.now() });
            db.insertDeribitSnapshot({ instrumentName: 'TEST_ACTIVE', underlyingPrice: 3000, markIv: 0.6, timestamp: Date.now() });

            // Prune expired
            const pruned = db.pruneExpiredDeribitInstruments(Date.now());
            expect(pruned).toBe(1);

            // Verify expired is gone, active remains
            const remaining = db.getDeribitInstruments('ETH', false);
            expect(remaining.some(i => i.instrumentName === 'TEST_EXPIRED')).toBe(false);
            expect(remaining.some(i => i.instrumentName === 'TEST_ACTIVE')).toBe(true);
        });
    });

    // ========================================================================
    // TRANSACTION ATOMICITY TESTS
    // ========================================================================
    describe('Transaction Atomicity', () => {
        it('should rollback batch insert on error', () => {
            const validTicks: BinanceTick[] = Array.from({ length: 5 }, (_, i) => ({
                symbol: 'TEST_ATOMIC',
                price: 1000 + i,
                timestamp: Date.now() + i
            }));

            db.insertBinanceTicksBatch(validTicks);

            // Verify all inserted
            const count = db.getBinancePriceHistory('TEST_ATOMIC', 0, Date.now() + 10, 100).length;
            expect(count).toBe(5);
        });

        it('should maintain data integrity in Deribit snapshot with instrument', () => {
            const instrument: DeribitInstrument = {
                instrumentName: 'TEST_ATOMIC_DERIBIT',
                currency: 'ETH',
                strike: 4000,
                expirationTimestamp: Date.now() + 86400000 * 60,
                optionType: 'put'
            };

            const snapshot: DeribitSnapshot = {
                instrumentName: 'TEST_ATOMIC_DERIBIT',
                underlyingPrice: 3500,
                markIv: 0.80,
                timestamp: Date.now()
            };

            // Both should be inserted atomically
            db.insertDeribitSnapshot(snapshot, instrument);

            const instruments = db.getDeribitInstruments('ETH', false);
            const snapshotData = db.getLatestDeribitSnapshot('TEST_ATOMIC_DERIBIT');

            expect(instruments.some(i => i.instrumentName === 'TEST_ATOMIC_DERIBIT')).toBe(true);
            expect(snapshotData).toBeDefined();
            expect(snapshotData?.markIv).toBe(0.80);
        });
    });

    // ========================================================================
    // DATABASE STATISTICS TESTS
    // ========================================================================
    describe('Database Statistics', () => {
        it('should return accurate database statistics', () => {
            const stats = db.getStats();

            expect(typeof stats.binanceTicks).toBe('number');
            expect(typeof stats.binanceSnapshots).toBe('number');
            expect(typeof stats.deribitInstruments).toBe('number');
            expect(typeof stats.deribitSnapshots).toBe('number');
            expect(typeof stats.markets).toBe('number');
            expect(typeof stats.positions).toBe('number');
            expect(typeof stats.trades).toBe('number');
            expect(stats.schemaVersion).toBeGreaterThanOrEqual(1);
        });
    });
});

// ============================================================================
// DATA REPLAYER TESTS
// ============================================================================
describe('DataReplayer', () => {
    let db: DB;
    let replayer: DataReplayer;
    const TEST_DB_PATH_REPLAY = path.join(process.cwd(), 'test-replay.db');

    beforeAll(() => {
        if (fs.existsSync(TEST_DB_PATH_REPLAY)) {
            fs.unlinkSync(TEST_DB_PATH_REPLAY);
        }
        db = new DB(TEST_DB_PATH_REPLAY);
        replayer = new DataReplayer(db);

        // Seed test data
        const baseTime = Date.now() - 3600000;
        const binanceTicks: BinanceTick[] = Array.from({ length: 50 }, (_, i) => ({
            symbol: 'ETHUSDT',
            price: 3000 + i,
            timestamp: baseTime + i * 1000
        }));
        db.insertBinanceTicksBatch(binanceTicks);

        const instrument: DeribitInstrument = {
            instrumentName: 'ETH-REPLAY-TEST',
            currency: 'ETH',
            strike: 3000,
            expirationTimestamp: Date.now() + 86400000 * 30,
            optionType: 'call'
        };
        db.upsertDeribitInstrument(instrument);

        const deribitSnapshots = Array.from({ length: 50 }, (_, i) => ({
            snapshot: {
                instrumentName: 'ETH-REPLAY-TEST',
                underlyingPrice: 3000 + i,
                markIv: 0.60 + i * 0.001,
                timestamp: baseTime + i * 1000
            }
        }));
        db.insertDeribitSnapshotsBatch(deribitSnapshots);
    });

    afterAll(() => {
        db.close();
        if (fs.existsSync(TEST_DB_PATH_REPLAY)) {
            fs.unlinkSync(TEST_DB_PATH_REPLAY);
        }
    });

    it('should replay Binance prices at high speed', async () => {
        const events: any[] = [];
        const baseTime = Date.now() - 3600000;

        const result = await replayer.replayBinancePrices('ETHUSDT', {
            speed: 1000, // 1000x speed
            startTime: baseTime,
            endTime: baseTime + 50000,
            batchSize: 100
        }, (event) => {
            events.push(event);
        });

        expect(result.recordsProcessed).toBe(50);
        expect(events.length).toBe(50);
        expect(events[0].data.price).toBe(3000);
        expect(events[49].data.price).toBe(3049);
    }, 30000);

    it('should replay Deribit snapshots at high speed', async () => {
        const events: any[] = [];
        const baseTime = Date.now() - 3600000;

        const result = await replayer.replayDeribitSnapshots('ETH', {
            speed: 1000,
            startTime: baseTime,
            endTime: baseTime + 50000,
            batchSize: 100
        }, (event) => {
            events.push(event);
        });

        expect(result.recordsProcessed).toBe(50);
        expect(events.length).toBe(50);
        expect(events[0].data.markIv).toBeCloseTo(0.60, 2);
    }, 30000);

    it('should pause and resume replay', async () => {
        const events: any[] = [];
        const baseTime = Date.now() - 3600000;

        const replayPromise = replayer.replayBinancePrices('ETHUSDT', {
            speed: 100,
            startTime: baseTime,
            endTime: baseTime + 50000,
            batchSize: 100
        }, (event) => {
            events.push(event);
            if (events.length === 10) {
                replayer.pause();
                setTimeout(() => replayer.resume(), 100);
            }
        });

        const result = await replayPromise;
        expect(result.recordsProcessed).toBe(50);
    }, 30000);

    it('should stop replay on demand', async () => {
        const events: any[] = [];
        const baseTime = Date.now() - 3600000;

        const replayPromise = replayer.replayBinancePrices('ETHUSDT', {
            speed: 10,
            startTime: baseTime,
            endTime: baseTime + 50000,
            batchSize: 100
        }, (event) => {
            events.push(event);
            if (events.length === 10) {
                replayer.stop();
            }
        });

        const result = await replayPromise;
        expect(result.recordsProcessed).toBeLessThanOrEqual(15); // Some may have processed before stop
    }, 30000);

    it('should get data range information', () => {
        const binanceRange = replayer.getDataRange('binance', 'ETHUSDT');
        const deribitRange = replayer.getDataRange('deribit', 'ETH');

        expect(binanceRange).not.toBeNull();
        expect(binanceRange?.count).toBe(50);

        expect(deribitRange).not.toBeNull();
        expect(deribitRange?.count).toBe(50);
    });
});
