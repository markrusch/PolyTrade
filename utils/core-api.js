/**
 * POLYMARKET DATA API CLIENT - OFFICIAL API WRAPPER
 * 
 * Implements all official Polymarket Data API endpoints per documentation:
 * - https://docs.polymarket.com/api-reference/core/get-user-activity
 * - https://docs.polymarket.com/developers/misc-endpoints/data-api-get-positions
 * - https://docs.polymarket.com/api-reference/core/get-trades-for-a-user-or-markets
 * - https://docs.polymarket.com/api-reference/core/get-closed-positions-for-a-user
 * - https://docs.polymarket.com/api-reference/core/get-total-value-of-a-users-positions
 * 
 * IMPORTANT: This module uses ONLY officially documented fields and behaviors.
 * No assumptions, no inferred behavior, no undocumented extensions.
 */

const axios = require('axios');
const { createLogger } = require('./logger');

const logger = createLogger('CORE_API');

const DATA_API_BASE = process.env.POLYMARKET_CORE_API_URL || 'https://data-api.polymarket.com';
const USER_ADDRESS = process.env.POLYMARKET_USER_ADDRESS;

// Cache system to avoid excessive API calls
const apiCache = {
  activity: { data: null, timestamp: 0, ttl: 2 * 60 * 1000 },        // 2 minutes
  trades: { data: null, timestamp: 0, ttl: 1 * 60 * 1000 },          // 1 minute
  positions: { data: null, timestamp: 0, ttl: 5 * 60 * 1000 },       // 5 minutes
  closedPositions: { data: null, timestamp: 0, ttl: 30 * 60 * 1000 }, // 30 minutes
  value: { data: null, timestamp: 0, ttl: 5 * 60 * 1000 },           // 5 minutes
};

/**
 * Check if cached data is still valid
 */
function isCacheValid(cache) {
  return cache.data && (Date.now() - cache.timestamp) < cache.ttl;
}

/**
 * 1. GET USER ACTIVITY
 * Endpoint: GET https://data-api.polymarket.com/activity
 * 
 * Provides a chronological event timeline for a user.
 * Filter on type == "TRADE" to isolate executed trades.
 * 
 * @param {Object} options - Query parameters
 * @param {string} options.user - 0x-prefixed wallet address (required)
 * @param {number} options.limit - Maximum number of results
 * @param {number} options.offset - Pagination offset
 * @param {string[]} options.market - Filter by market slugs
 * @param {number[]} options.eventId - Filter by event IDs
 * @param {string[]} options.type - Filter by activity type (TRADE, SPLIT, MERGE, REDEEM, REWARD, CONVERSION)
 * @returns {Promise<Array>} Array of activity objects
 */
async function getUserActivity(options = {}) {
  const { 
    user = USER_ADDRESS, 
    limit, 
    offset, 
    market, 
    eventId, 
    type 
  } = options;

  logger.logStart('Get User Activity', { user: user?.slice(0, 10), limit, type });

  try {
    if (!user) {
      throw new Error('User address is required for getUserActivity');
    }

    // Build query parameters (only include what's provided)
    const params = new URLSearchParams({ user });
    if (limit !== undefined) params.append('limit', limit);
    if (offset !== undefined) params.append('offset', offset);
    if (market) market.forEach(m => params.append('market', m));
    if (eventId) eventId.forEach(id => params.append('eventId', id));
    if (type) type.forEach(t => params.append('type', t));

    const url = `${DATA_API_BASE}/activity?${params.toString()}`;
    logger.debug(`Fetching from: ${url}`);

    const response = await axios.get(url, {
      timeout: 15000,
      headers: { 'Accept': 'application/json' }
    });

    const activity = response.data || [];
    logger.info(`Fetched ${activity.length} activity items`);
    logger.logEnd('Get User Activity', { count: activity.length });

    return activity;
  } catch (error) {
    logger.error('Failed to fetch user activity', { error: error.message });
    return [];
  }
}

/**
 * 2. GET TRADES (via Activity API)
 * Source: GET https://data-api.polymarket.com/activity with type=TRADE
 * 
 * For consistency and safety per request, core trades are now
 * retrieved by filtering the Activity endpoint to `type=TRADE`.
 * This returns on-chain user trade events including size, price,
 * side, asset, transactionHash, and timestamp (seconds).
 * 
 * @param {Object} options - Query parameters
 * @param {string} options.user - User wallet address
 * @param {number} options.limit - Maximum number of results
 * @param {number} options.offset - Pagination offset
 * @param {string[]} options.market - Filter by market slugs
 * @param {number[]} options.eventId - Filter by event IDs
 * @param {string} options.side - Filter by side (BUY or SELL)
 * @returns {Promise<Array>} Array of trade objects (activity rows with type=TRADE)
 */
