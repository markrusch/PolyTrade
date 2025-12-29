/**
 * CLOB OPERATIONS UTILITY
 * 
 * Centralized CLOB client initialization and operations
 * Features:
 * - Consistent CLOB client creation with proper auth
 * - Market name fetching and caching
 * - Order operations (get, create, cancel)
 * - Position tracking and balance queries
 * - Error handling with logging
 */

const { ClobClient } = require('@polymarket/clob-client');
const ethers = require('ethers');
const axios = require('axios');
const marketInfo = require('./market-info');
const { createLogger } = require('./logger');
const coreApi = require('./core-api-client');

const logger = createLogger('CLOB');

const CLOB_URL = 'https://clob.polymarket.com';
const RPC_URL = process.env.RPC_LINK_INFURA;
const PRIVATE_KEY = process.env.POLYMARKETS_PRIVATE_KEY;

// Network call timeouts (ms)
const TIMEOUTS = {
  deriveApiKey: 8000,
  getSimplifiedMarkets: 8000,
  getTrades: 8000,
  getOpenOrders: 6000,
  getMarket: 6000,
};

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function withTimeout(promise, ms, label = 'operation') {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const err = new Error(`${label} timed out after ${ms}ms`);
      err.code = 'ETIMEDOUT';
      reject(err);
    }, ms);
  });
  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId);
    return result;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

async function retry(fn, { retries = 3, delayMs = 300, factor = 1.5, onError } = {}) {
  let attempt = 0;
  let lastErr;
  while (attempt < retries) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      attempt += 1;
      if (onError) onError(err, attempt);
      if (attempt >= retries) break;
      const backoff = Math.floor(delayMs * Math.pow(factor, attempt - 1));
      await sleep(backoff);
    }
  }
  throw lastErr;
}

// Cache for market names (prevent repeated API calls)
const marketNameCache = {};
const marketQuestionCache = {}; // condition_id -> question mapping from gamma API
let simplifiedMarketsCache = null; // Global cache for simplified markets (avoid repeated API calls)
const CACHE_TTL = 3600000; // 1 hour in milliseconds
let questionsLoaded = false;

