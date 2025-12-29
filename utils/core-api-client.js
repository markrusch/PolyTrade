/**
 * POLYMARKET DATA API CLIENT
 * 
 * Public API wrapper for fetching positions, trades, and market data
 * Official API: https://data-api.polymarket.com/
 * No authentication required (on-chain data)
 */

const axios = require('axios');
const { createLogger } = require('./logger');

const logger = createLogger('DATA_API');

const DATA_API_BASE = process.env.POLYMARKET_CORE_API_URL || 'https://data-api.polymarket.com';
const USER_ADDRESS = process.env.POLYMARKET_USER_ADDRESS;

// Cache for API responses (avoid repeated calls)
const dataApiCache = {
  positions: { data: null, timestamp: 0, ttl: 5 * 60 * 1000 },      // 5 min
  trades: { data: null, timestamp: 0, ttl: 1 * 60 * 1000 },          // 1 min
  closedPositions: { data: null, timestamp: 0, ttl: 30 * 60 * 1000 }, // 30 min
};

/**
 * Check if cached data is still valid
 */
function isCacheValid(cache) {
  const now = Date.now();
  return cache.data && (now - cache.timestamp) < cache.ttl;
}

/**
 * GET /positions - Fetch current open positions
 * 
 * Public endpoint, no auth required
 * Query params: sizeThreshold, limit, sortBy, sortDirection, user
 * 
 * @param {string} userAddress - User wallet address (defaults to env var)
 * @returns {Promise<Array>} Array of positions with outcome, size, price, PnL, etc.
 */
async function getCurrentPositions(userAddress = USER_ADDRESS) {
  logger.logStart('Get Current Positions', { userAddress: userAddress?.slice(0, 10) });

  try {
    // Check cache first
    if (isCacheValid(dataApiCache.positions)) {
      logger.info('Using cached positions', { cacheAge: `${Date.now() - dataApiCache.positions.timestamp}ms` });
      logger.logEnd('Get Current Positions', { source: 'cache', count: dataApiCache.positions.data.length });
      return dataApiCache.positions.data;
    }

    if (!userAddress) {
      throw new Error('POLYMARKET_USER_ADDRESS not configured in .env');
    }

    const url = `${DATA_API_BASE}/positions?sizeThreshold=1&limit=100&sortBy=TOKENS&sortDirection=DESC&user=${userAddress}`;
    
    logger.debug(`Fetching from: ${url}`);
    const response = await axios.get(url, {
      timeout: 10000,
      headers: { 'Accept': 'application/json' }
    });

    const positions = response.data || [];
    logger.info(`Fetched ${positions.length} open positions`);

    // Cache the result
    dataApiCache.positions.data = positions;
    dataApiCache.positions.timestamp = Date.now();

    logger.logEnd('Get Current Positions', { count: positions.length, source: 'API' });
    return positions;
  } catch (error) {
    logger.error('Failed to fetch current positions', { error: error.message });
    // Graceful fallback: return empty array instead of throwing
    return [];
  }
}

/**
 * GET /trades - Fetch trade history for user
 * 
 * Public endpoint, no auth required
 * Query params: limit, takerOnly, user, asset, conditionId, etc.
 * 
 * @param {Object} options - Filter options
 * @returns {Promise<Array>} Array of trades with side, size, price, timestamp, etc.
 */