async function getTrades(options = {}) {
  const {
    user = USER_ADDRESS,
    limit,
    offset,
    market,
    eventId,
    side
  } = options;

  logger.logStart('Get Trades (Activity)', { user: user?.slice(0, 10), limit, side });

  try {
    // Check cache for user trades with matching parameters
    const cacheKey = `${user}_${side}_${limit}_${offset}`;
    if (isCacheValid(apiCache.trades) && apiCache.trades.cacheKey === cacheKey) {
      logger.info('Using cached trades (activity)', { cacheAge: `${Date.now() - apiCache.trades.timestamp}ms` });
      logger.logEnd('Get Trades (Activity)', { source: 'cache', count: apiCache.trades.data.length });
      return apiCache.trades.data;
    }

    if (!user) {
      throw new Error('User address is required for getTrades');
    }

    // Delegate to Activity endpoint with type=TRADE
    const activity = await getUserActivity({
      user,
      limit,
      offset,
      market,
      eventId,
      type: ['TRADE'],
      side
    });

    const trades = Array.isArray(activity) ? activity.filter(a => a && a.type === 'TRADE') : [];
    logger.info(`Fetched ${trades.length} trades (via activity)`);

    // Cache the result
    apiCache.trades.data = trades;
    apiCache.trades.timestamp = Date.now();
    apiCache.trades.cacheKey = cacheKey;

    logger.logEnd('Get Trades (Activity)', { count: trades.length });
    return trades;
  } catch (error) {
    logger.error('Failed to fetch trades (activity)', { error: error.message });
    return [];
  }
}

/**
 * 3. GET CURRENT POSITIONS FOR A USER
 * Endpoint: GET https://data-api.polymarket.com/positions
 * 
 * Authoritative source for open positions and unrealized PnL.
 * Contains fields: size, avgPrice, initialValue, currentValue, cashPnl, realizedPnl, etc.
 * 
 * @param {Object} options - Query parameters
 * @param {string} options.user - User wallet address (required)
 * @returns {Promise<Array>} Array of current position objects
 */
async function getCurrentPositions(options = {}) {
  const { user = USER_ADDRESS } = options;

  logger.logStart('Get Current Positions', { user: user?.slice(0, 10) });

  try {
    // Check cache
    if (isCacheValid(apiCache.positions)) {
      logger.info('Using cached positions', { cacheAge: `${Date.now() - apiCache.positions.timestamp}ms` });
      logger.logEnd('Get Current Positions', { source: 'cache', count: apiCache.positions.data.length });
      return apiCache.positions.data;
    }

    if (!user) {
      throw new Error('User address is required for getCurrentPositions');
    }

    const url = `${DATA_API_BASE}/positions?user=${user}`;
    logger.debug(`Fetching from: ${url}`);

    const response = await axios.get(url, {
      timeout: 15000,
      headers: { 'Accept': 'application/json' }
    });

    const positions = response.data || [];
    logger.info(`Fetched ${positions.length} open positions`);

    // Cache the result
    apiCache.positions.data = positions;
    apiCache.positions.timestamp = Date.now();

    logger.logEnd('Get Current Positions', { count: positions.length });
    return positions;
  } catch (error) {
    logger.error('Failed to fetch current positions', { error: error.message });
    return [];
  }
}

/**
 * 4. GET CLOSED POSITIONS FOR A USER
 * Endpoint: GET https://data-api.polymarket.com/closed-positions
 * 
 * Represents positions that are fully closed or settled.
 * Each object contains final realized PnL.
 * 
 * @param {Object} options - Query parameters
 * @param {string} options.user - User wallet address (required)
 * @returns {Promise<Array>} Array of closed position objects
 */