// **NEW: Trade Cache System**
// Stores all historical trades to avoid repeated API calls
// Uses incremental syncing to fetch only new trades since last update
const TradeCache = {
  trades: [],              // All cached trades
  lastSyncTime: 0,         // Timestamp of last successful sync
  syncInProgress: false,   // Prevents multiple simultaneous syncs
  lastTradeId: null,       // Track last known trade ID for incremental sync
  syncInterval: 60000,     // Sync every 60 seconds
  lastSyncAttempt: 0,
  
  /**
   * Initialize cache from storage (if available)
   */
  async init() {
    try {
      // Try to load from file if it exists
      const fs = require('fs').promises;
      const path = require('path');
      const cacheFile = path.join(__dirname, '..', '.trade-cache.json');
      
      try {
        const cached = await fs.readFile(cacheFile, 'utf8');
        const data = JSON.parse(cached);
        // Filter to only confirmed trades with actual user participation
        this.trades = (data.trades || []).filter(t => {
          if (!t.status || t.status.toUpperCase() !== 'CONFIRMED') return false;
          if (!t.maker_orders || t.maker_orders.length === 0) return false;
          return t.maker_orders.some(mo => mo.matched_amount && parseFloat(mo.matched_amount) > 0);
        });
        this.lastTradeId = data.lastTradeId || null;
        this.lastSyncTime = data.lastSyncTime || 0;
        logger.info(`✅ Loaded trade cache from disk: ${this.trades.length} trades (filtered for CONFIRMED status with user participation)`, { tradeCount: this.trades.length });
      } catch (err) {
        // Cache file doesn't exist yet or can't be read (first run)
        logger.debug('No persistent trade cache found (first run)', { error: err.message });
      }
    } catch (err) {
      logger.warn('Failed to initialize trade cache', { error: err.message });
    }
  },
  
  /**
   * Save cache to disk for persistence
   */
  async save() {
    try {
      const fs = require('fs').promises;
      const path = require('path');
      const cacheFile = path.join(__dirname, '..', '.trade-cache.json');
      
      const data = {
        trades: this.trades,
        lastTradeId: this.lastTradeId,
        lastSyncTime: this.lastSyncTime
      };
      
      await fs.writeFile(cacheFile, JSON.stringify(data, null, 2), 'utf8');
      logger.debug(`💾 Trade cache saved to disk: ${this.trades.length} trades`);
    } catch (err) {
      logger.warn('Failed to save trade cache', { error: err.message });
    }
  },
  
  /**
   * Sync new trades from CLOB API
   * Only fetches trades since last sync for efficiency
   */
  async sync(clob) {
    // Prevent multiple simultaneous syncs
    if (this.syncInProgress) {
      logger.debug('Trade sync already in progress, skipping');
      return false;
    }
    
    // Throttle sync attempts (don't sync more often than interval)
    const now = Date.now();
    if (now - this.lastSyncAttempt < this.syncInterval) {
      logger.debug(`Trade sync throttled (last attempt ${now - this.lastSyncAttempt}ms ago)`);
      return false;
    }
    
    this.syncInProgress = true;
    this.lastSyncAttempt = now;
    
    try {
      logger.logStart('Trade Cache Sync', { cachedTrades: this.trades.length });
      
      // Fetch new trades using pagination
      // Start from the beginning, but we'll only add trades not already in cache
      let allNewTrades = [];
      let pageNum = 1;
      let hasMore = true;
      let totalFetched = 0;
      
      while (hasMore && pageNum <= 10) { // Limit to 10 pages to avoid infinite loops
        try {
          // Get a page of trades
          const response = await retry(
            () => withTimeout(clob.getTrades({}, pageNum === 1), TIMEOUTS.getTrades, 'getTrades'),
            {
              retries: 3,
              delayMs: 400,
              factor: 1.7,
              onError: (err, attempt) => logger.debug('getTrades retry', { attempt, error: err.message })
            }
          ); // First call uses only_first_page=true for speed
          
          const trades = Array.isArray(response) ? response : (response?.data || []);
          totalFetched += trades.length;
          
          if (trades.length === 0) {
            hasMore = false;
            break;
          }
          
          // Add trades that aren't already in cache
          // Match by trade ID to avoid duplicates
          // IMPORTANT: Only include CONFIRMED trades where the user actually participated
          const newTrades = trades.filter(trade => {
            // Only include confirmed/filled trades
            if (!trade.status || trade.status.toUpperCase() !== 'CONFIRMED') {
              logger.debug(`Filtered out non-confirmed trade: ${trade.id} (status: ${trade.status})`);
              return false;
            }
            
            // Verify the user had orders matched in this trade
            // Check if any maker_orders exist (user participated)
            if (!trade.maker_orders || trade.maker_orders.length === 0) {
              logger.debug(`Filtered out trade with no maker participation: ${trade.id}`);
              return false;
            }
            
            // Verify at least one maker order has a matched amount
            const hasMatches = trade.maker_orders.some(mo => mo.matched_amount && parseFloat(mo.matched_amount) > 0);
            if (!hasMatches) {
              logger.debug(`Filtered out trade with no matched amounts: ${trade.id}`);
              return false;
            }
            
            return !this.trades.some(cached => cached.id === trade.id);
          });
          
          allNewTrades = allNewTrades.concat(newTrades);
          
          // If we got less than a full page, we're at the end
          if (trades.length < 100) {
            hasMore = false;
          } else {
            pageNum++;
          }
        } catch (err) {
          if (err.message && err.message.includes('pagination')) {
            hasMore = false;
          } else {
            throw err;
          }
        }
      }
      
      // Merge new trades into cache (newest first for quick access)
      if (allNewTrades.length > 0) {
        this.trades = [...allNewTrades, ...this.trades];
        logger.info(`✅ Added ${allNewTrades.length} new trades to cache (total: ${this.trades.length})`, { 
          newTrades: allNewTrades.length,
          totalCached: this.trades.length
        });
      } else {
        logger.debug('No new trades found in sync');
      }
      
      this.lastSyncTime = now;
      
      // Save to disk for persistence
      await this.save();
      
      logger.logEnd('Trade Cache Sync', { newTrades: allNewTrades.length, totalCached: this.trades.length });
      return true;
    } catch (error) {
      logger.error('Failed to sync trade cache', {}, error);
      return false;
    } finally {
      this.syncInProgress = false;
    }
  },
  
  /**
   * Get all cached trades
   */
  getAll() {
    return this.trades;
  },
  
  /**
   * Get trades since a specific timestamp
   */
  getByTimestamp(sinceTime) {
    return this.trades.filter(trade => {
      const tradeTime = new Date(trade.match_time || trade.timestamp || 0).getTime();
      return tradeTime >= sinceTime;
    });
  }
};

/**
 * Initialize CLOB client with proper authentication
 * Uses EOA to derive API credentials for Safe transactions
 */
