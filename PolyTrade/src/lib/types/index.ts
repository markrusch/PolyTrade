/**
 * Shared Type Definitions for PolyTrade
 * Defines all core data structures used across the platform
 */

// ============================================================================
// Market Data Types
// ============================================================================

export interface Tick {
  timestamp: number; // Unix epoch milliseconds
  spot: number; // Spot price from Binance (ETHUSDT, BTCUSDT, etc.)
  iv: number | null; // Implied volatility from Deribit (percentage, e.g., 0.65 = 65%)
  polyBid: number | null; // Best bid from Polymarket order book
  polyAsk: number | null; // Best ask from Polymarket order book
  polyMid: number | null; // Midpoint of Polymarket book (bid + ask) / 2
  riskNeutralProb: number | null; // Calculated risk-neutral probability (0-1)
  marketSlug: string; // Polymarket market identifier
  crypto: string; // Underlying crypto (ETH, BTC, SOL, etc.)
}

export interface SpotPrice {
  symbol: string; // e.g., "ETHUSDT"
  price: number;
  timestamp: number;
}

export interface OrderBookSnapshot {
  marketSlug: string;
  bids: OrderBookLevel[]; // Sorted by price descending
  asks: OrderBookLevel[]; // Sorted by price ascending
  timestamp: number;
  minOrderSize: number;
  tickSize: number;
  negRisk: boolean; // Negative risk market flag
}

export interface OrderBookLevel {
  price: number;
  size: number;
}

export interface OrderBookTick {
  tokenId: string;
  timestamp: number; // Unix milliseconds
  bestBid: number;
  bestAsk: number;
  spreadBps: number; // Spread in basis points
  topBidSize: number;
  topAskSize: number;
  bidLevels: OrderBookLevel[];
  askLevels: OrderBookLevel[];
  source: 'rest' | 'ws';
}

export type Timeframe = '1m' | '5m' | '10m';

export interface OrderBookCandle {
  tokenId: string;
  timeframe: Timeframe;
  timestamp: number; // Unix milliseconds (candle close time)
  openMid: number;
  highMid: number;
  lowMid: number;
  closeMid: number;
  avgSpread: number; // Average spread in basis points
  avgTopBidSize: number;
  avgTopAskSize: number;
  totalVolume: number; // Sum of bid/ask sizes
  levelCount: number; // Average depth
  tickCount: number; // Number of ticks in this candle
  
  // Best 20 bid levels (level 1 = best bid)
  bid1Price: number;
  bid1Size: number;
  bid2Price: number;
  bid2Size: number;
  bid3Price: number;
  bid3Size: number;
  bid4Price: number;
  bid4Size: number;
  bid5Price: number;
  bid5Size: number;
  bid6Price: number;
  bid6Size: number;
  bid7Price: number;
  bid7Size: number;
  bid8Price: number;
  bid8Size: number;
  bid9Price: number;
  bid9Size: number;
  bid10Price: number;
  bid10Size: number;
  bid11Price: number;
  bid11Size: number;
  bid12Price: number;
  bid12Size: number;
  bid13Price: number;
  bid13Size: number;
  bid14Price: number;
  bid14Size: number;
  bid15Price: number;
  bid15Size: number;
  bid16Price: number;
  bid16Size: number;
  bid17Price: number;
  bid17Size: number;
  bid18Price: number;
  bid18Size: number;
  bid19Price: number;
  bid19Size: number;
  bid20Price: number;
  bid20Size: number;
  
  // Best 20 ask levels (level 1 = best ask)
  ask1Price: number;
  ask1Size: number;
  ask2Price: number;
  ask2Size: number;
  ask3Price: number;
  ask3Size: number;
  ask4Price: number;
  ask4Size: number;
  ask5Price: number;
  ask5Size: number;
  ask6Price: number;
  ask6Size: number;
  ask7Price: number;
  ask7Size: number;
  ask8Price: number;
  ask8Size: number;
  ask9Price: number;
  ask9Size: number;
  ask10Price: number;
  ask10Size: number;
  ask11Price: number;
  ask11Size: number;
  ask12Price: number;
  ask12Size: number;
  ask13Price: number;
  ask13Size: number;
  ask14Price: number;
  ask14Size: number;
  ask15Price: number;
  ask15Size: number;
  ask16Price: number;
  ask16Size: number;
  ask17Price: number;
  ask17Size: number;
  ask18Price: number;
  ask18Size: number;
  ask19Price: number;
  ask19Size: number;
  ask20Price: number;
  ask20Size: number;
}

export interface OrderBookCandleRequest {
  tokenId: string;
  timeframe: Timeframe;
  startTime: number; // Unix milliseconds
  endTime: number; // Unix milliseconds
}

export interface OrderBookHistoryResponse {
  tokenId: string;
  timeframe: Timeframe;
  candles: OrderBookCandle[];
}

export interface DeribitSnapshot {
  instrumentName: string; // e.g., "ETH-28MAR25-3000-C"
  markIv: number; // Mark implied volatility
  underlyingPrice: number;
  greeks?: Greeks;
  timestamp: number;
  instrument?: {
    strike: number;
    expiration_timestamp: number;
    option_type: 'call' | 'put';
    currency: string;
  };
}

export interface Greeks {
  delta: number;
  gamma: number;
  vega: number;
  theta: number;
  rho?: number;
}

// ============================================================================
// Trading Types
// ============================================================================

