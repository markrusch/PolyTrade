import Database from 'better-sqlite3';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Logger } from '../lib/logger/index.js';

// Compute absolute default path for PolyTrade.db (relative to project root)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_DB_PATH = process.env.DB_PATH || path.join(PROJECT_ROOT, 'PolyTrade.db');

// ============================================================================
// INTERFACES - Core Trading Data Types
// ============================================================================

export interface Market {
    clobTokenId: string;
    crypto: string;
    strike: number;
    maturity: number; // timestamp
    question: string;
    conditionId: string;
    active: number; // 0 or 1
    lastUpdated: string;
}

export interface Position {
    clobTokenId: string;
    quantity: number;
    averagePrice: number;
    lastUpdated: string;
}

export interface Trade {
    id?: number;
    clobTokenId: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    price: number;
    timestamp: string;
    pnl?: number;
    tradeType: 'MAKER' | 'TAKER' | 'HEDGE';
}

export interface PortfolioGreeks {
    id?: number;
    timestamp: string;
    delta: number;
    gamma: number;
    vega: number;
    theta: number;
    notional: number;
    numPositions: number;
}

// ============================================================================
// INTERFACES - Binance Data Types (SQL Injection Safe)
// ============================================================================

export interface BinanceTick {
    id?: number;
    symbol: string;        // e.g., "ETHUSDT", "BTCUSDT"
    price: number;
    bidPrice?: number;
    askPrice?: number;
    bidQty?: number;
    askQty?: number;
    timestamp: number;     // Unix milliseconds
}

export interface BinanceSnapshot24h {
    id?: number;
    symbol: string;
    openPrice: number;
    highPrice: number;
    lowPrice: number;
    closePrice: number;
    volume: number;
    quoteVolume: number;
    priceChangePercent: number;
    numTrades: number;
    timestamp: number;     // Unix milliseconds
}

// ============================================================================
// INTERFACES - Deribit Data Types (SQL Injection Safe)
// ============================================================================

export interface DeribitInstrument {
    id?: number;
    instrumentName: string;  // e.g., "ETH-28MAR25-3000-C"
    currency: string;        // "ETH", "BTC"
    strike: number;
    expirationTimestamp: number;  // Unix milliseconds
    optionType: 'call' | 'put';
    createdAt?: string;
}

export interface DeribitSnapshot {
    id?: number;
    instrumentName: string;
    underlyingPrice: number;
    markIv: number;          // Implied volatility (decimal, 0.65 = 65%)
    markPrice?: number;
    lastPrice?: number;
    bestBidPrice?: number;
    bestAskPrice?: number;
    openInterest?: number;
    volume24h?: number;
    delta?: number;
    gamma?: number;
    vega?: number;
    theta?: number;
    timestamp: number;       // Unix milliseconds
}

// ============================================================================
// BATCH WRITER - Performance optimization for high-frequency writes
// ============================================================================

class BatchWriter {
    private binanceBatch: BinanceTick[] = [];
    private deribitBatch: Array<{ snapshot: DeribitSnapshot; instrument?: DeribitInstrument }> = [];
    private flushInterval: NodeJS.Timeout;
    private readonly BATCH_SIZE = 10;      // Flush every 10 items
    private readonly FLUSH_INTERVAL_MS = 100;  // Or 100ms (user choice: low tolerance)
    private isFlushing = false;

    constructor(private db: DB) {
        this.flushInterval = setInterval(() => this.flush(), this.FLUSH_INTERVAL_MS);

        // Flush on shutdown
        process.on('SIGTERM', () => this.flush());
        process.on('SIGINT', () => this.flush());
    }

    addBinanceTick(tick: BinanceTick): void {
        this.binanceBatch.push(tick);
        if (this.binanceBatch.length >= this.BATCH_SIZE) {
            this.flushBinance();
        }
    }

    addDeribitSnapshot(snapshot: DeribitSnapshot, instrument?: DeribitInstrument): void {
        this.deribitBatch.push({ snapshot, instrument });
        if (this.deribitBatch.length >= this.BATCH_SIZE) {
            this.flushDeribit();
        }
    }

    private flushBinance(): void {
        if (this.binanceBatch.length === 0) return;
        try {
            this.db.insertBinanceTicksBatch(this.binanceBatch);
            this.binanceBatch = [];
        } catch (error) {
            console.error('Batch flush failed:', error);
        }
    }