async function initClobClient(safeAddress) {
  logger.logStart('CLOB Client Initialization', { safeAddress });

  try {
    // Pre-load market questions via market-info util
    if (!questionsLoaded) {
      await marketInfo.preloadMarketQuestions();
      questionsLoaded = true;
    }

    // Get signer from private key
    const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
    const signer = new ethers.Wallet(PRIVATE_KEY, provider);

    // Step 1: Create temporary client to derive API credentials
    const tempClient = new ClobClient(CLOB_URL, 137, signer);
    logger.debug('Deriving API credentials...');
    const apiCreds = await retry(
      () => withTimeout(tempClient.deriveApiKey(), TIMEOUTS.deriveApiKey, 'deriveApiKey'),
      {
        retries: 3,
        delayMs: 400,
        factor: 1.7,
        onError: (err, attempt) => logger.debug('deriveApiKey retry', { attempt, error: err.message })
      }
    );

    // Step 2: Create authenticated client with Safe configuration
    // Use signatureType=1 (EOA) with funderAddress pointing to Safe
    // This allows EOA to sign orders while Safe holds the funds
    const clob = new ClobClient(
      CLOB_URL,
      137,
      signer,
      apiCreds,
      1, // signatureType=1 (EOA signs, Safe funds)
      safeAddress // funderAddress - where funds come from
    );

    // Pre-load and cache simplified markets for efficient enrichment
    // This is called once and reused for all subsequent market lookups
    if (!simplifiedMarketsCache) {
      try {
        logger.debug('Pre-loading simplified markets cache...');
        const markets = await retry(
          () => withTimeout(clob.getSimplifiedMarkets(), TIMEOUTS.getSimplifiedMarkets, 'getSimplifiedMarkets'),
          {
            retries: 2,
            delayMs: 300,
            factor: 1.5,
            onError: (err, attempt) => logger.debug('getSimplifiedMarkets retry', { attempt, error: err.message })
          }
        );
        simplifiedMarketsCache = Array.isArray(markets) ? markets : (markets?.data || []);
        logger.debug(`Cached ${simplifiedMarketsCache.length} simplified markets`);
      } catch (err) {
        logger.warn('Failed to pre-load simplified markets', { error: err.message });
        simplifiedMarketsCache = [];
      }
    }

    // Initialize trade cache (load from disk)
    await TradeCache.init();
    
    // Sync trades IN BACKGROUND (don't block initialization)
    // This prevents server startup from hanging if API is slow
    TradeCache.sync(clob).catch(err => {
      logger.warn('Background trade sync failed (non-critical)', { error: err.message });
    });

    logger.logEnd('CLOB Client Initialization');
    return clob;
  } catch (error) {
    logger.error('Failed to initialize CLOB client', { safeAddress }, error);
    throw error;
  }
}

/**
 * Fetch market names from CLOB API using getSimplifiedMarkets
 */
async function fetchMarketNames(clob, tokenIds = []) {
  logger.logStart('Fetch Market Names', { tokenCount: tokenIds.length });

  try {
    // Get all simplified markets from CLOB
    const markets = await retry(
      () => withTimeout(clob.getSimplifiedMarkets(), TIMEOUTS.getSimplifiedMarkets, 'getSimplifiedMarkets'),
      {
        retries: 2,
        delayMs: 300,
        factor: 1.5,
        onError: (err, attempt) => logger.debug('getSimplifiedMarkets retry', { attempt, error: err.message })
      }
    );
    const marketList = Array.isArray(markets) ? markets : (markets?.data || []);

    logger.info(`Retrieved ${marketList.length} markets from CLOB`, { count: marketList.length });

    // Build mapping of token_id -> market name
    // Markets have structure: { condition_id, tokens: [{token_id, outcome}, ...] }
    const nameMap = {};
    
    for (const market of marketList) {
      // Market may have tokens array with token_id inside each token
      if (market.tokens && Array.isArray(market.tokens)) {
        for (const tokenObj of market.tokens) {
          if (tokenObj.token_id) {
            // Use outcome if available as the market name descriptor
            const marketName = tokenObj.outcome || `Market ${tokenObj.token_id.slice(0, 8)}...`;
            nameMap[tokenObj.token_id] = {
              title: marketName,
              description: tokenObj.outcome || '',
              conditionId: market.condition_id,
              fetchedAt: Date.now()
            };
            
            // Log first few for debugging
            if (Object.keys(nameMap).length <= 3) {
              logger.debug(`Market mapping: ${tokenObj.token_id.slice(0, 16)}... => "${marketName}"`);
            }
          }
        }
      }
    }

    logger.info(`Mapped ${Object.keys(nameMap).length} token IDs to market names`, { mapped: Object.keys(nameMap).length });

    // Cache results
    Object.assign(marketNameCache, nameMap);

    logger.logEnd('Fetch Market Names', { marketsFetched: Object.keys(nameMap).length });
    return nameMap;
  } catch (error) {
    logger.error('Failed to fetch market names from CLOB', { tokenIds }, error);
    // Return empty map on error - positions will show token_id instead
    return {};
  }
}

/**
 * Get market name from cache or fetch from CLOB
 */