async function getTrades(options = {}) {
  const { user = USER_ADDRESS, limit = 1000, takerOnly = true } = options;
  
  logger.logStart('Get Trades', { user: user?.slice(0, 10), limit, takerOnly });

  try {
    // Create a cache key based on parameters (for different takerOnly values)
    const cacheKey = `trades_${takerOnly}`;
    const cache = dataApiCache.trades;

    // Check cache first (but only if takerOnly hasn't changed from last cache)
    if (cache.data && cache.lastOptions?.takerOnly === takerOnly && isCacheValid(cache)) {
      logger.info('Using cached trades', { cacheAge: `${Date.now() - cache.timestamp}ms` });
      logger.logEnd('Get Trades', { source: 'cache', count: cache.data.length });
      return cache.data;
    }

    if (!user) {
      throw new Error('User address required to fetch trades');
    }

    // Build query string
    const params = new URLSearchParams({
      limit,
      takerOnly: takerOnly.toString(),
      user
    });

    // Add optional filters
    if (options.asset) params.append('asset', options.asset);
    if (options.conditionId) params.append('conditionId', options.conditionId);

    const url = `${DATA_API_BASE}/trades?${params.toString()}`;
    
    logger.debug(`Fetching from: ${url}`);
    const response = await axios.get(url, {
      timeout: 10000,
      headers: { 'Accept': 'application/json' }
    });

    const trades = response.data || [];
    logger.info(`Fetched ${trades.length} trades`);

    // Cache the result with parameters
    dataApiCache.trades.data = trades;
    dataApiCache.trades.timestamp = Date.now();
    dataApiCache.trades.lastOptions = { takerOnly };

    logger.logEnd('Get Trades', { count: trades.length, source: 'API' });
    return trades;
  } catch (error) {
    logger.error('Failed to fetch trades', { error: error.message });
    // Graceful fallback: return empty array instead of throwing
    return [];
  }
}

/**
 * Reconcile CLOB trades vs Data API trades
 * Compares trade counts, amounts, and identifies discrepancies
 * 
 * @param {Array} clobTrades - Trades from CLOB client
 * @param {Array} coreApiTrades - Trades from Data API
 * @returns {Object} Reconciliation report
 */
function reconcileTrades(clobTrades = [], coreApiTrades = []) {
  logger.logStart('Reconcile Trades', { clobCount: clobTrades.length, coreCount: coreApiTrades.length });

  // Create maps for comparison (by transaction hash)
  const clobMap = new Map();
  const coreMap = new Map();

  clobTrades.forEach(trade => {
    const key = trade.transactionHash || `${trade.side}-${trade.asset}-${trade.size}-${trade.price}`;
    clobMap.set(key, trade);
  });

  coreApiTrades.forEach(trade => {
    const key = trade.transactionHash || `${trade.side}-${trade.asset}-${trade.size}-${trade.price}`;
    coreMap.set(key, trade);
  });

  // Find matched, only in CLOB, only in Core
  const matched = [];
  const onlyInClob = [];
  const onlyInCore = [];

  clobMap.forEach((trade, key) => {
    if (coreMap.has(key)) {
      matched.push(trade);
    } else {
      onlyInClob.push(trade);
    }
  });

  coreMap.forEach((trade, key) => {
    if (!clobMap.has(key)) {
      onlyInCore.push(trade);
    }
  });

  // Calculate totals
  const totalClobSize = clobTrades.reduce((sum, t) => sum + (parseFloat(t.size) || 0), 0);
  const totalCoreSize = coreApiTrades.reduce((sum, t) => sum + (parseFloat(t.size) || 0), 0);
  const totalMatchedSize = matched.reduce((sum, t) => sum + (parseFloat(t.size) || 0), 0);

  const reconciliation = {
    summary: {
      totalClob: clobTrades.length,
      totalCore: coreApiTrades.length,
      matched: matched.length,
      discrepancy: Math.abs(clobTrades.length - coreApiTrades.length),
      clobSizeTotal: totalClobSize.toFixed(4),
      coreSizeTotal: totalCoreSize.toFixed(4),
      matchedSize: totalMatchedSize.toFixed(4),
      matchPercentage: coreApiTrades.length > 0 ? ((matched.length / coreApiTrades.length) * 100).toFixed(2) : 'N/A'
    },
    matched: matched.slice(0, 10), // First 10 for display
    onlyInClob: onlyInClob.slice(0, 5),
    onlyInCore: onlyInCore.slice(0, 5),
    timestamp: new Date().toISOString()
  };

  logger.logEnd('Reconcile Trades', { 
    matched: matched.length, 
    discrepancy: reconciliation.summary.discrepancy,
    matchPercentage: reconciliation.summary.matchPercentage
  });

  return reconciliation;
}

/**
 * Calculate realized PnL from trades
 * Processes raw trades to compute PnL per market
 * 
 * @param {Array} trades - Array of trades from Core API
 * @returns {Object} Summary of realized P&L per market
 */
