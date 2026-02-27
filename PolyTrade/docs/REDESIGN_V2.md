# PolyTrade Comprehensive Redesign Plan v2.0

## Multi-Platform Scalable Architecture for Prediction Markets

---

## 📋 Table of Contents

1. [Current State Assessment](#current-state-assessment)
2. [Analysis of Existing REDESIGN.md](#analysis-of-existing-redesignmd)
3. [Critical Gaps Identified](#critical-gaps-identified)
4. [Proposed Architecture](#proposed-architecture)
5. [Core Abstractions](#core-abstractions)
6. [Database Schema Redesign](#database-schema-redesign)
7. [Event Sourcing Enhancement](#event-sourcing-enhancement)
8. [Implementation Phases](#implementation-phases)
9. [Platform Integration Guide](#platform-integration-guide)
10. [Risk Assessment](#risk-assessment)

---

## 1. Current State Assessment

### What Works Well ✅

| Component | Implementation | Quality |
|-----------|---------------|---------|
| **SQL Injection Prevention** | 100% parameterized queries | Excellent |
| **Service Separation** | Binance/Deribit/Polymarket separated | Good |
| **Feature Flags** | Per-crypto enable/disable | Good |
| **Rate Limiting** | RateLimiter class with backoff | Good |
| **WebSocket Streaming** | HybridStreamManager with fallback | Good |
| **Black-Scholes Implementation** | N(d2) with Greek calculations | Complete |
| **Quote Generation** | Strategy.ts with spread adjustments | Functional |

### Critical Architectural Coupling Points 🔴

| Coupling | Location | Impact |
|----------|----------|--------|
| **Market = Crypto Binary Option** | `Market` interface in Database.ts | Cannot support political/sports markets |
| **Strike Extraction via Regex** | `MarketPricingService.extractStrike()` | Only works for "above X" pattern |
| **Per-Crypto Service Dimension** | `ServiceRegistry`, `server.ts` | Cannot add non-crypto data sources |
| **Polymarket-Only Trading** | `ClobClient`, `OrderManager` | Cannot integrate Kalshi |
| **Black-Scholes Only Pricing** | `MarketPricingService.calculateRiskNeutralProb()` | No alternative pricing models |
| **Greeks Assume Options** | `RiskManager` hard limits | Not applicable to categorical markets |

### Code Evidence

```typescript
// Database.ts:17-26 - Market is crypto-centric
export interface Market {
    clobTokenId: string;
    crypto: string;        // ❌ Assumes crypto underlying
    strike: number;        // ❌ Assumes price threshold
    maturity: number;      // ✅ Generic expiry
    question: string;      // ✅ Generic
    conditionId: string;   // ❌ Polymarket-specific
    active: number;
    lastUpdated: string;
}

// MarketPricingService.ts:119 - Hard-coded regex
let match = slug.match(/above[- ]([\d.]+)k?(?:[- ]|$)/i);
// ❌ Only matches "above" pattern, not "below", "between", or categorical
```

---

## 2. Analysis of Existing REDESIGN.md

### Strengths of Current Redesign Plan ✅

| Aspect | Assessment |
|--------|------------|
| **Event Sourcing Concept** | Well-documented, follows Martin Fowler patterns |
| **CQRS Pattern** | Correctly separates read/write paths |
| **SQL Injection Prevention** | Already implemented, documented |
| **UI Architecture** | Comprehensive component hierarchy |
| **Data Flow Diagrams** | Clear visualization of architecture |

### Gaps in Current Redesign Plan ⚠️

| Missing | Impact | Priority |
|---------|--------|----------|
| **Platform Abstraction** | Cannot add Kalshi without major refactor | CRITICAL |
| **Market Type Abstraction** | Cannot support non-crypto markets | CRITICAL |
| **Pricing Model Pluggability** | Cannot use ML/statistical models | HIGH |
| **Data Source Abstraction** | Cannot add sports/political feeds | HIGH |
| **Multi-Outcome Markets** | Only YES/NO supported | MEDIUM |
| **Cross-Platform Arbitrage** | Cannot trade same event across platforms | LOW |

### What REDESIGN.md Got Right But Didn't Fully Address

```
REDESIGN.md Section 4.1 mentions:
"Event Types in PolyTrade"
- MarketAddedEvent
- PriceTickEvent
- IVSnapshotEvent
- TradeExecutedEvent

❌ Missing:
- PlatformEvent (for multi-platform)
- MarketTypeDefinedEvent (for market type flexibility)
- PricingStrategySelectedEvent (for model pluggability)
```

---

## 3. Critical Gaps Identified

### Gap 1: No Platform Abstraction

**Current State:**
```typescript
// server.ts directly instantiates Polymarket client
const clobClient = new ClobClientWrapper(config.polymarket);
const orderManager = new OrderManager(clobClient, db);
```

**Problem:** Adding Kalshi requires:
- New API client class
- Different authentication flow (OAuth vs Ethereum signature)
- Different order format
- Different settlement process
- Code changes in 10+ files

### Gap 2: No Market Type Abstraction

**Current State:**
```typescript
// Market type is implicitly crypto binary option
interface Market {
    crypto: string;      // What if market is "Will Lakers win championship?"
    strike: number;      // What if market is "Who will win election?"
}
```

**Problem:** Cannot support:
- Political markets (no underlying asset)
- Sports markets (multi-outcome, not price-based)
- Range markets ("BTC between 90k and 100k")
- Categorical markets ("Which party wins?")

### Gap 3: No Pricing Model Abstraction

**Current State:**
```typescript
// Only Black-Scholes available
calculateRiskNeutralProb(spot, strike, sigma, tte, r)
```

**Problem:** Cannot use:
- Machine learning probability models
- Historical outcome analysis
- Sentiment-based pricing
- Market maker edge detection algorithms

### Gap 4: No Data Source Abstraction

**Current State:**
```typescript
// Hard-coded to Binance spot + Deribit IV
const binanceListener = new BinancePriceListener(crypto);
const deribitListener = new DeribitListener(currency);
```

**Problem:** Cannot add:
- Sports data feeds (ESPN, odds APIs)
- Political polling data
- Weather data (for weather markets)
- Custom data sources

---

## 4. Proposed Architecture

### High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                           POLYTRADE v2.0 ARCHITECTURE                                │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  ┌───────────────────────────────────────────────────────────────────────────────┐  │
│  │                         PLATFORM ADAPTERS (New Layer)                          │  │
│  │                                                                                 │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐               │  │
│  │  │   Polymarket    │  │     Kalshi      │  │    PredictIt    │               │  │
│  │  │    Adapter      │  │    Adapter      │  │    Adapter      │               │  │
│  │  │                 │  │                 │  │                 │               │  │
│  │  │ - ClobClient    │  │ - KalshiClient  │  │ - PIClient      │               │  │
│  │  │ - EthSigning    │  │ - OAuthAuth     │  │ - BasicAuth     │               │  │
│  │  │ - GammaAPI      │  │ - KalshiAPI     │  │ - PIAPI         │               │  │
│  │  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘               │  │
│  │           │                    │                    │                         │  │
│  │           └────────────────────┼────────────────────┘                         │  │
│  │                                │                                               │  │
│  │                    ┌───────────▼───────────┐                                  │  │
│  │                    │  TradingPlatform      │ (Interface)                      │  │
│  │                    │  Interface            │                                  │  │
│  │                    └───────────┬───────────┘                                  │  │
│  └────────────────────────────────┼──────────────────────────────────────────────┘  │
│                                   │                                                  │
│  ┌────────────────────────────────┼──────────────────────────────────────────────┐  │
│  │                     MARKET TYPE SYSTEM (New Layer)                             │  │
│  │                                │                                               │  │
│  │  ┌─────────────────────────────▼─────────────────────────────────────────┐    │  │
│  │  │                    MarketDefinition (Generic Interface)                │    │  │
│  │  │                                                                        │    │  │
│  │  │  id: string                                                            │    │  │
│  │  │  type: 'binary_price' | 'binary_event' | 'categorical' | 'continuous' │    │  │
│  │  │  platform: 'polymarket' | 'kalshi' | 'predictit'                       │    │  │
│  │  │  outcomes: Outcome[]                                                   │    │  │
│  │  │  expiresAt: Date                                                       │    │  │
│  │  │  metadata: Record<string, any>  (platform-specific data)               │    │  │
│  │  └───────────────────────────────────────────────────────────────────────┘    │  │
│  │                                │                                               │  │
│  │  ┌─────────────────────────────┼─────────────────────────────────────────┐    │  │
│  │  │                    Market Type Handlers                                │    │  │
│  │  │                             │                                          │    │  │
│  │  │  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐            │    │  │
│  │  │  │ BinaryPrice    │ │ BinaryEvent    │ │ Categorical    │            │    │  │
│  │  │  │ Handler        │ │ Handler        │ │ Handler        │            │    │  │
│  │  │  │                │ │                │ │                │            │    │  │
│  │  │  │ - Crypto       │ │ - Political    │ │ - Multi-option │            │    │  │
│  │  │  │ - Commodities  │ │ - Sports       │ │ - Elections    │            │    │  │
│  │  │  │ - Forex        │ │ - Events       │ │ - Tournaments  │            │    │  │
│  │  │  └────────────────┘ └────────────────┘ └────────────────┘            │    │  │
│  │  └───────────────────────────────────────────────────────────────────────┘    │  │
│  └────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│  ┌────────────────────────────────────────────────────────────────────────────────┐  │
│  │                     PRICING STRATEGY SYSTEM (New Layer)                        │  │
│  │                                                                                 │  │
│  │  ┌─────────────────────────────────────────────────────────────────────────┐  │  │
│  │  │                    PricingStrategy (Interface)                           │  │  │
│  │  │                                                                          │  │  │
│  │  │  calculateFairPrice(market: MarketDefinition, data: MarketData): number │  │  │
│  │  │  calculateGreeks?(market, data): Greeks | null                          │  │  │
│  │  │  getConfidence(): number                                                 │  │  │
│  │  └────────────────────────────────────────────────────────────────────────┘  │  │
│  │                                 │                                             │  │
│  │  ┌──────────────────────────────┼──────────────────────────────────────────┐ │  │
│  │  │                   Strategy Implementations                               │ │  │
│  │  │                              │                                           │ │  │
│  │  │  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌─────────────┐ │ │  │
│  │  │  │ BlackScholes  │ │ Statistical   │ │ ML-Based      │ │ Composite   │ │ │  │
│  │  │  │ Strategy      │ │ Strategy      │ │ Strategy      │ │ Strategy    │ │ │  │
│  │  │  │               │ │               │ │               │ │             │ │ │  │
│  │  │  │ - N(d2) calc  │ │ - Historical  │ │ - Neural net  │ │ - Weighted  │ │ │  │
│  │  │  │ - Greeks      │ │ - Regression  │ │ - Features    │ │   average   │ │ │  │
│  │  │  │ - Crypto only │ │ - Polls       │ │ - Ensemble    │ │ - Multi-src │ │ │  │
│  │  │  └───────────────┘ └───────────────┘ └───────────────┘ └─────────────┘ │ │  │
│  │  └──────────────────────────────────────────────────────────────────────────┘ │  │
│  └────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│  ┌────────────────────────────────────────────────────────────────────────────────┐  │
│  │                     DATA SOURCE SYSTEM (New Layer)                             │  │
│  │                                                                                 │  │
│  │  ┌─────────────────────────────────────────────────────────────────────────┐  │  │
│  │  │                    DataSource (Interface)                                │  │  │
│  │  │                                                                          │  │  │
│  │  │  type: 'spot_price' | 'volatility' | 'polling' | 'odds' | 'custom'      │  │  │
│  │  │  fetch(): Promise<DataPoint>                                             │  │  │
│  │  │  subscribe(callback): Unsubscribe                                        │  │  │
│  │  └────────────────────────────────────────────────────────────────────────┘  │  │
│  │                                 │                                             │  │
│  │  ┌──────────────────────────────┼──────────────────────────────────────────┐ │  │
│  │  │                   Data Source Implementations                            │ │  │
│  │  │                              │                                           │ │  │
│  │  │  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌─────────────┐ │ │  │
│  │  │  │ Binance       │ │ Deribit       │ │ Polling       │ │ Odds        │ │ │  │
│  │  │  │ SpotSource    │ │ IVSource      │ │ DataSource    │ │ DataSource  │ │ │  │
│  │  │  │               │ │               │ │               │ │             │ │ │  │
│  │  │  │ - ETHUSDT     │ │ - ETH IV      │ │ - 538         │ │ - DraftKings│ │ │  │
│  │  │  │ - BTCUSDT     │ │ - BTC IV      │ │ - RealClear   │ │ - ESPN      │ │ │  │
│  │  │  │ - Any pair    │ │ - SOL IV      │ │ - Nate Silver │ │ - Odds API  │ │ │  │
│  │  │  └───────────────┘ └───────────────┘ └───────────────┘ └─────────────┘ │ │  │
│  │  └──────────────────────────────────────────────────────────────────────────┘ │  │
│  └────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│  ┌────────────────────────────────────────────────────────────────────────────────┐  │
│  │                     EXISTING LAYERS (Enhanced)                                 │  │
│  │                                                                                 │  │
│  │  ┌────────────────────────────────────────────────────────────────────────┐   │  │
│  │  │ Market Maker Engine                                                     │   │  │
│  │  │ - Strategy.ts (enhanced with pluggable pricing)                        │   │  │
│  │  │ - RiskManager.ts (enhanced with market-type-aware limits)              │   │  │
│  │  │ - MarketMaker.ts (orchestrates via abstractions)                       │   │  │
│  │  └────────────────────────────────────────────────────────────────────────┘   │  │
│  │                                                                                 │  │
│  │  ┌────────────────────────────────────────────────────────────────────────┐   │  │
│  │  │ Event Store (Enhanced from REDESIGN.md)                                 │   │  │
│  │  │ - Platform events                                                       │   │  │
│  │  │ - Market type events                                                    │   │  │
│  │  │ - Cross-platform correlation                                            │   │  │
│  │  └────────────────────────────────────────────────────────────────────────┘   │  │
│  │                                                                                 │  │
│  │  ┌────────────────────────────────────────────────────────────────────────┐   │  │
│  │  │ Database Layer (Schema v2.0)                                            │   │  │
│  │  │ - Flexible market definitions (JSON metadata)                           │   │  │
│  │  │ - Multi-platform position tracking                                      │   │  │
│  │  │ - Market type polymorphism                                              │   │  │
│  │  └────────────────────────────────────────────────────────────────────────┘   │  │
│  └────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Core Abstractions

### 5.1 TradingPlatform Interface

```typescript
// src/platforms/TradingPlatform.ts

export interface TradingPlatform {
  readonly name: 'polymarket' | 'kalshi' | 'predictit';
  readonly supportsMarketTypes: MarketType[];

  // Connection lifecycle
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  // Market discovery
  discoverMarkets(filters: MarketFilters): Promise<MarketDefinition[]>;
  getMarket(id: string): Promise<MarketDefinition | null>;

  // Trading
  placeOrder(params: OrderParams): Promise<OrderResult>;
  cancelOrder(orderId: string): Promise<void>;
  cancelAllOrders(marketId?: string): Promise<void>;

  // Portfolio
  getOrders(): Promise<Order[]>;
  getPositions(): Promise<Position[]>;
  getBalance(): Promise<Balance>;

  // Market data
  subscribeOrderbook(marketId: string, callback: OrderbookCallback): Unsubscribe;
  getOrderbook(marketId: string): Promise<OrderbookSnapshot>;
}

// Platform-specific implementations
export class PolymarketPlatform implements TradingPlatform {
  // Wraps existing ClobClient, GammaAPI
}

export class KalshiPlatform implements TradingPlatform {
  // New implementation for Kalshi REST + WebSocket API
}
```

### 5.2 MarketDefinition Interface

```typescript
// src/markets/MarketDefinition.ts

export type MarketType =
  | 'binary_price'      // "Will ETH be above $4000?" (uses Black-Scholes)
  | 'binary_event'      // "Will Trump win?" (statistical/poll-based)
  | 'categorical'       // "Which team wins Super Bowl?" (multi-outcome)
  | 'continuous';       // "What will ETH price be?" (range)

export interface MarketDefinition {
  // Core identity
  id: string;
  platformMarketId: string;  // Platform-specific ID
  platform: PlatformName;
  type: MarketType;

  // Question
  question: string;
  description?: string;

  // Outcomes
  outcomes: Outcome[];

  // Timing
  expiresAt: Date;
  resolvesAt?: Date;
  closesAt?: Date;  // When trading stops

  // Platform-specific metadata (JSON)
  metadata: {
    // For binary_price markets
    underlying?: string;      // "ETH", "BTC"
    strike?: number;          // 4000
    direction?: 'above' | 'below' | 'between';

    // For binary_event markets
    eventType?: string;       // "election", "sports", "weather"

    // For categorical markets
    category?: string;

    // Platform-specific
    polymarket?: {
      conditionId: string;
      clobTokenIds: string[];
      negRisk: boolean;
    };
    kalshi?: {
      ticker: string;
      seriesId: string;
    };
  };

  // Status
  active: boolean;
  resolved: boolean;
  resolutionOutcome?: string;
}

export interface Outcome {
  id: string;
  name: string;          // "YES", "NO", "Lakers", "Celtics"
  tokenId?: string;      // Platform-specific token ID
  currentPrice?: number;
}
```

### 5.3 PricingStrategy Interface

```typescript
// src/pricing/PricingStrategy.ts

export interface PricingStrategy {
  // Strategy identity
  readonly name: string;
  readonly supportedMarketTypes: MarketType[];

  // Core pricing function
  calculateFairPrice(
    market: MarketDefinition,
    data: PricingData
  ): PricingResult;

  // Optional Greeks (for options-like markets)
  calculateGreeks?(
    market: MarketDefinition,
    data: PricingData
  ): Greeks | null;

  // Confidence in the price estimate
  getConfidence(market: MarketDefinition, data: PricingData): number;
}

export interface PricingData {
  // For price-based markets
  spotPrice?: number;
  impliedVolatility?: number;
  riskFreeRate?: number;

  // For event-based markets
  historicalOutcomes?: HistoricalOutcome[];
  pollingData?: PollData[];
  oddsData?: OddsData[];

  // Generic
  timestamp: Date;
  dataQuality: 'high' | 'medium' | 'low' | 'stale';
}

export interface PricingResult {
  fairPrice: number;
  confidence: number;
  method: string;
  inputs: Record<string, any>;  // For audit trail
}

// Implementations
export class BlackScholesStrategy implements PricingStrategy {
  // Existing implementation from MarketPricingService
  // Only applies to binary_price markets
}

export class StatisticalStrategy implements PricingStrategy {
  // For binary_event markets (polls, historical data)
}

export class MLStrategy implements PricingStrategy {
  // Future: Machine learning-based pricing
}

export class CompositeStrategy implements PricingStrategy {
  // Combines multiple strategies with weighted average
}
```

### 5.4 DataSource Interface

```typescript
// src/data/DataSource.ts

export type DataSourceType =
  | 'spot_price'     // Binance, etc.
  | 'volatility'     // Deribit IV
  | 'polling'        // Political polls
  | 'odds'           // Sports odds
  | 'custom';

export interface DataSource {
  readonly name: string;
  readonly type: DataSourceType;
  readonly symbols: string[];  // What this source provides data for

  // Lifecycle
  start(): Promise<void>;
  stop(): Promise<void>;
  isHealthy(): boolean;

  // Data access
  getLatest(symbol: string): DataPoint | null;
  subscribe(symbol: string, callback: DataCallback): Unsubscribe;

  // Historical
  getHistory(symbol: string, from: Date, to: Date): Promise<DataPoint[]>;
}

export interface DataPoint {
  symbol: string;
  value: number;
  timestamp: Date;
  metadata?: Record<string, any>;
}

// Implementations
export class BinanceDataSource implements DataSource {
  // Refactored from BinancePriceListener
}

export class DeribitDataSource implements DataSource {
  // Refactored from DeribitListener
}

export class PollingDataSource implements DataSource {
  // New: FiveThirtyEight, RealClearPolitics, etc.
}

export class OddsDataSource implements DataSource {
  // New: Sports odds APIs
}
```

---

## 6. Database Schema Redesign

### Current Schema Limitations

```sql
-- Current: Tightly coupled to crypto binary options
CREATE TABLE markets (
    clob_token_id TEXT PRIMARY KEY,
    crypto TEXT,           -- ❌ Only crypto
    strike REAL,           -- ❌ Only price threshold
    maturity INTEGER,
    question TEXT,
    condition_id TEXT,     -- ❌ Polymarket-specific
    active INTEGER,
    last_updated TEXT
);
```

### Proposed Schema v2.0

```sql
-- ============================================================================
-- CORE TABLES (Platform & Market Type Agnostic)
-- ============================================================================

-- Platforms we can trade on
CREATE TABLE platforms (
    id TEXT PRIMARY KEY,                    -- 'polymarket', 'kalshi', 'predictit'
    display_name TEXT NOT NULL,
    api_config JSON,                        -- Platform-specific configuration
    enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Market definitions (flexible, type-agnostic)
CREATE TABLE markets (
    id TEXT PRIMARY KEY,                    -- Internal UUID
    platform_id TEXT NOT NULL,              -- FK to platforms
    platform_market_id TEXT NOT NULL,       -- Platform's market ID

    -- Market classification
    market_type TEXT NOT NULL,              -- 'binary_price', 'binary_event', 'categorical'

    -- Core data
    question TEXT NOT NULL,
    description TEXT,

    -- Timing
    expires_at INTEGER NOT NULL,            -- Unix timestamp
    closes_at INTEGER,                      -- When trading stops
    resolved_at INTEGER,

    -- Resolution
    resolved INTEGER DEFAULT 0,
    resolution_outcome TEXT,                -- Which outcome won

    -- Status
    active INTEGER DEFAULT 1,

    -- Flexible metadata (JSON)
    metadata JSON,                          -- Type-specific and platform-specific data

    -- Timestamps
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT,

    FOREIGN KEY (platform_id) REFERENCES platforms(id),
    UNIQUE(platform_id, platform_market_id)
);

-- Market outcomes (supports multi-outcome markets)
CREATE TABLE market_outcomes (
    id TEXT PRIMARY KEY,                    -- Internal UUID
    market_id TEXT NOT NULL,

    -- Outcome identity
    outcome_name TEXT NOT NULL,             -- 'YES', 'NO', 'Lakers', 'Trump'
    platform_token_id TEXT,                 -- Platform's token ID

    -- Current state
    current_price REAL,
    last_trade_price REAL,

    -- Metadata
    metadata JSON,

    FOREIGN KEY (market_id) REFERENCES markets(id),
    UNIQUE(market_id, outcome_name)
);

-- ============================================================================
-- TRADING TABLES (Multi-Platform)
-- ============================================================================

-- Positions across all platforms
CREATE TABLE positions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform_id TEXT NOT NULL,
    market_id TEXT NOT NULL,
    outcome_id TEXT NOT NULL,

    -- Position data
    quantity REAL NOT NULL,
    average_price REAL NOT NULL,

    -- Timestamps
    opened_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,

    FOREIGN KEY (platform_id) REFERENCES platforms(id),
    FOREIGN KEY (market_id) REFERENCES markets(id),
    FOREIGN KEY (outcome_id) REFERENCES market_outcomes(id)
);

-- Trade history
CREATE TABLE trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform_id TEXT NOT NULL,
    market_id TEXT NOT NULL,
    outcome_id TEXT NOT NULL,

    -- Trade data
    platform_order_id TEXT,                 -- Platform's order ID
    side TEXT NOT NULL,                     -- 'BUY', 'SELL'
    quantity REAL NOT NULL,
    price REAL NOT NULL,

    -- Execution details
    trade_type TEXT,                        -- 'MAKER', 'TAKER', 'HEDGE'
    fees REAL DEFAULT 0,

    -- P&L
    realized_pnl REAL,

    -- Timestamps
    executed_at TEXT NOT NULL,

    FOREIGN KEY (platform_id) REFERENCES platforms(id),
    FOREIGN KEY (market_id) REFERENCES markets(id),
    FOREIGN KEY (outcome_id) REFERENCES market_outcomes(id)
);

CREATE INDEX idx_trades_market ON trades(market_id);
CREATE INDEX idx_trades_executed ON trades(executed_at);
CREATE INDEX idx_trades_platform ON trades(platform_id);

-- ============================================================================
-- DATA TABLES (Multi-Source)
-- ============================================================================

-- Data sources registry
CREATE TABLE data_sources (
    id TEXT PRIMARY KEY,                    -- 'binance', 'deribit', '538', 'espn_odds'
    source_type TEXT NOT NULL,              -- 'spot_price', 'volatility', 'polling', 'odds'
    display_name TEXT NOT NULL,
    config JSON,
    enabled INTEGER DEFAULT 1
);

-- Generic data points (time-series)
CREATE TABLE data_points (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id TEXT NOT NULL,
    symbol TEXT NOT NULL,                   -- 'ETHUSDT', 'ETH_IV', 'BIDEN_APPROVAL'

    value REAL NOT NULL,
    metadata JSON,                          -- Source-specific extra data

    timestamp INTEGER NOT NULL,             -- Unix milliseconds

    FOREIGN KEY (source_id) REFERENCES data_sources(id)
);

CREATE INDEX idx_data_points_lookup ON data_points(source_id, symbol, timestamp);
CREATE INDEX idx_data_points_time ON data_points(timestamp);

-- ============================================================================
-- PRICING TABLES
-- ============================================================================

-- Pricing snapshots (audit trail)
CREATE TABLE pricing_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    market_id TEXT NOT NULL,

    -- Pricing result
    fair_price REAL NOT NULL,
    confidence REAL NOT NULL,
    strategy_used TEXT NOT NULL,            -- 'black_scholes', 'statistical', 'ml'

    -- Inputs used (for replay/audit)
    inputs JSON NOT NULL,

    -- Greeks (if applicable)
    delta REAL,
    gamma REAL,
    vega REAL,
    theta REAL,

    timestamp INTEGER NOT NULL,

    FOREIGN KEY (market_id) REFERENCES markets(id)
);

CREATE INDEX idx_pricing_market_time ON pricing_snapshots(market_id, timestamp);

-- ============================================================================
-- RISK TABLES
-- ============================================================================

-- Portfolio risk snapshots
CREATE TABLE portfolio_risk (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform_id TEXT,                       -- NULL for aggregate

    -- Position counts
    num_positions INTEGER NOT NULL,
    num_markets INTEGER NOT NULL,

    -- Exposure
    total_notional REAL NOT NULL,
    max_loss REAL,                          -- Worst case loss

    -- Greeks (for options-like markets)
    total_delta REAL,
    total_gamma REAL,
    total_vega REAL,
    total_theta REAL,

    timestamp INTEGER NOT NULL,

    FOREIGN KEY (platform_id) REFERENCES platforms(id)
);

-- ============================================================================
-- EVENT SOURCING (Enhanced from REDESIGN.md)
-- ============================================================================

CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    -- Event classification
    event_type TEXT NOT NULL,               -- 'MARKET_DISCOVERED', 'TRADE_EXECUTED', etc.
    aggregate_type TEXT NOT NULL,           -- 'market', 'position', 'platform'
    aggregate_id TEXT NOT NULL,

    -- Event data
    payload JSON NOT NULL,

    -- Metadata
    platform_id TEXT,                       -- Which platform (if applicable)
    correlation_id TEXT,                    -- Link related events

    -- Timestamps
    timestamp INTEGER NOT NULL,
    sequence_number INTEGER NOT NULL,

    UNIQUE(aggregate_type, aggregate_id, sequence_number)
);

CREATE INDEX idx_events_time ON events(timestamp);
CREATE INDEX idx_events_type ON events(event_type);
CREATE INDEX idx_events_aggregate ON events(aggregate_type, aggregate_id);
CREATE INDEX idx_events_platform ON events(platform_id);

-- ============================================================================
-- SYSTEM TABLES
-- ============================================================================

CREATE TABLE schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT DEFAULT CURRENT_TIMESTAMP,
    description TEXT
);

INSERT INTO schema_version (version, description)
VALUES (2, 'Multi-platform, multi-market-type schema');
```

### JSON Metadata Examples

```json
// Binary price market (crypto)
{
  "marketType": "binary_price",
  "metadata": {
    "underlying": "ETH",
    "strike": 4000,
    "direction": "above",
    "polymarket": {
      "conditionId": "0x123...",
      "clobTokenIds": ["123", "456"],
      "negRisk": false
    }
  }
}

// Binary event market (political)
{
  "marketType": "binary_event",
  "metadata": {
    "eventType": "election",
    "region": "US",
    "kalshi": {
      "ticker": "PRES-2024-DEM",
      "seriesId": "PRES-2024"
    }
  }
}

// Categorical market (sports)
{
  "marketType": "categorical",
  "metadata": {
    "category": "sports",
    "sport": "NFL",
    "event": "Super Bowl 2025",
    "predictit": {
      "marketId": "7456"
    }
  }
}
```

---

## 7. Event Sourcing Enhancement

### Extended Event Types

```typescript
// Core Event Types (extend REDESIGN.md)
type EventType =
  // Platform events (new)
  | 'PLATFORM_CONNECTED'
  | 'PLATFORM_DISCONNECTED'
  | 'PLATFORM_ERROR'

  // Market events (enhanced)
  | 'MARKET_DISCOVERED'        // New market found
  | 'MARKET_METADATA_UPDATED'  // Market details changed
  | 'MARKET_EXPIRED'
  | 'MARKET_RESOLVED'

  // Outcome events (new for multi-outcome)
  | 'OUTCOME_PRICE_UPDATED'
  | 'OUTCOME_VOLUME_UPDATED'

  // Pricing events (enhanced)
  | 'PRICING_CALCULATED'       // Fair price computed
  | 'PRICING_STRATEGY_CHANGED' // Different strategy selected
  | 'PRICING_CONFIDENCE_LOW'   // Alert: low confidence

  // Data events (enhanced)
  | 'DATA_POINT_RECEIVED'      // From any data source
  | 'DATA_SOURCE_STALE'        // Source not updating
  | 'DATA_SOURCE_RECOVERED'

  // Trading events (existing, enhanced)
  | 'ORDER_PLACED'
  | 'ORDER_FILLED'
  | 'ORDER_CANCELLED'
  | 'ORDER_FAILED'

  // Position events
  | 'POSITION_OPENED'
  | 'POSITION_INCREASED'
  | 'POSITION_DECREASED'
  | 'POSITION_CLOSED'

  // Risk events (new)
  | 'RISK_LIMIT_WARNING'       // Approaching limit
  | 'RISK_LIMIT_BREACHED'      // Limit exceeded
  | 'KILL_SWITCH_ACTIVATED';

// Example: Cross-platform market correlation event
interface MarketDiscoveredEvent {
  type: 'MARKET_DISCOVERED';
  aggregateType: 'market';
  aggregateId: string;  // Internal market ID
  platformId: string;
  payload: {
    platformMarketId: string;
    marketType: MarketType;
    question: string;
    expiresAt: Date;
    metadata: Record<string, any>;
    // Cross-platform link (if same event on multiple platforms)
    correlatedMarketIds?: string[];
  };
  timestamp: number;
}
```

---

## 8. Implementation Phases

### Phase 1: Core Abstractions (2-3 weeks)

**Goal:** Introduce abstraction layers without breaking existing functionality.

| Task | Priority | Effort |
|------|----------|--------|
| Create `TradingPlatform` interface | P0 | 2d |
| Wrap existing Polymarket code as `PolymarketPlatform` | P0 | 3d |
| Create `MarketDefinition` interface | P0 | 2d |
| Create migration from old `Market` to new definition | P0 | 2d |
| Create `PricingStrategy` interface | P0 | 1d |
| Wrap existing Black-Scholes as `BlackScholesStrategy` | P0 | 2d |
| Create `DataSource` interface | P0 | 1d |
| Wrap Binance/Deribit listeners as DataSources | P0 | 2d |

**Deliverable:** Existing system works unchanged, but through new interfaces.

### Phase 2: Database Migration (1-2 weeks)

**Goal:** Migrate to flexible schema without data loss.

| Task | Priority | Effort |
|------|----------|--------|
| Create v2 schema tables | P0 | 1d |
| Write migration script from v1 | P0 | 2d |
| Migrate existing markets to new format | P0 | 1d |
| Update Database.ts with new methods | P0 | 3d |
| Add JSON metadata support | P0 | 1d |
| Test migration with existing data | P0 | 2d |

**Deliverable:** Database supports multi-platform, multi-type markets.

### Phase 3: Kalshi Integration (2-3 weeks)

**Goal:** Prove architecture works with second platform.

| Task | Priority | Effort |
|------|----------|--------|
| Research Kalshi API (REST + WebSocket) | P0 | 2d |
| Implement `KalshiPlatform` adapter | P0 | 5d |
| Implement Kalshi authentication (OAuth) | P0 | 2d |
| Create Kalshi market discovery | P0 | 2d |
| Create Kalshi order execution | P0 | 3d |
| Test with paper trading | P0 | 2d |
| Add to UI platform selector | P1 | 2d |

**Deliverable:** Can discover, quote, and trade on Kalshi.

### Phase 4: Market Type Extensions (2 weeks)

**Goal:** Support non-crypto markets.

| Task | Priority | Effort |
|------|----------|--------|
| Implement `StatisticalPricingStrategy` | P1 | 3d |
| Add polling data source (538, RCP) | P1 | 2d |
| Create `BinaryEventHandler` market type | P1 | 2d |
| Update RiskManager for non-Greek metrics | P1 | 2d |
| Test with political markets | P1 | 2d |

**Deliverable:** Can price and trade political/event markets.

### Phase 5: Event Sourcing Full Implementation (2 weeks)

**Goal:** Complete event sourcing as specified in REDESIGN.md.

| Task | Priority | Effort |
|------|----------|--------|
| Create events table | P1 | 1d |
| Implement event emitting on all writes | P1 | 3d |
| Implement state reconstruction | P1 | 2d |
| Create event replay CLI tool | P2 | 2d |
| Add event streaming to UI | P2 | 2d |

**Deliverable:** Full audit trail, state reconstruction capability.

### Phase 6: Advanced Features (Ongoing)

| Feature | Priority | Effort |
|---------|----------|--------|
| Cross-platform arbitrage detection | P2 | 1w |
| ML-based pricing strategy | P2 | 2w |
| Sports odds data sources | P2 | 1w |
| Mobile-responsive UI | P3 | 1w |
| Kill switch implementation | P0 | 2d |
| Telegram/Discord alerts | P2 | 2d |

---

## 9. Platform Integration Guide

### Adding a New Platform

```typescript
// 1. Create platform adapter
// src/platforms/NewPlatformPlatform.ts

export class NewPlatformPlatform implements TradingPlatform {
  readonly name = 'newplatform';
  readonly supportsMarketTypes: MarketType[] = ['binary_event', 'categorical'];

  async connect(): Promise<void> {
    // Platform-specific authentication
  }

  async discoverMarkets(filters: MarketFilters): Promise<MarketDefinition[]> {
    // Fetch from platform API
    // Transform to MarketDefinition format
  }

  async placeOrder(params: OrderParams): Promise<OrderResult> {
    // Transform to platform format
    // Call platform API
    // Transform result
  }

  // ... implement other methods
}

// 2. Register platform
// src/platforms/index.ts
export const platforms: Record<string, TradingPlatform> = {
  polymarket: new PolymarketPlatform(config),
  kalshi: new KalshiPlatform(config),
  newplatform: new NewPlatformPlatform(config),  // Add new platform
};

// 3. Add to database
INSERT INTO platforms (id, display_name, api_config, enabled)
VALUES ('newplatform', 'New Platform', '{"apiUrl":"..."}', 1);
```

### Adding a New Pricing Strategy

```typescript
// src/pricing/NewStrategy.ts

export class NewPricingStrategy implements PricingStrategy {
  readonly name = 'new_strategy';
  readonly supportedMarketTypes: MarketType[] = ['binary_event'];

  calculateFairPrice(
    market: MarketDefinition,
    data: PricingData
  ): PricingResult {
    // Custom pricing logic
    const probability = this.computeProbability(market, data);

    return {
      fairPrice: probability,
      confidence: this.getConfidence(market, data),
      method: this.name,
      inputs: { /* audit trail */ }
    };
  }

  getConfidence(market: MarketDefinition, data: PricingData): number {
    // Return 0-1 confidence score
  }
}

// Register in strategy factory
strategyFactory.register('new_strategy', NewPricingStrategy);
```

### Adding a New Data Source

```typescript
// src/data/NewDataSource.ts

export class NewDataSource implements DataSource {
  readonly name = 'new_source';
  readonly type: DataSourceType = 'polling';
  readonly symbols = ['POLL_A', 'POLL_B'];

  async start(): Promise<void> {
    // Start polling or WebSocket connection
  }

  getLatest(symbol: string): DataPoint | null {
    return this.cache.get(symbol) || null;
  }

  subscribe(symbol: string, callback: DataCallback): Unsubscribe {
    // Add callback to subscribers
    return () => { /* cleanup */ };
  }
}

// Register
dataSourceRegistry.register(new NewDataSource(config));
```

---

## 10. Risk Assessment

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Migration breaks existing functionality | Medium | High | Extensive testing, parallel running |
| Kalshi API changes | Low | Medium | Abstract adapter layer, version checks |
| Performance degradation from abstraction | Low | Medium | Benchmark before/after, optimize hot paths |
| Event store grows too large | Medium | Low | Implement TTL-based pruning, archival |

### Business Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Kalshi API access requires approval | High | High | Apply early, have fallback platforms |
| Platform ToS changes prohibit bots | Low | High | Monitor ToS, diversify platforms |
| Pricing model inaccurate for new market types | Medium | Medium | Start with paper trading, validate |

### Security Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Multi-platform credential management | Medium | High | Secure vault, per-platform encryption |
| Cross-platform data leakage | Low | Medium | Strict data isolation, audit logging |

---

## Summary

### Key Differences from Original REDESIGN.md

| Aspect | Original REDESIGN.md | This Plan |
|--------|---------------------|-----------|
| **Scope** | Polymarket + crypto only | Multi-platform, multi-market-type |
| **Platform Support** | Single (Polymarket) | Polymarket, Kalshi, PredictIt, extensible |
| **Market Types** | Binary crypto options | Binary price, binary event, categorical |
| **Pricing** | Black-Scholes only | Pluggable strategies (BS, statistical, ML) |
| **Data Sources** | Binance + Deribit | Pluggable sources (spot, IV, polls, odds) |
| **Database Schema** | Crypto-centric | Type-agnostic with JSON metadata |

### Recommendation

**Implement in phases:**
1. **Phase 1-2 (Critical):** Core abstractions + database migration
2. **Phase 3 (High):** Kalshi integration (proves architecture)
3. **Phase 4-5 (Medium):** Market type extensions + event sourcing
4. **Phase 6 (Low):** Advanced features

This approach:
- Maintains backward compatibility with existing Polymarket trading
- Creates clear extension points for new platforms
- Enables different pricing models for different market types
- Supports the event sourcing vision from the original REDESIGN.md
- Positions PolyTrade as a **universal prediction market trading platform**

---

*Document Version: 2.0*
*Last Updated: January 2025*
*Supersedes: REDESIGN.md (which should be kept for reference)*