async function getFullMarketInfo(clob, tokenId, marketId = null) {
  // Serve cached when fresh
  if (marketNameCache[tokenId]) {
    const cached = marketNameCache[tokenId];
    const isStale = Date.now() - cached.fetchedAt >= CACHE_TTL;
    const isUnknown = !cached.event || cached.event === 'Unknown Event';
    if (!isStale && !isUnknown) {
      return cached;
    }
  }

  try {
    // **Strategy: Try to match by marketId FIRST (from trade.market field)**
    // Then fall back to tokenId lookup using cached simplified markets
    let matchedToken = null;
    let foundConditionId = null;

    // Step 1a: If we have a marketId from the trade, check if it's a conditionId directly (0x format)
    if (marketId && marketId.startsWith('0x')) {
      foundConditionId = marketId;
      logger.debug(`Using marketId directly as conditionId: ${foundConditionId.substring(0, 16)}...`);
    }

    // Step 1b: If no direct match, try to find by tokenId in cached simplified markets
    if (!foundConditionId && simplifiedMarketsCache) {
      // Use cached markets (populated once at initialization)
      for (const market of simplifiedMarketsCache) {
        if (!market.tokens) continue;
        for (const tokenObj of market.tokens) {
          if (tokenObj.token_id === tokenId) {
            matchedToken = {
              outcome: tokenObj.outcome,
              conditionId: market.condition_id,
              marketId: market.market_id || market.id || marketId,
              question: market.question || market.title || market.label || null,
            };
            foundConditionId = market.condition_id;
            break;
          }
        }
        if (matchedToken) break;
      }
    }

    // Step 2: fetch full market details using condition_id for richer metadata
    let fullMarket = null;
    if (foundConditionId) {
      try {
        fullMarket = await retry(
          () => withTimeout(clob.getMarket(foundConditionId), TIMEOUTS.getMarket, 'getMarket'),
          {
            retries: 2,
            delayMs: 300,
            factor: 1.5,
            onError: (err, attempt) => logger.debug('getMarket retry', { attempt, error: err.message })
          }
        );
      } catch (innerErr) {
        logger.debug('getMarket failed, trying HTTP fallback', { error: innerErr.message });
      }
    }

    // HTTP fallback to gamma API using the foundConditionId
    if (!fullMarket && foundConditionId) {
      fullMarket = await marketInfo.fetchMarketByConditionId(foundConditionId);
      if (fullMarket?.question) {
        logger.debug(`Found market via gamma API: ${fullMarket.question.substring(0, 50)}...`);
      }
    }

    // Build info from full market where possible
    const info = {
      title: matchedToken?.outcome || `Market ${tokenId.slice(0, 8)}...`,
      event: fullMarket?.question || fullMarket?.title || marketInfo.getMarketQuestion(foundConditionId) || matchedToken?.question || 'Unknown Event',
      outcome: matchedToken?.outcome || '',
      conditionId: foundConditionId || matchedToken?.conditionId || fullMarket?.condition_id || '',
      marketId: matchedToken?.marketId || fullMarket?.market_slug || marketId || '',
      description: fullMarket?.description || '',
      questionId: fullMarket?.question_id || '',
      marketSlug: fullMarket?.market_slug || '',
      endDate: fullMarket?.end_date_iso || '',
      fetchedAt: Date.now()
    };

    marketNameCache[tokenId] = info;
    logger.debug(`Full market info: tokenId=${tokenId.slice(0, 16)}..., foundConditionId=${foundConditionId?.substring(0, 16)}..., event="${info.event.substring(0, 50)}..."`);
    return info;
  } catch (err) {
    logger.debug('Could not fetch market info', { error: err.message });
    const fallback = {
      title: `Market ${tokenId.slice(0, 8)}...`,
      event: 'Unknown Event',
      outcome: '',
      conditionId: '',
      marketId: marketId || '',
      description: '',
      fetchedAt: Date.now()
    };
    marketNameCache[tokenId] = fallback;
    return fallback;
  }
}

/**
 * Resolve the correct market token ID for a trade by looking up market details
 * The asset_id from trades is internal; we need the actual token ID to create orders
 */
async function resolveMarketTokenId(clob, tradeAssetId, outcome, marketId) {
  logger.logStart('Resolve Market Token ID', { 
    assetId: tradeAssetId.slice(0, 16), 
    outcome,
    marketId
  });

  try {
    // Fetch all simplified markets
    const markets = await retry(
      () => withTimeout(clob.getSimplifiedMarkets(), TIMEOUTS.getSimplifiedMarkets, 'getSimplifiedMarkets'),
      {
        retries: 2,
        delayMs: 300,
        factor: 1.5,
        onError: (err, attempt) => logger.debug('getSimplifiedMarkets retry', { attempt, error: err.message })
      }
    );
    const marketList = Array.isArray(markets) ? markets : (markets?.data || []);

    // First try to match by market_id if provided
    if (marketId) {
      for (const market of marketList) {
        if (market.market_id === marketId && market.tokens && Array.isArray(market.tokens)) {
          for (const tokenObj of market.tokens) {
            if (tokenObj.outcome === outcome) {
              logger.info(`Found market token ID for ${outcome} in market ${marketId}`, { 
                tokenId: tokenObj.token_id,
                marketId: market.market_id
              });
              logger.logEnd('Resolve Market Token ID');
              return tokenObj.token_id;
            }
          }
        }
      }
    }

    // Fallback: look for a market that has tokens matching the outcome
    for (const market of marketList) {
      if (market.tokens && Array.isArray(market.tokens)) {
        for (const tokenObj of market.tokens) {
          // Check if this token matches our outcome (YES or NO)
          if (tokenObj.outcome === outcome) {
            logger.info(`Found market token ID for ${outcome}`, { tokenId: tokenObj.token_id });
            logger.logEnd('Resolve Market Token ID');
            return tokenObj.token_id;
          }
        }
      }
    }

    logger.warn(`Could not find matching token ID for outcome`, { outcome, assetId: tradeAssetId.slice(0, 16) });
  } catch (err) {
    logger.error(`Failed to resolve market token ID`, { error: err.message });
  }

  // If we can't find it, return the original asset_id (may still fail)
  logger.logEnd('Resolve Market Token ID', { fallback: true });
  return tradeAssetId;
}

