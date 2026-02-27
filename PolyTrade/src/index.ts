/**
 * PolyTrade Library - Main Entry Point
 * Exports all public APIs for the trading platform
 */

// Configuration
export { getConfig, resetConfig } from './lib/config/loader.js';
export type { Config, DeribitConfig, BinanceConfig, PolymarketConfig } from './lib/config/schema.js';

// Logger
export { createLogger } from './lib/logger/index.js';
export type { Logger } from './lib/logger/index.js';

// Retry Handler
export { RetryHandler, createRetryHandler } from './lib/retry/RetryHandler.js';
export type { RetryOptions, RetryState } from './lib/retry/RetryHandler.js';

// Cache Manager
export { CacheManager, createCache } from './lib/cache/CacheManager.js';
export type { CacheOptions } from './lib/cache/CacheManager.js';

// Communication Interfaces
export { BaseListener, BaseRequestor } from './lib/comm/index.js';
export type { IListener, IRequestor } from './lib/comm/index.js';

// Types
export type { Tick, Order, DeribitSnapshot, Greeks, SpotPrice } from './lib/types/index.js';

// Binance Service
export { BinanceRequestor } from './services/binance/BinanceRequestor.js';
export { BinancePriceListener } from './services/binance/BinancePriceListener.js';

// Deribit Service
export { DeribitRequestor } from './services/deribit/DeribitRequestor.js';
export { DeribitListener } from './services/deribit/DeribitListener.js';
export type { DeribitInstrument, DeribitTicker } from './services/deribit/DeribitRequestor.js';

// Polymarket Service
export {
  MarketPricingService,
} from './services/polymarket/index.js';
export type {
  MarketMetadata,
  PricingSnapshot,
} from './services/polymarket/index.js';

