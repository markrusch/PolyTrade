/**
 * POLYMARKET DASHBOARD BACKEND SERVER - PRODUCTION GRADE
 * 
 * Integrates with:
 * - CLOB API for orders, positions, balances
 * - Ethers.js for on-chain wallet data
 * - Builder API for trading execution
 * 
 * Endpoints:
 *   POST /api/balances - Get cash balances (EOA, Safe, Funder)
 *   POST /api/positions - Get open positions from CLOB
 *   POST /api/orders - Get open orders from CLOB
 *   POST /api/cancel-order - Cancel specific order
 *   POST /api/killswitch - Cancel all open orders
 *   POST /api/sell - Create sell order
 *   GET /health - Server health check
 *   GET /dashboard - Serve dashboard HTML
 *   GET / - Serve dashboard HTML
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const ethers = require('ethers');
const axios = require('axios');

// Import utility modules
const { createLogger } = require('./utils/logger');
const clobOps = require('./utils/clob-operations');

const app = express();
const logger = createLogger('DASHBOARD-SERVER');

// =============================================================================
// CONFIGURATION
// =============================================================================

const SAFE_ADDRESS = process.env.POLYMARKET_SAFE_ADDRESS?.toLowerCase();
const FUNDER_ADDRESS = process.env.POLYMARKET_FUNDER_ADRESS?.toLowerCase();
const USER_ADDRESS = process.env.POLYMARKET_USER_ADDRESS?.toLowerCase();
const RPC_URL = process.env.RPC_LINK_INFURA;
const PRIVATE_KEY = process.env.POLYMARKETS_PRIVATE_KEY;

const CLOB_URL = 'https://clob.polymarket.com';
const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const CTF_ADDRESS = '0x4d97dcd97fb0b65422325c1adab190f28ccc5256';

const USDC_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function allowance(address owner, address spender) view returns (uint256)'
];

const CTF_ABI = [
  'function balanceOfBatch(address[] calldata accounts, uint256[] calldata ids) view returns (uint256[])',
];

function validateConfig() {
  const required = {
    POLYMARKET_SAFE_ADDRESS: SAFE_ADDRESS,
    POLYMARKET_FUNDER_ADRESS: FUNDER_ADDRESS,
    POLYMARKET_USER_ADDRESS: USER_ADDRESS,
    RPC_LINK_INFURA: RPC_URL,
    POLYMARKETS_PRIVATE_KEY: PRIVATE_KEY
  };
  const missing = Object.entries(required)
    .filter(([, v]) => !v || String(v).trim() === '')
    .map(([k]) => k);
  return { ok: missing.length === 0, missing };
}

// Global state
let clobClient = null;

// =============================================================================
// INITIALIZATION
// =============================================================================

function getProvider() {
  return new ethers.providers.JsonRpcProvider(RPC_URL);
}

function getSigner() {
  const provider = getProvider();
  return new ethers.Wallet(PRIVATE_KEY, provider);
}

// =============================================================================
// MIDDLEWARE
// =============================================================================

app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname)));

// Log all requests
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  if (req.method === 'POST') {
    console.log(`  📤 Body:`, JSON.stringify(req.body).substring(0, 200));
  }
  next();
});

// =============================================================================
// HEALTH CHECK
// =============================================================================

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Full health check with dependencies (does not throw)
app.get('/health/full', async (req, res) => {
  const startedAt = Date.now();
  const envStatus = validateConfig();
  const result = {
    ok: true,
    env: envStatus,
    rpc: {},
    clob: {},
    core: {},
    durationMs: 0,
    timestamp: new Date().toISOString()
  };

  // RPC check
  try {
    const provider = getProvider();
    const blockNumber = await provider.getBlockNumber();
    result.rpc = { ok: true, blockNumber };
  } catch (err) {
    result.ok = false;
    result.rpc = { ok: false, error: err.message };
  }

  // CLOB auth check (derive API key and list open orders quickly)
  try {
    const clob = await clobOps.initClobClient(SAFE_ADDRESS);
    const orders = await clobOps.getOpenOrders(clob);
    result.clob = { ok: true, openOrders: orders.length };
  } catch (err) {
    result.ok = false;
    result.clob = { ok: false, error: err.message };
  }

  // Core API check (non-fatal)
  try {
    const core = require('./utils/core-api');
    const trades = await core.getTrades({ user: USER_ADDRESS, takerOnly: true });
    result.core = { ok: true, trades: Array.isArray(trades) ? trades.length : 0 };
  } catch (err) {
    result.ok = false;
    result.core = { ok: false, error: err.message };
  }

  result.durationMs = Date.now() - startedAt;
  res.json(result);
});

// =============================================================================
// API ENDPOINTS
// =============================================================================

/**
 * GET /api/data
 * Get all data at once (for browsers that have CORS issues with POST)
 */