function calculateClosedPositionsFromTrades(trades = []) {
  logger.logStart('Calculate Closed Positions from Trades');

  // Group trades by conditionId (market)
  const tradesByMarket = {};
  
  trades.forEach(trade => {
    const conditionId = trade.conditionId || trade.market || 'unknown';
    if (!tradesByMarket[conditionId]) {
      tradesByMarket[conditionId] = {
        conditionId,
        title: trade.title || trade.eventTitle || trade.marketTitle || 'Unknown Event',
        slug: trade.slug || trade.eventSlug || '',
        event: trade.eventSlug || trade.slug || trade.title || 'Unknown',
        buyTrades: [],
        sellTrades: [],
        outcomesByAsset: {}
      };
    }
    
    const market = tradesByMarket[conditionId];
    const side = (trade.side || '').toUpperCase();
    // Core API uses 'asset', CLOB uses 'asset_id'
    const assetId = trade.asset || trade.asset_id || trade.token_id;
    
    // Track outcome per asset
    if (assetId && trade.outcome && !market.outcomesByAsset[assetId]) {
      market.outcomesByAsset[assetId] = trade.outcome;
    }
    
    if (side === 'BUY') {
      market.buyTrades.push(trade);
    } else if (side === 'SELL') {
      market.sellTrades.push(trade);
    }
  });

  // Calculate PnL for each market
  const closedPositions = [];
  let totalRealizedPnl = 0;

  Object.values(tradesByMarket).forEach(market => {
    // Group by asset/outcome
    const positionsByAsset = {};
    
    [...market.buyTrades, ...market.sellTrades].forEach(trade => {
      // Core API uses 'asset', CLOB uses 'asset_id'
      const assetId = trade.asset || trade.asset_id || trade.token_id || 'unknown';
      if (!positionsByAsset[assetId]) {
        positionsByAsset[assetId] = {
          outcome: market.outcomesByAsset[assetId] || trade.outcome || 'N/A',
          buySize: 0,
          buyValue: 0,
          sellSize: 0,
          sellValue: 0
        };
      }
      
      const pos = positionsByAsset[assetId];
      const size = parseFloat(trade.size || 0);
      const price = parseFloat(trade.price || 0);
      const side = (trade.side || '').toUpperCase();
      
      if (side === 'BUY') {
        pos.buySize += size;
        pos.buyValue += size * price;
      } else if (side === 'SELL') {
        pos.sellSize += size;
        pos.sellValue += size * price;
      }
    });

    // Calculate PnL for each outcome
    const positions = Object.values(positionsByAsset).map(pos => {
      const closedSize = Math.min(pos.buySize, pos.sellSize);
      const avgBuyPrice = pos.buySize > 0 ? pos.buyValue / pos.buySize : 0;
      const avgSellPrice = pos.sellSize > 0 ? pos.sellValue / pos.sellSize : 0;
      const realizedPnl = closedSize * (avgSellPrice - avgBuyPrice);
      const percentRealizedPnl = pos.buyValue > 0 ? (realizedPnl / pos.buyValue) * 100 : 0;
      
      return {
        outcome: pos.outcome,
        realizedPnl,
        percentRealizedPnl
      };
    });

    const marketRealizedPnl = positions.reduce((sum, p) => sum + p.realizedPnl, 0);
    totalRealizedPnl += marketRealizedPnl;

    closedPositions.push({
      conditionId: market.conditionId,
      title: market.title,
      slug: market.slug,
      event: market.event,
      totalRealizedPnl: marketRealizedPnl,
      positions
    });
  });

  const result = {
    totalRealizedPnl: totalRealizedPnl.toFixed(2),
    positionCount: closedPositions.length,
    closedPositions,
    timestamp: new Date().toISOString()
  };

  logger.logEnd('Calculate Closed Positions from Trades', { 
    count: closedPositions.length,
    totalPnl: totalRealizedPnl.toFixed(2)
  });

  return result;
}

/**
 * Calculate realized PnL from closed positions
 * Uses current positions to derive closed P&L
 * 
 * @param {Array} currentPositions - Current open positions
 * @returns {Object} Summary of realized P&L
 */
