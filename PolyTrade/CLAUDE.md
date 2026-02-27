# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PolyTrade is an algorithmic trading system for prediction markets, primarily Polymarket crypto binary options. It uses Black-Scholes pricing with spot prices from Binance and implied volatility from Deribit.

## Development Commands

### Starting Services (Recommended)
```powershell
.\start.ps1              # Start backend + UI
.\start.ps1 stop         # Stop all services
.\start.ps1 status       # Check service status
.\start.ps1 -Services backend  # Backend only
.\start.ps1 -Services ui       # UI only
```

### Manual Start
```bash
# Backend API server (port 3003)
npm run server

# UI Dashboard (port 5173)
cd ui && npm run dev
```

### Testing
```bash
npm test                    # Run all tests
npm run test:unit           # Unit tests only
npm run test:watch          # Watch mode
```

### Building
```bash
npm run build               # Build backend
cd ui && npm run build      # Build UI
```

### Database
```bash
npm run db:migrate          # Run v1→v2 migration
npm run db:test-migration   # Test migration
```

## Architecture

### Two-Process System
- **Backend** (`server.ts`): Express API on port 3003 with WebSocket support
- **Frontend** (`ui/`): React/Vite app on port 5173 using TanStack Query

### Backend Structure
```
server.ts                    # Main entry - all API endpoints
src/services/
  ├── polymarket/
  │   ├── streaming/
  │   │   └── HybridStreamManager.ts  # Real-time orderbook streaming
  │   ├── ClobClient.ts               # Polymarket CLOB API wrapper
  │   ├── MarketFinderService.ts      # Crypto market discovery
  │   └── OrderBook.ts                # Orderbook processing
  ├── binance/                        # Spot price feeds
  ├── deribit/                        # IV feeds
  ├── market-maker/                   # Trading logic
  ├── MarketPricingWirer.ts           # Connects markets to data feeds
  └── PortfolioGreeksAggregator.ts    # Portfolio-level greeks
src/lib/
  ├── config/                         # Zod-validated config from .env
  ├── ServiceRegistry.ts              # Per-crypto service management
  └── logger/                         # Winston logging
src/pricing/
  └── BinaryGreeksCalculator.ts       # Black-Scholes for binary options
```

### Frontend Structure
```
ui/src/
  ├── App.tsx                         # Tab navigation (Trading, Markets, Portfolio, Controls)
  ├── lib/
  │   ├── api.ts                      # API client + TypeScript types
  │   ├── hooks.ts                    # React Query hooks
  │   └── contexts/AppReadyContext.tsx # App initialization state
  └── components/
      ├── TradingDashboard.tsx        # Main trading view
      ├── MarketsView.tsx             # Unified markets overview
      ├── MarketDiscovery.tsx         # Crypto market discovery
      ├── OrderBookPanel.tsx          # Orderbook display
      └── GreeksDisplay.tsx           # Greeks visualization
```

### Data Flow
1. **Binance** → spot prices (ETHUSDT, BTCUSDT)
2. **Deribit** → implied volatility
3. **MarketPricingWirer** → combines spot + IV → Black-Scholes fair price + Greeks
4. **HybridStreamManager** → Polymarket orderbook (WebSocket + REST fallback)
5. **Frontend** polls `/api/pricing/wired` for live pricing data

### Key Types
- `WiredMarketInfo`: Market with live pricing (tokenId, crypto, strike, expiry, spotPrice, IV, fairPrice, greeks)
- `CryptoTicker`: 'BTC' | 'ETH' | 'SOL' | 'XRP'
- `MarketRow`: Unified market display (from MarketsView)

## Environment Configuration

Key flags in `.env`:
```env
# Startup behavior
SKIP_MARKET_RESUME=true      # Don't auto-subscribe to markets on startup
CLEAR_MARKET_REGISTRY=false  # Clear market-registry.json on startup

# Feature flags
ENABLE_BINANCE=true
ENABLE_DERIBIT=true
PAPER_MODE=true              # Safety: prevents real trades

# Ports
API_PORT=3003
```

## Important Patterns

### Backend Response Formats
Some endpoints return arrays directly, others wrap in objects. The frontend hooks handle both:
```typescript
select: (data) => {
  if (Array.isArray(data)) return data;
  return data?.orders || [];
}
```

### Market Subscription
Markets are subscribed on-demand via `/api/streaming/markets` (POST). The `market-registry.json` persists enabled markets.

### Crypto vs Non-Crypto Markets
- Crypto markets have `crypto` ticker and `strike` price → show Greeks, IV, spot
- Non-crypto markets → show only bid/ask/spread

### Database
SQLite via better-sqlite3 at `PolyTrade.db`. Uses parameterized queries for SQL injection safety.

## API Endpoints (Key Ones)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/health` | GET | Service health + initialization status |
| `/api/orders` | GET/POST | Open orders |
| `/api/positions?type=open` | GET | Positions |
| `/api/pricing/wired` | GET | All wired markets with live pricing |
| `/api/pricing/:tokenId` | GET | Single market pricing |
| `/api/streaming/markets` | POST | Subscribe to market |
| `/api/discovery/markets` | GET | Discover crypto markets |
| `/api/discovery/subscribe` | POST | Wire discovered market to pricing |
