# Polymarket Data API - Quick Reference

## Official Endpoints Implemented

### 1. User Activity
```javascript
GET https://data-api.polymarket.com/activity
Query Parameters:
  - user: string (required) - 0x-prefixed wallet address
  - limit: integer (optional)
  - offset: integer (optional)
  - market: string[] (optional)
  - eventId: integer[] (optional)
  - type: enum[] (optional) - TRADE | SPLIT | MERGE | REDEEM | REWARD | CONVERSION

Response: Array of activity objects with:
  - proxyWallet, timestamp, conditionId, type, size, usdcSize
  - transactionHash, price, asset, side, outcomeIndex
  - title, slug, icon, eventSlug, outcome, name, etc.
```

**Usage Example:**
```javascript
const coreApi = require('./utils/core-api');
const activity = await coreApi.getUserActivity({
  user: '0xYourAddress',
  limit: 100,
  type: ['TRADE']
});
```

**Backend Endpoint:**
```bash
POST http://localhost:8000/api/activity
Body: { "limit": 100, "type": ["TRADE"] }
```

---

### 2. Trades
```javascript
GET https://data-api.polymarket.com/trades
Query Parameters:
  - user: string (required)
  - limit: integer (optional)
  - offset: integer (optional)
  - takerOnly: boolean (optional)
  - filterType: enum (optional) - CASH | TOKENS
  - filterAmount: number (optional, required if filterType provided)
  - market: string[] (optional)
  - eventId: integer[] (optional)
  - side: enum (optional) - BUY | SELL

Response: Array of trade objects with:
  - proxyWallet, side, asset, conditionId, size, price, timestamp
  - title, slug, icon, eventSlug, outcome, outcomeIndex
  - transactionHash, name, pseudonym, bio, profileImage
```

**Usage Example:**
```javascript
const trades = await coreApi.getTrades({
  user: '0xYourAddress',
  limit: 100,
  takerOnly: true,
  side: 'BUY'
});
```

**Backend Endpoint:**
```bash
POST http://localhost:8000/api/data-api/trades
Body: { "limit": 100, "takerOnly": true, "side": "BUY" }
```

---

### 3. Current Open Positions
```javascript
GET https://data-api.polymarket.com/positions
Query Parameters:
  - user: string (required)

Response: Array of position objects with:
  - proxyWallet, asset, conditionId, size, avgPrice
  - initialValue, currentValue, cashPnl, percentPnl
  - totalBought, realizedPnl, percentRealizedPnl
  - curPrice, redeemable, mergeable
  - title, slug, icon, eventSlug, outcome, outcomeIndex
  - oppositeOutcome, oppositeAsset, endDate, negativeRisk
```

**Field Definitions:**
- `size`: net outcome tokens currently held
- `avgPrice`: volume-weighted average entry price
- `initialValue`: USDC cost basis of open position
- `currentValue`: current mark-to-market value
- `cashPnl`: unrealized PnL (currentValue − initialValue)
- `realizedPnl`: PnL already realized via partial closes

**Usage Example:**
```javascript
const positions = await coreApi.getCurrentPositions({
  user: '0xYourAddress'
});

// Access unrealized PnL
positions.forEach(pos => {
  console.log(`${pos.title}: $${pos.cashPnl} unrealized PnL`);
});
```

**Backend Endpoint:**
```bash
POST http://localhost:8000/api/data-api/positions
```

---

### 4. Closed Positions
```javascript
GET https://data-api.polymarket.com/closed-positions
Query Parameters:
  - user: string (required)

Response: Array of closed position objects with:
  - proxyWallet, asset, conditionId, avgPrice
  - totalBought, realizedPnl, curPrice, timestamp
  - title, slug, icon, eventSlug, outcome, outcomeIndex
  - oppositeOutcome, oppositeAsset, endDate
```

**Usage Example:**
```javascript
const closedPositions = await coreApi.getClosedPositions({
  user: '0xYourAddress'
});

// Calculate total realized PnL
const totalRealized = closedPositions.reduce((sum, pos) => 
  sum + parseFloat(pos.realizedPnl || 0), 0
);
console.log(`Total Realized PnL: $${totalRealized.toFixed(2)}`);
```

**Backend Endpoint:**
```bash
POST http://localhost:8000/api/data-api/closed-positions
```

---

### 5. Portfolio Value
```javascript
GET https://data-api.polymarket.com/value
Query Parameters:
  - user: string (required)

Response: Array with single object:
  [{ user: string, value: number }]
```

**Field Definition:**
- `value`: aggregate current USDC value of all open positions

**Usage Example:**
```javascript
const portfolioData = await coreApi.getPortfolioValue({
  user: '0xYourAddress'
});

console.log(`Portfolio Value: $${portfolioData.value}`);
```

**Backend Endpoint:**
```bash
POST http://localhost:8000/api/data-api/portfolio-value
```

---

## Calculated Endpoints

### 6. Total PnL Calculation
**Formula (per official documentation):**
```
Total PnL = sum(cashPnl for all open positions)
          + sum(realizedPnl for all open positions)
          + sum(realizedPnl for all closed positions)
```

**Usage Example:**
```javascript
const pnl = await coreApi.calculateTotalPnL({
  user: '0xYourAddress'
});

console.log(`Total PnL: $${pnl.totalPnL}`);
console.log(`Unrealized PnL: $${pnl.unrealizedPnL}`);
console.log(`Realized PnL: $${pnl.totalRealizedPnL}`);
console.log(`Open Positions: ${pnl.openPositionsCount}`);
console.log(`Closed Positions: ${pnl.closedPositionsCount}`);
```

