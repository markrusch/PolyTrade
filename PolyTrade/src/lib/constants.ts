/**
 * Backend Configuration Constants
 * Centralized configuration to eliminate magic numbers throughout the codebase
 */

// Server Configuration
export const SERVER_CONFIG = {
  PORT: Number(process.env.PORT) || 3001,
  INIT_TIMEOUT_MS: 30000, // 30s initialization timeout
} as const;

// Streaming Configuration
export const STREAMING_CONFIG = {
  REST_POLL_INTERVAL_MS: Number(process.env.REST_POLL_INTERVAL_MS) || 5000,
  WS_STALE_THRESHOLD_MS: Number(process.env.WS_STALE_THRESHOLD_MS) || 60000,
  MAX_MARKETS_PER_INSTANCE: Number(process.env.MAX_MARKETS_PER_INSTANCE) || 100,
} as const;

// Metrics Configuration
export const METRICS_CONFIG = {
  FLUSH_INTERVAL_MS: Number(process.env.METRICS_FLUSH_INTERVAL_MS) || 30000,
  OUTPUT_PATH: process.env.METRICS_OUTPUT_PATH || undefined, // Uses default if undefined
} as const;

// Cache Configuration
export const CACHE_CONFIG = {
  MARKETS_TTL_MS: 10000,      // 10s - market list cache
  ORDERS_TTL_MS: 5000,        // 5s - orders cache
  POSITIONS_TTL_MS: 5000,     // 5s - positions cache
  GREEKS_TTL_MS: 10000,       // 10s - portfolio greeks cache
  MARKET_NAMES_TTL_MS: 60000, // 60s - market names cache
  SPOT_TTL_MS: 5000,          // 5s - spot price cache
  IV_TTL_MS: 30000,           // 30s - IV cache
} as const;

// Broadcast Configuration
export const BROADCAST_CONFIG = {
  INTERVAL_MS: 5000,          // 5s - periodic broadcast interval
  MAX_POSITIONS: 50,          // Max positions to broadcast
  MAX_ORDERS: 100,            // Max orders to broadcast
} as const;

// Graceful Shutdown Configuration
export const SHUTDOWN_CONFIG = {
  TIMEOUT_MS: 10000,          // 10s - force shutdown timeout
} as const;

// WebSocket Configuration
export const WS_CONFIG = {
  HEARTBEAT_INTERVAL_MS: 30000,  // 30s - ping interval
  DEAD_CONNECTION_CHECK_MS: 60000, // 60s - check for dead connections
} as const;

// Database Configuration
export const DB_CONFIG = {
  CLEANUP_INTERVAL_MS: 1000,  // 1s - tick buffer cleanup
  DEFAULT_HISTORY_LIMIT: 1000,
  MAX_PAGINATION_LIMIT: 5000,
} as const;

// Pricing Configuration
export const PRICING_CONFIG = {
  UPDATE_INTERVAL_MS: 1000,   // 1s - pricing update interval
  STALE_THRESHOLD_MS: 60000,  // 60s - stale price threshold
} as const;

// Default Fallback Prices (when no live data available)
export const FALLBACK_PRICES = {
  BTC_USD: 60000,
  ETH_USD: 3500,
} as const;