/**
 * Get all open orders with market names enriched
 */
async function getOpenOrders(clob) {
  logger.logStart('Get Open Orders', {});

  try {
    // Fetch open orders using only_first_page=true (per CLOB docs: no pagination for current batch)
    const orders = await retry(
      () => withTimeout(clob.getOpenOrders({}, true), TIMEOUTS.getOpenOrders, 'getOpenOrders'),
      {
        retries: 2,
        delayMs: 300,
        factor: 1.5,
        onError: (err, attempt) => logger.debug('getOpenOrders retry', { attempt, error: err.message })
      }
    );
    const ordersList = Array.isArray(orders) ? orders : (orders?.data || []);

    // Log order structure once for debugging
    if (ordersList.length > 0) {
      const keys = Object.keys(ordersList[0]);
      logger.info(`Order has keys: ${keys.join(', ')}`);
    }

    logger.logEnd('Get Open Orders', { count: ordersList.length });

    // Orders already have outcome field from CLOB API; no need for additional enrichment here
    // Dashboard will enrich with full market info separately
    return ordersList;
  } catch (error) {
    logger.error('Failed to get open orders', {}, error);
    return [];
  }
}

/**
 * Get open positions from CACHED FILLED TRADES
 * Positions = actual holdings from executed trades
 * Uses TradeCache to avoid repeated API calls
 */
async function getOpenPositions(clob) {
  logger.logStart('Get Open Positions (From Cache)', {});

  try {
    // **NEW: Sync trade cache with CLOB API (incremental update)**
    // This fetches only new trades since last sync
    const syncSucceeded = await TradeCache.sync(clob);
    
    // Get all cached trades (includes all historical trades)
    const tradesList = TradeCache.getAll();
    
    const cacheStats = {
      totalCachedTrades: tradesList.length,
      lastSyncTime: new Date(TradeCache.lastSyncTime).toISOString(),
      syncSucceeded
    };
    logger.info(`📦 Using cached trades: ${tradesList.length} total trades available`, cacheStats);

    if (tradesList.length === 0) {
      logger.logEnd('Get Open Positions (From Cache)', { count: 0, reason: 'No cached trades found' });
      return [];
    }

    // Log trade structure for debugging (from first cached trade)
    if (tradesList.length > 0) {
      const keys = Object.keys(tradesList[0]);
      logger.debug(`First cached trade keys: ${keys.join(', ')}`);
    }

    // Group trades by token and compute remaining inventory with FIFO
    const positions = [];
    const tradesByToken = tradesList.reduce((acc, trade) => {
      const tokenId = trade.asset_id || trade.token_id;
      if (!tokenId) return acc;
      (acc[tokenId] ||= []).push(trade);
      return acc;
    }, {});

    for (const [tokenId, tokenTrades] of Object.entries(tradesByToken)) {
      // Sort trades by time
      const sorted = tokenTrades.slice().sort((a, b) => {
        const ta = new Date(a.match_time || a.timestamp || a.created_at || 0).getTime();
        const tb = new Date(b.match_time || b.timestamp || b.created_at || 0).getTime();
        return ta - tb;
      });

      const inventory = [];
      let buys = 0;
      let sells = 0;
      let outcome = '';
      let market = '';

      for (const t of sorted) {
        const side = (t.side || 'BUY').toUpperCase();
        
        // Calculate the actual amount the user matched in this trade
        // Sum up all matched amounts from maker_orders
        let userMatchedAmount = 0;
        if (t.maker_orders && Array.isArray(t.maker_orders)) {
          userMatchedAmount = t.maker_orders.reduce((sum, mo) => {
            return sum + parseFloat(mo.matched_amount || 0);
          }, 0);
        }
        
        // Use the matched amount, not the full trade size
        const size = userMatchedAmount > 0 ? userMatchedAmount : parseFloat(t.size || 0);
        const price = parseFloat(t.price || 0);
        outcome = outcome || t.outcome || '';
        market = market || t.market || '';

        if (side === 'BUY') {
          inventory.push({ size, price });
          buys += size;
        } else if (side === 'SELL') {
          let remaining = size;
          sells += size;
          while (remaining > 0 && inventory.length > 0) {
            const lot = inventory[0];
            const matched = Math.min(remaining, lot.size);
            lot.size -= matched;
            remaining -= matched;
            if (lot.size <= 1e-8) inventory.shift();
          }
        }
      }

      const remainingSize = inventory.reduce((sum, lot) => sum + lot.size, 0);
      if (remainingSize > 0.01) {
        positions.push({
          tokenId,
          outcome: outcome || 'Unknown',
          market: market || 'Unknown',
          marketName: outcome || 'Unknown',
          amount: remainingSize.toFixed(2),
          side: 'BUY',
          netSize: remainingSize.toFixed(2),
          assetType: 'CONDITIONAL',
          status: 'FILLED',
          source: 'TRADES',
          buys: buys.toFixed(2),
          sells: sells.toFixed(2),
          timestamp: new Date().toISOString()
        });
        logger.info(`Position from trades: ${outcome || 'Unknown'} = ${remainingSize.toFixed(2)} (${sorted.length} trades)`);
      }
    }

    logger.logEnd('Get Open Positions (Filled Trades)', { count: positions.length, tokenCount: Object.keys(tradesByToken).length });
    return positions;
  } catch (error) {
    logger.error('Failed to get positions from trades', {}, error);
    return [];
  }
}

