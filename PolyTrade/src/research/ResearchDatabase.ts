import Database from 'better-sqlite3';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Logger } from '../lib/logger/index.js';

// Compute absolute default path for Research.db (separate from PolyTrade.db)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_RESEARCH_DB_PATH = process.env.RESEARCH_DB_PATH || path.join(PROJECT_ROOT, 'Research.db');

// ============================================================================
// INTERFACES - Research Data Types
// ============================================================================

export interface ResearchMarket {
  id: string;                   // condition_id
  question: string;
  slug: string;
  outcomes: string;             // JSON array
  outcomePrices: string;        // JSON array (0-1 range)
  volume: number;
  liquidity: number;
  active: boolean;
  closed: boolean;
  endDate: string | null;
  createdAt: string;
  resolution: string | null;    // YES/NO/null
  lastUpdated: string;
  tags: string | null;          // JSON array of tag strings (e.g., '["crypto","finance"]')
}

export interface ResearchTrade {
  id?: number;
  conditionId: string;
  asset: string;                // token_id
  side: 'BUY' | 'SELL';
  size: number;
  price: number;                // 0-1 range
  outcome: string;
  outcomeIndex: number;
  timestamp: number;
  transactionHash: string | null;
}

export interface AnalysisCache {
  id?: number;
  analysisType: string;
  parameters: string;           // JSON
  result: string;               // JSON
  computedAt: number;
  expiresAt: number;
}

export interface MispricingSignal {
  id: string;
  marketId: string;
  detectedAt: number;
  fairValue: number;
  marketPrice: number;
  mispricingPercent: number;
  confidence: number;
  direction: 'BUY' | 'SELL';
  status: 'PENDING' | 'ACTED' | 'EXPIRED';
  reasoning: string | null;
}

export interface ResearchPosition {
  id: string;
  marketId: string;
  marketQuestion: string;
  entryPrice: number;
  entryDate: number;
  size: number;
  direction: 'YES' | 'NO';
  thesis: string;               // Why this position
  status: 'OPEN' | 'CLOSED';
  currentPrice: number | null;
  exitPrice: number | null;
  exitDate: number | null;
  pnl: number | null;
}

export interface WinRateByPrice {
  pricePoint: number;           // 0-99 (cents)
  expectedWinRate: number;      // Expected (price / 100)
  actualWinRate: number;        // Actual based on resolutions
  sampleSize: number;
  overconfidence: number;       // actualWinRate - expectedWinRate
}

export interface MarketScore {
  marketId: string;
  question: string;
  slug: string;
  liquidityScore: number;       // 0-100
  spreadScore: number;          // 0-100
  volumeScore: number;          // 0-100
  overallScore: number;         // 0-100
  recommendation: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR';
  volume24h: number;
  liquidity: number;
  spreadBps: number;
  computedAt: number;
}

export interface DataSyncStatus {
  lastMarketsSync: number | null;
  lastTradesSync: number | null;
  totalMarkets: number;
  totalTrades: number;
  resolvedMarkets: number;
  activeMarkets: number;
  isRunning: boolean;
  lastError: string | null;
}

// ============================================================================
// RESEARCH DATABASE CLASS - Research.db (Separate from trading)
// ============================================================================

export class ResearchDB extends EventEmitter {
  private db: Database.Database;
  private logger: Logger;
  private dbPath: string;

  constructor(dbPath: string = DEFAULT_RESEARCH_DB_PATH) {
    super();
    this.logger = new Logger({ level: 'info', service: 'research-database' });
    this.dbPath = path.resolve(dbPath);
    this.logger.info(`Research database path: ${this.dbPath}`);
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
  }

  getDbPath(): string {
    return this.dbPath;
  }

  getDb(): Database.Database {
    return this.db;
  }

  private initialize() {
    // ========================================================================
    // SCHEMA: Research Markets Table
    // ========================================================================
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS research_markets (
        id TEXT PRIMARY KEY,
        question TEXT NOT NULL,
        slug TEXT,
        outcomes TEXT,
        outcome_prices TEXT,
        volume REAL DEFAULT 0,
        liquidity REAL DEFAULT 0,
        active INTEGER DEFAULT 1,
        closed INTEGER DEFAULT 0,
        end_date TEXT,
        created_at TEXT,
        resolution TEXT,
        last_updated TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_research_markets_slug ON research_markets(slug);
      CREATE INDEX IF NOT EXISTS idx_research_markets_active ON research_markets(active);
      CREATE INDEX IF NOT EXISTS idx_research_markets_closed ON research_markets(closed);
      CREATE INDEX IF NOT EXISTS idx_research_markets_volume ON research_markets(volume DESC);
    `);

    // Migration: add tags column if missing
    try {
      this.db.exec(`ALTER TABLE research_markets ADD COLUMN tags TEXT`);
    } catch { /* column already exists */ }
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_research_markets_tags ON research_markets(tags)`);

    // ========================================================================
    // SCHEMA: Research Trades Table (Historical trades for analysis)
    // ========================================================================
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS research_trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        condition_id TEXT NOT NULL,
        asset TEXT NOT NULL,
        side TEXT NOT NULL,
        size REAL NOT NULL,
        price REAL NOT NULL,
        outcome TEXT,
        outcome_index INTEGER,
        timestamp INTEGER NOT NULL,
        transaction_hash TEXT,
        FOREIGN KEY(condition_id) REFERENCES research_markets(id)
      );

