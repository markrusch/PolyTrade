# PolyTrade Dashboard

A Node.js + vanilla JS dashboard for tracking Polymarket trading activity, positions, and PnL using official Core Data APIs.

## Features
- Core trades sourced via Activity API (`type=TRADE`)
- Closed positions and realized PnL via official Core endpoint
- Current positions and portfolio value via official Core endpoints
- Consolidated PnL calculation (total, unrealized, realized)
- CLOB client utilities for open orders and trade cache

## Quick Start
1. Prerequisites
   - Node.js v18+ and npm
   - A Polygon RPC (optional, default public RPC used)
2. Install dependencies
   ```bash
   npm install
   ```
3. Configure environment
   Create a `.env` file with:
   ```env
   POLYMARKET_USER_ADDRESS=0x...
   SAFE_ADDRESS=0x...
   FUNDER_ADDRESS=0x...
   PRIVATE_KEY=...
   POLYMARKET_CORE_API_URL=https://data-api.polymarket.com
   ```
4. Run the server
   ```bash
   node dashboard-server.js
   ```
5. Open the dashboard
   - Visit `http://localhost:8000/api/data` to verify API
   - The UI is in `dashboard.html`; serve via your dev server or open as needed

## Key Endpoints
- POST `/api/trades-core` — Trades via Activity (type=TRADE)
- POST `/api/data-api/trades` — Official trades via Activity (type=TRADE)
- POST `/api/activity` — User activity timeline
- POST `/api/data-api/positions` — Open positions
- POST `/api/data-api/closed-positions` — Closed positions
- POST `/api/data-api/portfolio-value` — Portfolio value
- POST `/api/data-api/pnl` — Total PnL (realized + unrealized)

## Notes
- Timestamps from Core APIs are seconds; frontend multiplies by 1000 for JS Dates.
- Secrets and build artifacts are ignored by `.gitignore` (including `.env`).
- The `Agent_Instructions/` folder is ignored and not part of the repo.
