# PolyTrade Examples

## Interactive Test Script (Recommended)

### `interactive-polymarket-test.ts`
**Full-featured interactive menu for testing Polymarket API**

Features:
- ✅ View Open Orders (pending limit orders)
- ✅ View Open Positions (current holdings with PnL)
- ✅ View Closed Positions (realized PnL)
- ✅ Create Orders (buy/sell)
- ✅ Cancel Individual Orders
- ✅ Kill Switch (cancel all orders at once)

**Run:**
```bash
npx tsx src/examples/interactive-polymarket-test.ts
```

---

## Market Pricing & Data Scripts

### `test-market-pricing-slug.ts`
**Test slug-based market pricing with Binance + Deribit**

Demonstrates:
- ✅ Fetch market metadata using slug (e.g., `eth-above-4000-on-jan-31`)
- ✅ Stream Binance spot prices
- ✅ Stream Deribit implied volatility
- ✅ Calculate Black-Scholes fair price
- ✅ Calculate Greeks (Delta, Gamma, Vega, Theta)

**Run:**
```bash
npx tsx src/examples/test-market-pricing-slug.ts
```

See [MARKET_PRICING_GUIDE.md](../../MARKET_PRICING_GUIDE.md) for full documentation.

---

## Other Example Scripts

### `comprehensive-snapshot.ts`
One-time snapshot of all account data (orders, positions, trades, activity)

**Run:**
```bash
npx tsx src/examples/comprehensive-snapshot.ts
```

### `test-polymarket-interactive.ts`
Non-interactive test showing orders, positions, and market streaming (15 seconds)

**Run:**
```bash
npx tsx src/examples/test-polymarket-interactive.ts
```

### `test-place-orders.ts`
Interactive script for placing buy/sell orders on existing positions

**Run:**
```bash
npx tsx src/examples/test-place-orders.ts
```

### `test-open-orders-positions-ws.ts`
WebSocket subscription test for real-time market updates

**Run:**
```bash
npx tsx src/examples/test-open-orders-positions-ws.ts
```

### `test-binance.ts`
Test Binance spot price listener (ETH, BTC)

**Run:**
```bash
npx tsx src/examples/test-binance.ts
```

### `test-deribit.ts`
Test Deribit IV (implied volatility) listener

**Run:**
```bash
npx tsx src/examples/test-deribit.ts
```

### `test-health-and-orderbook.ts`
Test Polymarket health check and order book services

**Run:**
```bash
npx tsx src/examples/test-health-and-orderbook.ts
```

---

## Quick Start

For the best interactive testing experience:

```bash
cd "c:\Users\markr\OneDrive\Documents\Mark Rusch\sandbox\PolyTrade"
npx tsx src/examples/interactive-polymarket-test.ts
```

Then use the menu to:
1. Check your current orders and positions
2. Test creating new orders
3. Practice cancelling orders (including kill switch)
4. Monitor your PnL

All operations use the **POLYMARKET_FUNDER_ADDRESS** from your `.env` file automatically.
