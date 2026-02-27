/**
 * Test Migration Script
 *
 * Creates a sample v1 database, runs migration, and validates results.
 * Useful for testing migration logic without touching production data.
 *
 * Usage:
 *   npx tsx src/db/test_migration.ts
 */

import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { MigrationV1toV2 } from './migrate_v1_to_v2.js';
import { MigrationValidator } from './validate_migration.js';

// ============================================================================
// CONFIGURATION
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const TEST_DB_PATH = path.join(PROJECT_ROOT, 'PolyTrade.test.db');

// ============================================================================
// TEST DATABASE CREATOR
// ============================================================================

class TestDatabaseCreator {
    private db: Database.Database;
    private dbPath: string;

    constructor(dbPath: string) {
        this.dbPath = dbPath;

        // Remove existing test database
        if (fs.existsSync(dbPath)) {
            fs.unlinkSync(dbPath);
        }

        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');
    }

    /**
     * Create v1 schema with sample data
     */
    createV1Database(): void {
        console.log('Creating test v1 database...');

        // Create v1 tables
        this.db.exec(`
            CREATE TABLE markets (
                clob_token_id TEXT PRIMARY KEY,
                crypto TEXT,
                strike REAL,
                maturity INTEGER,
                question TEXT,
                condition_id TEXT,
                active INTEGER DEFAULT 1,
                last_updated TEXT,
                UNIQUE(crypto, strike, maturity)
            );

            CREATE INDEX idx_markets_crypto_maturity ON markets(crypto, maturity);

            CREATE TABLE positions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                clob_token_id TEXT UNIQUE,
                quantity REAL,
                average_price REAL,
                last_updated TEXT,
                FOREIGN KEY(clob_token_id) REFERENCES markets(clob_token_id)
            );

            CREATE TABLE trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                clob_token_id TEXT,
                side TEXT,
                quantity REAL,
                price REAL,
                timestamp TEXT,
                pnl REAL,
                trade_type TEXT,
                FOREIGN KEY(clob_token_id) REFERENCES markets(clob_token_id)
            );

            CREATE INDEX idx_trades_timestamp ON trades(timestamp);

            CREATE TABLE portfolio_greeks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT,
                delta REAL,
                gamma REAL,
                vega REAL,
                theta REAL,
                notional REAL,
                num_positions INTEGER
            );

            CREATE TABLE binance_ticks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol TEXT NOT NULL,
                price REAL NOT NULL,
                bid_price REAL,
                ask_price REAL,
                bid_qty REAL,
                ask_qty REAL,
                timestamp INTEGER NOT NULL
            );

            CREATE INDEX idx_binance_ticks_symbol_time ON binance_ticks(symbol, timestamp);

            CREATE TABLE deribit_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                instrument_name TEXT NOT NULL,
                underlying_price REAL NOT NULL,
                mark_iv REAL NOT NULL,
                mark_price REAL,
                last_price REAL,
                best_bid_price REAL,
                best_ask_price REAL,
                open_interest REAL,
                volume_24h REAL,
                delta REAL,
                gamma REAL,
                vega REAL,
                theta REAL,
                timestamp INTEGER NOT NULL
            );

            CREATE TABLE schema_version (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                version INTEGER NOT NULL,
                description TEXT,
                applied_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            INSERT INTO schema_version (version, description) VALUES (1, 'Initial v1 schema');
        `);

        // Insert sample data
        this.insertSampleData();

        console.log('✅ v1 database created with sample data');
    }