**Response Structure:**
```javascript
{
  totalPnL: number,              // Overall P&L
  unrealizedPnL: number,         // From open positions (cashPnl)
  totalRealizedPnL: number,      // Combined realized
  realizedPnLFromOpen: number,   // From partial closes
  realizedPnLFromClosed: number, // From fully closed
  openPositionsCount: number,
  closedPositionsCount: number,
  timestamp: string
}
```

**Backend Endpoint:**
```bash
POST http://localhost:8000/api/data-api/pnl
```

---

### 7. Account Summary
Comprehensive overview fetching all data in parallel.

**Usage Example:**
```javascript
const summary = await coreApi.getAccountSummary({
  user: '0xYourAddress'
});

console.log('Portfolio:', summary.portfolio);
console.log('PnL:', summary.pnl);
console.log('Activity:', summary.activity);
console.log('Trades:', summary.trades);
console.log('Open Positions:', summary.openPositions);
console.log('Closed Positions:', summary.closedPositions);
```

**Response Structure:**
```javascript
{
  user: string,
  portfolio: {
    value: number,
    openPositionsCount: number,
    closedPositionsCount: number
  },
  pnl: {
    total: number,
    unrealized: number,
    realized: number,
    realizedFromOpen: number,
    realizedFromClosed: number
  },
  activity: {
    recentCount: number,
    trades: number
  },
  trades: {
    totalCount: number,
    buyTrades: number,
    sellTrades: number
  },
  openPositions: Array,
  closedPositions: Array,
  recentActivity: Array,
  recentTrades: Array,
  timestamp: string
}
```

**Backend Endpoint:**
```bash
POST http://localhost:8000/api/data-api/account-summary
```

---

## Cache Management

All endpoints use intelligent caching:

```javascript
// Get cache status
const coreApi = require('./utils/core-api');
const status = coreApi.getCacheStatus();
console.log(status);

// Clear all caches
coreApi.clearCache();
```

**Cache TTLs:**
- Activity: 2 minutes
- Trades: 1 minute
- Positions: 5 minutes
- Closed Positions: 30 minutes
- Portfolio Value: 5 minutes

**Backend Clear Cache:**
```bash
POST http://localhost:8000/api/clear-core-cache
```

---

## Integration with Existing Dashboard

### Dashboard Display
The new PnL data automatically displays in:
1. **Portfolio Summary Card** - Shows value and PnL
2. **Position Stats Card** - Shows counts
3. **Status Indicators** - Shows Data API connection

### Auto-Refresh
- Refreshes every 10 seconds with rest of dashboard
- Manual refresh via "Refresh PnL" button
- All data fetched in parallel (non-blocking)

### Error Handling
- Graceful fallbacks to empty data
- Status indicators show success/failure
- Console logging for debugging
- User-friendly error messages

---

## Testing Examples

### Test All Endpoints
```javascript
const coreApi = require('./utils/core-api');

async function testAllEndpoints() {
  const user = process.env.POLYMARKET_USER_ADDRESS;
  
  console.log('Testing User Activity...');
  const activity = await coreApi.getUserActivity({ user });
  console.log(`✓ ${activity.length} activities`);
  
  console.log('Testing Trades...');
  const trades = await coreApi.getTrades({ user });
  console.log(`✓ ${trades.length} trades`);
  
  console.log('Testing Current Positions...');
  const positions = await coreApi.getCurrentPositions({ user });
  console.log(`✓ ${positions.length} open positions`);
  
  console.log('Testing Closed Positions...');
  const closed = await coreApi.getClosedPositions({ user });
  console.log(`✓ ${closed.length} closed positions`);
  
  console.log('Testing Portfolio Value...');
  const value = await coreApi.getPortfolioValue({ user });
  console.log(`✓ Portfolio: $${value.value}`);
  
  console.log('Testing PnL Calculation...');
  const pnl = await coreApi.calculateTotalPnL({ user });
  console.log(`✓ Total PnL: $${pnl.totalPnL}`);
  
  console.log('Testing Account Summary...');
  const summary = await coreApi.getAccountSummary({ user });
  console.log(`✓ Summary generated`);
}

testAllEndpoints();
```

### Test via HTTP
```bash
# Test PnL
curl -X POST http://localhost:8000/api/data-api/pnl \
  -H "Content-Type: application/json" \
  -d '{}'

# Test Positions
curl -X POST http://localhost:8000/api/data-api/positions \
  -H "Content-Type: application/json" \
  -d '{}'

# Test Portfolio Value
curl -X POST http://localhost:8000/api/data-api/portfolio-value \
  -H "Content-Type: application/json" \
  -d '{}'

# Test Account Summary
curl -X POST http://localhost:8000/api/data-api/account-summary \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## Important Notes

### Compliance
- ✅ Uses ONLY officially documented fields
- ✅ No assumptions or undocumented behavior
- ✅ Follows official PnL calculation formula
- ✅ All schemas match official API documentation

### Backward Compatibility
- All existing endpoints continue to work
- Legacy `core-api-client.js` untouched
- CLOB operations unaffected
- No breaking changes to dashboard

### Performance
- Parallel data fetching for speed
- Intelligent caching to reduce API calls
- Non-blocking requests
- Graceful error handling

### Security
- No API keys required (public data)
- Uses environment variable for user address
- No sensitive data exposure
- Rate limiting via caching
