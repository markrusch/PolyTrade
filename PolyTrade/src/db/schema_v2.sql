-- ============================================================================
-- PolyTrade Database Schema v2.0
-- Multi-Platform, Multi-Market-Type Architecture
-- ============================================================================
--
-- This schema supports:
-- - Multiple platforms (Polymarket, Kalshi, PredictIt, etc.)
-- - Multiple market types (binary_price, binary_event, categorical, continuous)
-- - Flexible metadata using JSON for platform-specific data
-- - Event sourcing for complete audit trail
-- - CQRS-compliant read/write separation
--
-- Design Principles:
-- - All queries use parameterized statements (zero SQL injection risk)
-- - Foreign key constraints enforced
-- - Indexed for common query patterns
-- - JSON metadata for extensibility
-- - WAL mode enabled for concurrent reads/writes
-- ============================================================================

-- ============================================================================
-- CORE TABLES (Platform & Market Type Agnostic)
-- ============================================================================

-- Platforms we can trade on
-- Stores configuration and status for each supported trading platform
CREATE TABLE platforms (
    id TEXT PRIMARY KEY,                    -- 'polymarket', 'kalshi', 'predictit'
    display_name TEXT NOT NULL,             -- Human-readable name
    api_config JSON,                        -- Platform-specific configuration (API URLs, etc.)
    enabled INTEGER DEFAULT 1,              -- 0 = disabled, 1 = enabled
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_platforms_enabled ON platforms(enabled);

-- Market definitions (flexible, type-agnostic)
-- Central table for all markets across all platforms
CREATE TABLE markets (
    id TEXT PRIMARY KEY,                    -- Internal UUID
    platform_id TEXT NOT NULL,              -- FK to platforms
    platform_market_id TEXT NOT NULL,       -- Platform's market ID (e.g., Polymarket conditionId, Kalshi ticker)

    -- Market classification
    market_type TEXT NOT NULL,              -- 'binary_price', 'binary_event', 'categorical', 'continuous'
    CHECK(market_type IN ('binary_price', 'binary_event', 'categorical', 'continuous')),

    -- Core data
    question TEXT NOT NULL,                 -- Market question
    description TEXT,                       -- Optional detailed description

    -- Timing
    expires_at INTEGER NOT NULL,            -- Unix timestamp (ms) when market expires
    closes_at INTEGER,                      -- Unix timestamp (ms) when trading stops (if different from expires_at)
    resolved_at INTEGER,                    -- Unix timestamp (ms) when market was resolved

    -- Resolution
    resolved INTEGER DEFAULT 0,             -- 0 = unresolved, 1 = resolved
    resolution_outcome TEXT,                -- Which outcome won (references market_outcomes.outcome_name)

    -- Status
    active INTEGER DEFAULT 1,               -- 0 = inactive, 1 = active

    -- Flexible metadata (JSON)
    -- For binary_price: {"underlying": "ETH", "strike": 4000, "direction": "above", "polymarket": {...}}
    -- For binary_event: {"eventType": "election", "region": "US", "kalshi": {...}}
    -- For categorical: {"category": "sports", "sport": "NFL", "predictit": {...}}
    metadata JSON,                          -- Type-specific and platform-specific data

    -- Timestamps
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT,

    FOREIGN KEY (platform_id) REFERENCES platforms(id),
    UNIQUE(platform_id, platform_market_id)
);

CREATE INDEX idx_markets_platform ON markets(platform_id);
CREATE INDEX idx_markets_type ON markets(market_type);
CREATE INDEX idx_markets_active ON markets(active);
CREATE INDEX idx_markets_expires ON markets(expires_at);
CREATE INDEX idx_markets_resolved ON markets(resolved);

-- Market outcomes (supports multi-outcome markets)
-- Each market can have multiple outcomes (YES/NO for binary, multiple for categorical)
CREATE TABLE market_outcomes (
    id TEXT PRIMARY KEY,                    -- Internal UUID
    market_id TEXT NOT NULL,                -- FK to markets

    -- Outcome identity
    outcome_name TEXT NOT NULL,             -- 'YES', 'NO', 'Lakers', 'Trump', etc.
    platform_token_id TEXT,                 -- Platform's token ID (e.g., Polymarket CLOB token ID)

    -- Current state
    current_price REAL,                     -- Latest price (0-1 for probability)
    last_trade_price REAL,                  -- Price of last trade

    -- Metadata
    metadata JSON,                          -- Outcome-specific metadata

    FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE CASCADE,
    UNIQUE(market_id, outcome_name)
);

CREATE INDEX idx_outcomes_market ON market_outcomes(market_id);
CREATE INDEX idx_outcomes_token ON market_outcomes(platform_token_id);

-- ============================================================================
-- TRADING TABLES (Multi-Platform)
-- ============================================================================

-- Positions across all platforms
-- Tracks current holdings for each outcome
CREATE TABLE positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform_id TEXT NOT NULL,
    market_id TEXT NOT NULL,
    outcome_id TEXT NOT NULL,

    -- Position data
    quantity REAL NOT NULL,                 -- Number of contracts/shares
    average_price REAL NOT NULL,            -- Weighted average entry price

    -- Timestamps
    opened_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,

    FOREIGN KEY (platform_id) REFERENCES platforms(id),
    FOREIGN KEY (market_id) REFERENCES markets(id),
    FOREIGN KEY (outcome_id) REFERENCES market_outcomes(id)
);

