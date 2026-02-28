# PolyTrade

**Multi-Platform Algorithmic Trading System for Prediction Markets**

PolyTrade is a full-stack algorithmic trading platform that prices, monitors, and market-makes on Polymarket crypto binary options using live implied volatility from Deribit and spot prices from Binance. A separate research layer ingests historical trade data into SQLite + DuckDB for calibration analysis, mispricing detection, and market scoring.

---

## Table of Contents

1. [Project Goal](#project-goal)
2. [System Architecture](#system-architecture)
3. [UI Walkthrough](#ui-walkthrough)
   - [Trading Dashboard](#1-trading-dashboard)
   - [Market Discovery](#2-market-discovery)
   - [Pricing Table](#3-pricing-table)
   - [Markets Overview](#4-markets-overview)
   - [Portfolio & Orders](#5-portfolio--orders)
   - [Safety Monitor](#6-safety-monitor)
   - [Research — Data](#7-research--data)
   - [Research — Scanner](#8-research--scanner)
4. [Codebase Structure](#codebase-structure)
5. [Database Architecture](#database-architecture)
6. [Research System](#research-system)
7. [Trading API](#trading-api)
8. [Market Making Engine](#market-making-engine)
9. [Safety & Reliability](#safety--reliability)
10. [Finding Mispriced Markets](#finding-mispriced-markets)
11. [Quick Start](#quick-start)
12. [Configuration](#configuration)

---

## Project Goal

PolyTrade is an **algorithmic trading system** for prediction markets. It targets Polymarket crypto binary options via a Black-Scholes fair-value approach, and is architected to extend cleanly to Kalshi, PredictIt, and any future platform.

| Platform       | Market Types                         | Status      |
| -------------- | ------------------------------------ | ----------- |
| **Polymarket** | Crypto binary options, event markets | Implemented |
| **Kalshi**     | Political, economic, event markets   | Planned     |
| **PredictIt**  | Political markets                    | Planned     |

| Capability             | Description                                                             |
| ---------------------- | ----------------------------------------------------------------------- |
| **Market Discovery**   | Scans and categorises tradeable markets across platforms                |
| **Fair Value Pricing** | Black-Scholes for crypto options, statistical scoring for event markets |
| **Market Making**      | Quotes bid/ask spread with gamma/inventory adjustments                  |
| **Risk Management**    | Live Greeks monitoring, portfolio limits, per-market kill switch        |
| **Safety Monitoring**  | Staleness checks, gap detection, orderbook depth gating                 |
| **Order Execution**    | Places, tracks, and cancels orders via platform CLOB API                |
| **Research Engine**    | DuckDB + SQLite analysis layer for mispricing detection and backtesting |
| **Data Persistence**   | Two-layer database: live trading DB (SQLite v2) + research DB (SQLite)  |

---

## System Architecture

```
+==============================================================================+
|                           POLYTRADE SYSTEM                                   |
+==============================================================================+
|                                                                              |
|  EXTERNAL DATA SOURCES          TRADING PLATFORMS           MARKET DATA      |
|  +------------------------+     +------------------+        +-------------+ |
|  |  Binance WebSocket     |     |  Polymarket CLOB |        |  Parquet /  | |
|  |  (Spot prices)         |     |  API + CLOB WS   |        |  DuckDB     | |
|  |  BTC / ETH tick        |     |  (orders, fills) |        |  research   | |
|  +----------+-------------+     +---------+--------+        |  data sets  | |
|             |                             |                  +------+------+ |
|  +----------+-----------+                |                         |        |
|  |  Deribit WebSocket   |                |                         |        |
|  |  (Implied vol, IV)   |                |                         |        |
|  +----------+-----------+                |                         |        |
|             |                            |                         |        |
|  -----------+----------------------------+-------------------------+------   |
|                        ABSTRACTION LAYER                                     |
|  +------------------+  +------------------+  +----------------------------+ |
|  |  DataSource      |  |  TradingPlatform |  |  PricingStrategy          | |
|  |  Interface       |  |  Interface       |  |  Interface                | |
|  +--------+---------+  +--------+---------+  +-------------+-------------+ |
|           |                     |                           |               |
|  ---------+---------------------+---------------------------+-----------    |
|                           CORE SERVICES                                      |
|  +-----------+  +------------------+  +--------------------------------+    |
|  | ServiceReg|  | TradingService   |  | MarketPricingWirer             |    |
|  | per-crypto|  | circuit breaker  |  | wires markets to BS pricing    |    |
|  | SafetyMon |  | retry, valid.    |  | + Greeks live                  |    |
|  +-----------+  +------------------+  +--------------------------------+    |
|                                                                              |
|  +------------------------------------------------------------------------+ |
|  |                        MARKET MAKER (2 s tick)                         | |
|  |  +-----------+  +------------+  +---------------+  +---------------+  | |
|  |  | Strategy  |  | RiskManager|  | SafetyMonitor |  | InventoryTrk  |  | |
|  |  | (QP spread|  | (Greeks    |  | (staleness,   |  | (skew adj.)   |  | |
|  |  |  formula) |  |  limits)   |  |  gap detect)  |  |               |  | |
|  |  +-----------+  +------------+  +---------------+  +---------------+  | |
|  +------------------------------------------------------------------------+ |
|                                                                              |
|  +------------------------------------------------------------------------+ |
|  |                        DATABASE LAYER                                   | |
|  |  Trading DB (SQLite v2, WAL)          Research DB (SQLite + DuckDB)    | |
|  |  platforms / markets / outcomes /     markets / trades / analysis /    | |
|  |  positions / trades / data_points /   mispricing_signals / scores      | |
|  |  pricing_snapshots / portfolio_risk   Parquet via DuckDB views         | |
|  |  / events (event sourcing audit)                                        | |
|  +------------------------------------------------------------------------+ |
|                                                                              |
|  +------------------------------+    +----------------------------------+    |
|  |  REST + WebSocket API        |    |  React UI (Vite, port 5173)     |    |
|  |  Express server (port 3002)  |----|  Dashboard / Research / Orders  |    |
|  |  Zod input validation        |    |  Greeks / Safety / SQL explorer |    |
|  +------------------------------+    +----------------------------------+    |
+==============================================================================+
```

### Data Flow: Live Pricing

```
Binance WS (tick) --> BinancePriceListener --> ServiceRegistry.updateSpot()
Deribit WS (iv)  --> DeribitListener       --> ServiceRegistry.updateIV()
                                                       |
                                              SafetyMonitor.isSafeToQuote()
                                                       |
                                        MarketPricingWirer.onDataUpdate()
                                                       |
                                        BlackScholesStrategy.calculate()
                                                       |
                                        PricingSnapshot --> MarketMaker.tick()
                                                       |
                                      Strategy.generateQuote()  (QP spread)
                                                       |
                                      ClobClient.placeOrder() --> Polymarket
```

### Data Flow: Research

```
Parquet files (polymarket_markets, polymarket_trades, kalshi_*)
       |
       v
DuckDB in-memory views  <--  ParquetQueryService (SQL query engine)
       |
LiveDataIngester --------->  ResearchDatabase (Research.db SQLite)
       |                      markets / trades / analysis_cache /
       |                      mispricing_signals / research_positions
       v
AnalysisEngine
  +-- calculateWinRateByPrice()    -> win rate calibration (longshot bias)
  +-- detectMispricingSignals()    -> fair value vs market price delta
  +-- scoreLiquidMarkets()         -> liquidity + spread scoring
  +-- generateResearchReport()     -> combined scoring output

       |
       v
     UI: MispricingScanner / WinRateChart / MarketScoresPanel / SqlQueryPanel
```

---

## UI Walkthrough

The React dashboard (Vite, port `5173`) is organized into two top-level tabs: **Trading Dashboard** and **Research**. The Trading Dashboard further subdivides into **Trading**, **Markets**, and **Discovery** sub-views.

> **Screenshots:** Save the corresponding PNG files to `docs/screenshots/` to render the images below.

---

### 1. Trading Dashboard

![Trading Dashboard](docs/screenshots/trading-dashboard.png)

The primary operational view. Split into three panels:

#### Left — Markets Panel

Displays all markets currently wired for live pricing. Each row shows:

| Column | Description |
|--------|-------------|
| **Question** | Market title (e.g., "Will BTC close above $68,000?") |
| **Price** | Current mid-market price from the Polymarket CLOB |
| **Volume 24h** | 24-hour trading volume in USD |
| **Ends** | UTC expiry timestamp |

The **My Positions** button filters the list to only markets where you hold an open position. When no markets are wired, the panel shows `No markets available`.

#### Right — Pricing & Greeks Panel

Shows the **Black-Scholes derived fair value** and **option Greeks** for the selected market:

| Field | Description |
|-------|-------------|
| **Fair Value** | `N(d2)` — the risk-neutral probability that the market resolves YES |
| **Spot** | Live BTC or ETH price from Binance WebSocket |
| **Strike** | Binary option strike price from market metadata |
| **IV** | Deribit mark implied volatility (annualised %) |
| **Delta** | ∂V/∂S — sensitivity to a $1 move in spot |
| **Gamma** | ∂²V/∂S² — rate of change of delta |
| **Vega** | ∂V/∂σ — sensitivity per 1% IV move |
| **Theta** | ∂V/∂t — daily time decay in contract value |

The panel shows `INITIALIZING` while the backend is connecting to Deribit/Binance. Once both feeds are live, fair values update in real time.

The **Interpretation** bar at the bottom renders a human-readable summary (e.g., _"OTM call, mild negative edge vs. market"_).

#### Bottom — Order Book Panel

Live bid/ask ladder fetched from the Polymarket CLOB. Red rows are asks (offers to sell), blue/white rows are bids. The **MID** and **SPREAD** (shown as a percentage) are computed from best bid and best ask.

---

### 2. Market Discovery

![Market Discovery](docs/screenshots/market-discovery.png)

The **Discovery** sub-view scans for available Polymarket markets matching the selected crypto asset and date range.

#### Controls Bar

| Control | Description |
|---------|-------------|
| **Crypto** | Select `Bitcoin (BTC)` or `Ethereum (ETH)` |
| **Days Ahead** | How far forward to scan (7 / 14 / 30 days) |
| **Refresh** | Re-queries Polymarket Gamma API for new markets |
| **Wire All BTC Markets** | Wires every discovered market for live pricing in one click |
| **Show Pricing Table / Show Discovery** | Toggle between the strike grid and the live pricing table |

The live spot price and ATM implied vol are shown in the header bar (e.g., **BTC: $65,612.32 | ATM VOL: 53.0%**) with a freshness indicator.

#### Strike Grid

Markets are grouped by **expiry date**. Expanding a date reveals one row per strike:

| Column | Description |
|--------|-------------|
| **Strike** | Dollar strike (e.g., $66,000) |
| **YES** | Current YES bid (green) — probability market resolves YES |
| **NO** | Current NO ask (red) — complement: `1 − YES` |
| **Spread** | Bid-ask spread as a percentage of mid |
| **24H Vol** | 24-hour volume in USD |
| **Liquidity** | Best-level depth (total size × price) |
| **Action** | **View** (deep OTM) or **Wire** (near ATM, wirable for MM) |

Markets deep out-of-the-money (near $66,000 when spot is $65,600) display a **Wire** button because fair value divergence is meaningful there. Extremely deep OTM/ITM markets show **View** instead — the spread exceeds any realistic edge.

---

### 3. Pricing Table

![Pricing Table](docs/screenshots/pricing-table.png)

The **BTC Live Pricing** table (accessed via "Show Pricing Table") compares **market prices vs. derived (Black-Scholes) prices** side-by-side for every wired market.

| Column Group | Description |
|--------------|-------------|
| **Strike / Expiry / Spot** | Market parameters. Spot updates live from Binance. |
| **Fair** | Black-Scholes `N(d2)` fair value |
| **Market** | Live CLOB bid, ask, and spread in basis points |
| **Derived (Strategy)** | MM's quoted bid/ask, spread, and computed **Edge** (fair − market mid). Green = positive edge, red = negative. |
| **Greeks** (Δ, Γ, N, Θ) | Per-contract delta, gamma, vega, theta |

The top-right shows **Spot staleness** and **IV staleness** in seconds — these turn red when feeds go stale, which would trigger the SafetyMonitor to halt quoting.

---

### 4. Markets Overview

![Markets Overview](docs/screenshots/markets-overview.png)

The **Markets** sub-view gives a compact status panel for all known markets, with four filter tabs:

| Tab | Shows |
|-----|-------|
| **All** | Every market in the local market registry |
| **Connected** | Markets with live CLOB WebSocket subscriptions |
| **Positions** | Markets where you hold an open position |
| **Orders** | Markets with at least one open order |

The **Crypto Only** checkbox hides event markets and shows only BTC/ETH binary options.

Each market card shows:
- **Asset + Strike + Direction** badge (e.g., `BTC · $64,000 · YES`)
- **Expiry** badge (e.g., `Mar 1`)
- **Bid / Ask** from CLOB (or `—` if no live quote)
- **Spread** in basis points
- **Fair / Spot** — Black-Scholes fair value and current spot price
- **IV** — Deribit implied vol driving the pricing
- **Greeks summary** — `V:0.00 G:0.0000` (vega / gamma)
- **Disconnect** button — removes the market from live pricing

---

### 5. Portfolio & Orders

![Portfolio & Orders](docs/screenshots/portfolio-orders.png)

The **Portfolio & Orders** top-level tab is the position management hub.

#### Portfolio Greeks

Aggregates option Greeks **across all active crypto positions**:

| Metric | Description |
|--------|-------------|
| **Net Delta** | Directional BTC/ETH exposure |
| **Net Gamma** | Convexity — accelerates delta on large spot moves |
| **Net Vega** | IV sensitivity |
| **Net Theta** | Daily time decay cost |

Shows `No active crypto positions (filtered from N total positions)` when all positions are closed. This tells you positions exist in the DB but none currently qualify for Greek aggregation.

#### Order Management

Live order book for your account on Polymarket. Shows counts of **open buy** and **open sell** resting orders. **Cancel All** cancels every open order in one click.

Individual order rows show: market question, side, size, limit price, time-in-force, and a cancel button.

#### Positions Table

Full position history with **Status** and **Type** filters:

| Column | Description |
|--------|-------------|
| **Market** | Market question with category badge (`CRYPTO`, `POLITICS`, etc.) |
| **Outcome** | YES or NO |
| **Status** | ACTIVE (open) / CLOSED (resolved) / REDEEMABLE (won, claimable) |
| **Size** | Current position size |
| **Avg Entry** | Average fill price |
| **Current / Exit** | Current market price (if active) or exit price (if resolved) |
| **PnL** | Realised profit/loss in USD |
| **PnL %** | Return on capital |

---

### 6. Safety Monitor

![Safety Monitor](docs/screenshots/safety-monitor.png)

The **Safety Monitor** panel (in the Controls tab) provides a real-time health dashboard for all wired markets.

| Metric | Description |
|--------|-------------|
| **Total Markets** | Markets currently under safety supervision |
| **Safe Markets** | Markets where all checks pass — quotes are being generated |
| **Unsafe Markets** | Markets blocked from quoting due to a failed check |
| **Safety Rate** | `Safe / Total × 100%` |

The system performs the following checks before generating any quote:

| Check | Threshold | Effect on Failure |
|-------|-----------|-------------------|
| Spot price staleness | > 5,000 ms | Halts **all** markets for that crypto |
| IV staleness | > 30,000 ms | Halts **all** markets for that crypto |
| Spot price gap (per tick) | > 2% | Halts **all** markets for that crypto |
| Orderbook staleness | > 10,000 ms | Skips **this market only** |
| Orderbook depth | Configurable | Skips **this market only** |

`No markets being monitored yet. Markets will appear here once they are wired for pricing.` is the initial state before any markets are wired via the Discovery tab.

---

### 7. Research — Data

![Research Data](docs/screenshots/research-data.png)

The **Research** top-level tab is the data pipeline and analysis hub. It has four sub-tabs: **Data**, **Query**, **Analysis**, and **Scanner**.

#### Data Status Panel (top)

| Metric | Description |
|--------|-------------|
| **Markets** | Records in `research_markets` SQLite table |
| **Trades** | Records in `research_trades` (can be millions) |
| **Signals** | Active mispricing signals detected by `AnalysisEngine` |
| **Positions** | Open research positions in the paper-trading tracker |

**Sync Status** shows when each sync last ran and counts of Active / Resolved markets. The **Stopped** badge turns green when the background ingester is active.

#### Backfill Panel (bottom)

Controls for pulling historical data into the research DB:

| Control | Description |
|---------|-------------|
| **Category** | Filter markets to sync: All, Crypto, Politics, Sports, Finance, etc. |
| **Days** | Lookback window slider (1–90 days). Default 30d. |
| **Include Resolved Markets** | Toggle to pull closed/resolved markets (required for calibration) |
| **Start Backfill** | Fires `POST /api/research/ingest` |

**How backfill works internally:**
1. Gamma API queried for markets matching the category
2. For each market, Data API paginated (500 trades/page, newest-first)
3. Trades inserted with `INSERT OR IGNORE` via `UNIQUE INDEX (condition_id, asset, timestamp, price)`
4. After ingestion, `AnalysisEngine` runs calibration and scoring automatically

---

### 8. Research — Scanner

![Research Scanner](docs/screenshots/research-scanner.png)

The **Scanner** sub-tab surfaces actionable opportunities from the research database.

#### Market Scores for MM

Ranks all markets by composite market-making suitability score (**0–100**):

| Score Range | Recommendation | Meaning |
|------------|----------------|---------|
| 80–100 | **EXCELLENT** | Ideal for market making |
| 60–79 | **GOOD** | Strong candidate |
| 40–59 | **FAIR** | Worth monitoring |
| < 40 | **POOR** | Insufficient liquidity/volume |

Controls:
- **Exclude Crypto Markets** — hide BTC/ETH options (already priced via Black-Scholes)
- **Min Score** — filter threshold (default 40)

Each row shows: market question, score bar, recommendation badge, volume, liquidity, and spread.

The score is computed from:
1. **Liquidity** — tight relative spread (lower spread → higher score)
2. **Volume** — log-rank vs. all tracked markets over 7 days
3. **Spread stability** — spread variance over time

#### Mispricing Scanner

Finds active markets where the current price deviates materially from estimated fair value:

| Control | Description |
|---------|-------------|
| **Min Mispricing %** | Minimum estimated edge (default 3%) |
| **Min Confidence** | Minimum signal confidence 0–1 (default 0.5) |

Each detected signal shows: direction (BUY YES / BUY NO), market question, market price vs. fair value, mispricing %, confidence score, and a reasoning string.

`No mispricing opportunities found. Try lowering the minimum mispricing threshold.` appears when no active markets exceed the threshold — common during low-volume periods or when the research DB needs a fresh backfill.

---

## Codebase Structure

```
PolyTrade/
+-- server.ts                      # Express + WS API server
|                                  # Initialises all services, routes, WS push
+-- src/
|   +-- index.ts                   # Public library exports
|   |
|   +-- platforms/                 # Trading platform abstraction layer
|   |   +-- TradingPlatform.ts     # Core interface: connect, discoverMarkets,
|   |   |                          #   placeOrder, getPositions, getBalance
|   |   +-- polymarket/
|   |       +-- PolymarketPlatform.ts  # Polymarket implementation
|   |
|   +-- markets/
|   |   +-- MarketDefinition.ts    # Type-agnostic market (binary_price /
|   |                              #   binary_event / categorical / continuous)
|   |
|   +-- pricing/
|   |   +-- PricingStrategy.ts     # Strategy interface
|   |   +-- BinaryGreeksCalculator.ts  # Greeks: delta, gamma, vega, theta
|   |   +-- strategies/
|   |       +-- BlackScholesStrategy.ts    # N(d2) = risk-neutral prob
|   |       +-- StatisticalStrategy.ts     # Poll aggregation, base rates
|   |
|   +-- data/
|   |   +-- DataSource.ts          # Stream interface: start/stop/subscribe
|   |   +-- sources/
|   |       +-- BinanceDataSource.ts    # Spot price adapter
|   |       +-- DeribitDataSource.ts    # IV adapter
|   |
|   +-- db/
|   |   +-- Database.ts            # v1 DB (original BTC/ETH binary only)
|   |   +-- DatabaseV2.ts          # v2 DB (multi-platform, multi-type)
|   |   +-- schema_v2.sql          # Full schema
|   |   +-- migrate_v1_to_v2.ts    # v1 -> v2 migration script
|   |   +-- rollback_v2_to_v1.ts   # Rollback safety
|   |   +-- validate_migration.ts  # Post-migration data integrity checks
|   |
|   +-- services/
|   |   +-- TradingService.ts      # Facade: circuit breaker + validation
|   |   +-- MarketPricingWirer.ts  # Wires markets -> pricing -> Greeks live
|   |   +-- MarketSubscriptionManager.ts   # WS subscription lifecycle
|   |   +-- PortfolioGreeksAggregator.ts   # Aggregates Greeks across markets
|   |   +-- DiscoveryOrchestrator.ts       # Orchestrates market discovery
|   |   |
|   |   +-- binance/
|   |   |   +-- BinancePriceListener.ts    # WS + REST spot feed
|   |   |   +-- BinanceWsClient.ts         # Low-level WS client
|   |   |   +-- BinanceRequestor.ts        # REST API client
|   |   |
|   |   +-- deribit/
|   |   |   +-- DeribitListener.ts         # WS IV feed (mark_iv)
|   |   |   +-- DeribitRequestor.ts        # REST: tickers, instruments
|   |   |
|   |   +-- polymarket/
|   |   |   +-- ClobClient.ts              # Signed order submission (CLOB)
|   |   |   +-- DataApi.ts                 # REST: positions, orders
|   |   |   +-- MarketDiscoveryService.ts  # Find active crypto markets
|   |   |   +-- MarketPricingService.ts    # Per-market pricing snapshots
|   |   |   +-- OrderBook.ts               # Orderbook fetch + cache
|   |   |   +-- OrderManager.ts            # Place / cancel / track orders
|   |   |   +-- PositionTracker.ts         # Portfolio position tracker
|   |   |   +-- streaming/
|   |   |       +-- HybridStreamManager.ts # WS + REST fallback manager
|   |   |       +-- ConnectionPool.ts      # Pool of WS connections
|   |   |       +-- TickBuffer.ts          # Tick deduplication + ordering
|   |   |
|   |   +-- market-maker/
|   |       +-- MarketMaker.ts             # Main 2 s trading loop
|   |       +-- Strategy.ts               # QP spread (gamma + inventory)
|   |       +-- RiskManager.ts            # Greeks limit checks
|   |       +-- SafetyMonitor.ts          # Staleness + gap detection
|   |       +-- InventoryTracker.ts       # Net inventory per market
|   |
|   +-- research/
|   |   +-- AnalysisEngine.ts       # Win rate calibration, mispricing, scoring
|   |   +-- LiveDataIngester.ts     # Pulls live Polymarket data into Research.db
|   |   +-- ParquetQueryService.ts  # DuckDB SQL engine over Parquet datasets
|   |   +-- ResearchDatabase.ts     # Research.db schema + query methods
|   |
|   +-- lib/
|       +-- CircuitBreaker.ts       # CLOSED / OPEN / HALF_OPEN state machine
|       +-- ServiceRegistry.ts      # Per-crypto service health + safety
|       +-- auth/                   # HMAC signature for CLOB API
|       +-- config/                 # Zod-validated env schema + loader
|       +-- metrics/
|       |   +-- PerformanceMetrics.ts  # p95/p99 latency, success rates per feed
|       +-- rate-limit/             # Token bucket rate limiter
|       +-- retry/                  # Exponential backoff RetryHandler
|
+-- ui/                            # React dashboard (Vite, port 5173)
|   +-- src/
|       +-- components/
|           +-- TradingDashboard.tsx        # Live Greeks + pricing
|           +-- LivePricingTable.tsx        # All market fair values
|           +-- MarketMakerControls.tsx     # Start/stop MM, paper mode
|           +-- OrdersPanel.tsx             # Open orders
|           +-- PositionsPanel.tsx          # Current positions
|           +-- PortfolioGreeksPanel.tsx    # Aggregate Greeks
|           +-- SafetyMonitorPanel.tsx      # Per-market safety status
|           +-- RiskLimitsPanel.tsx         # Risk limit gauges
|           +-- StreamingStatusPanel.tsx    # WS / REST feed health
|           +-- SystemStatusPanel.tsx       # Service initialisation state
|           +-- research/
|               +-- ResearchPage.tsx        # Research hub
|               +-- MispricingScanner.tsx   # Detected mispricing signals
|               +-- WinRateChart.tsx        # Calibration (longshot bias)
|               +-- MarketScoresPanel.tsx   # Market scoring table
|               +-- SqlQueryPanel.tsx       # Live DuckDB SQL explorer
|               +-- BackfillPanel.tsx       # Data ingestion controls
|               +-- DataStatusPanel.tsx     # Research DB stats
|
+-- scripts/                        # PowerShell operational scripts
|   +-- start.ps1 / stop.ps1 / status.ps1
|   +-- run-tests.ps1 / seed-db.mjs
|
+-- prediction-market-data/         # Research data pipeline (Python)
|   +-- main.py                     # Entry: download + index Parquet data
|   +-- src/
|   |   +-- indexers/               # Polymarket + Kalshi data fetchers
|   |   +-- analysis/               # Python analysis modules
|   +-- data/
|       +-- polymarket/             # Parquet: markets, trades, positions
|       +-- kalshi/                 # Parquet: markets, trades
|
+-- test/          # Integration + unit tests
+-- docs/          # Architecture docs + screenshots
+-- package.json
```

---

## Database Architecture

The system uses **two separate databases** with distinct responsibilities.

---

### 1. PolyTrade.db — Live Trading Database (SQLite v2, WAL Mode)

Operational database. Created automatically on first run and migrated from v1 if needed.

**Core tables:**

```
platforms
  id (PK)  display_name  api_config (JSON)  enabled

markets
  id (UUID)  platform_id (FK)  platform_market_id
  market_type  CHECK IN ('binary_price','binary_event','categorical','continuous')
  question  expires_at  closes_at  resolved_at
  resolved  resolution_outcome  active
  metadata (JSON)
    binary_price:  { "underlying":"BTC", "strike":66000, "direction":"above" }

market_outcomes
  id  market_id (FK)  outcome_name  platform_token_id
  current_price  last_trade_price
```

**Trading tables:**

```
positions
  id  platform_id  market_id (FK)  outcome_id (FK)
  quantity  average_price  opened_at  updated_at

trades  (immutable append-only)
  id  platform_id  market_id (FK)  outcome_id (FK)
  platform_order_id  side (BUY/SELL)  quantity  price
  trade_type (MAKER/TAKER/HEDGE)  fees  realized_pnl  executed_at
```

**Data + pricing tables:**

```
data_points  (time-series ring)
  id  source_id (FK)  symbol ('BTCUSDT','BTC_IV',...)
  value  metadata (JSON)  timestamp (unix ms)

pricing_snapshots  (audit trail)
  id  market_id (FK)  fair_price  confidence
  strategy_used ('black_scholes','statistical','ml','composite')
  inputs (JSON)  delta  gamma  vega  theta  timestamp

portfolio_risk  (time-series)
  id  platform_id  num_positions  num_markets
  total_delta  total_gamma  total_vega  total_theta  timestamp
```

**Event sourcing (complete audit trail):**

```
events
  id  event_type  aggregate_type  aggregate_id
  payload (JSON)  correlation_id  timestamp (unix ms)  sequence_number

  event_type examples:
    MARKET_DISCOVERED  TRADE_EXECUTED  PRICE_UPDATED
    RISK_LIMIT_BREACHED  ORDER_PLACED  ORDER_CANCELLED
```

**CQRS read views:**

| View | Purpose |
|------|---------|
| `v_active_markets` | Non-expired, non-resolved markets with counts |
| `v_portfolio_summary` | Aggregate positions per platform |
| `v_recent_trades` | Trades joined with market + outcome context |

---

### 2. Research.db — Analysis & Research Database (SQLite + DuckDB)

Separate from the live trading DB. Never on the hot path.

```
research_markets       # Market metadata + resolution outcomes
research_trades        # Individual fills (deduped by UNIQUE INDEX)
analysis_cache         # Memoised analysis results with TTL
mispricing_signals     # Detected fair value vs. market price gaps
research_positions     # Paper trading position tracker
win_rate_cache         # Pre-computed calibration buckets
market_scores          # Composite per-market MM scores
```

**DuckDB Parquet views** (registered automatically on first query):

- `polymarket_markets` — market definitions, volumes, prices, resolutions
- `polymarket_trades` — CTF exchange fills (maker/taker, price, size)
- `polymarket_positions` — wallet-level position snapshots
- `kalshi_markets` — Kalshi event market data

---

## Research System

### Purpose

The research system answers: **"Is any market mispriced, and by how much?"**

Runs entirely separately from the live trading loop — zero impact on order execution latency.

### Analysis Methods

#### 1. Win Rate Calibration (Longshot Bias Detection)

Groups all resolved markets by price at close into 1-cent buckets:

```
expectedWinRate = price / 100
actualWinRate   = fraction resolved YES at that price
overconfidence  = actualWinRate − expectedWinRate
```

Negative overconfidence at prices 1–10 cents is **longshot bias** — the market overprices unlikely events, creating a structural edge for selling low-probability outcomes.

#### 2. Mispricing Signal Detection

```
|market_price - fair_value| / fair_value  >  threshold (e.g. 5%)
```

Signals stored with status: `PENDING` → `ACTED` → `EXPIRED`.

#### 3. Market Scoring

Composite score (0–100) across: liquidity, relative spread, and 7-day rolling volume.

#### 4. DuckDB SQL Explorer

Live SQL REPL backed by DuckDB:

```sql
-- Markets where final price was wrong by > 30%
SELECT question, outcome_prices, resolution, volume
FROM polymarket_markets
WHERE closed = TRUE AND resolution IS NOT NULL
  AND ABS(CAST(JSON_EXTRACT(outcome_prices, '$[0]') AS DOUBLE)
          - CASE WHEN resolution = 'YES' THEN 1.0 ELSE 0.0 END) > 0.3
  AND volume > 10000
ORDER BY volume DESC;
```

Write operations are blocked at the service level.

---

## Trading API

Express server on port `3002`.

### REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Service health + init status |
| GET | `/api/markets` | Active markets with current prices |
| GET | `/api/markets/discover` | Trigger discovery scan |
| GET | `/api/pricing` | Fair value snapshots for all markets |
| GET | `/api/pricing/:tokenId` | Fair value for one market |
| GET | `/api/positions` | Open positions |
| GET | `/api/orders` | Open orders |
| POST | `/api/orders` | Place order (Zod-validated) |
| DELETE | `/api/orders/:orderId` | Cancel order |
| POST | `/api/market-maker/start` | Start market making loop |
| POST | `/api/market-maker/stop` | Stop market making loop |
| GET | `/api/greeks` | Portfolio Greeks |
| GET | `/api/greeks/:crypto` | Per-crypto Greeks |
| GET | `/api/risk` | Risk status + limit checks |
| GET | `/api/safety` | Per-market safety status |
| GET | `/api/streams` | Feed health (Binance/Deribit) |
| GET | `/api/metrics` | p95/p99 latency, success rates |
| POST | `/api/research/ingest` | Trigger live market ingestion |
| GET | `/api/research/win-rates` | Win rate calibration data |
| GET | `/api/research/mispricing` | Active mispricing signals |
| GET | `/api/research/scores` | Market composite scores |
| POST | `/api/research/query` | Run read-only DuckDB SQL |

### WebSocket Feed (`ws://localhost:3002`)

Real-time push every 2 s:

```json
{
  "type": "state_update",
  "data": {
    "pricing": { "<tokenId>": { "fairPrice": 0.42, "delta": 0.42, "gamma": 0.08 } },
    "greeks": { "ETH": { "delta": 12.4, "gamma": 0.3, "vega": 8.1 } },
    "safety": { "<tokenId>": { "safe": true, "reasons": [] } },
    "streams": { "binance_ETH": "OK", "deribit_ETH": "OK" }
  }
}
```

---

## Market Making Engine

### The Trading Loop

`MarketMaker` runs on a **2-second timer**:

1. **Risk check** — `RiskManager.checkRisk(greeks)` against configured limits
2. **Per-market safety** — `SafetyMonitor.isSafeToQuote()` for each underlying
3. **Quote generation** — `Strategy.generateQuote()` runs the QP spread formula
4. **Order management** — Stale quotes cancelled and replaced via CLOB API

### Spread Formula (QP)

```
spread = baseSpread × r_ATM × r_T × r_gamma

r_ATM   = 1 + 0.5 × exp(−m² / 0.1)     where m = |ln(K/S)|
r_T     = 1 + 0.3 × T
r_gamma = 1 + k_gamma × |portfolio_gamma|

adjustedSpread = clamp(spread, minSpread, maxSpread)
```

**Inventory skew:**

```
adjusted_mid = fair_price − k_inv × q_net
```

### Risk Limits

| Limit | Default | Description |
|-------|---------|-------------|
| `maxDelta` | 50 | Max aggregate delta |
| `maxGamma` | 5 | Max aggregate gamma |
| `maxVega` | 100 | Max aggregate vega |
| `maxNotional` | 50,000 | Max total notional ($) |
| `minSpread` | 0.5% | Minimum bid-ask spread |
| `maxSpread` | 10% | Maximum bid-ask spread |

---

## Safety & Reliability

| Check | Threshold | Effect |
|-------|-----------|--------|
| Spot staleness | > 5,000 ms | Halt all markets for that crypto |
| IV staleness | > 30,000 ms | Halt all markets for that crypto |
| Spot tick gap | > 2% | Halt all markets for that crypto |
| Orderbook staleness | > 10,000 ms | Skip this market only |

Additional reliability features:

- **Circuit Breaker** — `CLOSED → OPEN → HALF_OPEN` on external API failures
- **RetryHandler** — exponential backoff with jitter on REST calls
- **HybridStreamManager** — automatic REST fallback when WebSocket drops
- **TickBuffer** — deduplicates and re-orders ticks on reconnect
- **PerformanceMetrics** — p50/p95/p99 latency per service
- **WAL mode** — concurrent reads during writes, crash-safe SQLite

---

## Finding Mispriced Markets

### 1. Black-Scholes Divergence (Crypto Markets)

```
fair_price = N(d2)

d1 = [ln(S/K) + (r + σ²/2) × T] / (σ × √T)
d2 = d1 − σ × √T

S = Binance spot (live WS)
K = Strike from market metadata
σ = Deribit mark IV (live WS)
T = Time to expiry (seconds / 31,557,600)
```

If `|polymarket_mid − N(d2)| > bid_ask_spread`, there is a tradeable edge.

### 2. Calibration-Based Edge

1. Compute historical win rate for each 1-cent price bucket
2. Identify systematic biases (e.g., 5¢ markets win only 3% → overpriced by 2%)
3. Edge = `actualWinRate − marketPrice`

### 3. Market Score Ranking

`scoreLiquidMarkets()` ranks by composite score across liquidity, volume, and spread stability.

### 4. DuckDB SQL Explorer

Direct SQL access to historical Parquet data for ad-hoc analysis.

---

## Quick Start

### Prerequisites

- Node.js 18+
- npm
- Python 3.10+ (optional, for research data pipeline)

### Install

```bash
cd PolyTrade
npm install
cd ui && npm install && cd ..
```

### Configure

Copy `.env.example` to `.env`:

```env
# Required for live trading
POLYMARKETS_PRIVATE_KEY=your_ethereum_private_key
POLYMARKET_FUNDER_ADDRESS=your_wallet_address

# Optional
API_PORT=3002
LOG_LEVEL=info
ENABLE_BINANCE=true
ENABLE_DERIBIT=true
DB_PATH=./PolyTrade.db
RESEARCH_DB_PATH=./Research.db
```

> **Security:** Never commit your `.env` file. Only `.env.example` (with placeholder values) should be tracked by git.

### Run

```powershell
.\start.ps1              # Start backend + UI
.\start.ps1 -Services backend   # Backend only (port 3002)
.\start.ps1 -Services ui        # UI only (port 5173)
.\start.ps1 stop         # Stop everything
```

Or manually:

```bash
npm run server           # Backend
cd ui && npm run dev     # UI (separate terminal)
```

### Research Pipeline

```bash
cd prediction-market-data
pip install -e .
python main.py           # Download polymarket + kalshi Parquet snapshots
```

---

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `POLYMARKETS_PRIVATE_KEY` | Yes | — | Ethereum private key (CLOB auth) |
| `POLYMARKET_FUNDER_ADDRESS` | Yes | — | Wallet address |
| `API_PORT` | No | `3002` | Backend HTTP port |
| `LOG_LEVEL` | No | `info` | `debug`/`info`/`warn`/`error` |
| `DB_PATH` | No | `PolyTrade.db` | Live trading DB path |
| `RESEARCH_DB_PATH` | No | `Research.db` | Research DB path |
| `ENABLE_BINANCE` | No | `true` | Enable Binance spot feed |
| `ENABLE_DERIBIT` | No | `true` | Enable Deribit IV feed |

### Risk & Safety Limits

| Limit | Default | Description |
|-------|---------|-------------|
| `maxSpotStalenessMs` | 5,000 ms | Spot price max age before halting |
| `maxIvStalenessMs` | 30,000 ms | IV max age before halting |
| `maxSpotGapPercent` | 2% | Max single-tick spot move |
| `maxDelta` | 50 | Portfolio delta limit |
| `maxGamma` | 5 | Portfolio gamma limit |
| `maxVega` | 100 | Portfolio vega limit |
| `maxNotional` | 50,000 | Max total notional ($) |

---

## Resources

- [Polymarket CLOB API](https://docs.polymarket.com)
- [Binance WebSocket API](https://binance-docs.github.io/apidocs/spot/en/#websocket-market-streams)
- [Deribit API](https://docs.deribit.com/)
- [Black-Scholes model](https://en.wikipedia.org/wiki/Black%E2%80%93Scholes_model)
- [DuckDB](https://duckdb.org/docs/)
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)

---

## Disclaimer

**This software is for educational and personal use only.**

- This is NOT financial advice
- Prediction market trading carries significant risk
- Always test with `paperMode: true` before using real funds
- Check platform terms of service for algorithmic trading restrictions

---

## License

MIT License
