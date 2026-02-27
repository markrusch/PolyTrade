/**
 * UI Configuration Constants
 * Centralized configuration to eliminate magic numbers throughout the codebase
 */

// API Configuration
export const API_CONFIG = {
  BASE_URL: import.meta.env.VITE_API_URL || 'http://localhost:3001',
  PRICING_URL: import.meta.env.VITE_PRICING_URL || 'http://localhost:3002',
} as const;

// Query Refetch Intervals (milliseconds)
// Tuned to reduce backend load (~50% fewer requests vs original)
export const REFETCH_INTERVALS = {
  HEALTH: 15000,          // 15s - health check
  MARKETS: 60000,         // 60s - market list (rarely changes)
  ORDERBOOK: 10000,       // 10s - order book (only when WS not connected)
  ORDERS: 10000,          // 10s - open orders
  POSITIONS: 15000,       // 15s - positions
  CANDLES: 10000,         // 10s - candlestick data
  STREAMING_STATUS: 10000, // 10s - streaming status
  PRICING: 5000,          // 5s - pricing data (core feature, keep fast)
  WIRED_MARKETS: 10000,   // 10s - wired markets
  IV_DATA: 60000,         // 60s - IV data (DVOL updates slowly)
  PORTFOLIO_GREEKS: 15000, // 15s - portfolio greeks
  DISCOVERY: 300000,      // 5 min - market discovery
} as const;

// Query Cache Times (milliseconds)
export const CACHE_TIMES = {
  DEFAULT_STALE: 10000,   // 10s
  DEFAULT_GC: 60000,      // 60s
  HEALTH_STALE: 8000,     // 8s
  DISCOVERY_STALE: 300000, // 5 min
  DISCOVERY_GC: 600000,    // 10 min
  PRICING_STALE: 3000,     // 3s
  ORDERBOOK_STALE: 8000,   // 8s
} as const;

// Retry Configuration
export const RETRY_CONFIG = {
  HEALTH_RETRIES: 5,
  DEFAULT_RETRIES: 3,
  MAX_RETRY_DELAY: 30000,  // 30s
} as const;

// UI Timing (milliseconds)
export const UI_TIMING = {
  INIT_DELAY: 1000,        // 1s - app initialization delay
  FLASH_DURATION: 300,     // 300ms - price flash animation
  MESSAGE_TIMEOUT: 3000,   // 3s - toast/action message display
  THROTTLE_WS: 500,        // 500ms - WebSocket update throttle
  RECONNECT_DELAY: 3000,   // 3s - WebSocket reconnect delay
} as const;

// Order Book Configuration
export const ORDERBOOK_CONFIG = {
  DEFAULT_LEVEL_DEPTH: 5,
  DEFAULT_REFRESH_INTERVAL: 30,
  MIN_REFRESH_INTERVAL: 15,
  MAX_REFRESH_INTERVAL: 90,
  MAX_HISTORY_POINTS: 100,
} as const;

// Chart Colors
export const CHART_COLORS = {
  BIDS: [
    'rgba(16, 185, 129, 0.9)',  // Level 1 (best)
    'rgba(16, 185, 129, 0.75)',
    'rgba(16, 185, 129, 0.6)',
    'rgba(16, 185, 129, 0.45)',
    'rgba(16, 185, 129, 0.3)',
    'rgba(16, 185, 129, 0.25)',
    'rgba(16, 185, 129, 0.2)',
    'rgba(16, 185, 129, 0.15)',
    'rgba(16, 185, 129, 0.1)',
    'rgba(16, 185, 129, 0.05)',
  ],
  ASKS: [
    'rgba(239, 68, 68, 0.9)',   // Level 1 (best)
    'rgba(239, 68, 68, 0.75)',
    'rgba(239, 68, 68, 0.6)',
    'rgba(239, 68, 68, 0.45)',
    'rgba(239, 68, 68, 0.3)',
    'rgba(239, 68, 68, 0.25)',
    'rgba(239, 68, 68, 0.2)',
    'rgba(239, 68, 68, 0.15)',
    'rgba(239, 68, 68, 0.1)',
    'rgba(239, 68, 68, 0.05)',
  ],
  MID_PRICE: 'rgba(99, 102, 241, 0.8)',
  SPREAD: 'rgba(156, 163, 175, 0.4)',
} as const;

// Theme Colors (CSS variable fallbacks)
export const THEME_COLORS = {
  BG_PRIMARY: '#0f0f1e',
  BG_SECONDARY: '#1a1a2e',
  BG_TERTIARY: '#252538',
  BORDER: '#2d2d44',
  TEXT_PRIMARY: '#fff',
  TEXT_SECONDARY: '#a0a0b0',
  TEXT_TERTIARY: '#6b6b80',
  ACCENT: '#6366f1',
  ACCENT_HOVER: '#5558e3',
  SUCCESS: '#10b981',
  DANGER: '#ef4444',
  WARNING: '#fbbf24',
} as const;

// Greeks Thresholds
export const GREEKS_THRESHOLDS = {
  DELTA_NEUTRAL: 0.1,    // Below this = delta neutral
  THETA_MINIMAL: 0.01,   // Below this = minimal time decay
  GAMMA_LOW: 0.01,       // Below this = low convexity
  VEGA_NEUTRAL: 0.1,     // Below this = vega neutral
} as const;

// Trading Configuration
export const TRADING_CONFIG = {
  DEFAULT_SLIPPAGE: 0.02,  // 2% slippage for market orders
  MIN_ORDER_SIZE: 1,
  MAX_DISPLAY_POSITIONS: 50,
  MAX_DISPLAY_ORDERS: 100,
} as const;

// Discovery Configuration
export const DISCOVERY_CONFIG = {
  DEFAULT_CRYPTO: 'BTC',
  DEFAULT_EXPIRY_DAYS: 14,
  MIN_EXPIRY_DAYS: 1,
  MAX_EXPIRY_DAYS: 90,
} as const;
