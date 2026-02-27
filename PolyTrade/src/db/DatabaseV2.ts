/**
 * DatabaseV2 - PolyTrade Database v2.0
 *
 * Multi-platform, multi-market-type database access layer.
 * Implements the v2 schema from REDESIGN_V2.md Section 6.
 *
 * Key differences from v1:
 * - Platform-agnostic (supports Polymarket, Kalshi, PredictIt)
 * - Market type system (binary_price, binary_event, categorical, continuous)
 * - JSON metadata for flexible platform-specific data
 * - Multi-outcome markets
 * - Generic data points system
 * - Event sourcing support
 */

import Database from 'better-sqlite3';
import { EventEmitter } from 'events';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../lib/logger/index.js';
import type { MarketDefinition, MarketType, Outcome } from '../markets/MarketDefinition.js';
import type { PlatformName } from '../platforms/TradingPlatform.js';

// Compute paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_DB_PATH = process.env.DB_PATH || path.join(PROJECT_ROOT, 'PolyTrade.db');

// ============================================================================
// Types
// ============================================================================

export interface Platform {
  id: string;
  displayName: string;
  apiConfig?: Record<string, unknown>;
  enabled: boolean;
  createdAt: string;
}

export interface MarketRow {
  id: string;
  platformId: string;
  platformMarketId: string;
  marketType: MarketType;
  question: string;
  description?: string;
  expiresAt: number;
  closesAt?: number;
  resolvedAt?: number;
  resolved: boolean;
  resolutionOutcome?: string;
  active: boolean;
  metadata: string; // JSON string
  createdAt: string;
  updatedAt?: string;
}

export interface OutcomeRow {
  id: string;
  marketId: string;
  outcomeName: string;
  platformTokenId?: string;
  currentPrice?: number;
  lastTradePrice?: number;
  metadata?: string;
}

export interface PositionRow {
  id: number;
  platformId: string;
  marketId: string;
  outcomeId: string;
  quantity: number;
  averagePrice: number;
  openedAt: string;
  updatedAt: string;
}

export interface TradeRow {
  id: number;
  platformId: string;
  marketId: string;
  outcomeId: string;
  platformOrderId?: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  tradeType?: string;
  fees: number;
  realizedPnl?: number;
  executedAt: string;
}

export interface DataSourceRow {
  id: string;
  sourceType: string;
  displayName: string;
  config?: string;
  enabled: boolean;
}

export interface DataPointRow {
  id: number;
  sourceId: string;
  symbol: string;
  value: number;
  metadata?: string;
  timestamp: number;
}

export interface PricingSnapshotRow {
  id: number;
  marketId: string;
  fairPrice: number;
  confidence: number;
  strategyUsed: string;
  inputs: string;
  delta?: number;
  gamma?: number;
  vega?: number;
  theta?: number;
  timestamp: number;
}

export interface EventRow {
  id: number;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: string;
  platformId?: string;
  correlationId?: string;
  timestamp: number;
  sequenceNumber: number;
}

// ============================================================================
// DatabaseV2 Class
// ============================================================================

export class DatabaseV2 extends EventEmitter {
  private db: Database.Database;
  private logger: Logger;
  private dbPath: string;