/**
 * Cancel single order  
 * Uses CLOB client's cancelOrder method but ensures correct API call format
 */
async function cancelOrder(clob, orderID) {
  logger.logAction('CANCEL_ORDER', orderID, 'PENDING', { orderID });

  try {
    logger.debug(`Sending cancelOrder request with orderID: ${orderID}`);
    
    // The CLOB client expects a string ordersHashes array, not an object.
    // Use cancelOrders() which takes an array of order IDs
    const result = await clob.cancelOrders([orderID]);
    
    const wasCanceled = result.canceled && result.canceled.includes(orderID);
    const notCanceledReason = result.not_canceled?.[orderID] || null;
    
    logger.debug(`Cancel response:`, { canceled: result.canceled, not_canceled: result.not_canceled });
    
    if (wasCanceled) {
      logger.logAction('CANCEL_ORDER', orderID, 'SUCCESS', { orderID, canceled: true });
      return { success: true, orderID, canceled: true, result };
    } else {
      const error = `Order not canceled: ${notCanceledReason}`;
      logger.logAction('CANCEL_ORDER', orderID, 'FAILED', { orderID, reason: error });
      return { success: false, orderID, canceled: false, reason: error, result };
    }
  } catch (error) {
    logger.error('Failed to cancel order', { orderID, errorMsg: error.message }, error);
    logger.logAction('CANCEL_ORDER', orderID, 'FAILED', { orderID, error: error.message });
    throw error;
  }
}

/**
 * Cancel all open orders (killswitch)
 * CLOB API: cancelAll() - takes NO parameters, cancels all user's open orders
 */
async function cancelAllOrders(clob) {
  logger.logAction('KILLSWITCH', 'ALL_ORDERS', 'PENDING', {});

  try {
    logger.info(`KILLSWITCH: Initiating cancelAll() - will cancel all open orders`);
    
    // CLOB method signature: cancelAll() => Promise<CancelOrdersResponse>
    // Response: { canceled: string[], not_canceled: Record<string, any> }
    const result = await clob.cancelAll();
    
    const canceledCount = (result.canceled || []).length;
    const notCanceledCount = Object.keys(result.not_canceled || {}).length;
    
    logger.info(`KILLSWITCH complete:`, { 
      canceled: canceledCount, 
      not_canceled: notCanceledCount,
      canceledIds: result.canceled || [],
      notCanceledReasons: result.not_canceled || {}
    });
    
    logger.logAction('KILLSWITCH', 'ALL_ORDERS', 'SUCCESS', { 
      canceledCount, 
      notCanceledCount,
      total: canceledCount + notCanceledCount
    });
    
    return { 
      success: true,
      successCount: canceledCount, 
      failureCount: notCanceledCount,
      result 
    };
  } catch (error) {
    logger.error('KILLSWITCH failed to cancel all orders', {}, error);
    logger.logAction('KILLSWITCH', 'ALL_ORDERS', 'FAILED', { error: error.message });
    throw error;
  }
}

/**
 * PolymarketOrder Class - Type-safe order creation
 * INPUT: type ('BUY'|'SELL'), tokenID (string), size (number > 0), price (number >= 0)
 * OUTPUT: Order object with validation, toClob() method, and summary() method
 * REUSABLE: Can be used for any order type (BUY/SELL) with clear contracts
 */
class PolymarketOrder {
  constructor(type, tokenID, size, price) {
    // Input validation
    if (!type || !['BUY', 'SELL'].includes(type.toUpperCase())) {
      throw new Error(`Invalid order type: ${type}. Must be BUY or SELL.`);
    }
    if (!tokenID || typeof tokenID !== 'string' || tokenID.trim() === '') {
      throw new Error('tokenID must be a non-empty string');
    }
    if (!Number.isFinite(size) || size <= 0) {
      throw new Error(`Invalid size: ${size}. Must be a positive number.`);
    }
    if (!Number.isFinite(price) || price < 0) {
      throw new Error(`Invalid price: ${price}. Must be a non-negative number.`);
    }

    this.type = type.toUpperCase();
    this.tokenID = tokenID.trim();
    this.size = parseFloat(size);
    this.price = parseFloat(price);
    this.side = this.type;
    this.timestamp = new Date().toISOString();
  }