      CREATE INDEX IF NOT EXISTS idx_research_trades_condition ON research_trades(condition_id);
      CREATE INDEX IF NOT EXISTS idx_research_trades_timestamp ON research_trades(timestamp);
      CREATE INDEX IF NOT EXISTS idx_research_trades_price ON research_trades(price);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_research_trades_dedup
        ON research_trades(condition_id, asset, timestamp, price);
    `);

    // ========================================================================
    // SCHEMA: Analysis Cache Table
    // ========================================================================
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS analysis_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        analysis_type TEXT NOT NULL,
        parameters TEXT NOT NULL,
        result TEXT NOT NULL,
        computed_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        UNIQUE(analysis_type, parameters)
      );

      CREATE INDEX IF NOT EXISTS idx_analysis_cache_type ON analysis_cache(analysis_type);
      CREATE INDEX IF NOT EXISTS idx_analysis_cache_expires ON analysis_cache(expires_at);
    `);

    // ========================================================================
    // SCHEMA: Mispricing Signals Table
    // ========================================================================
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mispricing_signals (
        id TEXT PRIMARY KEY,
        market_id TEXT NOT NULL,
        detected_at INTEGER NOT NULL,
        fair_value REAL NOT NULL,
        market_price REAL NOT NULL,
        mispricing_percent REAL NOT NULL,
        confidence REAL NOT NULL,
        direction TEXT NOT NULL,
        status TEXT DEFAULT 'PENDING',
        reasoning TEXT,
        FOREIGN KEY(market_id) REFERENCES research_markets(id)
      );

      CREATE INDEX IF NOT EXISTS idx_mispricing_market ON mispricing_signals(market_id);
      CREATE INDEX IF NOT EXISTS idx_mispricing_status ON mispricing_signals(status);
      CREATE INDEX IF NOT EXISTS idx_mispricing_detected ON mispricing_signals(detected_at DESC);
    `);

    // ========================================================================
    // SCHEMA: Research Positions Table (Directional bets, separate from trading)
    // ========================================================================
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS research_positions (
        id TEXT PRIMARY KEY,
        market_id TEXT NOT NULL,
        market_question TEXT,
        entry_price REAL NOT NULL,
        entry_date INTEGER NOT NULL,
        size REAL NOT NULL,
        direction TEXT NOT NULL,
        thesis TEXT,
        status TEXT DEFAULT 'OPEN',
        current_price REAL,
        exit_price REAL,
        exit_date INTEGER,
        pnl REAL,
        FOREIGN KEY(market_id) REFERENCES research_markets(id)
      );

      CREATE INDEX IF NOT EXISTS idx_research_positions_status ON research_positions(status);
      CREATE INDEX IF NOT EXISTS idx_research_positions_market ON research_positions(market_id);
    `);

    // ========================================================================
    // SCHEMA: Market Scores Table (MM market selection)
    // ========================================================================
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS market_scores (
        market_id TEXT PRIMARY KEY,
        question TEXT,
        slug TEXT,
        liquidity_score REAL,
        spread_score REAL,
        volume_score REAL,
        overall_score REAL,
        recommendation TEXT,
        volume_24h REAL,
        liquidity REAL,
        spread_bps REAL,
        computed_at INTEGER,
        FOREIGN KEY(market_id) REFERENCES research_markets(id)
      );

      CREATE INDEX IF NOT EXISTS idx_market_scores_overall ON market_scores(overall_score DESC);
      CREATE INDEX IF NOT EXISTS idx_market_scores_recommendation ON market_scores(recommendation);
    `);

    // ========================================================================
    // SCHEMA: Data Sync Status Table
    // ========================================================================
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS data_sync_status (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        last_markets_sync INTEGER,
        last_trades_sync INTEGER,
        is_running INTEGER DEFAULT 0,
        last_error TEXT
      );

      INSERT OR IGNORE INTO data_sync_status (id) VALUES (1);
    `);

    // Migration: add progress-tracking columns to data_sync_status (idempotent)
    const progressColumns = [
      'sync_started_at INTEGER',
      'markets_total INTEGER DEFAULT 0',
      'markets_processed INTEGER DEFAULT 0',
      'trades_processed INTEGER DEFAULT 0',
      'db_size_mb REAL DEFAULT 0',
      'current_phase TEXT',
    ];
    for (const col of progressColumns) {
      try {
        this.db.prepare(`ALTER TABLE data_sync_status ADD COLUMN ${col}`).run();
      } catch {
        // Column already exists — safe to ignore
      }
    }

    // ========================================================================
    // SCHEMA: Win Rate Analysis Results (cached)
    // ========================================================================
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS win_rate_analysis (
        price_point INTEGER PRIMARY KEY,
        expected_win_rate REAL,
        actual_win_rate REAL,
        sample_size INTEGER,
        overconfidence REAL,
        computed_at INTEGER
      );
    `);

    this.logger.info('Research database initialized (Research.db)');
  }

  // ========================================================================
  // MARKET OPERATIONS
  // ========================================================================

  upsertMarket(market: Partial<ResearchMarket> & { id: string }): Database.RunResult {
    const stmt = this.db.prepare(`
      INSERT INTO research_markets (
        id, question, slug, outcomes, outcome_prices, volume, liquidity,
        active, closed, end_date, created_at, resolution, tags, last_updated
      )
      VALUES (
        @id, @question, @slug, @outcomes, @outcomePrices, @volume, @liquidity,
        @active, @closed, @endDate, @createdAt, @resolution, @tags, @lastUpdated
      )
      ON CONFLICT(id) DO UPDATE SET
        question = COALESCE(@question, question),
        slug = COALESCE(@slug, slug),
        outcomes = COALESCE(@outcomes, outcomes),
        outcome_prices = COALESCE(@outcomePrices, outcome_prices),
        volume = COALESCE(@volume, volume),
        liquidity = COALESCE(@liquidity, liquidity),
        active = COALESCE(@active, active),
        closed = COALESCE(@closed, closed),
        end_date = COALESCE(@endDate, end_date),
        resolution = COALESCE(@resolution, resolution),
        tags = COALESCE(@tags, tags),
        last_updated = @lastUpdated
    `);
    return stmt.run({
      id: market.id,
      question: market.question ?? null,
      slug: market.slug ?? null,
      outcomes: market.outcomes ?? null,
      outcomePrices: market.outcomePrices ?? null,
      volume: market.volume ?? null,
      liquidity: market.liquidity ?? null,
      active: market.active !== undefined ? (market.active ? 1 : 0) : null,
      closed: market.closed !== undefined ? (market.closed ? 1 : 0) : null,
      endDate: market.endDate ?? null,
      createdAt: market.createdAt ?? null,
      resolution: market.resolution ?? null,
      tags: market.tags ?? null,
      lastUpdated: new Date().toISOString(),
    });
  }

  upsertMarketsBatch(markets: Array<Partial<ResearchMarket> & { id: string }>): void {
    const stmt = this.db.prepare(`
      INSERT INTO research_markets (
        id, question, slug, outcomes, outcome_prices, volume, liquidity,
        active, closed, end_date, created_at, resolution, tags, last_updated
      )
      VALUES (
        @id, @question, @slug, @outcomes, @outcomePrices, @volume, @liquidity,
        @active, @closed, @endDate, @createdAt, @resolution, @tags, @lastUpdated
      )
      ON CONFLICT(id) DO UPDATE SET
        question = COALESCE(@question, question),
        slug = COALESCE(@slug, slug),
        outcomes = COALESCE(@outcomes, outcomes),
        outcome_prices = COALESCE(@outcomePrices, outcome_prices),
        volume = COALESCE(@volume, volume),
        liquidity = COALESCE(@liquidity, liquidity),
        active = COALESCE(@active, active),
        closed = COALESCE(@closed, closed),
        end_date = COALESCE(@endDate, end_date),
        resolution = COALESCE(@resolution, resolution),
        tags = COALESCE(@tags, tags),
        last_updated = @lastUpdated
    `);

    const insertMany = this.db.transaction((items: Array<Partial<ResearchMarket> & { id: string }>) => {
      const now = new Date().toISOString();
      for (const market of items) {
        stmt.run({
          id: market.id,
          question: market.question ?? null,
          slug: market.slug ?? null,
          outcomes: market.outcomes ?? null,
          outcomePrices: market.outcomePrices ?? null,
          volume: market.volume ?? null,
          liquidity: market.liquidity ?? null,
          active: market.active !== undefined ? (market.active ? 1 : 0) : null,
          closed: market.closed !== undefined ? (market.closed ? 1 : 0) : null,
          endDate: market.endDate ?? null,
          createdAt: market.createdAt ?? null,
          resolution: market.resolution ?? null,
          tags: market.tags ?? null,
          lastUpdated: now,
        });
      }
    });

    insertMany(markets);
  }

  getMarket(id: string): ResearchMarket | undefined {
    return this.db.prepare(`
      SELECT
        id, question, slug, outcomes,
        outcome_prices as outcomePrices,
        volume, liquidity,
        active, closed,
        end_date as endDate,
        created_at as createdAt,
        resolution, tags,
        last_updated as lastUpdated
      FROM research_markets
      WHERE id = ?
    `).get(id) as ResearchMarket | undefined;
  }

  getMarkets(options?: {
    activeOnly?: boolean;
    closedOnly?: boolean;
    resolvedOnly?: boolean;
    tag?: string;
    limit?: number;
    offset?: number;
    orderBy?: 'volume' | 'liquidity' | 'created_at';
  }): ResearchMarket[] {
    let sql = `
      SELECT
        id, question, slug, outcomes,
        outcome_prices as outcomePrices,
        volume, liquidity,
        active, closed,
        end_date as endDate,
        created_at as createdAt,
        resolution, tags,
        last_updated as lastUpdated
      FROM research_markets
      WHERE 1=1
    `;
    const params: any[] = [];

    if (options?.activeOnly) {
      sql += ' AND active = 1';
    }
    if (options?.closedOnly) {
      sql += ' AND closed = 1';
    }
    if (options?.resolvedOnly) {
      sql += ' AND resolution IS NOT NULL';
    }
    if (options?.tag) {
      sql += ' AND tags LIKE ?';
      params.push(`%"${options.tag}"%`);
    }

    const orderColumn = options?.orderBy || 'volume';
    sql += ` ORDER BY ${orderColumn} DESC`;

    if (options?.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }
    if (options?.offset) {
      sql += ' OFFSET ?';
      params.push(options.offset);
    }

    return this.db.prepare(sql).all(...params) as ResearchMarket[];
  }

  getMarketStats(): { total: number; active: number; closed: number; resolved: number } {
    const stats = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN closed = 1 THEN 1 ELSE 0 END) as closed,
        SUM(CASE WHEN resolution IS NOT NULL THEN 1 ELSE 0 END) as resolved
      FROM research_markets
    `).get() as { total: number; active: number; closed: number; resolved: number };
    return stats;
  }

  // ========================================================================
  // TRADE OPERATIONS
  // ========================================================================

  insertTrade(trade: Omit<ResearchTrade, 'id'>): Database.RunResult {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO research_trades (
        condition_id, asset, side, size, price, outcome, outcome_index, timestamp, transaction_hash
      )
      VALUES (@conditionId, @asset, @side, @size, @price, @outcome, @outcomeIndex, @timestamp, @transactionHash)
    `);
    return stmt.run({
      conditionId: trade.conditionId,
      asset: trade.asset,
      side: trade.side,
      size: trade.size,
      price: trade.price,
      outcome: trade.outcome,
      outcomeIndex: trade.outcomeIndex,
      timestamp: trade.timestamp,
      transactionHash: trade.transactionHash,
    });
  }

  insertTradesBatch(trades: Array<Omit<ResearchTrade, 'id'>>): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO research_trades (
        condition_id, asset, side, size, price, outcome, outcome_index, timestamp, transaction_hash
      )
      VALUES (@conditionId, @asset, @side, @size, @price, @outcome, @outcomeIndex, @timestamp, @transactionHash)
    `);

    const insertMany = this.db.transaction((items: Array<Omit<ResearchTrade, 'id'>>) => {
      for (const trade of items) {
        stmt.run({
          conditionId: trade.conditionId,
          asset: trade.asset,
          side: trade.side,
          size: trade.size,
          price: trade.price,
          outcome: trade.outcome,
          outcomeIndex: trade.outcomeIndex,
          timestamp: trade.timestamp,
          transactionHash: trade.transactionHash,
        });
      }
    });

    insertMany(trades);
  }

  getTrades(marketId: string, limit: number = 1000): ResearchTrade[] {
    return this.db.prepare(`
      SELECT
        id, condition_id as conditionId, asset, side, size, price,
        outcome, outcome_index as outcomeIndex, timestamp,
        transaction_hash as transactionHash
      FROM research_trades
      WHERE condition_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(marketId, limit) as ResearchTrade[];
  }

  getTradeCount(): number {
    return (this.db.prepare('SELECT COUNT(*) as c FROM research_trades').get() as { c: number }).c;
  }

  /**
   * Get resolved markets that have trades in the database.
   * Used for trade-based win rate calibration analysis.
   */
  getResolvedMarketsWithTrades(options?: { tag?: string; limit?: number }): ResearchMarket[] {
    let sql = `
      SELECT DISTINCT
        m.id, m.question, m.slug, m.outcomes,
        m.outcome_prices as outcomePrices,
        m.volume, m.liquidity,
        m.active, m.closed,
        m.end_date as endDate,
        m.created_at as createdAt,
        m.resolution, m.tags,
        m.last_updated as lastUpdated
      FROM research_markets m
      INNER JOIN research_trades t ON t.condition_id = m.id
      WHERE m.resolution IS NOT NULL
    `;
    const params: any[] = [];

    if (options?.tag) {
      sql += ' AND m.tags LIKE ?';
      params.push(`%"${options.tag}"%`);
    }

    sql += ' ORDER BY m.volume DESC';

    if (options?.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    return this.db.prepare(sql).all(...params) as ResearchMarket[];
  }

  // ========================================================================
  // ANALYSIS CACHE OPERATIONS
  // ========================================================================

  getCachedAnalysis<T>(type: string, parameters: Record<string, any>): T | null {
    const paramsJson = JSON.stringify(parameters);
    const row = this.db.prepare(`
      SELECT result FROM analysis_cache
      WHERE analysis_type = ? AND parameters = ? AND expires_at > ?
    `).get(type, paramsJson, Date.now()) as { result: string } | undefined;

    if (row) {
      try {
        return JSON.parse(row.result) as T;
      } catch {
        return null;
      }
    }
    return null;
  }

  setCachedAnalysis(type: string, parameters: Record<string, any>, result: any, ttlMs: number): void {
    const paramsJson = JSON.stringify(parameters);
    const resultJson = JSON.stringify(result);
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO analysis_cache (analysis_type, parameters, result, computed_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(analysis_type, parameters) DO UPDATE SET
        result = excluded.result,
        computed_at = excluded.computed_at,
        expires_at = excluded.expires_at
    `).run(type, paramsJson, resultJson, now, now + ttlMs);
  }

  pruneExpiredCache(): number {
    const result = this.db.prepare('DELETE FROM analysis_cache WHERE expires_at < ?').run(Date.now());
    return result.changes;
  }

  // ========================================================================
  // MISPRICING SIGNALS OPERATIONS
  // ========================================================================

  upsertMispricingSignal(signal: MispricingSignal): Database.RunResult {
    const stmt = this.db.prepare(`
      INSERT INTO mispricing_signals (
        id, market_id, detected_at, fair_value, market_price,
        mispricing_percent, confidence, direction, status, reasoning
      )
      VALUES (
        @id, @marketId, @detectedAt, @fairValue, @marketPrice,
        @mispricingPercent, @confidence, @direction, @status, @reasoning
      )
      ON CONFLICT(id) DO UPDATE SET
        market_price = @marketPrice,
        mispricing_percent = @mispricingPercent,
        confidence = @confidence,
        status = @status
    `);
    return stmt.run({
      id: signal.id,
      marketId: signal.marketId,
      detectedAt: signal.detectedAt,
      fairValue: signal.fairValue,
      marketPrice: signal.marketPrice,
      mispricingPercent: signal.mispricingPercent,
      confidence: signal.confidence,
      direction: signal.direction,
      status: signal.status,
      reasoning: signal.reasoning,
    });
  }

  getMispricingSignals(status?: 'PENDING' | 'ACTED' | 'EXPIRED', limit: number = 50): MispricingSignal[] {
    let sql = `
      SELECT
        id, market_id as marketId, detected_at as detectedAt,
        fair_value as fairValue, market_price as marketPrice,
        mispricing_percent as mispricingPercent, confidence,
        direction, status, reasoning
      FROM mispricing_signals
    `;
    const params: any[] = [];

    if (status) {
      sql += ' WHERE status = ?';
      params.push(status);
    }

    sql += ' ORDER BY detected_at DESC LIMIT ?';
    params.push(limit);

    return this.db.prepare(sql).all(...params) as MispricingSignal[];
  }

  updateMispricingStatus(id: string, status: 'PENDING' | 'ACTED' | 'EXPIRED'): void {
    this.db.prepare('UPDATE mispricing_signals SET status = ? WHERE id = ?').run(status, id);
  }

  // ========================================================================
  // RESEARCH POSITIONS OPERATIONS
  // ========================================================================

  upsertResearchPosition(position: ResearchPosition): Database.RunResult {
    const stmt = this.db.prepare(`
      INSERT INTO research_positions (
        id, market_id, market_question, entry_price, entry_date,
        size, direction, thesis, status, current_price, exit_price, exit_date, pnl
      )
      VALUES (
        @id, @marketId, @marketQuestion, @entryPrice, @entryDate,
        @size, @direction, @thesis, @status, @currentPrice, @exitPrice, @exitDate, @pnl
      )
      ON CONFLICT(id) DO UPDATE SET
        current_price = @currentPrice,
        exit_price = @exitPrice,
        exit_date = @exitDate,
        pnl = @pnl,
        status = @status
    `);
    return stmt.run({
      id: position.id,
      marketId: position.marketId,
      marketQuestion: position.marketQuestion,
      entryPrice: position.entryPrice,
      entryDate: position.entryDate,
      size: position.size,
      direction: position.direction,
      thesis: position.thesis,
      status: position.status,
      currentPrice: position.currentPrice,
      exitPrice: position.exitPrice,
      exitDate: position.exitDate,
      pnl: position.pnl,
    });
  }

  getResearchPositions(status?: 'OPEN' | 'CLOSED'): ResearchPosition[] {
    let sql = `
      SELECT
        id, market_id as marketId, market_question as marketQuestion,
        entry_price as entryPrice, entry_date as entryDate,
        size, direction, thesis, status,
        current_price as currentPrice, exit_price as exitPrice,
        exit_date as exitDate, pnl
      FROM research_positions
    `;
    const params: any[] = [];

    if (status) {
      sql += ' WHERE status = ?';
      params.push(status);
    }

    sql += ' ORDER BY entry_date DESC';

    return this.db.prepare(sql).all(...params) as ResearchPosition[];
  }

  closeResearchPosition(id: string, exitPrice: number): void {
    const position = this.db.prepare(`
      SELECT entry_price, size, direction FROM research_positions WHERE id = ?
    `).get(id) as { entry_price: number; size: number; direction: string } | undefined;

    if (position) {
      const pnl = position.direction === 'YES'
        ? (exitPrice - position.entry_price) * position.size
        : (position.entry_price - exitPrice) * position.size;

      this.db.prepare(`
        UPDATE research_positions
        SET status = 'CLOSED', exit_price = ?, exit_date = ?, pnl = ?
        WHERE id = ?
      `).run(exitPrice, Date.now(), pnl, id);
    }
  }

  // ========================================================================
  // MARKET SCORES OPERATIONS
  // ========================================================================

  upsertMarketScore(score: MarketScore): Database.RunResult {
    const stmt = this.db.prepare(`
      INSERT INTO market_scores (
        market_id, question, slug, liquidity_score, spread_score, volume_score,
        overall_score, recommendation, volume_24h, liquidity, spread_bps, computed_at
      )
      VALUES (
        @marketId, @question, @slug, @liquidityScore, @spreadScore, @volumeScore,
        @overallScore, @recommendation, @volume24h, @liquidity, @spreadBps, @computedAt
      )
      ON CONFLICT(market_id) DO UPDATE SET
        question = @question,
        liquidity_score = @liquidityScore,
        spread_score = @spreadScore,
        volume_score = @volumeScore,
        overall_score = @overallScore,
        recommendation = @recommendation,
        volume_24h = @volume24h,
        liquidity = @liquidity,
        spread_bps = @spreadBps,
        computed_at = @computedAt
    `);
    return stmt.run({
      marketId: score.marketId,
      question: score.question,
      slug: score.slug,
      liquidityScore: score.liquidityScore,
      spreadScore: score.spreadScore,
      volumeScore: score.volumeScore,
      overallScore: score.overallScore,
      recommendation: score.recommendation,
      volume24h: score.volume24h,
      liquidity: score.liquidity,
      spreadBps: score.spreadBps,
      computedAt: score.computedAt,
    });
  }

  getMarketScores(options?: {
    minScore?: number;
    recommendation?: string;
    limit?: number;
  }): MarketScore[] {
    let sql = `
      SELECT
        market_id as marketId, question, slug,
        liquidity_score as liquidityScore,
        spread_score as spreadScore,
        volume_score as volumeScore,
        overall_score as overallScore,
        recommendation,
        volume_24h as volume24h,
        liquidity,
        spread_bps as spreadBps,
        computed_at as computedAt
      FROM market_scores
      WHERE 1=1
    `;
    const params: any[] = [];

    if (options?.minScore !== undefined) {
      sql += ' AND overall_score >= ?';
      params.push(options.minScore);
    }
    if (options?.recommendation) {
      sql += ' AND recommendation = ?';
      params.push(options.recommendation);
    }

    sql += ' ORDER BY overall_score DESC';

    if (options?.limit) {
      sql += ' LIMIT ?';
      params.push(options.limit);
    }

    return this.db.prepare(sql).all(...params) as MarketScore[];
  }

  // ========================================================================
  // WIN RATE ANALYSIS
  // ========================================================================

  saveWinRateAnalysis(data: WinRateByPrice[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO win_rate_analysis (
        price_point, expected_win_rate, actual_win_rate, sample_size, overconfidence, computed_at
      )
      VALUES (@pricePoint, @expectedWinRate, @actualWinRate, @sampleSize, @overconfidence, @computedAt)
      ON CONFLICT(price_point) DO UPDATE SET
        expected_win_rate = @expectedWinRate,
        actual_win_rate = @actualWinRate,
        sample_size = @sampleSize,
        overconfidence = @overconfidence,
        computed_at = @computedAt
    `);

    const now = Date.now();
    const insertMany = this.db.transaction((items: WinRateByPrice[]) => {
      for (const item of items) {
        stmt.run({
          pricePoint: item.pricePoint,
          expectedWinRate: item.expectedWinRate,
          actualWinRate: item.actualWinRate,
          sampleSize: item.sampleSize,
          overconfidence: item.overconfidence,
          computedAt: now,
        });
      }
    });

    insertMany(data);
  }

  getWinRateAnalysis(): WinRateByPrice[] {
    return this.db.prepare(`
      SELECT
        price_point as pricePoint,
        expected_win_rate as expectedWinRate,
        actual_win_rate as actualWinRate,
        sample_size as sampleSize,
        overconfidence
      FROM win_rate_analysis
      ORDER BY price_point
    `).all() as WinRateByPrice[];
  }

  // ========================================================================
  // DATA SYNC STATUS
  // ========================================================================

  updateSyncStatus(updates: Partial<DataSyncStatus>): void {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.lastMarketsSync !== undefined) {
      fields.push('last_markets_sync = ?');
      values.push(updates.lastMarketsSync);
    }
    if (updates.lastTradesSync !== undefined) {
      fields.push('last_trades_sync = ?');
      values.push(updates.lastTradesSync);
    }
    if (updates.isRunning !== undefined) {
      fields.push('is_running = ?');
      values.push(updates.isRunning ? 1 : 0);
    }
    if (updates.lastError !== undefined) {
      fields.push('last_error = ?');
      values.push(updates.lastError);
    }

    if (fields.length > 0) {
      this.db.prepare(`UPDATE data_sync_status SET ${fields.join(', ')} WHERE id = 1`).run(...values);
    }
  }

  getSyncStatus(): DataSyncStatus {
    const row = this.db.prepare(`
      SELECT
        last_markets_sync as lastMarketsSync,
        last_trades_sync as lastTradesSync,
        is_running as isRunning,
        last_error as lastError
      FROM data_sync_status
      WHERE id = 1
    `).get() as { lastMarketsSync: number | null; lastTradesSync: number | null; isRunning: number; lastError: string | null };

    const marketStats = this.getMarketStats();

    return {
      lastMarketsSync: row.lastMarketsSync,
      lastTradesSync: row.lastTradesSync,
      totalMarkets: marketStats.total,
      totalTrades: this.getTradeCount(),
      resolvedMarkets: marketStats.resolved,
      activeMarkets: marketStats.active,
      isRunning: row.isRunning === 1,
      lastError: row.lastError,
    };
  }

  updateSyncProgress(progress: {
    isRunning?: boolean;
    syncStartedAt?: number;
    marketsTotal?: number;
    marketsProcessed?: number;
    tradesProcessed?: number;
    dbSizeMB?: number;
    currentPhase?: string | null;
    lastError?: string | null;
  }): void {
    const sets: string[] = [];
    const values: unknown[] = [];

    if (progress.isRunning !== undefined) { sets.push('is_running = ?'); values.push(progress.isRunning ? 1 : 0); }
    if (progress.syncStartedAt !== undefined) { sets.push('sync_started_at = ?'); values.push(progress.syncStartedAt); }
    if (progress.marketsTotal !== undefined) { sets.push('markets_total = ?'); values.push(progress.marketsTotal); }
    if (progress.marketsProcessed !== undefined) { sets.push('markets_processed = ?'); values.push(progress.marketsProcessed); }
    if (progress.tradesProcessed !== undefined) { sets.push('trades_processed = ?'); values.push(progress.tradesProcessed); }
    if (progress.dbSizeMB !== undefined) { sets.push('db_size_mb = ?'); values.push(progress.dbSizeMB); }
    if (progress.currentPhase !== undefined) { sets.push('current_phase = ?'); values.push(progress.currentPhase); }
    if (progress.lastError !== undefined) { sets.push('last_error = ?'); values.push(progress.lastError); }

    if (sets.length === 0) return;

    this.db.prepare(`UPDATE data_sync_status SET ${sets.join(', ')} WHERE id = 1`).run(...values);
  }

  getSyncProgress(): {
    isRunning: boolean;
    syncStartedAt: number | null;
    marketsTotal: number;
    marketsProcessed: number;
    tradesProcessed: number;
    dbSizeMB: number;
    currentPhase: string | null;
    lastError: string | null;
    lastMarketsSync: number | null;
    lastTradesSync: number | null;
  } {
    const row = this.db.prepare('SELECT * FROM data_sync_status WHERE id = 1').get() as Record<string, unknown> | undefined;
    if (!row) {
      return {
        isRunning: false,
        syncStartedAt: null,
        marketsTotal: 0,
        marketsProcessed: 0,
        tradesProcessed: 0,
        dbSizeMB: 0,
        currentPhase: null,
        lastError: null,
        lastMarketsSync: null,
        lastTradesSync: null,
      };
    }
    return {
      isRunning: !!row['is_running'],
      syncStartedAt: (row['sync_started_at'] as number | null) ?? null,
      marketsTotal: (row['markets_total'] as number | null) ?? 0,
      marketsProcessed: (row['markets_processed'] as number | null) ?? 0,
      tradesProcessed: (row['trades_processed'] as number | null) ?? 0,
      dbSizeMB: (row['db_size_mb'] as number | null) ?? 0,
      currentPhase: (row['current_phase'] as string | null) ?? null,
      lastError: (row['last_error'] as string | null) ?? null,
      lastMarketsSync: (row['last_markets_sync'] as number | null) ?? null,
      lastTradesSync: (row['last_trades_sync'] as number | null) ?? null,
    };
  }

  // ========================================================================
  // STATISTICS & MAINTENANCE
  // ========================================================================

  getStats(): {
    markets: number;
    trades: number;
    signals: number;
    positions: number;
    cachedAnalyses: number;
  } {
    const markets = (this.db.prepare('SELECT COUNT(*) as c FROM research_markets').get() as { c: number }).c;
    const trades = (this.db.prepare('SELECT COUNT(*) as c FROM research_trades').get() as { c: number }).c;
    const signals = (this.db.prepare('SELECT COUNT(*) as c FROM mispricing_signals').get() as { c: number }).c;
    const positions = (this.db.prepare('SELECT COUNT(*) as c FROM research_positions').get() as { c: number }).c;
    const cachedAnalyses = (this.db.prepare('SELECT COUNT(*) as c FROM analysis_cache').get() as { c: number }).c;

    return { markets, trades, signals, positions, cachedAnalyses };
  }

  pruneOldTrades(olderThan: number): number {
    const result = this.db.prepare('DELETE FROM research_trades WHERE timestamp < ?').run(olderThan);
    this.logger.info(`Pruned ${result.changes} research trades older than ${new Date(olderThan).toISOString()}`);
    return result.changes;
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
      } catch { /* file may not exist */ }
    }
    return total;
  }

  /**
   * Run database maintenance - prune old data and checkpoint WAL
   */
  runMaintenance(maxSizeBytes: number): { pruned: Record<string, number>; sizeBeforeMB: number; sizeAfterMB: number } {
    const sizeBefore = this.getTotalSizeBytes();
    const pruned: Record<string, number> = {};

    // Always checkpoint WAL first (reclaims WAL file space)
    try {
      this.db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (e) {
      this.logger.warn(`WAL checkpoint failed during maintenance: ${e}`);
    }

    // If still over limit, prune research_trades (biggest table) progressively
    for (const days of [90, 60, 30]) {
      if (this.getTotalSizeBytes() <= maxSizeBytes) break;
      const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
      pruned[`trades_${days}d`] = this.pruneOldTrades(cutoff);
      try { this.db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }
    }

    // Always prune expired cache
    pruned.expiredCache = this.pruneExpiredCache();

    // If still over limit, prune old mispricing signals
    if (this.getTotalSizeBytes() > maxSizeBytes) {
      for (const days of [90, 60, 30]) {
        if (this.getTotalSizeBytes() <= maxSizeBytes) break;
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        const result = this.db.prepare('DELETE FROM mispricing_signals WHERE detected_at < ?').run(cutoff);
        pruned[`signals_${days}d`] = result.changes;
        try { this.db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }
      }
    }

    // Final checkpoint
    try { this.db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }

    const sizeAfter = this.getTotalSizeBytes();
    return {
      pruned,
      sizeBeforeMB: Math.round(sizeBefore / 1024 / 1024),
      sizeAfterMB: Math.round(sizeAfter / 1024 / 1024),
    };
  }

  close(): void {
    this.db.close();
    this.logger.info('Research database connection closed');
  }
}

// Export singleton instance
let researchDbInstance: ResearchDB | null = null;

export function getResearchDB(): ResearchDB {
  if (!researchDbInstance) {
    researchDbInstance = new ResearchDB();
  }
  return researchDbInstance;
}

export function closeResearchDB(): void {
  if (researchDbInstance) {
    researchDbInstance.close();
    researchDbInstance = null;
  }
}