async function getClosedPositions(options = {}) {
  const { user = USER_ADDRESS } = options;

  logger.logStart('Get Closed Positions', { user: user?.slice(0, 10) });

  try {
    // Check cache
    if (isCacheValid(apiCache.closedPositions)) {
      logger.info('Using cached closed positions', { cacheAge: `${Date.now() - apiCache.closedPositions.timestamp}ms` });
      logger.logEnd('Get Closed Positions', { source: 'cache', count: apiCache.closedPositions.data.length });
      return apiCache.closedPositions.data;
    }

    if (!user) {
      throw new Error('User address is required for getClosedPositions');
    }

    const url = `${DATA_API_BASE}/closed-positions?user=${user}`;
    logger.debug(`Fetching from: ${url}`);

    const response = await axios.get(url, {
      timeout: 15000,
      headers: { 'Accept': 'application/json' }
    });

    const closedPositions = response.data || [];
    logger.info(`Fetched ${closedPositions.length} closed positions`);

    // Cache the result
    apiCache.closedPositions.data = closedPositions;
    apiCache.closedPositions.timestamp = Date.now();

    logger.logEnd('Get Closed Positions', { count: closedPositions.length });
    return closedPositions;
  } catch (error) {
    logger.error('Failed to fetch closed positions', { error: error.message });
    return [];
  }
}

/**
 * 5. GET TOTAL VALUE OF A USER'S POSITIONS
 * Endpoint: GET https://data-api.polymarket.com/value
 * 
 * Returns aggregate current USDC value of all open positions.
 * 
 * @param {Object} options - Query parameters
 * @param {string} options.user - User wallet address (required)
 * @returns {Promise<Object>} Object containing user and value
 */
async function getPortfolioValue(options = {}) {
  const { user = USER_ADDRESS } = options;

  logger.logStart('Get Portfolio Value', { user: user?.slice(0, 10) });

  try {
    // Check cache
    if (isCacheValid(apiCache.value)) {
      logger.info('Using cached portfolio value', { cacheAge: `${Date.now() - apiCache.value.timestamp}ms` });
      logger.logEnd('Get Portfolio Value', { source: 'cache' });
      return apiCache.value.data;
    }

    if (!user) {
      throw new Error('User address is required for getPortfolioValue');
    }

    const url = `${DATA_API_BASE}/value?user=${user}`;
    logger.debug(`Fetching from: ${url}`);

    const response = await axios.get(url, {
      timeout: 15000,
      headers: { 'Accept': 'application/json' }
    });

    // Response is an array with single object: [{ user, value }]
    const result = response.data && response.data.length > 0 ? response.data[0] : { user, value: 0 };
    logger.info(`Portfolio value: $${result.value}`);

    // Cache the result
    apiCache.value.data = result;
    apiCache.value.timestamp = Date.now();

    logger.logEnd('Get Portfolio Value', { value: result.value });
    return result;
  } catch (error) {
    logger.error('Failed to fetch portfolio value', { error: error.message });
    return { user, value: 0 };
  }
}

/**
 * 6. CALCULATE TOTAL ACCOUNT PnL
 * 
 * Formula per documentation:
 * Total PnL = sum(cashPnl for all open positions)
 *           + sum(realizedPnl for all open positions)
 *           + sum(realizedPnl for all closed positions)
 * 
 * @param {Object} options - User address
 * @returns {Promise<Object>} PnL breakdown
 */