export interface Order {
  id: string;
  market: string;
  side: 'BUY' | 'SELL';
  price: number;
  amount: number;
  status: 'PENDING' | 'OPEN' | 'FILLED' | 'PARTIALLY_FILLED' | 'CANCELLED' | 'FAILED';
  createdAt: number;
  updatedAt: number;
  filledAmount?: number;
  signature?: string;
}

export interface Position {
  market: string;
  outcome: string;
  size: number; // Negative for short positions
  entryPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  realizedPnL: number;
  timestamp: number;
}

export interface Trade {
  id: string;
  market: string;
  price: number;
  size: number;
  timestamp: number;
  side: 'BUY' | 'SELL';
  maker: string; // Address
  taker: string; // Address
}

export interface PortfolioSummary {
  balance: number;
  totalNotional: number;
  unrealizedPnL: number;
  realizedPnL: number;
  positions: Position[];
  openOrders: Order[];
  timestamp: number;
}

// ============================================================================
// Market Metadata Types
// ============================================================================

export interface MarketInfo {
  slug: string;
  question: string;
  outcomes: string[];
  tokenIds: string[];
  active: boolean;
  closed: boolean;
  endDate: string | null;
  minOrderSize: number;
  tickSize: number;
  negRisk: boolean;
}

export interface Instrument {
  instrumentName: string; // Deribit format: "ETH-28MAR25-3000-C"
  currency: string; // ETH, BTC
  strike: number;
  expirationTimestamp: number;
  optionType: 'call' | 'put';
}

export interface ExpiryDate {
  currency: string;
  expirationTimestamp: number;
  atmStrike: number;
  instruments: Instrument[];
}

// ============================================================================
// API Request/Response Types
// ============================================================================

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, any>;
}

export interface JsonRpcResponse<T = any> {
  jsonrpc: '2.0';
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export interface HttpRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  params?: Record<string, any>;
  data?: any;
}

export interface HttpResponse<T = any> {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: T;
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface Config {
  env: 'development' | 'production' | 'test';
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  
  // Service ports
  port: number;
  dashboardPort: number;
  
  // Polymarket
  polymarket: {
    privateKey: string;
    safeAddress: string;
    funderAddress: string;
    userAddress: string;
    coreApiUrl: string;
    builderApiKey: string;
    builderSecret: string;
    builderPassphrase: string;
  };
  
  // Deribit
  deribit: {
    clientId?: string;
    clientSecret?: string;
    baseUrl: string;
    wsUrl: string;
    interval: number; // Polling interval in ms
  };
  
  // Binance
  binance: {
    baseUrl: string;
    interval: number; // Polling interval in ms
  };
  
  // RPC
  rpc: {
    infuraUrl: string;
  };
  
  // Cache TTLs (in milliseconds)
  cache: {
    activityTtl: number;
    tradesTtl: number;
    positionsTtl: number;
    instrumentsTtl: number;
    marketsTtl: number;
  };
}

// ============================================================================
// Cache Types
// ============================================================================

export interface CacheEntry<T> {
  key: string;
  value: T;
  expiresAt: number;
  createdAt: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  evictions: number;
}

// ============================================================================
// Logging Types
// ============================================================================

export interface LogEntry {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  correlationId?: string;
  service?: string;
  context?: Record<string, any>;
  error?: Error;
}

// ============================================================================
// Health & Monitoring Types
// ============================================================================

export interface HealthStatus {
  service: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number; // milliseconds
  lastCheck: number; // timestamp
  details: {
    binance?: ConnectionStatus;
    deribit?: ConnectionStatus;
    polymarket?: ConnectionStatus;
  };
}

export interface ConnectionStatus {
  connected: boolean;
  lastSuccessfulRequest: number | null;
  lastError: string | null;
  consecutiveFailures: number;
}

export interface ServiceStatus {
  healthy: boolean;
  markets: Map<string, MarketStatus>;
  memory: {
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
  uptime: number;
}

export interface MarketStatus {
  marketKey: string; // "eth:market-slug"
  connected: boolean;
  lastTick: number | null;
  dataFreshness: number; // ms since last update
  sources: {
    binance: boolean;
    deribit: boolean;
    polymarket: boolean;
  };
}

// ============================================================================
// Event Types
// ============================================================================

export type EventType = 
  | 'tick:received'
  | 'price:updated'
  | 'book:updated'
  | 'order:placed'
  | 'order:filled'
  | 'order:cancelled'
  | 'position:opened'
  | 'position:closed'
  | 'error:connection'
  | 'error:rate-limit'
  | 'error:reconnecting'
  | 'connection:established'
  | 'cache:hit'
  | 'cache:miss'
  | 'cache:expired';

export interface Event<T = any> {
  type: EventType;
  timestamp: number;
  correlationId?: string;
  data: T;
}

// ============================================================================
// Builder API Types (Polymarket)
// ============================================================================

export interface BuilderOrderRequest {
  market: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  tokenId: string;
  expirationTimestamp?: number;
}

export interface SignedOrder extends BuilderOrderRequest {
  signature: string;
  signer: string;
  nonce: number;
  timestamp: number;
}

export interface OrderAccepted {
  orderId: string;
  status: 'ACCEPTED' | 'REJECTED';
  reason?: string;
}

// ============================================================================
// Utility Types
// ============================================================================

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type RequireAtLeastOne<T, Keys extends keyof T = keyof T> = 
  Pick<T, Exclude<keyof T, Keys>> & 
  { [K in Keys]-?: Required<Pick<T, K>> & Partial<Pick<T, Exclude<Keys, K>>> }[Keys];

export type Awaitable<T> = T | Promise<T>;