  constructor(dbPath: string = DEFAULT_DB_PATH) {
    super();
    this.logger = new Logger({ level: 'info', service: 'DatabaseV2' });
    this.dbPath = path.resolve(dbPath);
    this.logger.info(`Database path: ${this.dbPath}`);
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  getDbPath(): string {
    return this.dbPath;
  }

  // =========================================================================
  // Platform Methods
  // =========================================================================

  getPlatform(id: string): Platform | undefined {
    return this.db.prepare(`
      SELECT id, display_name as displayName, api_config as apiConfig, enabled, created_at as createdAt
      FROM platforms WHERE id = ?
    `).get(id) as Platform | undefined;
  }

  getPlatforms(enabledOnly: boolean = true): Platform[] {
    const sql = `
      SELECT id, display_name as displayName, api_config as apiConfig, enabled, created_at as createdAt
      FROM platforms
    ` + (enabledOnly ? ' WHERE enabled = 1' : '');
    return this.db.prepare(sql).all() as Platform[];
  }

  upsertPlatform(platform: Omit<Platform, 'createdAt'>): void {
    this.db.prepare(`
      INSERT INTO platforms (id, display_name, api_config, enabled)
      VALUES (@id, @displayName, @apiConfig, @enabled)
      ON CONFLICT(id) DO UPDATE SET
        display_name = @displayName,
        api_config = @apiConfig,
        enabled = @enabled
    `).run({
      id: platform.id,
      displayName: platform.displayName,
      apiConfig: platform.apiConfig ? JSON.stringify(platform.apiConfig) : null,
      enabled: platform.enabled ? 1 : 0,
    });
  }

  // =========================================================================
  // Market Methods
  // =========================================================================

  getMarket(id: string): MarketRow | undefined {
    return this.db.prepare(`
      SELECT
        id, platform_id as platformId, platform_market_id as platformMarketId,
        market_type as marketType, question, description,
        expires_at as expiresAt, closes_at as closesAt, resolved_at as resolvedAt,
        resolved, resolution_outcome as resolutionOutcome, active,
        metadata, created_at as createdAt, updated_at as updatedAt
      FROM markets WHERE id = ?
    `).get(id) as MarketRow | undefined;
  }

  getMarketByPlatformId(platformId: string, platformMarketId: string): MarketRow | undefined {
    return this.db.prepare(`
      SELECT
        id, platform_id as platformId, platform_market_id as platformMarketId,
        market_type as marketType, question, description,
        expires_at as expiresAt, closes_at as closesAt, resolved_at as resolvedAt,
        resolved, resolution_outcome as resolutionOutcome, active,
        metadata, created_at as createdAt, updated_at as updatedAt
      FROM markets WHERE platform_id = ? AND platform_market_id = ?
    `).get(platformId, platformMarketId) as MarketRow | undefined;
  }

  getMarkets(filters: {
    platformId?: string;
    marketType?: MarketType;
    active?: boolean;
    resolved?: boolean;
    expiresAfter?: number;
    limit?: number;
    offset?: number;
  } = {}): MarketRow[] {
    let sql = `
      SELECT
        id, platform_id as platformId, platform_market_id as platformMarketId,
        market_type as marketType, question, description,
        expires_at as expiresAt, closes_at as closesAt, resolved_at as resolvedAt,
        resolved, resolution_outcome as resolutionOutcome, active,
        metadata, created_at as createdAt, updated_at as updatedAt
      FROM markets WHERE 1=1
    `;
    const params: unknown[] = [];

    if (filters.platformId) {
      sql += ' AND platform_id = ?';
      params.push(filters.platformId);
    }
    if (filters.marketType) {
      sql += ' AND market_type = ?';
      params.push(filters.marketType);
    }
    if (filters.active !== undefined) {
      sql += ' AND active = ?';
      params.push(filters.active ? 1 : 0);
    }
    if (filters.resolved !== undefined) {
      sql += ' AND resolved = ?';
      params.push(filters.resolved ? 1 : 0);
    }
    if (filters.expiresAfter !== undefined) {
      sql += ' AND expires_at > ?';
      params.push(filters.expiresAfter);
    }

    sql += ' ORDER BY expires_at ASC';

    if (filters.limit) {
      sql += ' LIMIT ?';
      params.push(filters.limit);
    }
    if (filters.offset) {
      sql += ' OFFSET ?';
      params.push(filters.offset);
    }

    return this.db.prepare(sql).all(...params) as MarketRow[];
  }

  insertMarket(market: Omit<MarketRow, 'createdAt' | 'updatedAt'>): string {
    const id = market.id || uuidv4();
    this.db.prepare(`
      INSERT INTO markets (
        id, platform_id, platform_market_id, market_type, question, description,
        expires_at, closes_at, resolved_at, resolved, resolution_outcome, active, metadata
      ) VALUES (
        @id, @platformId, @platformMarketId, @marketType, @question, @description,
        @expiresAt, @closesAt, @resolvedAt, @resolved, @resolutionOutcome, @active, @metadata
      )
    `).run({
      id,
      platformId: market.platformId,
      platformMarketId: market.platformMarketId,
      marketType: market.marketType,
      question: market.question,
      description: market.description || null,
      expiresAt: market.expiresAt,
      closesAt: market.closesAt || null,
      resolvedAt: market.resolvedAt || null,
      resolved: market.resolved ? 1 : 0,
      resolutionOutcome: market.resolutionOutcome || null,
      active: market.active ? 1 : 0,
      metadata: market.metadata,
    });
    return id;
  }

  updateMarket(id: string, updates: Partial<MarketRow>): void {
    const setClauses: string[] = [];
    const params: Record<string, unknown> = { id };

    if (updates.question !== undefined) {
      setClauses.push('question = @question');
      params.question = updates.question;
    }
    if (updates.active !== undefined) {
      setClauses.push('active = @active');
      params.active = updates.active ? 1 : 0;
    }
    if (updates.resolved !== undefined) {
      setClauses.push('resolved = @resolved');
      params.resolved = updates.resolved ? 1 : 0;
    }
    if (updates.resolutionOutcome !== undefined) {
      setClauses.push('resolution_outcome = @resolutionOutcome');
      params.resolutionOutcome = updates.resolutionOutcome;
    }
    if (updates.resolvedAt !== undefined) {
      setClauses.push('resolved_at = @resolvedAt');
      params.resolvedAt = updates.resolvedAt;
    }
    if (updates.metadata !== undefined) {
      setClauses.push('metadata = @metadata');
      params.metadata = updates.metadata;
    }

    setClauses.push('updated_at = CURRENT_TIMESTAMP');

    if (setClauses.length > 1) {
      this.db.prepare(`UPDATE markets SET ${setClauses.join(', ')} WHERE id = @id`).run(params);
    }
  }

  // =========================================================================
  // Outcome Methods
  // =========================================================================

  getOutcomes(marketId: string): OutcomeRow[] {
    return this.db.prepare(`
      SELECT id, market_id as marketId, outcome_name as outcomeName,
        platform_token_id as platformTokenId, current_price as currentPrice,
        last_trade_price as lastTradePrice, metadata
      FROM market_outcomes WHERE market_id = ?
    `).all(marketId) as OutcomeRow[];
  }

  getOutcomeByTokenId(platformTokenId: string): OutcomeRow | undefined {
    return this.db.prepare(`
      SELECT id, market_id as marketId, outcome_name as outcomeName,
        platform_token_id as platformTokenId, current_price as currentPrice,
        last_trade_price as lastTradePrice, metadata
      FROM market_outcomes WHERE platform_token_id = ?
    `).get(platformTokenId) as OutcomeRow | undefined;
  }

  insertOutcome(outcome: Omit<OutcomeRow, 'id'>): string {
    const id = uuidv4();
    this.db.prepare(`
      INSERT INTO market_outcomes (id, market_id, outcome_name, platform_token_id, current_price, last_trade_price, metadata)
      VALUES (@id, @marketId, @outcomeName, @platformTokenId, @currentPrice, @lastTradePrice, @metadata)
    `).run({
      id,
      marketId: outcome.marketId,
      outcomeName: outcome.outcomeName,
      platformTokenId: outcome.platformTokenId || null,
      currentPrice: outcome.currentPrice || null,
      lastTradePrice: outcome.lastTradePrice || null,
      metadata: outcome.metadata || null,
    });
    return id;
  }

  updateOutcomePrice(id: string, currentPrice: number, lastTradePrice?: number): void {
    this.db.prepare(`
      UPDATE market_outcomes SET current_price = ?, last_trade_price = COALESCE(?, last_trade_price)
      WHERE id = ?
    `).run(currentPrice, lastTradePrice || null, id);
  }

  // =========================================================================
  // Position Methods
  // =========================================================================

  getPositions(platformId?: string): PositionRow[] {
    let sql = `
      SELECT id, platform_id as platformId, market_id as marketId, outcome_id as outcomeId,
        quantity, average_price as averagePrice, opened_at as openedAt, updated_at as updatedAt
      FROM positions
    `;
    if (platformId) {
      sql += ' WHERE platform_id = ?';
      return this.db.prepare(sql).all(platformId) as PositionRow[];
    }
    return this.db.prepare(sql).all() as PositionRow[];
  }

  getPosition(marketId: string, outcomeId: string): PositionRow | undefined {
    return this.db.prepare(`
      SELECT id, platform_id as platformId, market_id as marketId, outcome_id as outcomeId,
        quantity, average_price as averagePrice, opened_at as openedAt, updated_at as updatedAt
      FROM positions WHERE market_id = ? AND outcome_id = ?
    `).get(marketId, outcomeId) as PositionRow | undefined;
  }

  upsertPosition(position: Omit<PositionRow, 'id' | 'openedAt' | 'updatedAt'>): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO positions (platform_id, market_id, outcome_id, quantity, average_price, opened_at, updated_at)
      VALUES (@platformId, @marketId, @outcomeId, @quantity, @averagePrice, @now, @now)
      ON CONFLICT(market_id, outcome_id) DO UPDATE SET
        quantity = @quantity,
        average_price = @averagePrice,
        updated_at = @now
    `).run({
      ...position,
      now,
    });
  }

  deletePosition(marketId: string, outcomeId: string): void {
    this.db.prepare('DELETE FROM positions WHERE market_id = ? AND outcome_id = ?').run(marketId, outcomeId);
  }

  // =========================================================================
  // Trade Methods
  // =========================================================================

  recordTrade(trade: Omit<TradeRow, 'id'>): number {
    const result = this.db.prepare(`
      INSERT INTO trades (
        platform_id, market_id, outcome_id, platform_order_id, side,
        quantity, price, trade_type, fees, realized_pnl, executed_at
      ) VALUES (
        @platformId, @marketId, @outcomeId, @platformOrderId, @side,
        @quantity, @price, @tradeType, @fees, @realizedPnl, @executedAt
      )
    `).run({
      platformId: trade.platformId,
      marketId: trade.marketId,
      outcomeId: trade.outcomeId,
      platformOrderId: trade.platformOrderId || null,
      side: trade.side,
      quantity: trade.quantity,
      price: trade.price,
      tradeType: trade.tradeType || null,
      fees: trade.fees,
      realizedPnl: trade.realizedPnl || null,
      executedAt: trade.executedAt,
    });
    return result.lastInsertRowid as number;
  }

  getTrades(filters: {
    platformId?: string;
    marketId?: string;
    limit?: number;
    startTime?: number;
    endTime?: number;
  } = {}): TradeRow[] {
    let sql = `
      SELECT id, platform_id as platformId, market_id as marketId, outcome_id as outcomeId,
        platform_order_id as platformOrderId, side, quantity, price, trade_type as tradeType,
        fees, realized_pnl as realizedPnl, executed_at as executedAt
      FROM trades WHERE 1=1
    `;
    const params: unknown[] = [];

    if (filters.platformId) {
      sql += ' AND platform_id = ?';
      params.push(filters.platformId);
    }
    if (filters.marketId) {
      sql += ' AND market_id = ?';
      params.push(filters.marketId);
    }
    if (filters.startTime) {
      sql += ' AND executed_at >= datetime(?, "unixepoch", "subsec")';
      params.push(filters.startTime / 1000);
    }
    if (filters.endTime) {
      sql += ' AND executed_at <= datetime(?, "unixepoch", "subsec")';
      params.push(filters.endTime / 1000);
    }

    sql += ' ORDER BY id DESC';

    if (filters.limit) {
      sql += ' LIMIT ?';
      params.push(filters.limit);
    }

    return this.db.prepare(sql).all(...params) as TradeRow[];
  }

  // =========================================================================
  // Data Source Methods
  // =========================================================================

  getDataSource(id: string): DataSourceRow | undefined {
    return this.db.prepare(`
      SELECT id, source_type as sourceType, display_name as displayName, config, enabled
      FROM data_sources WHERE id = ?
    `).get(id) as DataSourceRow | undefined;
  }

  getDataSources(type?: string): DataSourceRow[] {
    let sql = 'SELECT id, source_type as sourceType, display_name as displayName, config, enabled FROM data_sources';
    if (type) {
      sql += ' WHERE source_type = ?';
      return this.db.prepare(sql).all(type) as DataSourceRow[];
    }
    return this.db.prepare(sql).all() as DataSourceRow[];
  }

  upsertDataSource(source: DataSourceRow): void {
    this.db.prepare(`
      INSERT INTO data_sources (id, source_type, display_name, config, enabled)
      VALUES (@id, @sourceType, @displayName, @config, @enabled)
      ON CONFLICT(id) DO UPDATE SET
        source_type = @sourceType,
        display_name = @displayName,
        config = @config,
        enabled = @enabled
    `).run({
      id: source.id,
      sourceType: source.sourceType,
      displayName: source.displayName,
      config: source.config || null,
      enabled: source.enabled ? 1 : 0,
    });
  }

  // =========================================================================
  // Data Points Methods
  // =========================================================================

  insertDataPoint(point: Omit<DataPointRow, 'id'>): number {
    const result = this.db.prepare(`
      INSERT INTO data_points (source_id, symbol, value, metadata, timestamp)
      VALUES (@sourceId, @symbol, @value, @metadata, @timestamp)
    `).run({
      sourceId: point.sourceId,
      symbol: point.symbol,
      value: point.value,
      metadata: point.metadata || null,
      timestamp: point.timestamp,
    });
    return result.lastInsertRowid as number;
  }

  insertDataPointsBatch(points: Omit<DataPointRow, 'id'>[]): void {
    const stmt = this.db.prepare(`
      INSERT INTO data_points (source_id, symbol, value, metadata, timestamp)
      VALUES (@sourceId, @symbol, @value, @metadata, @timestamp)
    `);

    const insertMany = this.db.transaction((items: Omit<DataPointRow, 'id'>[]) => {
      for (const point of items) {
        stmt.run({
          sourceId: point.sourceId,
          symbol: point.symbol,
          value: point.value,
          metadata: point.metadata || null,
          timestamp: point.timestamp,
        });
      }
    });

    insertMany(points);
  }

  getDataPoints(filters: {
    sourceId?: string;
    symbol?: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
  }): DataPointRow[] {
    let sql = `
      SELECT id, source_id as sourceId, symbol, value, metadata, timestamp
      FROM data_points WHERE 1=1
    `;
    const params: unknown[] = [];

    if (filters.sourceId) {
      sql += ' AND source_id = ?';
      params.push(filters.sourceId);
    }
    if (filters.symbol) {
      sql += ' AND symbol = ?';
      params.push(filters.symbol);
    }
    if (filters.startTime) {
      sql += ' AND timestamp >= ?';
      params.push(filters.startTime);
    }
    if (filters.endTime) {
      sql += ' AND timestamp <= ?';
      params.push(filters.endTime);
    }

    sql += ' ORDER BY timestamp DESC';

    if (filters.limit) {
      sql += ' LIMIT ?';
      params.push(filters.limit);
    }

    return this.db.prepare(sql).all(...params) as DataPointRow[];
  }

  getLatestDataPoint(sourceId: string, symbol: string): DataPointRow | undefined {
    return this.db.prepare(`
      SELECT id, source_id as sourceId, symbol, value, metadata, timestamp
      FROM data_points WHERE source_id = ? AND symbol = ?
      ORDER BY timestamp DESC LIMIT 1
    `).get(sourceId, symbol) as DataPointRow | undefined;
  }

  // =========================================================================
  // Pricing Snapshot Methods
  // =========================================================================

  recordPricingSnapshot(snapshot: Omit<PricingSnapshotRow, 'id'>): number {
    const result = this.db.prepare(`
      INSERT INTO pricing_snapshots (
        market_id, fair_price, confidence, strategy_used, inputs,
        delta, gamma, vega, theta, timestamp
      ) VALUES (
        @marketId, @fairPrice, @confidence, @strategyUsed, @inputs,
        @delta, @gamma, @vega, @theta, @timestamp
      )
    `).run({
      marketId: snapshot.marketId,
      fairPrice: snapshot.fairPrice,
      confidence: snapshot.confidence,
      strategyUsed: snapshot.strategyUsed,
      inputs: snapshot.inputs,
      delta: snapshot.delta || null,
      gamma: snapshot.gamma || null,
      vega: snapshot.vega || null,
      theta: snapshot.theta || null,
      timestamp: snapshot.timestamp,
    });
    return result.lastInsertRowid as number;
  }

  getLatestPricingSnapshot(marketId: string): PricingSnapshotRow | undefined {
    return this.db.prepare(`
      SELECT id, market_id as marketId, fair_price as fairPrice, confidence,
        strategy_used as strategyUsed, inputs, delta, gamma, vega, theta, timestamp
      FROM pricing_snapshots WHERE market_id = ?
      ORDER BY timestamp DESC LIMIT 1
    `).get(marketId) as PricingSnapshotRow | undefined;
  }

  // =========================================================================
  // Event Sourcing Methods
  // =========================================================================

  recordEvent(event: Omit<EventRow, 'id' | 'sequenceNumber'>): number {
    const seqResult = this.db.prepare(`
      SELECT COALESCE(MAX(sequence_number), 0) + 1 as nextSeq
      FROM events WHERE aggregate_type = ? AND aggregate_id = ?
    `).get(event.aggregateType, event.aggregateId) as { nextSeq: number };

    const result = this.db.prepare(`
      INSERT INTO events (
        event_type, aggregate_type, aggregate_id, payload,
        platform_id, correlation_id, timestamp, sequence_number
      ) VALUES (
        @eventType, @aggregateType, @aggregateId, @payload,
        @platformId, @correlationId, @timestamp, @sequenceNumber
      )
    `).run({
      eventType: event.eventType,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      payload: event.payload,
      platformId: event.platformId || null,
      correlationId: event.correlationId || null,
      timestamp: event.timestamp,
      sequenceNumber: seqResult.nextSeq,
    });

    return result.lastInsertRowid as number;
  }

  getEvents(filters: {
    aggregateType?: string;
    aggregateId?: string;
    eventType?: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
  }): EventRow[] {
    let sql = `
      SELECT id, event_type as eventType, aggregate_type as aggregateType,
        aggregate_id as aggregateId, payload, platform_id as platformId,
        correlation_id as correlationId, timestamp, sequence_number as sequenceNumber
      FROM events WHERE 1=1
    `;
    const params: unknown[] = [];

    if (filters.aggregateType) {
      sql += ' AND aggregate_type = ?';
      params.push(filters.aggregateType);
    }
    if (filters.aggregateId) {
      sql += ' AND aggregate_id = ?';
      params.push(filters.aggregateId);
    }
    if (filters.eventType) {
      sql += ' AND event_type = ?';
      params.push(filters.eventType);
    }
    if (filters.startTime) {
      sql += ' AND timestamp >= ?';
      params.push(filters.startTime);
    }
    if (filters.endTime) {
      sql += ' AND timestamp <= ?';
      params.push(filters.endTime);
    }

    sql += ' ORDER BY timestamp ASC, sequence_number ASC';

    if (filters.limit) {
      sql += ' LIMIT ?';
      params.push(filters.limit);
    }

    return this.db.prepare(sql).all(...params) as EventRow[];
  }

  // =========================================================================
  // Conversion Helpers
  // =========================================================================

  /**
   * Convert a MarketRow to MarketDefinition
   */
  marketRowToDefinition(row: MarketRow, outcomes: OutcomeRow[]): MarketDefinition {
    const metadata = JSON.parse(row.metadata || '{}');

    return {
      id: row.id,
      platformMarketId: row.platformMarketId,
      platform: row.platformId as PlatformName,
      type: row.marketType,
      question: row.question,
      description: row.description,
      outcomes: outcomes.map(o => ({
        id: o.id,
        name: o.outcomeName,
        platformTokenId: o.platformTokenId,
        currentPrice: o.currentPrice,
        lastTradePrice: o.lastTradePrice,
        metadata: o.metadata ? JSON.parse(o.metadata) : undefined,
      })),
      expiresAt: new Date(row.expiresAt),
      closesAt: row.closesAt ? new Date(row.closesAt) : undefined,
      resolvesAt: row.resolvedAt ? new Date(row.resolvedAt) : undefined,
      active: row.active,
      resolved: row.resolved,
      resolutionOutcome: row.resolutionOutcome,
      metadata,
      createdAt: row.createdAt ? new Date(row.createdAt) : undefined,
    };
  }

  /**
   * Convert a MarketDefinition to database format and insert
   */
  insertMarketDefinition(market: MarketDefinition): void {
    const tx = this.db.transaction(() => {
      // Insert market
      const marketId = this.insertMarket({
        id: market.id,
        platformId: market.platform,
        platformMarketId: market.platformMarketId,
        marketType: market.type,
        question: market.question,
        description: market.description,
        expiresAt: market.expiresAt.getTime(),
        closesAt: market.closesAt?.getTime(),
        resolvedAt: market.resolvesAt?.getTime(),
        resolved: market.resolved,
        resolutionOutcome: market.resolutionOutcome,
        active: market.active,
        metadata: JSON.stringify(market.metadata),
      });

      // Insert outcomes
      for (const outcome of market.outcomes) {
        this.insertOutcome({
          marketId,
          outcomeName: outcome.name,
          platformTokenId: outcome.platformTokenId,
          currentPrice: outcome.currentPrice,
          lastTradePrice: outcome.lastTradePrice,
          metadata: outcome.metadata ? JSON.stringify(outcome.metadata) : undefined,
        });
      }
    });

    tx();
  }

  // =========================================================================
  // Statistics & Maintenance
  // =========================================================================

  getStats(): Record<string, number> {
    const tables = ['platforms', 'markets', 'market_outcomes', 'positions', 'trades',
      'data_sources', 'data_points', 'pricing_snapshots', 'portfolio_risk', 'events'];
    const stats: Record<string, number> = {};

    for (const table of tables) {
      try {
        const result = this.db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number };
        stats[table] = result.c;
      } catch {
        stats[table] = 0; // Table may not exist yet
      }
    }

    // Get schema version
    try {
      const version = this.db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number };
      stats.schemaVersion = version?.v || 0;
    } catch {
      stats.schemaVersion = 0;
    }

    return stats;
  }

  close(): void {
    this.db.close();
    this.logger.info('Database connection closed');
  }
}

// Export singleton factory
let defaultInstance: DatabaseV2 | null = null;

export function getDatabase(dbPath?: string): DatabaseV2 {
  if (!defaultInstance) {
    defaultInstance = new DatabaseV2(dbPath);
  }
  return defaultInstance;
}