app.get('/api/data', async (req, res) => {
  console.log('[DATA] 📊 Fetching all data...');

  // Helper to safely fetch a section and capture errors
  const safeFetch = async (label, fn) => {
    try {
      const data = await fn();
      return { ok: true, data };
    } catch (err) {
      console.warn(`[DATA] ⚠️ ${label} failed:`, err.message);
      return { ok: false, error: err.message, data: Array.isArray(data) ? [] : null };
    }
  };

  try {
    const clob = await clobOps.initClobClient(SAFE_ADDRESS);
    const coreApi = require('./utils/core-api');

    const [balancesRes, ordersRes, positionsRes, closedRes, tradeHistoryRes, coreTradesRes, dataApiPositionsRes, dataApiClosedRes, dataApiPnlRes, dataApiValueRes] = await Promise.all([
      safeFetch('Balances', async () => {
        const provider = getProvider();
        const signer = getSigner();
        const eoa = await signer.getAddress();
        const usdcContract = new ethers.Contract(USDC_ADDRESS, USDC_ABI, provider);
        const [eoaBalance, safeBalance, funderBalance] = await Promise.all([
          usdcContract.balanceOf(eoa),
          usdcContract.balanceOf(SAFE_ADDRESS),
          usdcContract.balanceOf(FUNDER_ADDRESS)
        ]);
        return {
          eoaBalance: parseFloat(ethers.utils.formatUnits(eoaBalance, 6)),
          safeBalance: parseFloat(ethers.utils.formatUnits(safeBalance, 6)),
          funderBalance: parseFloat(ethers.utils.formatUnits(funderBalance, 6))
        };
      }),
      safeFetch('Open Orders', () => clobOps.getOpenOrders(clob)),
      safeFetch('Open Positions', () => clobOps.getOpenPositions(clob)),
      safeFetch('Closed Positions', () => clobOps.getClosedPositions(clob)),
      safeFetch('Trade Cache', async () => {
        try {
          return clobOps.TradeCache.getAll() || [];
        } catch (err) {
          console.log('[DATA] ⚠️ Trade cache unavailable:', err.message);
          return [];
        }
      }),
      safeFetch('Core Trades (Activity)', async () => {
        const activity = await coreApi.getUserActivity({ user: USER_ADDRESS, limit: 100, type: ['TRADE'] });
        return Array.isArray(activity) ? activity.filter(a => a && a.type === 'TRADE') : [];
      }),
      safeFetch('Data API Positions', () => coreApi.getCurrentPositions({ user: USER_ADDRESS })),
      safeFetch('Data API Closed Positions', () => coreApi.getClosedPositions({ user: USER_ADDRESS })),
      safeFetch('Data API PnL', () => coreApi.calculateTotalPnL({ user: USER_ADDRESS })),
      safeFetch('Data API Portfolio Value', () => coreApi.getPortfolioValue({ user: USER_ADDRESS }))
    ]);

    const response = {
      success: true,
      balances: balancesRes.ok ? balancesRes.data : { eoaBalance: 0, safeBalance: 0, funderBalance: 0 },
      orders: ordersRes.ok ? ordersRes.data : [],
      positions: positionsRes.ok ? positionsRes.data : [],
      closed: closedRes.ok ? closedRes.data : [],
      tradeHistory: tradeHistoryRes.ok ? tradeHistoryRes.data : [],
      coreTrades: coreTradesRes.ok ? coreTradesRes.data : [],
      // New Data API fields
      dataApiPositions: dataApiPositionsRes.ok ? dataApiPositionsRes.data : [],
      dataApiClosedPositions: dataApiClosedRes.ok ? dataApiClosedRes.data : [],
      dataApiPnl: dataApiPnlRes.ok ? dataApiPnlRes.data : { totalPnL: 0, unrealizedPnL: 0, totalRealizedPnL: 0 },
      dataApiValue: dataApiValueRes.ok ? dataApiValueRes.data : { user: USER_ADDRESS, value: 0 },
      status: {
        balances: { ok: balancesRes.ok, error: balancesRes.error },
        orders: { ok: ordersRes.ok, error: ordersRes.error },
        positions: { ok: positionsRes.ok, error: positionsRes.error },
        closed: { ok: closedRes.ok, error: closedRes.error },
        tradeHistory: { ok: tradeHistoryRes.ok, error: tradeHistoryRes.error },
        coreTrades: { ok: coreTradesRes.ok, error: coreTradesRes.error },
        dataApiPositions: { ok: dataApiPositionsRes.ok, error: dataApiPositionsRes.error },
        dataApiClosedPositions: { ok: dataApiClosedRes.ok, error: dataApiClosedRes.error },
        dataApiPnl: { ok: dataApiPnlRes.ok, error: dataApiPnlRes.error },
        dataApiValue: { ok: dataApiValueRes.ok, error: dataApiValueRes.error }
      },
      timestamp: new Date().toISOString()
    };

    res.json(response);
    console.log('[DATA] ✅ Sent partial-friendly data bundle');
  } catch (error) {
    // If top-level init fails, still return a structured partial response
    console.error('[DATA] ❌ Top-level error:', error.message);
    res.json({
      success: true,
      balances: { eoaBalance: 0, safeBalance: 0, funderBalance: 0 },
      orders: [],
      positions: [],
      closed: [],
      tradeHistory: [],
      coreTrades: [],
      dataApiPositions: [],
      dataApiClosedPositions: [],
      dataApiPnl: { totalPnL: 0, unrealizedPnL: 0, totalRealizedPnL: 0 },
      dataApiValue: { user: USER_ADDRESS, value: 0 },
      status: {
        balances: { ok: false, error: 'init failed' },
        orders: { ok: false, error: 'init failed' },
        positions: { ok: false, error: 'init failed' },
        closed: { ok: false, error: 'init failed' },
        tradeHistory: { ok: false, error: 'init failed' },
        coreTrades: { ok: false, error: 'init failed' },
        dataApiPositions: { ok: false, error: 'init failed' },
        dataApiClosedPositions: { ok: false, error: 'init failed' },
        dataApiPnl: { ok: false, error: 'init failed' },
        dataApiValue: { ok: false, error: 'init failed' }
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/balances
 * Get USDC balances from all wallets
 */
app.post('/api/balances', async (req, res) => {
  try {
    const provider = getProvider();
    const signer = getSigner();
    const eoa = await signer.getAddress();
    
    console.log(`[BALANCES] Fetching for EOA: ${eoa}, Safe: ${SAFE_ADDRESS}, Funder: ${FUNDER_ADDRESS}`);
    
    // Create USDC contract instance
    const usdcContract = new ethers.Contract(USDC_ADDRESS, USDC_ABI, provider);
    
    // Fetch balances from all three wallets in parallel
    const [eoaBalance, safeBalance, funderBalance] = await Promise.all([
      usdcContract.balanceOf(eoa),
      usdcContract.balanceOf(SAFE_ADDRESS),
      usdcContract.balanceOf(FUNDER_ADDRESS)
    ]);
    
    const eoaAmount = parseFloat(ethers.utils.formatUnits(eoaBalance, 6));
    const safeAmount = parseFloat(ethers.utils.formatUnits(safeBalance, 6));
    const funderAmount = parseFloat(ethers.utils.formatUnits(funderBalance, 6));
    const totalAmount = eoaAmount + safeAmount + funderAmount;
    
    console.log(`[BALANCES] EOA: $${eoaAmount.toFixed(2)}, Safe: $${safeAmount.toFixed(2)}, Funder: $${funderAmount.toFixed(2)}`);
    
    res.json({
      success: true,
      total: totalAmount,
      balances: [
        {
          name: 'EOA (Signer)',
          address: eoa,
          amount: eoaAmount,
          role: 'Private key holder, signs orders'
        },
        {
          name: 'Safe Wallet (Funder)',
          address: SAFE_ADDRESS,
          amount: safeAmount,
          role: 'Holds USDC and tokens, executes trades'
        },
        {
          name: 'Funder Account',
          address: FUNDER_ADDRESS,
          amount: funderAmount,
          role: 'Builder funder (replenishes Safe if needed)'
        }
      ],
      timestamp: new Date().toISOString()
    });
    console.log(`[BALANCES] ✅ Sent response: total=${totalAmount}`);
  } catch (error) {
    console.error('[BALANCES] ❌ Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      total: 0,
      balances: []
    });
  }
});

/**
 * POST /api/orders
 * Get all open orders from CLOB with market names
 */
app.post('/api/orders', async (req, res) => {
  try {
    logger.logStart('Fetch Open Orders');
    const clob = await clobOps.initClobClient(SAFE_ADDRESS);

    const orders = await clobOps.getOpenOrders(clob);

    let openOrders = (orders || [])
      .map(o => {
        // Prefer conditionId from order for reliable market resolution
        const marketId = o.market || o.condition_id || o.conditionId || null;

        // Compute remaining size: prefer explicit remaining fields, else size - filled
        const rawSize = (
          o.remaining_size ??
          o.leaves_qty ??
          ((o.original_size != null && o.size_matched != null) ? (o.original_size - o.size_matched) : null) ??
          ((o.size != null && o.filled != null) ? (o.size - o.filled) : null) ??
          (o.size ?? o.amount ?? 0)
        );
        const size = Math.max(0, parseFloat(rawSize || 0));
        const originalSize = parseFloat(o.original_size ?? o.size ?? o.amount ?? size);
        const sizeMatched = parseFloat(o.size_matched ?? o.filled ?? 0);
        const fillPct = originalSize > 0 ? ((sizeMatched / originalSize) * 100).toFixed(1) : '0.0';

        return {
          id: o.id || o.orderID,
          orderID: o.orderID || o.id,
          market: o.marketName || o.outcome || o.market_ticker || 'Unknown',
          marketId,
          tokenId: o.token_id || o.tokenId || o.asset_id,
          side: (o.side || 'SELL').toUpperCase(),
          price: parseFloat(o.price || o.priceString || 0).toFixed(4),
          size: size.toFixed(2),
          originalSize: originalSize.toFixed(2),
          sizeMatched: sizeMatched.toFixed(2),
          fillPct,
          status: (o.status || 'PENDING').toUpperCase(),
          createdAt: o.created_at || o.timestamp || new Date().toISOString(),
          chainId: 137
        };
      });

    // Enrich with market titles and events
    openOrders = await Promise.all(
      openOrders.map(async (order) => {
        try {
          const marketInfo = await clobOps.getFullMarketInfo(clob, order.tokenId, order.marketId);
          return {
            ...order,
            eventTitle: marketInfo.event,
            marketTitle: marketInfo.title,
            marketDescription: marketInfo.description
          };
        } catch (err) {
          logger.warn(`Could not enrich order ${order.id} with market info`, { tokenId: order.tokenId, marketId: order.marketId });
          return order; // Return order as-is if enrichment fails
        }
      })
    );

    logger.logEnd('Fetch Open Orders', { count: openOrders.length });

    res.json({
      success: true,
      count: openOrders.length,
      orders: openOrders,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to fetch orders', {}, error);
    res.status(500).json({
      success: false,
      error: error.message,
      count: 0,
      orders: []
    });
  }
});

/**
 * POST /api/positions
 * Get all open positions from CLOB with market titles and events
 */
app.post('/api/positions', async (req, res) => {
  try {
    logger.logStart('Fetch Positions with Market Info');
    const clob = await clobOps.initClobClient(SAFE_ADDRESS);

    // Get positions using the utility (fetches actual filled trades)
    let positions = await clobOps.getOpenPositions(clob);

    // Enhance each position with full market info (title and event)
    for (let i = 0; i < positions.length; i++) {
      try {
        const marketInfo = await clobOps.getFullMarketInfo(clob, positions[i].tokenId, positions[i].market);
        positions[i].marketTitle = marketInfo.title;
        positions[i].eventTitle = marketInfo.event;
        positions[i].marketDescription = marketInfo.description;
        positions[i].conditionId = marketInfo.conditionId;
      } catch (err) {
        // Keep defaults if lookup fails
        positions[i].marketTitle = positions[i].marketName || 'Unknown';
        positions[i].eventTitle = 'Unknown Event';
        positions[i].conditionId = positions[i].market || '';
      }
    }

    // Collapse positions by market (conditionId) to combine Yes/No outcomes
    const marketGroups = {};
    for (const pos of positions) {
      const key = pos.conditionId || pos.market || pos.eventTitle;
      if (!marketGroups[key]) {
        marketGroups[key] = {
          eventTitle: pos.eventTitle,
          marketDescription: pos.marketDescription,
          conditionId: pos.conditionId,
          outcomes: [],
          totalAmount: 0,
          tokenIds: [],
          markets: []
        };
      }
      marketGroups[key].outcomes.push({
        outcome: pos.outcome,
        marketTitle: pos.marketTitle,
        amount: parseFloat(pos.amount),
        side: pos.side,
        tokenId: pos.tokenId
      });
      marketGroups[key].totalAmount += parseFloat(pos.amount);
      marketGroups[key].tokenIds.push(pos.tokenId);
      if (pos.market && !marketGroups[key].markets.includes(pos.market)) {
        marketGroups[key].markets.push(pos.market);
      }
    }

    // Convert back to array
    positions = Object.values(marketGroups).map(group => ({
      eventTitle: group.eventTitle,
      marketDescription: group.marketDescription,
      conditionId: group.conditionId,
      outcomes: group.outcomes,
      totalAmount: group.totalAmount.toFixed(2),
      tokenIds: group.tokenIds,
      markets: group.markets,
      assetType: 'CONDITIONAL',
      status: 'FILLED',
      source: 'TRADES',
      timestamp: new Date().toISOString()
    }));

    logger.logEnd('Fetch Positions with Market Info', { count: positions.length });

    res.json({
      success: true,
      count: positions.length,
      positions: positions,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to fetch positions', {}, error);
    // Return gracefully - positions are optional
    res.json({
      success: true,
      count: 0,
      positions: [],
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/cancel-order
 * Cancel a specific order
 */
app.post('/api/cancel-order', async (req, res) => {
  try {
    const { orderId } = req.body;
    
    if (!orderId) {
      return res.status(400).json({
        success: false,
        error: 'orderId is required'
      });
    }
    
    logger.logStart(`Cancel Order: ${orderId}`);
    const clob = await clobOps.initClobClient(SAFE_ADDRESS);

    const result = await clobOps.cancelOrder(clob, orderId);

    logger.logEnd(`Cancel Order: ${orderId}`, { result });

    res.json({
      success: true,
      orderId,
      result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`Failed to cancel order`, { orderId: req.body.orderId }, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/closed-positions
 * Get closed positions with PnL calculations
 */
app.post('/api/closed-positions', async (req, res) => {
  try {
    logger.logStart('Fetch Closed Positions with PnL');
    const clob = await clobOps.initClobClient(SAFE_ADDRESS);

    // Get closed positions with PnL calculations
    let closedPositions = await clobOps.getClosedPositions(clob);

    // Enhance each closed position with market info
    for (let i = 0; i < closedPositions.length; i++) {
      try {
        const marketInfo = await clobOps.getFullMarketInfo(clob, closedPositions[i].tokenId, closedPositions[i].market);
        closedPositions[i].marketTitle = marketInfo.title;
        closedPositions[i].eventTitle = marketInfo.event;
        closedPositions[i].marketDescription = marketInfo.description;
        closedPositions[i].conditionId = marketInfo.conditionId;
      } catch (err) {
        closedPositions[i].marketTitle = 'Unknown';
        closedPositions[i].eventTitle = 'Unknown Event';
        closedPositions[i].marketDescription = '';
        closedPositions[i].conditionId = closedPositions[i].market || '';
      }
    }

    // Collapse closed positions by market (conditionId) to combine Yes/No outcomes
    const closedMarketGroups = {};
    for (const pos of closedPositions) {
      const key = pos.conditionId || pos.market || pos.eventTitle;
      if (!closedMarketGroups[key]) {
        closedMarketGroups[key] = {
          eventTitle: pos.eventTitle,
          marketDescription: pos.marketDescription,
          conditionId: pos.conditionId,
          outcomes: [],
          totalQuantityClosed: 0,
          totalQuantityBought: 0,
          totalQuantitySold: 0,
          totalBuyValue: 0,
          totalSellValue: 0,
          totalPnl: 0,
          remainingSize: 0,
          statuses: []
        };
      }
      const group = closedMarketGroups[key];
      group.outcomes.push({
        outcome: pos.outcome,
        marketTitle: pos.marketTitle,
        quantityClosed: pos.quantityClosed,
        avgBuyPrice: pos.avgBuyPrice,
        avgSellPrice: pos.avgSellPrice,
        pnlAbsolute: pos.pnlAbsolute,
        pnlPercent: pos.pnlPercent
      });
      group.totalQuantityClosed += pos.quantityClosed || 0;
      group.totalQuantityBought += pos.quantityBought || 0;
      group.totalQuantitySold += pos.quantitySold || 0;
      group.totalBuyValue += (pos.quantityBought || 0) * (pos.avgBuyPrice || 0);
      group.totalSellValue += (pos.quantitySold || 0) * (pos.avgSellPrice || 0);
      group.totalPnl += pos.pnlAbsolute || 0;
      group.remainingSize += pos.remainingSize || 0;
      if (pos.status && !group.statuses.includes(pos.status)) {
        group.statuses.push(pos.status);
      }
    }

    // Convert back to array with aggregated P&L
    closedPositions = Object.values(closedMarketGroups).map(group => {
      const avgBuy = group.totalQuantityBought > 0 ? group.totalBuyValue / group.totalQuantityBought : 0;
      const avgSell = group.totalQuantitySold > 0 ? group.totalSellValue / group.totalQuantitySold : 0;
      const pnlPct = group.totalBuyValue > 0 ? (group.totalPnl / group.totalBuyValue) * 100 : 0;
      const status = group.remainingSize > 0.01 ? 'PARTIALLY_CLOSED' : 'CLOSED';
      return {
        eventTitle: group.eventTitle,
        marketDescription: group.marketDescription,
        conditionId: group.conditionId,
        outcomes: group.outcomes,
        quantityClosed: group.totalQuantityClosed,
        quantityBought: group.totalQuantityBought,
        quantitySold: group.totalQuantitySold,
        avgBuyPrice: avgBuy,
        avgSellPrice: avgSell,
        pnlAbsolute: group.totalPnl,
        pnlPercent: pnlPct,
        remainingSize: group.remainingSize,
        status
      };
    });

    logger.logEnd('Fetch Closed Positions with PnL', { count: closedPositions.length });

    res.json({
      success: true,
      count: closedPositions.length,
      closedPositions: closedPositions,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to fetch closed positions', {}, error);
    res.json({
      success: true,
      count: 0,
      closedPositions: [],
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/cancel-order
 * Cancel a specific order
 */
app.post('/api/cancel-order', async (req, res) => {
  try {
    const { orderId } = req.body;
    
    if (!orderId) {
      return res.status(400).json({
        success: false,
        error: 'orderId is required'
      });
    }
    
    logger.logStart(`Cancel Order: ${orderId}`);
    const clob = await clobOps.initClobClient(SAFE_ADDRESS);

    const result = await clobOps.cancelOrder(clob, orderId);

    logger.logEnd(`Cancel Order: ${orderId}`, { result });

    res.json({
      success: true,
      orderId,
      result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`Failed to cancel order`, { orderId: req.body.orderId }, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/killswitch
 * Cancel ALL open orders (emergency)
 * Uses CLOB API's cancelAll() for bulk atomic cancellation
 */
app.post('/api/killswitch', async (req, res) => {
  try {
    logger.logStart('KILLSWITCH - Cancel All Orders');
    const clob = await clobOps.initClobClient(SAFE_ADDRESS);
    
    logger.info(`KILLSWITCH: Initiating bulk cancellation of all open orders`);
    
    // Use CLOB operations utility (calls cancelAll() internally)
    const killswitchResult = await clobOps.cancelAllOrders(clob);
    
    logger.logEnd('KILLSWITCH - Cancel All Orders', killswitchResult);
    
    res.json({
      success: true,
      totalOrders: killswitchResult.successCount + killswitchResult.failureCount,
      cancelledCount: killswitchResult.successCount,
      failedCount: killswitchResult.failureCount,
      result: killswitchResult.result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('KILLSWITCH failed', {}, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/sell
 * Create a sell order (reduce position)
 * 
 * Expected body: { tokenId (string), size (number > 0), price (number >= 0), outcome (string), marketId (optional) }
 * Returns: { success (bool), orderID (string), orderDetails (object), result (object), timestamp (string) }
 */
app.post('/api/sell', async (req, res) => {
  try {
    const { tokenId, size, price, outcome, marketId } = req.body;
    
    // Log the exact request body for debugging
    logger.info('Sell order request received', {
      tokenId: tokenId ? tokenId.slice(0, 20) : 'undefined',
      size,
      price,
      outcome,
      marketId,
      fullTokenId: tokenId  // Log full tokenId for debugging
    });
    
    // Validate required fields with type checking
    if (!tokenId || typeof tokenId !== 'string' || tokenId.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'tokenId is required and must be a non-empty string'
      });
    }
    
    if (size === undefined || size === null || size === '') {
      return res.status(400).json({
        success: false,
        error: 'size is required'
      });
    }

    // Validate numeric fields
    const sizeNum = parseFloat(size);
    const priceNum = parseFloat(price || 0.50);
    
    if (!Number.isFinite(sizeNum) || sizeNum <= 0) {
      return res.status(400).json({
        success: false,
        error: `Invalid size: ${size}. Must be a positive number.`
      });
    }
    
    if (!Number.isFinite(priceNum) || priceNum < 0) {
      return res.status(400).json({
        success: false,
        error: `Invalid price: ${price}. Must be a non-negative number.`
      });
    }
    
    // Additional trade guards
    if (priceNum > 1) {
      return res.status(400).json({
        success: false,
        error: `Invalid price: ${priceNum}. Must be <= 1.0 (cents scale).`
      });
    }

    logger.logStart(`Sell Order: ${tokenId.slice(0, 20)}`, { size: sizeNum, price: priceNum, outcome, marketId });
    const clob = await clobOps.initClobClient(SAFE_ADDRESS);

    // Guard: ensure size does not exceed net position
    const netPosition = await clobOps.getNetPositionForToken(clob, tokenId.trim());
    if (sizeNum > netPosition + 1e-8) {
      return res.status(400).json({
        success: false,
        error: `Insufficient position to sell ${sizeNum}. Net position is ${netPosition.toFixed(2)}.`,
        details: { netPosition }
      });
    }

    // Guard: ensure allowance and balance are sufficient
    const allowanceInfo = await clobOps.checkAllowanceForToken(clob, tokenId.trim(), sizeNum);
    if (!allowanceInfo.isBalanceSufficient || !allowanceInfo.isAllowanceSufficient) {
      return res.status(400).json({
        success: false,
        error: !allowanceInfo.isBalanceSufficient
          ? `Insufficient balance (${allowanceInfo.balance.toFixed(2)}) for sell size ${sizeNum}.`
          : `Insufficient allowance (${allowanceInfo.allowance.toFixed(2)}) for sell size ${sizeNum}.`,
        details: allowanceInfo,
        requiresApproval: !allowanceInfo.isAllowanceSufficient
      });
    }

    // Use the type-safe createSellOrder function
    const result = await clobOps.createSellOrder(clob, tokenId.trim(), sizeNum, priceNum, outcome || 'YES', marketId || null);
    
    logger.logEnd(`Sell Order: ${tokenId.slice(0, 20)}`, result);
    
    res.json({
      success: true,
      orderID: result.orderID,
      orderDetails: result.orderDetails,
      result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to create sell order', { 
      tokenId: req.body.tokenId ? req.body.tokenId.slice(0, 20) : 'undefined',
      size: req.body.size,
      error: error.message 
    }, error);
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.data || error.response?.status
    });
  }
});

/**
 * POST /api/sell/validate
 * Validate a sell request without placing an order
 */
app.post('/api/sell/validate', async (req, res) => {
  try {
    const { tokenId, size } = req.body;
    if (!tokenId || typeof tokenId !== 'string' || tokenId.trim() === '') {
      return res.status(400).json({ success: false, error: 'tokenId is required and must be a non-empty string' });
    }
    const sizeNum = parseFloat(size);
    if (!Number.isFinite(sizeNum) || sizeNum <= 0) {
      return res.status(400).json({ success: false, error: `Invalid size: ${size}. Must be a positive number.` });
    }

    const clob = await clobOps.initClobClient(SAFE_ADDRESS);
    const netPosition = await clobOps.getNetPositionForToken(clob, tokenId.trim());
    const allowanceInfo = await clobOps.checkAllowanceForToken(clob, tokenId.trim(), sizeNum);

    const ok = sizeNum <= netPosition + 1e-8 && allowanceInfo.isBalanceSufficient && allowanceInfo.isAllowanceSufficient;

    res.json({
      success: true,
      ok,
      netPosition,
      allowanceInfo,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to validate sell request', {}, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/trade-history
 * Get all filled trades grouped by event with market info
 */
app.post('/api/trade-history', async (req, res) => {
  try {
    logger.logStart('Fetch Trade History');
    const clob = await clobOps.initClobClient(SAFE_ADDRESS);

    // Get all cached trades
    const allTrades = clobOps.TradeCache.getAll();

    // Fetch current positions (from filled trades) to reconcile against trade totals
    const currentPositions = await clobOps.getOpenPositions(clob);
    const positionByMarketOutcome = {};
    currentPositions.forEach(pos => {
      const marketKey = (pos.market || '').toUpperCase();
      const outcomeKey = (pos.outcome || '').toUpperCase();
      const key = `${marketKey}::${outcomeKey}`;
      const net = parseFloat(pos.netSize || pos.amount || 0);
      positionByMarketOutcome[key] = net;
    });

    if (allTrades.length === 0) {
      logger.logEnd('Fetch Trade History', { count: 0 });
      return res.json({
        success: true,
        count: 0,
        trades: [],
        timestamp: new Date().toISOString()
      });
    }

    // Group trades by market/event
    const tradesByMarket = {};
    for (const trade of allTrades) {
      const market = trade.market || 'Unknown';
      if (!tradesByMarket[market]) {
        tradesByMarket[market] = {
          market,
          trades: [],
          eventTitle: 'Unknown Event',
          marketDescription: 'Unknown'
        };
      }
      tradesByMarket[market].trades.push(trade);
    }

    // Enhance each market group with event info
    const tradeHistory = [];
    for (const [market, group] of Object.entries(tradesByMarket)) {
      try {
        const marketInfo = await clobOps.getFullMarketInfo(clob, group.trades[0].asset_id, market);
        group.eventTitle = marketInfo.event;
        group.marketDescription = marketInfo.description;
      } catch (err) {
        // Keep defaults if lookup fails
      }

      // Sort trades by time (newest first)
      const sortedTrades = group.trades.sort((a, b) => {
        const ta = a.match_time ? (a.match_time > 9999999999 ? a.match_time : a.match_time * 1000) : 0;
        const tb = b.match_time ? (b.match_time > 9999999999 ? b.match_time : b.match_time * 1000) : 0;
        return tb - ta;
      });

      // Aggregate buys/sells per outcome to reconcile with positions
      const aggregates = {};
      for (const t of sortedTrades) {
        const outcomeKey = (t.outcome || 'UNKNOWN').toUpperCase();
        const sideKey = (t.side || 'BUY').toUpperCase();

        let userMatchedAmount = 0;
        if (t.maker_orders && Array.isArray(t.maker_orders)) {
          userMatchedAmount = t.maker_orders.reduce((sum, mo) => {
            return sum + parseFloat(mo.matched_amount || 0);
          }, 0);
        }
        const size = userMatchedAmount > 0 ? userMatchedAmount : parseFloat(t.size || 0);

        aggregates[outcomeKey] = aggregates[outcomeKey] || { buy: 0, sell: 0 };
        if (sideKey === 'BUY') {
          aggregates[outcomeKey].buy += size;
        } else if (sideKey === 'SELL') {
          aggregates[outcomeKey].sell += size;
        }
      }

      const marketKey = (market || '').toUpperCase();
      const yesAgg = aggregates.YES || { buy: 0, sell: 0 };
      const noAgg = aggregates.NO || { buy: 0, sell: 0 };
      const yesNet = yesAgg.buy - yesAgg.sell;
      const noNet = noAgg.buy - noAgg.sell;
      const yesPos = positionByMarketOutcome[`${marketKey}::YES`] || 0;
      const noPos = positionByMarketOutcome[`${marketKey}::NO`] || 0;

      tradeHistory.push({
        market: market,
        eventTitle: group.eventTitle,
        marketDescription: group.marketDescription,
        tradeCount: sortedTrades.length,
        reconciliation: {
          YES: {
            buy: yesAgg.buy,
            sell: yesAgg.sell,
            net: yesNet,
            position: yesPos,
            delta: yesNet - yesPos
          },
          NO: {
            buy: noAgg.buy,
            sell: noAgg.sell,
            net: noNet,
            position: noPos,
            delta: noNet - noPos
          }
        },
        trades: sortedTrades.map(t => {
          // Parse match_time - could be Unix timestamp (seconds), milliseconds, or ISO string
          let matchTimeISO = '';
          try {
            const matchTime = t.match_time || t.timestamp || 0;
            const timeMs = typeof matchTime === 'string' ? 
              (matchTime.includes('-') ? new Date(matchTime).getTime() : parseInt(matchTime) * 1000) :
              (matchTime > 9999999999 ? matchTime : matchTime * 1000);  // Convert seconds to ms
            matchTimeISO = new Date(timeMs).toISOString();
          } catch (err) {
            matchTimeISO = new Date().toISOString();
          }
          
          // Calculate the actual amount the user matched in this trade (same as position calc)
          // Sum up all matched amounts from maker_orders
          let userMatchedAmount = 0;
          if (t.maker_orders && Array.isArray(t.maker_orders)) {
            userMatchedAmount = t.maker_orders.reduce((sum, mo) => {
              return sum + parseFloat(mo.matched_amount || 0);
            }, 0);
          }
          
          // Use the matched amount, not the full trade size
          const size = userMatchedAmount > 0 ? userMatchedAmount : parseFloat(t.size || 0);
          
          return {
            id: t.id,
            outcome: t.outcome || 'Unknown',
            side: t.side || 'BUY',
            size: size,
            price: parseFloat(t.price || 0),
            matchTime: matchTimeISO,
            status: t.status || 'CONFIRMED'
          };
        })
      });
    }

    logger.logEnd('Fetch Trade History', { count: allTrades.length, markets: tradeHistory.length });

    res.json({
      success: true,
      count: allTrades.length,
      marketCount: tradeHistory.length,
      tradeHistory: tradeHistory,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to fetch trade history', {}, error);
    res.json({
      success: true,
      count: 0,
      tradeHistory: [],
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/check-allowances
 * Check token allowances for all open positions
 */
app.post('/api/check-allowances', async (req, res) => {
  try {
    logger.logStart('Check Token Allowances');
    const clob = await clobOps.initClobClient(SAFE_ADDRESS);

    // Get open positions
    let positions = await clobOps.getOpenPositions(clob);

    // Enhance with market info
    for (let i = 0; i < positions.length; i++) {
      try {
        const marketInfo = await clobOps.getFullMarketInfo(clob, positions[i].tokenId, positions[i].market);
        positions[i].marketTitle = marketInfo.title;
        positions[i].eventTitle = marketInfo.event;
        positions[i].marketDescription = marketInfo.description;
      } catch (err) {
        positions[i].marketTitle = positions[i].marketName || 'Unknown';
        positions[i].eventTitle = 'Unknown Event';
      }
    }

    // Check allowance for each position's token
    const allowances = [];
    for (const pos of positions) {
      try {
        const result = await clob.getBalanceAllowance({
          asset_type: 'CONDITIONAL',
          token_id: pos.tokenId
        });

        const balance = parseFloat(result.balance || 0);
        const allowance = parseFloat(result.allowance || 0);
        const positionSize = parseFloat(pos.amount || 0);

        allowances.push({
          tokenId: pos.tokenId,
          outcome: pos.outcome,
          eventTitle: pos.eventTitle,
          marketDescription: pos.marketDescription,
          positionSize: positionSize,
          balance: balance,
          allowance: allowance,
          hasAllowance: allowance > 0,
          isAllowanceSufficient: allowance >= positionSize,
          warning: allowance === 0 ? '⚠️ NO ALLOWANCE SET' : 
                   allowance < positionSize ? '⚠️ INSUFFICIENT ALLOWANCE' : 
                   '✅ ALLOWANCE OK'
        });
      } catch (err) {
        logger.warn(`Failed to check allowance for token ${pos.tokenId}`, { error: err.message });
        allowances.push({
          tokenId: pos.tokenId,
          outcome: pos.outcome,
          eventTitle: pos.eventTitle,
          marketDescription: pos.marketDescription,
          positionSize: parseFloat(pos.amount || 0),
          balance: 0,
          allowance: 0,
          hasAllowance: false,
          isAllowanceSufficient: false,
          warning: '❌ COULD NOT CHECK',
          error: err.message
        });
      }
    }

    logger.logEnd('Check Token Allowances', { positions: positions.length, allowances: allowances.length });

    res.json({
      success: true,
      positionCount: positions.length,
      allowances: allowances,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to check allowances', {}, error);
    res.json({
      success: true,
      positionCount: 0,
      allowances: [],
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/positions-core
 * Get open positions from Core API (official source)
 */
app.post('/api/positions-core', async (req, res) => {
  try {
    logger.logStart('Fetch Open Positions (Core API)');
    
    const corePositions = await clobOps.coreApi.getCurrentPositions();
    
    // Enrich with market info
    const clob = await clobOps.initClobClient(SAFE_ADDRESS);
    for (let i = 0; i < corePositions.length; i++) {
      try {
        const tokenId = corePositions[i].token_id || corePositions[i].asset || '';
        const marketInfo = await clobOps.getFullMarketInfo(clob, tokenId, '');
        corePositions[i].eventTitle = marketInfo.event || corePositions[i].title;
        corePositions[i].marketDescription = marketInfo.description || corePositions[i].title;
      } catch (err) {
        corePositions[i].eventTitle = corePositions[i].title || 'Unknown Event';
        corePositions[i].marketDescription = corePositions[i].slug || corePositions[i].eventSlug || 'Unknown Market';
      }
    }

    logger.logEnd('Fetch Open Positions (Core API)', { count: corePositions.length });

    res.json({
      success: true,
      count: corePositions.length,
      positions: corePositions,
      source: 'Core API',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to fetch positions from Core API', {}, error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/trade-comparison
 * Compare CLOB trades with Core API trades
 * Request body: { takerOnly: true/false }
 */
app.post('/api/trade-comparison', async (req, res) => {
  try {
    logger.logStart('Trade Comparison (CLOB vs Core API)');
    
    const { takerOnly = true } = req.body;
    const clobTrades = clobOps.TradeCache.getAll();
    const coreApi = require('./utils/core-api');
    const activityTrades = await coreApi.getUserActivity({ user: USER_ADDRESS, limit: 100, type: ['TRADE'] });
    const coreTradesData = Array.isArray(activityTrades) ? activityTrades.filter(a => a && a.type === 'TRADE') : [];

    const reconciliation = clobOps.coreApi.reconcileTrades(clobTrades, coreTradesData);

    logger.logEnd('Trade Comparison', reconciliation);

    res.json({
      success: true,
      reconciliation: reconciliation,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to compare trades', {}, error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/trades-core
 * Fetch raw trades from Data API (Core)
 * Request body: { takerOnly: true/false, limit?: number }
 */
app.post('/api/trades-core', async (req, res) => {
  try {
    logger.logStart('Fetch Trades (Core Activity)');

    const { limit = 100, offset = 0, market, eventId, side } = req.body || {};
    const coreApi = require('./utils/core-api');

    // Use Core Activity endpoint and filter to TRADE events
    const activity = await coreApi.getUserActivity({
      user: USER_ADDRESS,
      limit,
      offset,
      market,
      eventId,
      type: 'TRADE',
      side
    });

    const tradesOnly = Array.isArray(activity) ? activity.filter(a => a && a.type === 'TRADE') : [];

    logger.logEnd('Fetch Trades (Core Activity)', { count: tradesOnly.length });

    res.json({
      success: true,
      trades: tradesOnly,
      source: 'Core Activity',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to fetch trades from Core Activity', {}, error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/closed-positions-core
 * Get closed positions (realized PnL) from Data API
 */
app.post('/api/closed-positions-core', async (req, res) => {
  try {
    logger.logStart('Fetch Closed Positions (Data API)');
    
    // Use the new official Data API module
    const coreApi = require('./utils/core-api');
    
    // Get closed positions directly from official endpoint
    const closedPositions = await coreApi.getClosedPositions({ user: USER_ADDRESS });
    
    if (closedPositions && closedPositions.length > 0) {
      // Group by market for display
      const grouped = {};
      let totalRealizedPnl = 0;
      
      closedPositions.forEach(pos => {
        const conditionId = pos.conditionId || 'unknown';
        if (!grouped[conditionId]) {
          grouped[conditionId] = {
            conditionId,
            title: pos.title || 'Unknown Event',
            slug: pos.slug || '',
            event: pos.eventSlug || pos.slug || pos.title || 'Unknown',
            totalRealizedPnl: 0,
            positions: []
          };
        }
        
        const realizedPnl = parseFloat(pos.realizedPnl || 0);
        grouped[conditionId].totalRealizedPnl += realizedPnl;
        grouped[conditionId].positions.push({
          outcome: pos.outcome || 'N/A',
          realizedPnl,
          percentRealizedPnl: 0 // Not provided by official API
        });
        
        totalRealizedPnl += realizedPnl;
      });
      
      const closedData = {
        totalRealizedPnl: totalRealizedPnl.toFixed(2),
        positionCount: Object.keys(grouped).length,
        closedPositions: Object.values(grouped),
        timestamp: new Date().toISOString()
      };
      
      logger.logEnd('Fetch Closed Positions (Data API)', { 
        count: closedData.positionCount,
        totalPnl: closedData.totalRealizedPnl 
      });

      return res.json({
        success: true,
        data: closedData,
        source: 'Data API (official)',
        timestamp: new Date().toISOString()
      });
    }
    
    // If no closed positions from API, return empty data
    logger.info('No closed positions returned from Data API');
    const emptyData = {
      totalRealizedPnl: '0.00',
      positionCount: 0,
      closedPositions: [],
      timestamp: new Date().toISOString()
    };

    logger.logEnd('Fetch Closed Positions (Data API)', { count: emptyData.positionCount });

    return res.json({
      success: true,
      data: emptyData,
      source: 'Data API (official: none)',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.warn('Failed to fetch closed positions from Data API; using CLOB fallback', { note: 'non-fatal' });
    // Fallback: compute closed positions from CLOB trade cache
    try {
      const clob = await clobOps.initClobClient(SAFE_ADDRESS);
      const clobClosed = await clobOps.getClosedPositions(clob);

      // Map CLOB closed groups to Core-like closed positions structure
      const grouped = {};
      for (const grp of clobClosed) {
        const key = grp.conditionId || grp.eventTitle || 'unknown';
        if (!grouped[key]) {
          grouped[key] = {
            conditionId: grp.conditionId || key,
            title: grp.eventTitle || grp.marketTitle || grp.marketDescription || 'Unknown Event',
            slug: grp.marketDescription || 'Unknown',
            event: grp.eventTitle || grp.marketTitle || 'Unknown Event',
            totalRealizedPnl: 0,
            positions: []
          };
        }
        const entry = grouped[key];
        // Aggregate totals
        entry.totalRealizedPnl += parseFloat(grp.pnlAbsolute || 0);
        // Push per-outcome details if available
        const outcomes = Array.isArray(grp.outcomes) && grp.outcomes.length ? grp.outcomes : [{ outcome: grp.outcome, pnlAbsolute: grp.pnlAbsolute, pnlPercent: grp.pnlPercent }];
        outcomes.forEach(o => {
          entry.positions.push({
            outcome: o.outcome || 'N/A',
            realizedPnl: parseFloat(o.pnlAbsolute || grp.pnlAbsolute || 0),
            percentRealizedPnl: parseFloat(o.pnlPercent || grp.pnlPercent || 0)
          });
        });
      }

      const fallbackData = {
        totalRealizedPnl: Object.values(grouped).reduce((s, g) => s + (parseFloat(g.totalRealizedPnl) || 0), 0).toFixed(2),
        positionCount: Object.keys(grouped).length,
        closedPositions: Object.values(grouped),
        timestamp: new Date().toISOString()
      };

      return res.json({
        success: true,
        data: fallbackData,
        source: 'CLOB fallback',
        timestamp: new Date().toISOString()
      });
    } catch (fallbackErr) {
      logger.error('Fallback closed positions failed', {}, fallbackErr);
      return res.status(500).json({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }
});

/**
 * POST /api/portfolio-value-core
 * Get total portfolio value from Data API
 */
app.post('/api/portfolio-value-core', async (req, res) => {
  try {
    logger.logStart('Fetch Portfolio Value (Data API)');
    
    // Get current positions first
    const positions = await clobOps.coreApi.getCurrentPositions();
    
    // Calculate portfolio value from positions
    const portfolioData = clobOps.coreApi.calculatePortfolioValue(positions);

    logger.logEnd('Fetch Portfolio Value (Data API)', { totalValue: portfolioData.totalValue });

    res.json({
      success: true,
      data: portfolioData,
      source: 'Data API',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to fetch portfolio value from Data API', {}, error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/clear-core-cache
 * Clear Core API caches for manual refresh
 */
app.post('/api/clear-core-cache', (req, res) => {
  try {
    logger.logStart('Clear Core API Caches');
    
    clobOps.coreApi.clearCache();

    logger.logEnd('Clear Core API Caches', { status: 'cleared' });

    res.json({
      success: true,
      message: 'Core API caches cleared',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to clear caches', {}, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =============================================================================
// NEW POLYMARKET DATA API ENDPOINTS (Official API)
// =============================================================================

/**
 * POST /api/activity
 * Get user activity timeline from Data API
 */
app.post('/api/activity', async (req, res) => {
  try {
    const { limit, offset, market, eventId, type } = req.body;
    logger.logStart('Fetch User Activity', { limit, type });
    
    const coreApi = require('./utils/core-api');
    const activity = await coreApi.getUserActivity({
      user: USER_ADDRESS,
      limit,
      offset,
      market,
      eventId,
      type
    });

    logger.logEnd('Fetch User Activity', { count: activity.length });

    res.json({
      success: true,
      count: activity.length,
      activity,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to fetch user activity', {}, error);
    res.status(500).json({
      success: false,
      error: error.message,
      activity: [],
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/data-api/trades
 * Get trade history from official Data API
 */
app.post('/api/data-api/trades', async (req, res) => {
  try {
    const { limit, offset, side, market, eventId } = req.body;
    logger.logStart('Fetch Trades (Core Activity Official)', { limit, side });
    
    const coreApi = require('./utils/core-api');
    const activity = await coreApi.getUserActivity({
      user: USER_ADDRESS,
      limit,
      offset,
      market,
      eventId,
      type: 'TRADE',
      side
    });

    const trades = Array.isArray(activity) ? activity.filter(a => a && a.type === 'TRADE') : [];

    logger.logEnd('Fetch Trades (Core Activity Official)', { count: trades.length });

    res.json({
      success: true,
      count: trades.length,
      trades,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to fetch trades from Core Activity', {}, error);
    res.status(500).json({
      success: false,
      error: error.message,
      trades: [],
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/data-api/positions
 * Get current open positions from official Data API
 */
app.post('/api/data-api/positions', async (req, res) => {
  try {
    logger.logStart('Fetch Current Positions (Data API Official)');
    
    const coreApi = require('./utils/core-api');
    const positions = await coreApi.getCurrentPositions({
      user: USER_ADDRESS
    });

    logger.logEnd('Fetch Current Positions (Data API Official)', { count: positions.length });

    res.json({
      success: true,
      count: positions.length,
      positions,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to fetch current positions from Data API', {}, error);
    res.status(500).json({
      success: false,
      error: error.message,
      positions: [],
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/data-api/closed-positions
 * Get closed positions from official Data API
 */
app.post('/api/data-api/closed-positions', async (req, res) => {
  try {
    logger.logStart('Fetch Closed Positions (Data API Official)');
    
    const coreApi = require('./utils/core-api');
    const closedPositions = await coreApi.getClosedPositions({
      user: USER_ADDRESS
    });

    logger.logEnd('Fetch Closed Positions (Data API Official)', { count: closedPositions.length });

    res.json({
      success: true,
      count: closedPositions.length,
      closedPositions,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to fetch closed positions from Data API', {}, error);
    res.status(500).json({
      success: false,
      error: error.message,
      closedPositions: [],
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/data-api/portfolio-value
 * Get total portfolio value from official Data API
 */
app.post('/api/data-api/portfolio-value', async (req, res) => {
  try {
    logger.logStart('Fetch Portfolio Value (Data API Official)');
    
    const coreApi = require('./utils/core-api');
    const portfolioValue = await coreApi.getPortfolioValue({
      user: USER_ADDRESS
    });

    logger.logEnd('Fetch Portfolio Value (Data API Official)', { value: portfolioValue.value });

    res.json({
      success: true,
      ...portfolioValue,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to fetch portfolio value from Data API', {}, error);
    res.status(500).json({
      success: false,
      error: error.message,
      value: 0,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/data-api/pnl
 * Calculate total PnL from official Data API
 */
app.post('/api/data-api/pnl', async (req, res) => {
  try {
    logger.logStart('Calculate Total PnL (Data API Official)');
    
    const coreApi = require('./utils/core-api');
    const pnl = await coreApi.calculateTotalPnL({
      user: USER_ADDRESS
    });

    logger.logEnd('Calculate Total PnL (Data API Official)', { 
      totalPnL: pnl.totalPnL,
      unrealizedPnL: pnl.unrealizedPnL,
      realizedPnL: pnl.totalRealizedPnL
    });

    res.json({
      success: true,
      pnl,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to calculate PnL from Data API', {}, error);
    res.status(500).json({
      success: false,
      error: error.message,
      pnl: {
        totalPnL: 0,
        unrealizedPnL: 0,
        totalRealizedPnL: 0
      },
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/data-api/account-summary
 * Get comprehensive account summary from official Data API
 */
app.post('/api/data-api/account-summary', async (req, res) => {
  try {
    logger.logStart('Fetch Account Summary (Data API Official)');
    
    const coreApi = require('./utils/core-api');
    const summary = await coreApi.getAccountSummary({
      user: USER_ADDRESS
    });

    logger.logEnd('Fetch Account Summary (Data API Official)', {
      portfolioValue: summary.portfolio.value,
      totalPnL: summary.pnl.total,
      openPositions: summary.portfolio.openPositionsCount,
      closedPositions: summary.portfolio.closedPositionsCount
    });

    res.json({
      success: true,
      summary,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to fetch account summary from Data API', {}, error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /dashboard
 * Serve the dashboard HTML with embedded data
 */
app.get('/dashboard', (req, res) => {
  (async () => {
    try {
      console.log('[DASHBOARD] 📊 Dashboard requested, fetching data...');
      
      // STEP 1: Always start with static HTML (fast load)
      let html = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8');
      
      // STEP 2: Get immediate data (no async operations)
      const preloadedData = {
        balances: { eoaBalance: 0, safeBalance: 0, funderBalance: 0 },
        orders: [],
        positions: [],
        closed: [],
        trades: [],
        timestamp: new Date().toISOString()
      };
      
      // STEP 3: Try to fetch real data with timeout (max 3 seconds)
      try {
        const balancesPromise = (async () => {
          const provider = getProvider();
          const signer = getSigner();
          const eoa = await signer.getAddress();
          const usdcContract = new ethers.Contract(USDC_ADDRESS, USDC_ABI, provider);

          const [eoaBalance, safeBalance, funderBalance] = await Promise.all([
            usdcContract.balanceOf(eoa),
            usdcContract.balanceOf(SAFE_ADDRESS),
            usdcContract.balanceOf(FUNDER_ADDRESS)
          ]);

          return {
            eoaBalance: parseFloat(ethers.utils.formatUnits(eoaBalance, 6)),
            safeBalance: parseFloat(ethers.utils.formatUnits(safeBalance, 6)),
            funderBalance: parseFloat(ethers.utils.formatUnits(funderBalance, 6))
          };
        })();
        
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 3000)
        );
        
        const balances = await Promise.race([balancesPromise, timeoutPromise]);
        preloadedData.balances = balances;
        console.log('[DASHBOARD] ✅ Balances fetched:', balances);
      } catch (err) {
        console.log('[DASHBOARD] ⚠️ Balance fetch failed or timed out:', err.message);
      }
      
      // Get cached trades
      try {
        const trades = clobOps.TradeCache.getAll() || [];
        preloadedData.trades = trades;
        console.log('[DASHBOARD] ✅ Cached trades:', trades.length);
      } catch (err) {
        console.log('[DASHBOARD] ⚠️ Trade cache error:', err.message);
      }
      
      // STEP 4: Inject preloaded data into HTML
      const dataScript = `<script>
window.preloadedData = ${JSON.stringify(preloadedData)};
console.log('[INIT] Preloaded data injected:', window.preloadedData);
</script>`;
      
      const finalHtml = html.replace('</body>', dataScript + '\n</body>');
      
      // STEP 5: Send response immediately
      res.type('text/html').charset('utf-8');
      res.send(finalHtml);
      console.log('[DASHBOARD] ✅ Sent dashboard with embedded data');
      
      // STEP 6: Fetch remaining data in background (don't block response)
      fetchBackgroundData();
      
    } catch (error) {
      console.error('[DASHBOARD] ❌ Error:', error.message);
      // Fallback: send raw HTML
      res.sendFile(path.join(__dirname, 'dashboard.html'));
    }
  })();
});

// Background data fetching (doesn't block dashboard response)
async function fetchBackgroundData() {
  try {
    console.log('[BACKGROUND] 🔄 Starting background data fetch...');
    const clob = await clobOps.initClobClient(SAFE_ADDRESS);
    
    const [orders, positions, closed] = await Promise.all([
      clobOps.getOpenOrders(clob).catch(() => []),
      clobOps.getOpenPositions(clob).catch(() => []),
      clobOps.getClosedPositions(clob).catch(() => [])
    ]);
    
    console.log('[BACKGROUND] ✅ Fetched:', { orders: orders.length, positions: positions.length, closed: closed.length });
  } catch (err) {
    console.log('[BACKGROUND] ⚠️ Error:', err.message);
  }
}

/**
 * GET /
 * Serve the dashboard HTML at root
 */
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// =============================================================================
// ERROR HANDLING & SERVER START
// =============================================================================

app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({
    success: false,
    error: err.message
  });
});

const PORT = process.env.PORT || 8000;
const envStatus = validateConfig();
if (!envStatus.ok) {
  console.error('❌ Missing required environment variables:', envStatus.missing.join(', '));
  process.exit(1);
}

const server = app.listen(PORT, '0.0.0.0', () => {
  try {
    const signer = getSigner();
    logger.success(`Server started on http://localhost:${PORT}`);
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`📊 POLYMARKET DASHBOARD SERVER`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`🚀 Server: http://localhost:${PORT}`);
    console.log(`📈 Dashboard: http://localhost:${PORT}/dashboard`);
    console.log(`\n⚙️  Configuration:`);
    console.log(`   Safe: ${SAFE_ADDRESS}`);
    console.log(`   EOA: ${signer.address}`);
    console.log(`   Funder: ${FUNDER_ADDRESS}`);
    console.log(`\n📡 API Endpoints:`);
    console.log(`   POST /api/balances - Get cash balances`);
    console.log(`   POST /api/orders - Get open orders with market names`);
    console.log(`   POST /api/positions - Get open positions with market names`);
    console.log(`   POST /api/closed-positions - Get closed positions with PnL`);
    console.log(`   POST /api/trade-history - Get all trades grouped by event`);
    console.log(`   POST /api/check-allowances - Check token allowances for positions`);
    console.log(`   POST /api/cancel-order - Cancel single order`);
    console.log(`   POST /api/killswitch - Cancel all orders`);
    console.log(`   POST /api/sell - Create sell order`);
    console.log(`\n🔌 Core API Endpoints (Legacy):`);
    console.log(`   POST /api/positions-core - Get open positions from Core API`);
    console.log(`   POST /api/trade-comparison - Compare CLOB vs Core API trades`);
    console.log(`   POST /api/trades-core - Get raw trades from Core API`);
    console.log(`   POST /api/closed-positions-core - Get closed positions (PnL) from Core API`);
    console.log(`   POST /api/portfolio-value-core - Get total portfolio value from Core API`);
    console.log(`   POST /api/clear-core-cache - Clear Core API caches for manual refresh`);
    console.log(`\n📊 Official Data API Endpoints (New):`);
    console.log(`   POST /api/activity - Get user activity timeline`);
    console.log(`   POST /api/data-api/trades - Get trade history (official)`);
    console.log(`   POST /api/data-api/positions - Get current open positions (official)`);
    console.log(`   POST /api/data-api/closed-positions - Get closed positions (official)`);
    console.log(`   POST /api/data-api/portfolio-value - Get total portfolio value (official)`);
    console.log(`   POST /api/data-api/pnl - Calculate total PnL (official)`);
    console.log(`   POST /api/data-api/account-summary - Get comprehensive account summary (official)`);
    console.log(`\n📋 Logging:`);
    console.log(`   Console: Real-time output`);
    console.log(`   Files: /logs/polymarket-YYYY-MM-DD.log`);
    console.log(`${'═'.repeat(60)}\n`);
  } catch (err) {
    console.error('❌ Server startup error:', err);
    process.exit(1);
  }
});

// Handle any uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err.message);
  console.error(err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection:', reason);
  if (reason instanceof Error) {
    console.error(reason.stack);
  }
  process.exit(1);
});

module.exports = app;
