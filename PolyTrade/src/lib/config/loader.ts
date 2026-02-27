/**
 * Configuration Loader
 * Loads and validates configuration from environment variables
 */

import { config as dotenvConfig } from 'dotenv';
import { Config, validateConfig } from './schema.js';

/**
 * Load configuration from environment variables
 * Throws if required variables are missing or invalid
 */
export function loadConfig(): Config {
  // Load .env file
  dotenvConfig();

  // Build configuration object from environment
  const rawConfig = {
    env: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || 'info',
    port: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
    dashboardPort: process.env.DASHBOARD_PORT ? parseInt(process.env.DASHBOARD_PORT, 10) : 3001,
    
    polymarket: {
      privateKey: process.env.POLYMARKETS_PRIVATE_KEY || '',
      safeAddress: process.env.POLYMARKET_SAFE_ADDRESS || '',
      funderAddress: process.env.POLYMARKET_FUNDER_ADDRESS || '',
      userAddress: process.env.POLYMARKET_USER_ADDRESS || '',
      coreApiUrl: process.env.POLYMARKET_CORE_API_URL || 'https://data-api.polymarket.com',
      builderApiKey: process.env.POLY_BUILDER_API_KEY || '',
      builderSecret: process.env.POLY_BUILDER_SECRET || '',
      builderPassphrase: process.env.POLY_BUILDER_PASSPHRASE || '',
    },
    
    deribit: {
      clientId: process.env.DERIBIT_CLIENT_ID,
      clientSecret: process.env.DERIBIT_CLIENT_SECRET,
      baseUrl: process.env.DERIBIT_BASE_URL || 'https://www.deribit.com',
      wsUrl: process.env.DERIBIT_WS_URL || 'wss://www.deribit.com/ws/api/v2',
      interval: process.env.DERIBIT_INTERVAL ? parseInt(process.env.DERIBIT_INTERVAL, 10) : 30000, // 30 seconds - DVOL doesn't change rapidly
      currencies: [
        {
          symbol: 'ETH',
          enabled: process.env.DERIBIT_ETH_ENABLED !== 'false',
          priority: 'high' as const,
        },
        {
          symbol: 'BTC',
          enabled: process.env.DERIBIT_BTC_ENABLED !== 'false',
          priority: 'normal' as const,
        },
      ],
    },
    
    binance: {
      baseUrl: process.env.BINANCE_BASE_URL || 'https://api.binance.com',
      interval: process.env.BINANCE_INTERVAL ? parseInt(process.env.BINANCE_INTERVAL, 10) : 1000,
      cryptos: [
        {
          symbol: 'ETHUSDT',
          enabled: process.env.BINANCE_ETH_ENABLED !== 'false',
          priority: 'high' as const,
        },
        {
          symbol: 'BTCUSDT',
          enabled: process.env.BINANCE_BTC_ENABLED !== 'false',
          priority: 'high' as const,
        },
      ],
    },
    
    rpc: {
      infuraUrl: process.env.RPC_LINK_INFURA || '',
    },
    
    cache: {
      activityTtl: process.env.CACHE_ACTIVITY_TTL ? parseInt(process.env.CACHE_ACTIVITY_TTL, 10) : 120000,
      tradesTtl: process.env.CACHE_TRADES_TTL ? parseInt(process.env.CACHE_TRADES_TTL, 10) : 120000,
      positionsTtl: process.env.CACHE_POSITIONS_TTL ? parseInt(process.env.CACHE_POSITIONS_TTL, 10) : 300000,
      instrumentsTtl: process.env.CACHE_INSTRUMENTS_TTL ? parseInt(process.env.CACHE_INSTRUMENTS_TTL, 10) : 300000,
      marketsTtl: process.env.CACHE_MARKETS_TTL ? parseInt(process.env.CACHE_MARKETS_TTL, 10) : 1800000,
    },
    
    features: {
      binance: process.env.ENABLE_BINANCE !== 'false',
      deribit: process.env.ENABLE_DERIBIT !== 'false',
      polymarketTrading: process.env.ENABLE_POLYMARKET_TRADING !== 'false',
    },
  };

  // Validate and return typed configuration
  try {
    return validateConfig(rawConfig);
  } catch (error) {
    console.error('Configuration validation failed:', error);
    throw new Error(`Invalid configuration: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Singleton configuration instance
 */
let configInstance: Config | null = null;

/**
 * Get configuration (singleton)
 * Loads config on first call, returns cached instance on subsequent calls
 */
export function getConfig(): Config {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

/**
 * Reset configuration (useful for testing)
 */
export function resetConfig(): void {
  configInstance = null;
}