    private flushDeribit(): void {
        if (this.deribitBatch.length === 0) return;
        try {
            // Use transaction for batch insert
            const tx = this.db.getDb().transaction(() => {
                for (const item of this.deribitBatch) {
                    this.db.insertDeribitSnapshotDirect(item.snapshot, item.instrument);
                }
            });
            tx();
            this.deribitBatch = [];
        } catch (error) {
            console.error('Deribit batch flush failed:', error);
        }
    }

    flush(): void {
        if (this.isFlushing) return;
        this.isFlushing = true;
        try {
            this.flushBinance();
            this.flushDeribit();
        } finally {
            this.isFlushing = false;
        }
    }

    destroy(): void {
        clearInterval(this.flushInterval);
        this.flush();
    }
}

// ============================================================================
// DATABASE CLASS - PolyTrade.db
// ============================================================================

export class DB extends EventEmitter {
    private db: Database.Database;
    private logger: Logger;
    private dbPath: string;
    private batchWriter: BatchWriter;

    /**
     * Initialize database connection
     * @param dbPath Path to SQLite database file (default: PROJECT_ROOT/PolyTrade.db or DB_PATH env var)
     */
    constructor(dbPath: string = DEFAULT_DB_PATH) {
        super();
        this.logger = new Logger({ level: 'info', service: 'database' });
        this.dbPath = path.resolve(dbPath); // Ensure absolute path
        this.logger.info(`Database path: ${this.dbPath}`);
        this.db = new Database(this.dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
        this.db.pragma('busy_timeout = 5000');

        // Checkpoint WAL on startup to reclaim disk space
        try {
            this.db.pragma('wal_checkpoint(TRUNCATE)');
            this.logger.info('WAL checkpoint completed on startup');
        } catch (e) {
            this.logger.warn(`WAL checkpoint failed on startup: ${e}`);
        }

        this.initialize();
        this.batchWriter = new BatchWriter(this);
    }

    /**
     * Get the absolute path to the database file
     */
    getDbPath(): string {
        return this.dbPath;
    }

    /**
     * Get the underlying database object (for BatchWriter)
     */
    getDb(): Database.Database {
        return this.db;
    }

    /**
     * Cleanup method to destroy batch writer
     */
    destroy(): void {
        this.batchWriter.destroy();
    }

    private initialize() {
        // ========================================================================
        // SCHEMA: Core Trading Tables
        // ========================================================================
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS markets (
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

      CREATE INDEX IF NOT EXISTS idx_markets_crypto_maturity ON markets(crypto, maturity);
      CREATE INDEX IF NOT EXISTS idx_markets_strike ON markets(strike);

      CREATE TABLE IF NOT EXISTS positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        clob_token_id TEXT UNIQUE,
        quantity REAL,
        average_price REAL,
        last_updated TEXT,
        FOREIGN KEY(clob_token_id) REFERENCES markets(clob_token_id)
      );

      CREATE TABLE IF NOT EXISTS trades (
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

      CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);
      CREATE INDEX IF NOT EXISTS idx_trades_token ON trades(clob_token_id);

      CREATE TABLE IF NOT EXISTS portfolio_greeks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT,
        delta REAL,
        gamma REAL,
        vega REAL,
        theta REAL,
        notional REAL,
        num_positions INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_greeks_timestamp ON portfolio_greeks(timestamp);
    `);

        // ========================================================================
        // SCHEMA: Binance Market Data Tables
        // ========================================================================
        this.db.exec(`
      -- Binance tick-level price data (high frequency)
      CREATE TABLE IF NOT EXISTS binance_ticks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        price REAL NOT NULL,
        bid_price REAL,
        ask_price REAL,
        bid_qty REAL,
        ask_qty REAL,
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_binance_ticks_symbol_time ON binance_ticks(symbol, timestamp);
      CREATE INDEX IF NOT EXISTS idx_binance_ticks_time ON binance_ticks(timestamp);

      -- Binance 24-hour snapshots (hourly aggregates)
      CREATE TABLE IF NOT EXISTS binance_snapshots_24h (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        open_price REAL,
        high_price REAL,
        low_price REAL,
        close_price REAL,
        volume REAL,
        quote_volume REAL,
        price_change_percent REAL,
        num_trades INTEGER,
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_binance_snapshots_symbol_time ON binance_snapshots_24h(symbol, timestamp);
      CREATE INDEX IF NOT EXISTS idx_binance_snapshots_time ON binance_snapshots_24h(timestamp);
    `);

        // ========================================================================
        // SCHEMA: Deribit Options Data Tables
        // ========================================================================
        this.db.exec(`
      -- Deribit instrument metadata (static, rarely changes)
      CREATE TABLE IF NOT EXISTS deribit_instruments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instrument_name TEXT UNIQUE NOT NULL,
        currency TEXT NOT NULL,
        strike REAL NOT NULL,
        expiration_timestamp INTEGER NOT NULL,
        option_type TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_deribit_inst_currency_expiry ON deribit_instruments(currency, expiration_timestamp);
      CREATE INDEX IF NOT EXISTS idx_deribit_inst_name ON deribit_instruments(instrument_name);

      -- Deribit IV and pricing snapshots (time-series)
      CREATE TABLE IF NOT EXISTS deribit_snapshots (
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
        timestamp INTEGER NOT NULL,
        FOREIGN KEY(instrument_name) REFERENCES deribit_instruments(instrument_name)
      );

      CREATE INDEX IF NOT EXISTS idx_deribit_snap_name_time ON deribit_snapshots(instrument_name, timestamp);
      CREATE INDEX IF NOT EXISTS idx_deribit_snap_time ON deribit_snapshots(timestamp);
    `);

        // ========================================================================
        // SCHEMA: Schema Version Tracking
        // ========================================================================
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version INTEGER NOT NULL,
        description TEXT,
        applied_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

        // Record current schema version if not exists
        const currentVersion = this.db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number | null };
        if (!currentVersion?.v) {
            this.db.prepare(`
                INSERT INTO schema_version (version, description) VALUES (?, ?)
            `).run(1, 'Initial schema with Binance/Deribit tables');
        }

        this.logger.info('Database initialized (PolyTrade.db with Binance/Deribit tables)');
    }

    // --- Markets ---

    upsertMarket(market: Market) {
        const stmt = this.db.prepare(`
      INSERT INTO markets (clob_token_id, crypto, strike, maturity, question, condition_id, active, last_updated)
      VALUES (@clobTokenId, @crypto, @strike, @maturity, @question, @conditionId, @active, @lastUpdated)
      ON CONFLICT(clob_token_id) DO UPDATE SET
        active = @active,
        last_updated = @lastUpdated
    `);
        return stmt.run({ ...market, lastUpdated: new Date().toISOString() });
    }

    getMarkets(activeOnly: boolean = true): Market[] {
        const sql = `SELECT 
      clob_token_id as clobTokenId,
      crypto,
      strike,
      maturity,
      question,
      condition_id as conditionId,
      active,
      last_updated as lastUpdated
     FROM markets` + (activeOnly ? ' WHERE active = 1' : '');
        return this.db.prepare(sql).all() as Market[];
    }

    getMarket(clobTokenId: string): Market | undefined {
        return this.db.prepare(`
      SELECT 
        clob_token_id as clobTokenId,
        crypto,
        strike,
        maturity,
        question,
        condition_id as conditionId,
        active,
        last_updated as lastUpdated
      FROM markets WHERE clob_token_id = ?
    `).get(clobTokenId) as Market | undefined;
    }

    // --- Positions ---

    updatePosition(clobTokenId: string, quantityChange: number, price: number) {
        const tx = this.db.transaction(() => {
            const existing = this.db.prepare(`
        SELECT quantity, average_price FROM positions WHERE clob_token_id = ?
      `).get(clobTokenId) as { quantity: number, average_price: number } | undefined;

            let newQuantity = quantityChange;
            let newAvgPrice = price;

            if (existing) {
                newQuantity = existing.quantity + quantityChange;

                // Only update avg price if increasing position size (weighted average)
                // If reducing position, avg price remains same
                if (Math.abs(newQuantity) > Math.abs(existing.quantity)) {
                    // Basic weighted average for simplicity. 
                    // In reality slightly more complex for long/short flips.
                    // For this impl: simplified PnL tracking
                    const totalCost = (existing.quantity * existing.average_price) + (quantityChange * price);
                    newAvgPrice = totalCost / newQuantity;
                } else {
                    newAvgPrice = existing.average_price;
                }
            }

            if (Math.abs(newQuantity) < 1e-6) {
                this.db.prepare('DELETE FROM positions WHERE clob_token_id = ?').run(clobTokenId);
            } else {
                this.db.prepare(`
          INSERT INTO positions (clob_token_id, quantity, average_price, last_updated)
          VALUES (@clobTokenId, @quantity, @avgPrice, @lastUpdated)
          ON CONFLICT(clob_token_id) DO UPDATE SET
            quantity = @quantity,
            average_price = @avgPrice,
            last_updated = @lastUpdated
        `).run({
                    clobTokenId,
                    quantity: newQuantity,
                    avgPrice: Math.abs(newAvgPrice), // Store unsigned price
                    lastUpdated: new Date().toISOString()
                });
            }
        });

        tx();
    }

    getPositions(): Position[] {
        return this.db.prepare(`
      SELECT 
        clob_token_id as clobTokenId,
        quantity,
        average_price as averagePrice,
        last_updated as lastUpdated
      FROM positions
    `).all() as Position[];
    }

    // --- Trades ---

    recordTrade(trade: Trade) {
        this.db.prepare(`
      INSERT INTO trades (clob_token_id, side, quantity, price, timestamp, pnl, trade_type)
      VALUES (@clobTokenId, @side, @quantity, @price, @timestamp, @pnl, @tradeType)
    `).run({
            ...trade,
            timestamp: trade.timestamp || new Date().toISOString()
        });
    }

    getTrades(limit: number = 100): Trade[] {
        return this.db.prepare(`
      SELECT 
        id,
        clob_token_id as clobTokenId,
        side,
        quantity,
        price,
        timestamp,
        pnl,
        trade_type as tradeType
      FROM trades
      ORDER BY id DESC
      LIMIT ?
    `).all(limit) as Trade[];
    }

    // --- Portfolio Greeks ---

    recordGreeks(greeks: PortfolioGreeks) {
        this.db.prepare(`
      INSERT INTO portfolio_greeks (timestamp, delta, gamma, vega, theta, notional, num_positions)
      VALUES (@timestamp, @delta, @gamma, @vega, @theta, @notional, @numPositions)
    `).run({
            ...greeks,
            timestamp: greeks.timestamp || new Date().toISOString()
        });
    }

    getLatestGreeks(): PortfolioGreeks | undefined {
        return this.db.prepare(`
          SELECT 
            timestamp, delta, gamma, vega, theta, notional, num_positions as numPositions
          FROM portfolio_greeks
          ORDER BY id DESC
          LIMIT 1
      `).get() as PortfolioGreeks | undefined;
    }

    // ========================================================================
    // BINANCE DATA ACCESS - All Parameterized (SQL Injection Safe)
    // ========================================================================

    /**
     * Insert a Binance price tick (batched for performance)
     * Uses parameterized query to prevent SQL injection
     */
    insertBinanceTick(tick: BinanceTick): void {
        this.batchWriter.addBinanceTick(tick);
    }

    /**
     * Insert a Binance price tick directly (synchronous, for batch writer internal use)
     */
    insertBinanceTickDirect(tick: BinanceTick): Database.RunResult {
        const stmt = this.db.prepare(`
            INSERT INTO binance_ticks (symbol, price, bid_price, ask_price, bid_qty, ask_qty, timestamp)
            VALUES (@symbol, @price, @bidPrice, @askPrice, @bidQty, @askQty, @timestamp)
        `);
        return stmt.run({
            symbol: tick.symbol,
            price: tick.price,
            bidPrice: tick.bidPrice ?? null,
            askPrice: tick.askPrice ?? null,
            bidQty: tick.bidQty ?? null,
            askQty: tick.askQty ?? null,
            timestamp: tick.timestamp
        });
    }

    /**
     * Insert multiple Binance ticks in a transaction
     */
    insertBinanceTicksBatch(ticks: BinanceTick[]): void {
        const stmt = this.db.prepare(`
            INSERT INTO binance_ticks (symbol, price, bid_price, ask_price, bid_qty, ask_qty, timestamp)
            VALUES (@symbol, @price, @bidPrice, @askPrice, @bidQty, @askQty, @timestamp)
        `);

        const insertMany = this.db.transaction((items: BinanceTick[]) => {
            for (const tick of items) {
                stmt.run({
                    symbol: tick.symbol,
                    price: tick.price,
                    bidPrice: tick.bidPrice ?? null,
                    askPrice: tick.askPrice ?? null,
                    bidQty: tick.bidQty ?? null,
                    askQty: tick.askQty ?? null,
                    timestamp: tick.timestamp
                });
            }
        });

        insertMany(ticks);
    }

    /**
     * Insert a Binance 24h snapshot
     */
    insertBinanceSnapshot24h(snapshot: BinanceSnapshot24h): Database.RunResult {
        const stmt = this.db.prepare(`
            INSERT INTO binance_snapshots_24h (
                symbol, open_price, high_price, low_price, close_price, 
                volume, quote_volume, price_change_percent, num_trades, timestamp
            )
            VALUES (
                @symbol, @openPrice, @highPrice, @lowPrice, @closePrice,
                @volume, @quoteVolume, @priceChangePercent, @numTrades, @timestamp
            )
        `);
        return stmt.run({
            symbol: snapshot.symbol,
            openPrice: snapshot.openPrice,
            highPrice: snapshot.highPrice,
            lowPrice: snapshot.lowPrice,
            closePrice: snapshot.closePrice,
            volume: snapshot.volume,
            quoteVolume: snapshot.quoteVolume,
            priceChangePercent: snapshot.priceChangePercent,
            numTrades: snapshot.numTrades,
            timestamp: snapshot.timestamp
        });
    }

    /**
     * Get Binance price history for a symbol within time range
     * @param symbol Trading pair (e.g., "ETHUSDT")
     * @param startTime Unix timestamp (ms) - start of range
     * @param endTime Unix timestamp (ms) - end of range
     * @param limit Maximum records to return (default 1000)
     */
    getBinancePriceHistory(symbol: string, startTime: number, endTime: number, limit: number = 1000): BinanceTick[] {
        return this.db.prepare(`
            SELECT 
                id, symbol, price, 
                bid_price as bidPrice, ask_price as askPrice,
                bid_qty as bidQty, ask_qty as askQty,
                timestamp
            FROM binance_ticks
            WHERE symbol = ? AND timestamp >= ? AND timestamp <= ?
            ORDER BY timestamp ASC
            LIMIT ?
        `).all(symbol, startTime, endTime, limit) as BinanceTick[];
    }

    /**
     * Get latest Binance price for a symbol
     */
    getLatestBinancePrice(symbol: string): BinanceTick | undefined {
        return this.db.prepare(`
            SELECT 
                id, symbol, price, 
                bid_price as bidPrice, ask_price as askPrice,
                bid_qty as bidQty, ask_qty as askQty,
                timestamp
            FROM binance_ticks
            WHERE symbol = ?
            ORDER BY timestamp DESC
            LIMIT 1
        `).get(symbol) as BinanceTick | undefined;
    }

    /**
     * Get Binance 24h snapshots history
     */
    getBinanceSnapshots24h(symbol: string, startTime: number, endTime: number, limit: number = 100): BinanceSnapshot24h[] {
        return this.db.prepare(`
            SELECT 
                id, symbol, 
                open_price as openPrice, high_price as highPrice,
                low_price as lowPrice, close_price as closePrice,
                volume, quote_volume as quoteVolume,
                price_change_percent as priceChangePercent,
                num_trades as numTrades, timestamp
            FROM binance_snapshots_24h
            WHERE symbol = ? AND timestamp >= ? AND timestamp <= ?
            ORDER BY timestamp ASC
            LIMIT ?
        `).all(symbol, startTime, endTime, limit) as BinanceSnapshot24h[];
    }

    /**
     * Prune old Binance ticks (retention management)
     * @param olderThan Unix timestamp (ms) - delete records older than this
     */
    pruneBinanceTicks(olderThan: number): number {
        const result = this.db.prepare(`
            DELETE FROM binance_ticks WHERE timestamp < ?
        `).run(olderThan);
        this.logger.info(`Pruned ${result.changes} Binance ticks older than ${new Date(olderThan).toISOString()}`);
        return result.changes;
    }

    /**
     * Prune old Binance 24h snapshots
     */
    pruneBinanceSnapshots24h(olderThan: number): number {
        const result = this.db.prepare(`
            DELETE FROM binance_snapshots_24h WHERE timestamp < ?
        `).run(olderThan);
        this.logger.info(`Pruned ${result.changes} Binance snapshots older than ${new Date(olderThan).toISOString()}`);
        return result.changes;
    }

    // ========================================================================
    // DERIBIT DATA ACCESS - All Parameterized (SQL Injection Safe)
    // ========================================================================

    /**
     * Upsert a Deribit instrument (metadata)
     * Creates if not exists, updates nothing on conflict (static data)
     */
    upsertDeribitInstrument(instrument: DeribitInstrument): Database.RunResult {
        const stmt = this.db.prepare(`
            INSERT INTO deribit_instruments (instrument_name, currency, strike, expiration_timestamp, option_type)
            VALUES (@instrumentName, @currency, @strike, @expirationTimestamp, @optionType)
            ON CONFLICT(instrument_name) DO NOTHING
        `);
        return stmt.run({
            instrumentName: instrument.instrumentName,
            currency: instrument.currency,
            strike: instrument.strike,
            expirationTimestamp: instrument.expirationTimestamp,
            optionType: instrument.optionType
        });
    }

    /**
     * Insert a Deribit snapshot with automatic instrument registration (batched)
     * Uses transaction to ensure atomicity
     */
    insertDeribitSnapshot(snapshot: DeribitSnapshot, instrument?: DeribitInstrument): void {
        this.batchWriter.addDeribitSnapshot(snapshot, instrument);
    }

    /**
     * Insert a Deribit snapshot directly (synchronous, for batch writer internal use)
     * Uses transaction to ensure atomicity
     */
    insertDeribitSnapshotDirect(snapshot: DeribitSnapshot, instrument?: DeribitInstrument): Database.RunResult {
        const tx = this.db.transaction(() => {
            // Register instrument if provided (upsert)
            if (instrument) {
                this.upsertDeribitInstrument(instrument);
            }

            // Insert snapshot
            const stmt = this.db.prepare(`
                INSERT INTO deribit_snapshots (
                    instrument_name, underlying_price, mark_iv, mark_price, last_price,
                    best_bid_price, best_ask_price, open_interest, volume_24h,
                    delta, gamma, vega, theta, timestamp
                )
                VALUES (
                    @instrumentName, @underlyingPrice, @markIv, @markPrice, @lastPrice,
                    @bestBidPrice, @bestAskPrice, @openInterest, @volume24h,
                    @delta, @gamma, @vega, @theta, @timestamp
                )
            `);
            return stmt.run({
                instrumentName: snapshot.instrumentName,
                underlyingPrice: snapshot.underlyingPrice,
                markIv: snapshot.markIv,
                markPrice: snapshot.markPrice ?? null,
                lastPrice: snapshot.lastPrice ?? null,
                bestBidPrice: snapshot.bestBidPrice ?? null,
                bestAskPrice: snapshot.bestAskPrice ?? null,
                openInterest: snapshot.openInterest ?? null,
                volume24h: snapshot.volume24h ?? null,
                delta: snapshot.delta ?? null,
                gamma: snapshot.gamma ?? null,
                vega: snapshot.vega ?? null,
                theta: snapshot.theta ?? null,
                timestamp: snapshot.timestamp
            });
        });

        return tx();
    }

    /**
     * Insert multiple Deribit snapshots in a transaction
     */
    insertDeribitSnapshotsBatch(snapshots: { snapshot: DeribitSnapshot; instrument?: DeribitInstrument }[]): void {
        const instrumentStmt = this.db.prepare(`
            INSERT INTO deribit_instruments (instrument_name, currency, strike, expiration_timestamp, option_type)
            VALUES (@instrumentName, @currency, @strike, @expirationTimestamp, @optionType)
            ON CONFLICT(instrument_name) DO NOTHING
        `);

        const snapshotStmt = this.db.prepare(`
            INSERT INTO deribit_snapshots (
                instrument_name, underlying_price, mark_iv, mark_price, last_price,
                best_bid_price, best_ask_price, open_interest, volume_24h,
                delta, gamma, vega, theta, timestamp
            )
            VALUES (
                @instrumentName, @underlyingPrice, @markIv, @markPrice, @lastPrice,
                @bestBidPrice, @bestAskPrice, @openInterest, @volume24h,
                @delta, @gamma, @vega, @theta, @timestamp
            )
        `);

        const insertMany = this.db.transaction((items: { snapshot: DeribitSnapshot; instrument?: DeribitInstrument }[]) => {
            for (const { snapshot, instrument } of items) {
                if (instrument) {
                    instrumentStmt.run({
                        instrumentName: instrument.instrumentName,
                        currency: instrument.currency,
                        strike: instrument.strike,
                        expirationTimestamp: instrument.expirationTimestamp,
                        optionType: instrument.optionType
                    });
                }
                snapshotStmt.run({
                    instrumentName: snapshot.instrumentName,
                    underlyingPrice: snapshot.underlyingPrice,
                    markIv: snapshot.markIv,
                    markPrice: snapshot.markPrice ?? null,
                    lastPrice: snapshot.lastPrice ?? null,
                    bestBidPrice: snapshot.bestBidPrice ?? null,
                    bestAskPrice: snapshot.bestAskPrice ?? null,
                    openInterest: snapshot.openInterest ?? null,
                    volume24h: snapshot.volume24h ?? null,
                    delta: snapshot.delta ?? null,
                    gamma: snapshot.gamma ?? null,
                    vega: snapshot.vega ?? null,
                    theta: snapshot.theta ?? null,
                    timestamp: snapshot.timestamp
                });
            }
        });

        insertMany(snapshots);
    }

    /**
     * Get Deribit IV history for an instrument within time range
     */
    getDeribitIVHistory(instrumentName: string, startTime: number, endTime: number, limit: number = 1000): DeribitSnapshot[] {
        return this.db.prepare(`
            SELECT 
                id, instrument_name as instrumentName, underlying_price as underlyingPrice,
                mark_iv as markIv, mark_price as markPrice, last_price as lastPrice,
                best_bid_price as bestBidPrice, best_ask_price as bestAskPrice,
                open_interest as openInterest, volume_24h as volume24h,
                delta, gamma, vega, theta, timestamp
            FROM deribit_snapshots
            WHERE instrument_name = ? AND timestamp >= ? AND timestamp <= ?
            ORDER BY timestamp ASC
            LIMIT ?
        `).all(instrumentName, startTime, endTime, limit) as DeribitSnapshot[];
    }

    /**
     * Get Deribit snapshots by currency and expiry range
     */
    getDeribitSnapshotsByCurrency(
        currency: string, 
        startTime: number, 
        endTime: number, 
        expiryAfter?: number,
        limit: number = 1000
    ): DeribitSnapshot[] {
        let sql = `
            SELECT 
                s.id, s.instrument_name as instrumentName, s.underlying_price as underlyingPrice,
                s.mark_iv as markIv, s.mark_price as markPrice, s.last_price as lastPrice,
                s.best_bid_price as bestBidPrice, s.best_ask_price as bestAskPrice,
                s.open_interest as openInterest, s.volume_24h as volume24h,
                s.delta, s.gamma, s.vega, s.theta, s.timestamp
            FROM deribit_snapshots s
            JOIN deribit_instruments i ON s.instrument_name = i.instrument_name
            WHERE i.currency = ? AND s.timestamp >= ? AND s.timestamp <= ?
        `;
        const params: (string | number)[] = [currency, startTime, endTime];

        if (expiryAfter !== undefined) {
            sql += ' AND i.expiration_timestamp > ?';
            params.push(expiryAfter);
        }

        sql += ' ORDER BY s.timestamp ASC LIMIT ?';
        params.push(limit);

        return this.db.prepare(sql).all(...params) as DeribitSnapshot[];
    }

    /**
     * Get latest Deribit snapshot for an instrument
     */
    getLatestDeribitSnapshot(instrumentName: string): DeribitSnapshot | undefined {
        return this.db.prepare(`
            SELECT 
                id, instrument_name as instrumentName, underlying_price as underlyingPrice,
                mark_iv as markIv, mark_price as markPrice, last_price as lastPrice,
                best_bid_price as bestBidPrice, best_ask_price as bestAskPrice,
                open_interest as openInterest, volume_24h as volume24h,
                delta, gamma, vega, theta, timestamp
            FROM deribit_snapshots
            WHERE instrument_name = ?
            ORDER BY timestamp DESC
            LIMIT 1
        `).get(instrumentName) as DeribitSnapshot | undefined;
    }

    /**
     * Get all Deribit instruments for a currency
     */
    getDeribitInstruments(currency: string, activeOnly: boolean = true): DeribitInstrument[] {
        let sql = `
            SELECT 
                id, instrument_name as instrumentName, currency, strike,
                expiration_timestamp as expirationTimestamp, option_type as optionType,
                created_at as createdAt
            FROM deribit_instruments
            WHERE currency = ?
        `;

        if (activeOnly) {
            sql += ' AND expiration_timestamp > ?';
            return this.db.prepare(sql).all(currency, Date.now()) as DeribitInstrument[];
        }

        return this.db.prepare(sql).all(currency) as DeribitInstrument[];
    }

    /**
     * Prune old Deribit snapshots (retention management)
     */
    pruneDeribitSnapshots(olderThan: number): number {
        const result = this.db.prepare(`
            DELETE FROM deribit_snapshots WHERE timestamp < ?
        `).run(olderThan);
        this.logger.info(`Pruned ${result.changes} Deribit snapshots older than ${new Date(olderThan).toISOString()}`);
        return result.changes;
    }

    /**
     * Prune expired Deribit instruments and their snapshots
     */
    pruneExpiredDeribitInstruments(expiredBefore: number): number {
        const tx = this.db.transaction(() => {
            // First delete snapshots for expired instruments
            const snapshotResult = this.db.prepare(`
                DELETE FROM deribit_snapshots 
                WHERE instrument_name IN (
                    SELECT instrument_name FROM deribit_instruments 
                    WHERE expiration_timestamp < ?
                )
            `).run(expiredBefore);

            // Then delete the instruments
            const instrumentResult = this.db.prepare(`
                DELETE FROM deribit_instruments WHERE expiration_timestamp < ?
            `).run(expiredBefore);

            this.logger.info(`Pruned ${instrumentResult.changes} expired instruments and ${snapshotResult.changes} snapshots`);
            return instrumentResult.changes;
        });

        return tx();
    }

    // ========================================================================
    // STATISTICS & MAINTENANCE
    // ========================================================================

    /**
     * Get database statistics
     */
    getStats(): {
        binanceTicks: number;
        binanceSnapshots: number;
        deribitInstruments: number;
        deribitSnapshots: number;
        markets: number;
        positions: number;
        trades: number;
        schemaVersion: number;
    } {
        const binanceTicks = (this.db.prepare('SELECT COUNT(*) as c FROM binance_ticks').get() as { c: number }).c;
        const binanceSnapshots = (this.db.prepare('SELECT COUNT(*) as c FROM binance_snapshots_24h').get() as { c: number }).c;
        const deribitInstruments = (this.db.prepare('SELECT COUNT(*) as c FROM deribit_instruments').get() as { c: number }).c;
        const deribitSnapshots = (this.db.prepare('SELECT COUNT(*) as c FROM deribit_snapshots').get() as { c: number }).c;
        const markets = (this.db.prepare('SELECT COUNT(*) as c FROM markets').get() as { c: number }).c;
        const positions = (this.db.prepare('SELECT COUNT(*) as c FROM positions').get() as { c: number }).c;
        const trades = (this.db.prepare('SELECT COUNT(*) as c FROM trades').get() as { c: number }).c;
        const schemaVersion = (this.db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number }).v;

        return {
            binanceTicks,
            binanceSnapshots,
            deribitInstruments,
            deribitSnapshots,
            markets,
            positions,
            trades,
            schemaVersion
        };
    }

    /**
     * Get total database size on disk (main file + WAL + SHM)
     */
    getTotalSizeBytes(): number {
        let total = 0;
        for (const suffix of ['', '-wal', '-shm']) {
            try {
                const stat = fs.statSync(this.dbPath + suffix);
                total += stat.size;
            } catch {
                // File may not exist
            }
        }
        return total;
    }

    /**
     * Run database maintenance - prune old data and checkpoint WAL
     * @param maxSizeBytes Maximum total DB size (main + WAL) in bytes
     */
    runMaintenance(maxSizeBytes: number): { pruned: Record<string, number>; sizeBeforeMB: number; sizeAfterMB: number } {
        const sizeBefore = this.getTotalSizeBytes();
        const pruned: Record<string, number> = {};

        // Always checkpoint WAL first (this alone can reclaim GBs)
        try {
            this.db.pragma('wal_checkpoint(TRUNCATE)');
        } catch (e) {
            this.logger.warn(`WAL checkpoint failed: ${e}`);
        }

        // If still over limit, prune oldest data in progressive steps
        if (this.getTotalSizeBytes() > maxSizeBytes) {
            // Prune binance_ticks: try 7 days, then 3 days, then 1 day
            for (const days of [7, 3, 1]) {
                if (this.getTotalSizeBytes() <= maxSizeBytes) break;
                const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
                const count = this.pruneBinanceTicks(cutoff);
                if (count > 0) pruned[`binanceTicks_${days}d`] = count;
                try { this.db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }
            }

            // Prune deribit_snapshots: try 7 days, then 3 days, then 1 day
            for (const days of [7, 3, 1]) {
                if (this.getTotalSizeBytes() <= maxSizeBytes) break;
                const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
                const count = this.pruneDeribitSnapshots(cutoff);
                if (count > 0) pruned[`deribitSnapshots_${days}d`] = count;
                try { this.db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }
            }

            // Prune expired instruments
            const expiredCount = this.pruneExpiredDeribitInstruments(Date.now());
            if (expiredCount > 0) pruned.expiredInstruments = expiredCount;

            // Prune old binance 24h snapshots (keep 30 days)
            const cutoff30d = Date.now() - 30 * 24 * 60 * 60 * 1000;
            const snap24hCount = this.pruneBinanceSnapshots24h(cutoff30d);
            if (snap24hCount > 0) pruned.binanceSnapshots24h = snap24hCount;

            try { this.db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }
        }

        const sizeAfter = this.getTotalSizeBytes();
        const hasPruned = Object.keys(pruned).length > 0;
        if (hasPruned) {
            this.logger.info(`DB maintenance: ${Math.round(sizeBefore / 1024 / 1024)}MB -> ${Math.round(sizeAfter / 1024 / 1024)}MB`, pruned);
        }

        return {
            pruned,
            sizeBeforeMB: Math.round(sizeBefore / 1024 / 1024),
            sizeAfterMB: Math.round(sizeAfter / 1024 / 1024),
        };
    }

    /**
     * Close database connection
     */
    close(): void {
        this.db.close();
        this.logger.info('Database connection closed');
    }
}