CREATE INDEX idx_positions_platform ON positions(platform_id);
CREATE INDEX idx_positions_market ON positions(market_id);
CREATE INDEX idx_positions_outcome ON positions(outcome_id);

-- Trade history
-- Immutable record of all trades executed
CREATE TABLE trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform_id TEXT NOT NULL,
    market_id TEXT NOT NULL,
    outcome_id TEXT NOT NULL,

    -- Trade data
    platform_order_id TEXT,                 -- Platform's order ID
    side TEXT NOT NULL,                     -- 'BUY', 'SELL'
    CHECK(side IN ('BUY', 'SELL')),
    quantity REAL NOT NULL,
    price REAL NOT NULL,

    -- Execution details
    trade_type TEXT,                        -- 'MAKER', 'TAKER', 'HEDGE'
    fees REAL DEFAULT 0,

    -- P&L
    realized_pnl REAL,                      -- Realized profit/loss on this trade

    -- Timestamps
    executed_at TEXT NOT NULL,

    FOREIGN KEY (platform_id) REFERENCES platforms(id),
    FOREIGN KEY (market_id) REFERENCES markets(id),
    FOREIGN KEY (outcome_id) REFERENCES market_outcomes(id)
);

CREATE INDEX idx_trades_market ON trades(market_id);
CREATE INDEX idx_trades_executed ON trades(executed_at);
CREATE INDEX idx_trades_platform ON trades(platform_id);
CREATE INDEX idx_trades_outcome ON trades(outcome_id);

-- ============================================================================
-- DATA TABLES (Multi-Source)
-- ============================================================================

-- Data sources registry
-- Tracks all external data providers (price feeds, polling, odds, etc.)
CREATE TABLE data_sources (
    id TEXT PRIMARY KEY,                    -- 'binance', 'deribit', 'fivethirtyeight', 'espn_odds'
    source_type TEXT NOT NULL,              -- 'spot_price', 'volatility', 'polling', 'odds', 'custom'
    CHECK(source_type IN ('spot_price', 'volatility', 'polling', 'odds', 'custom')),
    display_name TEXT NOT NULL,
    config JSON,                            -- Source-specific configuration
    enabled INTEGER DEFAULT 1
);

CREATE INDEX idx_data_sources_type ON data_sources(source_type);
CREATE INDEX idx_data_sources_enabled ON data_sources(enabled);

-- Generic data points (time-series)
-- Stores all data from external sources
CREATE TABLE data_points (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id TEXT NOT NULL,
    symbol TEXT NOT NULL,                   -- 'ETHUSDT', 'ETH_IV', 'BIDEN_APPROVAL', etc.

    value REAL NOT NULL,                    -- Numeric value
    metadata JSON,                          -- Source-specific extra data (bid/ask, confidence, etc.)

    timestamp INTEGER NOT NULL,             -- Unix milliseconds

    FOREIGN KEY (source_id) REFERENCES data_sources(id)
);

CREATE INDEX idx_data_points_lookup ON data_points(source_id, symbol, timestamp);
CREATE INDEX idx_data_points_time ON data_points(timestamp);
CREATE INDEX idx_data_points_source ON data_points(source_id);

-- ============================================================================
-- PRICING TABLES
-- ============================================================================

-- Pricing snapshots (audit trail)
-- Records all fair price calculations for auditability
CREATE TABLE pricing_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    market_id TEXT NOT NULL,

    -- Pricing result
    fair_price REAL NOT NULL,               -- Calculated fair probability (0-1)
    confidence REAL NOT NULL,               -- Confidence in calculation (0-1)
    strategy_used TEXT NOT NULL,            -- 'black_scholes', 'statistical', 'ml', 'composite'

    -- Inputs used (for replay/audit)
    inputs JSON NOT NULL,                   -- All inputs used in calculation

    -- Greeks (if applicable - for options-like markets)
    delta REAL,
    gamma REAL,
    vega REAL,
    theta REAL,

    timestamp INTEGER NOT NULL,

    FOREIGN KEY (market_id) REFERENCES markets(id)
);

CREATE INDEX idx_pricing_market_time ON pricing_snapshots(market_id, timestamp);
CREATE INDEX idx_pricing_time ON pricing_snapshots(timestamp);
CREATE INDEX idx_pricing_strategy ON pricing_snapshots(strategy_used);

-- ============================================================================
-- RISK TABLES
-- ============================================================================