    /**
     * Insert sample data
     */
    private insertSampleData(): void {
        const now = new Date().toISOString();
        const nowMs = Date.now();

        // Insert markets
        const marketStmt = this.db.prepare(`
            INSERT INTO markets (clob_token_id, crypto, strike, maturity, question, condition_id, active, last_updated)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const markets = [
            {
                clobTokenId: '0xabc123',
                crypto: 'ETH',
                strike: 4000,
                maturity: nowMs + 86400000 * 30, // 30 days from now
                question: 'Will ETH be above $4000 on Feb 24, 2026?',
                conditionId: '0xcond1'
            },
            {
                clobTokenId: '0xdef456',
                crypto: 'BTC',
                strike: 100000,
                maturity: nowMs + 86400000 * 60, // 60 days from now
                question: 'Will BTC be above $100,000 on Mar 26, 2026?',
                conditionId: '0xcond2'
            },
            {
                clobTokenId: '0xghi789',
                crypto: 'ETH',
                strike: 3500,
                maturity: nowMs + 86400000 * 15, // 15 days from now
                question: 'Will ETH be above $3500 on Feb 9, 2026?',
                conditionId: '0xcond3'
            }
        ];

        for (const market of markets) {
            marketStmt.run(
                market.clobTokenId,
                market.crypto,
                market.strike,
                market.maturity,
                market.question,
                market.conditionId,
                1,
                now
            );
        }

        console.log(`  ✅ Inserted ${markets.length} markets`);

        // Insert positions
        const positionStmt = this.db.prepare(`
            INSERT INTO positions (clob_token_id, quantity, average_price, last_updated)
            VALUES (?, ?, ?, ?)
        `);

        const positions = [
            { clobTokenId: '0xabc123', quantity: 100, avgPrice: 0.65 },
            { clobTokenId: '0xdef456', quantity: 50, avgPrice: 0.45 }
        ];

        for (const pos of positions) {
            positionStmt.run(pos.clobTokenId, pos.quantity, pos.avgPrice, now);
        }

        console.log(`  ✅ Inserted ${positions.length} positions`);

        // Insert trades
        const tradeStmt = this.db.prepare(`
            INSERT INTO trades (clob_token_id, side, quantity, price, timestamp, pnl, trade_type)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        const trades = [
            { clobTokenId: '0xabc123', side: 'BUY', quantity: 50, price: 0.60, pnl: null, tradeType: 'MAKER' },
            { clobTokenId: '0xabc123', side: 'BUY', quantity: 50, price: 0.70, pnl: null, tradeType: 'TAKER' },
            { clobTokenId: '0xdef456', side: 'BUY', quantity: 50, price: 0.45, pnl: null, tradeType: 'MAKER' },
            { clobTokenId: '0xghi789', side: 'BUY', quantity: 100, price: 0.55, pnl: null, tradeType: 'MAKER' },
            { clobTokenId: '0xghi789', side: 'SELL', quantity: 100, price: 0.60, pnl: 5.0, tradeType: 'TAKER' }
        ];

        for (const trade of trades) {
            tradeStmt.run(trade.clobTokenId, trade.side, trade.quantity, trade.price, now, trade.pnl, trade.tradeType);
        }

        console.log(`  ✅ Inserted ${trades.length} trades`);

        // Insert portfolio Greeks
        const greeksStmt = this.db.prepare(`
            INSERT INTO portfolio_greeks (timestamp, delta, gamma, vega, theta, notional, num_positions)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        const greeks = [
            { timestamp: now, delta: 50.5, gamma: 0.5, vega: 10.2, theta: -2.5, notional: 10000, numPositions: 2 }
        ];

        for (const greek of greeks) {
            greeksStmt.run(greek.timestamp, greek.delta, greek.gamma, greek.vega, greek.theta, greek.notional, greek.numPositions);
        }

        console.log(`  ✅ Inserted ${greeks.length} portfolio Greek snapshots`);

        // Insert Binance ticks
        const binanceStmt = this.db.prepare(`
            INSERT INTO binance_ticks (symbol, price, bid_price, ask_price, bid_qty, ask_qty, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        for (let i = 0; i < 100; i++) {
            const price = 3500 + Math.random() * 100;
            binanceStmt.run('ETHUSDT', price, price - 0.5, price + 0.5, 10.5, 12.3, nowMs - i * 60000);
        }

        console.log(`  ✅ Inserted 100 Binance ticks`);

        // Insert Deribit snapshots
        const deribitStmt = this.db.prepare(`
            INSERT INTO deribit_snapshots (
                instrument_name, underlying_price, mark_iv, mark_price, last_price,
                best_bid_price, best_ask_price, open_interest, volume_24h,
                delta, gamma, vega, theta, timestamp
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (let i = 0; i < 50; i++) {
            deribitStmt.run(
                'ETH-28MAR26-4000-C',
                3500,
                0.65 + Math.random() * 0.1,
                250.5,
                248.0,
                245.0,
                252.0,
                1000,
                500,
                0.5,
                0.002,
                100,
                -50,
                nowMs - i * 300000
            );
        }

        console.log(`  ✅ Inserted 50 Deribit snapshots`);
    }

    close(): void {
        this.db.close();
    }
}

// ============================================================================
// MAIN TEST FUNCTION
// ============================================================================

async function main() {
    console.log('========================================');
    console.log('PolyTrade Migration Test');
    console.log('========================================\n');

    try {
        // Step 1: Create test v1 database
        console.log('STEP 1: Creating test v1 database...\n');
        const creator = new TestDatabaseCreator(TEST_DB_PATH);
        creator.createV1Database();
        creator.close();

        console.log('\nSTEP 2: Running migration...\n');

        // Step 2: Run migration
        const migration = new MigrationV1toV2(TEST_DB_PATH);
        await migration.migrate();
        migration.close();

        console.log('\nSTEP 3: Validating migration...\n');

        // Step 3: Validate migration
        const validator = new MigrationValidator(TEST_DB_PATH);
        const summary = await validator.validate();
        validator.close();

        console.log('\n========================================');
        console.log('TEST SUMMARY');
        console.log('========================================');
        console.log(`Total Checks: ${summary.totalChecks}`);
        console.log(`Passed: ${summary.passed}`);
        console.log(`Failed: ${summary.failed}`);
        console.log(`Warnings: ${summary.warnings}`);
        console.log('========================================\n');

        if (summary.failed === 0) {
            console.log('✅ MIGRATION TEST PASSED!');
            console.log(`Test database available at: ${TEST_DB_PATH}\n`);
            console.log('You can inspect it with:');
            console.log(`  sqlite3 ${TEST_DB_PATH}`);
            console.log('');
            process.exit(0);
        } else {
            console.error('❌ MIGRATION TEST FAILED!');
            console.error('Please review the errors above.\n');
            process.exit(1);
        }

    } catch (error) {
        console.error('Test failed:', error);
        process.exit(1);
    }
}

// Run test if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}
