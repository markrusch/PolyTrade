/**
 * Configuration Schema with Zod Validation
 * Validates all environment variables at startup
 */

import { z } from 'zod';

// Environment type
export const EnvSchema = z.enum(['development', 'production', 'test']);

// Log level
export const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);

// Crypto service configuration for per-crypto control (must be defined before Deribit/Binance)
export const CryptoServiceConfigSchema = z.object({
  symbol: z.string(),
  enabled: z.boolean().default(true),
  interval: z.number().positive().optional(),
  priority: z.enum(['high', 'normal', 'low']).default('normal'),
});

// Polymarket configuration
export const PolymarketConfigSchema = z.object({
  privateKey: z.string()
    .regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid Ethereum private key format'),
  safeAddress: z.string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address format'),
  funderAddress: z.string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address format'),
  userAddress: z.string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address format'),
  coreApiUrl: z.string().url('Invalid Polymarket Core API URL'),
  builderApiKey: z.string().min(1, 'Builder API key is required'),
  builderSecret: z.string().min(1, 'Builder secret is required'),
  builderPassphrase: z.string().min(1, 'Builder passphrase is required'),
});

// Deribit configuration with per-currency control
export const DeribitConfigSchema = z.object({
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
  baseUrl: z.string().url('Invalid Deribit base URL'),
  wsUrl: z.string()
    .regex(/^wss?:\/\//, 'Deribit WebSocket URL must start with ws:// or wss://'),
  interval: z.number()
    .positive('Deribit interval must be positive')
    .default(5000),
  fallbackIV: z.number()
    .positive('Fallback IV must be positive')
    .default(0.8), // 80% default IV when Deribit unavailable
  currencies: z.array(CryptoServiceConfigSchema).default([
    { symbol: 'ETH', enabled: true, priority: 'high' },
    { symbol: 'BTC', enabled: false, priority: 'normal' },
  ]),
});

// Binance configuration with per-crypto control
export const BinanceConfigSchema = z.object({
  baseUrl: z.string().url('Invalid Binance base URL'),
  interval: z.number()
    .positive('Binance interval must be positive')
    .min(1000, 'Binance interval should be at least 1000ms to respect rate limits')
    .default(1000), // 1 second default to stay well under 1200 req/min limit
  cryptos: z.array(CryptoServiceConfigSchema).default([
    { symbol: 'ETHUSDT', enabled: true, priority: 'high' },
    { symbol: 'BTCUSDT', enabled: true, priority: 'high' },
  ]),
});

// RPC configuration
export const RpcConfigSchema = z.object({
  infuraUrl: z.string().url('Invalid Infura RPC URL'),
});

// Cache configuration
export const CacheConfigSchema = z.object({
  activityTtl: z.number().positive().default(120000), // 2 minutes
  tradesTtl: z.number().positive().default(120000), // 2 minutes
  positionsTtl: z.number().positive().default(300000), // 5 minutes
  instrumentsTtl: z.number().positive().default(300000), // 5 minutes
  marketsTtl: z.number().positive().default(1800000), // 30 minutes
});

// Feature flags configuration
export const FeaturesConfigSchema = z.object({
  binance: z.boolean().default(false),
  deribit: z.boolean().default(false),
  polymarketTrading: z.boolean().default(true),
});

// Pricing configuration
export const PricingConfigSchema = z.object({
  riskFreeRate: z.number()
    .min(0, 'Risk-free rate must be non-negative')
    .max(1, 'Risk-free rate must be <= 100%')
    .default(0.04), // 4% Polymarket holding rate (annualized)
  enableCarryCost: z.boolean().default(true),
});

// Market maker configuration
export const MarketMakerConfigSchema = z.object({
  maxQuantityPerMarket: z.number()
    .positive('Max quantity must be positive')
    .default(1000),
  maxNotionalPerCrypto: z.number()
    .positive('Max notional must be positive')
    .default(10000),
  maxGammaExposure: z.number()
    .positive('Max gamma exposure must be positive')
    .default(0.5),
  baseSpread: z.number()
    .positive('Base spread must be positive')
    .max(1, 'Base spread must be <= 100%')
    .default(0.02), // 2%
  gammaCoefficient: z.number()
    .positive('Gamma coefficient must be positive')
    .default(100),
  inventoryCoefficient: z.number()
    .positive('Inventory coefficient must be positive')
    .default(0.0001),
});

// Safety configuration
export const SafetyConfigSchema = z.object({
  maxSpotStalenessMs: z.number()
    .positive('Max spot staleness must be positive')
    .default(30000), // 30 seconds - realistic for polling-based data with network latency
  maxIvStalenessMs: z.number()
    .positive('Max IV staleness must be positive')
    .default(120000), // 2 minutes - DVOL doesn't change rapidly
  maxSpotGapPercent: z.number()
    .positive('Max spot gap percent must be positive')
    .max(1, 'Max spot gap must be <= 100%')
    .default(0.02), // 2%
  maxOrderbookStalenessMs: z.number()
    .positive('Max orderbook staleness must be positive')
    .default(30000), // 30 seconds - reasonable for REST polling
  minOrderbookDepth: z.number()
    .nonnegative('Min orderbook depth must be non-negative')
    .default(100),
});

// Performance configuration
export const PerformanceConfigSchema = z.object({
  batchSize: z.number()
    .positive('Batch size must be positive')
    .int('Batch size must be an integer')
    .default(50),
  cacheSpotTtl: z.number()
    .positive('Cache spot TTL must be positive')
    .default(30000), // 30 seconds
  cacheIvTtl: z.number()
    .positive('Cache IV TTL must be positive')
    .default(120000), // 120 seconds
});

// Main configuration schema
export const ConfigSchema = z.object({
  env: EnvSchema.default('development'),
  logLevel: LogLevelSchema.default('info'),
  port: z.number()
    .positive('Port must be positive')
    .int('Port must be an integer')
    .max(65535, 'Port must be less than 65536')
    .default(3000),
  dashboardPort: z.number()
    .positive('Dashboard port must be positive')
    .int('Dashboard port must be an integer')
    .max(65535, 'Dashboard port must be less than 65536')
    .default(3001),
  polymarket: PolymarketConfigSchema,
  deribit: DeribitConfigSchema,
  binance: BinanceConfigSchema,
  rpc: RpcConfigSchema,
  cache: CacheConfigSchema,
  features: FeaturesConfigSchema,
  pricing: PricingConfigSchema.optional(),
  marketMaker: MarketMakerConfigSchema.optional(),
  safety: SafetyConfigSchema.optional(),
  performance: PerformanceConfigSchema.optional(),
});

// Type inference from schema
export type Config = z.infer<typeof ConfigSchema>;
export type PolymarketConfig = z.infer<typeof PolymarketConfigSchema>;
export type DeribitConfig = z.infer<typeof DeribitConfigSchema>;
export type BinanceConfig = z.infer<typeof BinanceConfigSchema>;
export type RpcConfig = z.infer<typeof RpcConfigSchema>;
export type CacheConfig = z.infer<typeof CacheConfigSchema>;
export type CryptoServiceConfig = z.infer<typeof CryptoServiceConfigSchema>;
export type FeaturesConfig = z.infer<typeof FeaturesConfigSchema>;
export type PricingConfig = z.infer<typeof PricingConfigSchema>;
export type MarketMakerConfig = z.infer<typeof MarketMakerConfigSchema>;
export type SafetyConfig = z.infer<typeof SafetyConfigSchema>;
export type PerformanceConfig = z.infer<typeof PerformanceConfigSchema>;

/**
 * Validate configuration object
 * @param config - Raw configuration object
 * @returns Validated and typed configuration
 * @throws ZodError if validation fails
 */
export function validateConfig(config: unknown): Config {
  return ConfigSchema.parse(config);
}

/**
 * Validate configuration object with safe parsing
 * @param config - Raw configuration object
 * @returns Success or error result
 */
export function safeValidateConfig(config: unknown) {
  return ConfigSchema.safeParse(config);
}