function calculateClosedPositions(currentPositions = []) {
  logger.logStart('Calculate Closed Positions');

  // Extract markets and group by condition
  const closedByCondition = {};
  let totalRealizedPnl = 0;

  currentPositions.forEach(pos => {
    const conditionId = pos.conditionId;
    if (!closedByCondition[conditionId]) {
      // Robust title resolution across known field variants
      const resolvedTitle = pos.title || pos.eventTitle || pos.marketTitle || pos.market || pos.slug || pos.event || 'Unknown Event';
      const resolvedSlug = pos.slug || pos.eventSlug || pos.event || pos.marketSlug || '';
      closedByCondition[conditionId] = {
        conditionId,
        title: resolvedTitle,
        slug: resolvedSlug,
        event: resolvedSlug || resolvedTitle,
        totalRealizedPnl: 0,
        positions: []
      };
    }
    
    const realizedPnl = parseFloat(pos.realizedPnl) || 0;
    closedByCondition[conditionId].totalRealizedPnl += realizedPnl;
    closedByCondition[conditionId].positions.push({
      outcome: pos.outcome,
      realizedPnl,
      percentRealizedPnl: pos.percentRealizedPnl || 0
    });
    
    totalRealizedPnl += realizedPnl;
  });

  const closedPositions = Object.values(closedByCondition);

  const result = {
    totalRealizedPnl: totalRealizedPnl.toFixed(2),
    positionCount: closedPositions.length,
    closedPositions,
    timestamp: new Date().toISOString()
  };

  logger.logEnd('Calculate Closed Positions', { 
    count: closedPositions.length,
    totalPnl: totalRealizedPnl.toFixed(2)
  });

  return result;
}

/**
 * Calculate total portfolio value
 * Uses current positions to sum USD value
 * 
 * @param {Array} currentPositions - Current open positions
 * @returns {Object} Summary of portfolio value
 */
function calculatePortfolioValue(currentPositions = []) {
  logger.logStart('Calculate Portfolio Value');

  let totalValue = 0;
  let totalUnrealizedPnl = 0;
  const positions = [];

  currentPositions.forEach(pos => {
    const currentVal = parseFloat(pos.currentValue) || 0;
    const cashPnl = parseFloat(pos.cashPnl) || 0;
    
    totalValue += currentVal;
    totalUnrealizedPnl += cashPnl;
    
    positions.push({
      title: pos.title,
      outcome: pos.outcome,
      size: pos.size,
      currentValue: currentVal,
      cashPnl,
      percentPnl: pos.percentPnl || 0,
      curPrice: pos.curPrice
    });
  });

  const result = {
    totalValue: totalValue.toFixed(2),
    totalUnrealizedPnl: totalUnrealizedPnl.toFixed(2),
    positionCount: positions.length,
    positions,
    timestamp: new Date().toISOString()
  };

  logger.logEnd('Calculate Portfolio Value', { 
    totalValue: totalValue.toFixed(2),
    unrealizedPnl: totalUnrealizedPnl.toFixed(2),
    positionCount: positions.length
  });

  return result;
}

/**
 * Clear all caches to force fresh API calls
 */
function clearCache() {
  logger.logStart('Clear Cache');
  
  dataApiCache.positions.data = null;
  dataApiCache.positions.timestamp = 0;
  dataApiCache.trades.data = null;
  dataApiCache.trades.timestamp = 0;
  dataApiCache.closedPositions.data = null;
  dataApiCache.closedPositions.timestamp = 0;

  logger.info('All caches cleared');
  logger.logEnd('Clear Cache');
}

module.exports = {
  getCurrentPositions,
  getTrades,
  reconcileTrades,
  calculateClosedPositions,
  calculateClosedPositionsFromTrades,
  calculatePortfolioValue,
  clearCache,
  // Expose cache status for debugging
  getCacheStatus: () => ({
    positions: {
      valid: isCacheValid(dataApiCache.positions),
      age: dataApiCache.positions.timestamp ? Date.now() - dataApiCache.positions.timestamp : null,
      items: dataApiCache.positions.data?.length || 0
    },
    trades: {
      valid: isCacheValid(dataApiCache.trades),
      age: dataApiCache.trades.timestamp ? Date.now() - dataApiCache.trades.timestamp : null,
      items: dataApiCache.trades.data?.length || 0
    }
  })
};