async function calculateTotalPnL(options = {}) {
  const { user = USER_ADDRESS } = options;

  logger.logStart('Calculate Total PnL', { user: user?.slice(0, 10) });

  try {
    // Fetch all necessary data in parallel
    const [openPositions, closedPositions] = await Promise.all([
      getCurrentPositions({ user }),
      getClosedPositions({ user })
    ]);

    // Calculate unrealized PnL from open positions
    const unrealizedPnL = openPositions.reduce((sum, pos) => {
      return sum + (parseFloat(pos.cashPnl) || 0);
    }, 0);

    // Calculate realized PnL from open positions (partial closes)
    const realizedPnLFromOpen = openPositions.reduce((sum, pos) => {
      return sum + (parseFloat(pos.realizedPnl) || 0);
    }, 0);

    // Calculate realized PnL from closed positions
    const realizedPnLFromClosed = closedPositions.reduce((sum, pos) => {
      return sum + (parseFloat(pos.realizedPnl) || 0);
    }, 0);

    // Total PnL per documentation formula
    const totalPnL = unrealizedPnL + realizedPnLFromOpen + realizedPnLFromClosed;
    const totalRealizedPnL = realizedPnLFromOpen + realizedPnLFromClosed;

    const result = {
      totalPnL: parseFloat(totalPnL.toFixed(2)),
      unrealizedPnL: parseFloat(unrealizedPnL.toFixed(2)),
      totalRealizedPnL: parseFloat(totalRealizedPnL.toFixed(2)),
      realizedPnLFromOpen: parseFloat(realizedPnLFromOpen.toFixed(2)),
      realizedPnLFromClosed: parseFloat(realizedPnLFromClosed.toFixed(2)),
      openPositionsCount: openPositions.length,
      closedPositionsCount: closedPositions.length,
      timestamp: new Date().toISOString()
    };

    logger.logEnd('Calculate Total PnL', { 
      totalPnL: result.totalPnL,
      unrealizedPnL: result.unrealizedPnL,
      totalRealizedPnL: result.totalRealizedPnL
    });

    return result;
  } catch (error) {
    logger.error('Failed to calculate total PnL', { error: error.message });
    return {
      totalPnL: 0,
      unrealizedPnL: 0,
      totalRealizedPnL: 0,
      realizedPnLFromOpen: 0,
      realizedPnLFromClosed: 0,
      openPositionsCount: 0,
      closedPositionsCount: 0,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * 7. GET COMPREHENSIVE ACCOUNT SUMMARY
 * 
 * Fetches all data in parallel and provides a complete account overview.
 * 
 * @param {Object} options - User address
 * @returns {Promise<Object>} Complete account summary
 */
async function getAccountSummary(options = {}) {
  const { user = USER_ADDRESS } = options;

  logger.logStart('Get Account Summary', { user: user?.slice(0, 10) });

  try {
    // Fetch all data in parallel
    const [
      activity,
      trades,
      openPositions,
      closedPositions,
      portfolioValue,
      pnl
    ] = await Promise.all([
      getUserActivity({ user, limit: 100 }),
      getTrades({ user, limit: 100 }),
      getCurrentPositions({ user }),
      getClosedPositions({ user }),
      getPortfolioValue({ user }),
      calculateTotalPnL({ user })
    ]);

    const summary = {
      user,
      portfolio: {
        value: portfolioValue.value || 0,
        openPositionsCount: openPositions.length,
        closedPositionsCount: closedPositions.length
      },
      pnl: {
        total: pnl.totalPnL,
        unrealized: pnl.unrealizedPnL,
        realized: pnl.totalRealizedPnL,
        realizedFromOpen: pnl.realizedPnLFromOpen,
        realizedFromClosed: pnl.realizedPnLFromClosed
      },
      activity: {
        recentCount: activity.length,
        trades: activity.filter(a => a.type === 'TRADE').length
      },
      trades: {
        totalCount: trades.length,
        buyTrades: trades.filter(t => t.side === 'BUY').length,
        sellTrades: trades.filter(t => t.side === 'SELL').length
      },
      openPositions,
      closedPositions,
      recentActivity: activity.slice(0, 20),
      recentTrades: trades.slice(0, 20),
      timestamp: new Date().toISOString()
    };

    logger.logEnd('Get Account Summary', {
      portfolioValue: summary.portfolio.value,
      totalPnL: summary.pnl.total,
      openPositions: summary.portfolio.openPositionsCount,
      closedPositions: summary.portfolio.closedPositionsCount
    });

    return summary;
  } catch (error) {
    logger.error('Failed to get account summary', { error: error.message });
    throw error;
  }
}

/**
 * Clear all caches to force fresh API calls
 */
function clearCache() {
  logger.info('Clearing all API caches');
  Object.keys(apiCache).forEach(key => {
    apiCache[key].data = null;
    apiCache[key].timestamp = 0;
  });
}

/**
 * Get cache status for debugging
 */
function getCacheStatus() {
  return Object.keys(apiCache).reduce((status, key) => {
    const cache = apiCache[key];
    status[key] = {
      valid: isCacheValid(cache),
      age: cache.timestamp ? Date.now() - cache.timestamp : null,
      items: Array.isArray(cache.data) ? cache.data.length : (cache.data ? 1 : 0)
    };
    return status;
  }, {});
}

// Export all functions
module.exports = {
  // Official API endpoints
  getUserActivity,
  getTrades,
  getCurrentPositions,
  getClosedPositions,
  getPortfolioValue,
  
  // Calculated endpoints
  calculateTotalPnL,
  getAccountSummary,
  
  // Utility functions
  clearCache,
  getCacheStatus
};