  // Convert to CLOB API format for createOrder()
  toClob() {
    return {
      tokenID: this.tokenID,
      price: this.price,
      side: this.side,
      size: this.size
    };
  }

  // Get summary for logging and tracking
  summary() {
    return {
      type: this.type,
      tokenID: this.tokenID.slice(0, 20) + '...',
      size: this.size,
      price: this.price,
      timestamp: this.timestamp
    };
  }
}

/**
 * Create and submit sell order
 * INPUT: clob (ClobClient), assetId (string), size (number > 0), price (number >= 0), outcome (string), marketId (optional)
 * OUTPUT: { success (bool), orderID (string), order (object), orderDetails (object) }
 * 
 * Creates a GTC limit order to sell existing position.
 * The assetId from trades IS the correct tokenID - no resolution needed!
 * Can be extended for BUY orders by changing the order type.
 */
async function createSellOrder(clob, assetId, size, price, outcome = 'YES', marketId = null) {
  // Input validation with type checking
  if (!assetId || typeof assetId !== 'string' || assetId.trim() === '') {
    throw new Error('assetId must be a non-empty string');
  }
  if (!Number.isFinite(size) || size <= 0) {
    throw new Error(`Invalid size: ${size}. Must be a positive number.`);
  }
  if (!Number.isFinite(price) || price < 0) {
    throw new Error(`Invalid price: ${price}. Must be a non-negative number.`);
  }

  logger.logAction('CREATE_SELL', assetId, 'PENDING', { assetId, size, price, outcome });

  try {
    // Create order object with validation
    const order = new PolymarketOrder('SELL', assetId, size, price);
    logger.info(`Order created and validated`, order.summary());

    // The assetId from trades is the correct token ID!
    // Use it directly - no need to resolve through markets
    const tokenId = assetId;
    
    logger.info(`Using asset ID as token ID for selling`, { 
      assetId: assetId.slice(0, 16), 
      tokenId: tokenId.slice(0, 16)
    });

    // Create order using the validated order object
    logger.info('Calling clob.createOrder', {
      tokenID: tokenId.slice(0, 20),
      size,
      price,
      side: 'SELL'
    });
    
    const signedOrder = await clob.createOrder(order.toClob());

    logger.info('Order signed, posting to CLOB', {
      tokenID: tokenId.slice(0, 20),
      orderId: signedOrder.id || 'pending'
    });

    // Post the order to the CLOB
    const submittedOrder = await clob.postOrder(signedOrder);

    // Check if the response contains an error
    if (submittedOrder.error || submittedOrder.status === 400) {
      const errorMsg = submittedOrder.error || 'Unknown CLOB API error';
      logger.error('CLOB API returned error', {
        assetId: assetId.slice(0, 20),
        error: errorMsg,
        status: submittedOrder.status,
        response: submittedOrder
      });
      throw new Error(`CLOB API Error: ${errorMsg}`);
    }

    const orderID = submittedOrder.orderID || submittedOrder.id;
    
    if (!orderID) {
      const errorMsg = 'No orderID in response';
      logger.error('postOrder did not return orderID', {
        assetId: assetId.slice(0, 20),
        response: submittedOrder
      });
      throw new Error(errorMsg);
    }
    
    logger.logAction('CREATE_SELL', tokenId, 'SUCCESS', {
      assetId: assetId.slice(0, 16),
      tokenId,
      size,
      price,
      orderID
    });

    return {
      success: true,
      orderID: orderID,
      order: submittedOrder,
      orderDetails: order.summary()
    };
  } catch (error) {
    // Log full error details for debugging
    logger.error('Sell order failed', {
      assetId: assetId.slice(0, 20),
      size,
      price,
      errorMessage: error.message,
      errorCode: error.code || error.status,
      errorResponse: error.response?.data || error.response
    }, error);
    
    logger.logAction('CREATE_SELL', assetId, 'FAILED', { 
      assetId, 
      size, 
      price, 
      error: error.message,
      details: error.response?.data || null
    });
    
    throw error;
  }
}

/**
 * Detect closed positions (historical - zero balance after having orders)
 */