-- Portfolio risk snapshots
-- Tracks aggregate risk metrics over time
CREATE TABLE portfolio_risk (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform_id TEXT,                       -- NULL for aggregate across all platforms

    -- Position counts
    num_positions INTEGER NOT NULL,
    num_markets INTEGER NOT NULL,

    -- Exposure
    total_notional REAL NOT NULL,           -- Total position value
    max_loss REAL,                          -- Maximum potential loss (worst case)

    -- Greeks (for options-like markets, NULL for others)
    total_delta REAL,
    total_gamma REAL,
    total_vega REAL,
    total_theta REAL,

    timestamp INTEGER NOT NULL,

    FOREIGN KEY (platform_id) REFERENCES platforms(id)
);

CREATE INDEX idx_portfolio_risk_time ON portfolio_risk(timestamp);
CREATE INDEX idx_portfolio_risk_platform ON portfolio_risk(platform_id);

-- ============================================================================
-- EVENT SOURCING (Enhanced from REDESIGN.md)
-- ============================================================================

-- Events table (immutable event log)
-- Complete audit trail of all state changes in the system
CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    -- Event classification
    event_type TEXT NOT NULL,               -- 'MARKET_DISCOVERED', 'TRADE_EXECUTED', 'PRICE_UPDATED', etc.
    aggregate_type TEXT NOT NULL,           -- 'market', 'position', 'platform', 'data_source'
    aggregate_id TEXT NOT NULL,             -- ID of the entity this event relates to

    -- Event data
    payload JSON NOT NULL,                  -- Event-specific data

    -- Metadata
    platform_id TEXT,                       -- Which platform (if applicable)
    correlation_id TEXT,                    -- Link related events (e.g., all events from one trading decision)

    -- Timestamps
    timestamp INTEGER NOT NULL,             -- When the event occurred (Unix ms)
    sequence_number INTEGER NOT NULL,       -- Sequence number within aggregate (for ordering)

    UNIQUE(aggregate_type, aggregate_id, sequence_number)
);

CREATE INDEX idx_events_time ON events(timestamp);
CREATE INDEX idx_events_type ON events(event_type);
CREATE INDEX idx_events_aggregate ON events(aggregate_type, aggregate_id);
CREATE INDEX idx_events_platform ON events(platform_id);
CREATE INDEX idx_events_correlation ON events(correlation_id);

-- ============================================================================
-- SYSTEM TABLES
-- ============================================================================

-- Schema version tracking
CREATE TABLE schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT DEFAULT CURRENT_TIMESTAMP,
    description TEXT
);

-- Insert schema version v2
INSERT INTO schema_version (version, description)
VALUES (2, 'Multi-platform, multi-market-type schema with event sourcing');

-- ============================================================================
-- VIEWS (Read-Optimized Projections for CQRS)
-- ============================================================================

-- Active markets with current prices (denormalized for performance)
CREATE VIEW v_active_markets AS
SELECT
    m.id,
    m.platform_id,
    p.display_name AS platform_name,
    m.platform_market_id,
    m.market_type,
    m.question,
    m.description,
    m.expires_at,
    m.closes_at,
    m.metadata,
    m.created_at,
    COUNT(mo.id) AS num_outcomes
FROM markets m
JOIN platforms p ON m.platform_id = p.id
LEFT JOIN market_outcomes mo ON m.id = mo.market_id
WHERE m.active = 1 AND m.resolved = 0
GROUP BY m.id;

-- Current portfolio summary (aggregated positions)
CREATE VIEW v_portfolio_summary AS
SELECT
    p.platform_id,
    pl.display_name AS platform_name,
    COUNT(DISTINCT p.market_id) AS num_markets,
    COUNT(*) AS num_positions,
    SUM(p.quantity * p.average_price) AS total_notional
FROM positions p
JOIN platforms pl ON p.platform_id = pl.id
GROUP BY p.platform_id;

-- Recent trades with market context
CREATE VIEW v_recent_trades AS
SELECT
    t.id,
    t.platform_id,
    pl.display_name AS platform_name,
    m.question,
    mo.outcome_name,
    t.side,
    t.quantity,
    t.price,
    t.trade_type,
    t.realized_pnl,
    t.executed_at
FROM trades t
JOIN platforms pl ON t.platform_id = pl.id
JOIN markets m ON t.market_id = m.id
JOIN market_outcomes mo ON t.outcome_id = mo.id
ORDER BY t.executed_at DESC;

-- ============================================================================
-- MIGRATION NOTES
-- ============================================================================
--
-- To migrate from v1 to v2:
-- 1. Insert platform record: INSERT INTO platforms (id, display_name) VALUES ('polymarket', 'Polymarket');
-- 2. Migrate markets table:
--    - Generate UUID for each market
--    - Set platform_id = 'polymarket'
--    - Set platform_market_id = condition_id
--    - Set market_type = 'binary_price'
--    - Build metadata JSON from crypto, strike columns
-- 3. Create market_outcomes for each market (YES/NO outcomes)
-- 4. Migrate positions table with new foreign keys
-- 5. Migrate trades table with new foreign keys
-- 6. Create data_sources records for Binance and Deribit
-- 7. Migrate binance_ticks to data_points
-- 8. Migrate deribit_snapshots to data_points
-- 9. Migrate portfolio_greeks to portfolio_risk
--
-- ============================================================================