async function getClosedPositions(clob) {
  logger.logStart('Detect Closed Positions', { source: 'trade-cache' });

  try {
    // **NEW: Use cached trades instead of fetching from API**
    // This is instant since all trades are already loaded in memory
    const tradesList = TradeCache.getAll();

    if (!tradesList.length) {
      logger.logEnd('Detect Closed Positions', { count: 0, reason: 'no trades in cache' });
      return [];
    }

    logger.debug(`📦 Processing ${tradesList.length} cached trades for closed positions`);

    // Sort trades per token by time to properly match buys and sells (FIFO)
    const tradesByToken = tradesList.reduce((acc, trade) => {
      const tokenId = trade.asset_id || trade.token_id;
      if (!tokenId) return acc;
      if (!acc[tokenId]) acc[tokenId] = [];
      acc[tokenId].push(trade);
      return acc;
    }, {});

    const closed = [];

    for (const tokenId of Object.keys(tradesByToken)) {
      const tokenTrades = tradesByToken[tokenId].slice().sort((a, b) => {
        const ta = new Date(a.timestamp || a.created_at || 0).getTime();
        const tb = new Date(b.timestamp || b.created_at || 0).getTime();
        return ta - tb;
      });

      // FIFO inventory for buys to calculate realized PnL on sells
      const inventory = [];
      let realizedPnl = 0;
      let realizedSize = 0;
      let realizedBuyValue = 0;
      let realizedSellValue = 0;
      let outcome = '';
      let market = '';

      for (const t of tokenTrades) {
        const side = (t.side || 'BUY').toUpperCase();
        const size = parseFloat(t.size || 0);
        const price = parseFloat(t.price || 0);
        outcome = outcome || t.outcome || '';
        market = market || t.market || '';

        if (side === 'BUY') {
          inventory.push({ size, price });
        } else if (side === 'SELL') {
          let remaining = size;

          while (remaining > 0 && inventory.length > 0) {
            const lot = inventory[0];
            const matched = Math.min(remaining, lot.size);
            realizedPnl += matched * (price - lot.price);
            realizedSize += matched;
            realizedSellValue += matched * price;
            realizedBuyValue += matched * lot.price;
            lot.size -= matched;
            remaining -= matched;
            if (lot.size <= 1e-8) inventory.shift();
          }

          // If we sold more than we bought (rare), treat remaining as flat-cost zero
          if (remaining > 0) {
            realizedPnl += remaining * price;
            realizedSize += remaining;
            realizedSellValue += remaining * price;
          }
        }
      }

      // Remaining inventory is the still-open portion
      const remainingSize = inventory.reduce((sum, lot) => sum + lot.size, 0);

      if (realizedSize <= 0) {
        continue; // No sells means nothing is closed/realized yet
      }

      const avgBuy = realizedSize > 0 ? realizedBuyValue / realizedSize : 0;
      const avgSell = realizedSize > 0 ? realizedSellValue / realizedSize : 0;
      const pnlAbs = realizedPnl;
      const pnlPct = realizedBuyValue > 0 ? (pnlAbs / realizedBuyValue) * 100 : 0;

      closed.push({
        tokenId,
        market,
        outcome,
        quantityClosed: realizedSize,
        quantityBought: realizedSize,
        quantitySold: realizedSize,
        avgBuyPrice: avgBuy,
        avgSellPrice: avgSell,
        pnlAbsolute: pnlAbs,
        pnlPercent: pnlPct,
        remainingSize,
        status: remainingSize <= 0.01 ? 'CLOSED' : 'PARTIALLY_CLOSED',
      });
    }

    logger.logEnd('Detect Closed Positions', { count: closed.length });
    return closed;
  } catch (error) {
    logger.error('Failed to detect closed positions', {}, error);
    return [];
  }
}

module.exports = {
  initClobClient,
  getOpenOrders,
  getOpenPositions,
  cancelOrder,
  cancelAllOrders,
  createSellOrder,
  getClosedPositions,
  fetchMarketNames,
  getFullMarketInfo,
  TradeCache,  // Export trade cache for direct access if needed
  PolymarketOrder,  // Export the Order class for reuse in other order types
  
  // Core API functions (wrapped from core-api-client)
  coreApi: {
    getCurrentPositions: coreApi.getCurrentPositions,
    getTrades: coreApi.getTrades,
    getClosedPositions: coreApi.getClosedPositions,
    getPositionValue: coreApi.getPositionValue,
    reconcileTrades: coreApi.reconcileTrades,
    clearCache: coreApi.clearCache
  },

  // Helpers for guards
  async checkAllowanceForToken(clob, tokenId, requiredSize = 0) {
    try {
      const result = await clob.getBalanceAllowance({
        asset_type: 'CONDITIONAL',
        token_id: tokenId
      });
      const balance = parseFloat(result.balance || 0);
      const allowance = parseFloat(result.allowance || 0);
      const isAllowanceSufficient = allowance >= requiredSize;
      const isBalanceSufficient = balance >= requiredSize;
      return {
        balance,
        allowance,
        requiredSize,
        isAllowanceSufficient,
        isBalanceSufficient
      };
    } catch (err) {
      logger.warn('Allowance check failed', { tokenId, error: err.message });
      return {
        balance: 0,
        allowance: 0,
        requiredSize,
        isAllowanceSufficient: false,
        isBalanceSufficient: false,
        error: err.message
      };
    }
  },

  async getNetPositionForToken(clob, tokenId) {
    try {
      const positions = await getOpenPositions(clob);
      const pos = (positions || []).find(p => p.tokenId === tokenId);
      const amount = pos ? parseFloat(pos.amount || pos.netSize || 0) : 0;
      return amount;
    } catch (err) {
      logger.warn('Net position check failed', { tokenId, error: err.message });
      return 0;
    }
  }
};
