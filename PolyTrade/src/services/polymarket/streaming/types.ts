/**
 * Hybrid Streaming Types
 * Type definitions for multi-market orderbook streaming
 */

import { OrderBookTick, OrderBookCandle, Timeframe } from '../../../lib/types/index.js';

// ============================================================================
// Market State
// ============================================================================

export type TickSource = 'rest' | 'ws' | 'merged';
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
export type MarketState = 'idle' | 'subscribing' | 'active' | 'stale' | 'error';

export interface MarketRegistration {
  tokenId: string;
  slug?: string;
  outcome?: 'yes' | 'no';
  state: MarketState;
  subscribedAt: number;
  lastRestUpdate: number;
  lastWsUpdate: number;
  lastMergedTick: number;
  tickCount: number;
  errorCount: number;
  lastError?: string;
}

// ============================================================================
// Tick Management
// ============================================================================

export interface EnrichedTick extends OrderBookTick {
  hash: string;         // Deduplication hash
  receivedAt: number;   // When we received it
  seqNum?: number;      // Sequence number if available
  isComplete: boolean;  // Whether this is a full snapshot or partial
}

export interface TickDeduplicationResult {
  isDuplicate: boolean;
  existingTick?: EnrichedTick;
  source: TickSource;
}

export interface MergedTickResult {
  tick: EnrichedTick;
  restTick?: EnrichedTick;
  wsTick?: EnrichedTick;
  mergeStrategy: 'ws-priority' | 'rest-priority' | 'latest' | 'depth-merge';
}

// ============================================================================
// WebSocket Events (from Polymarket)
// ============================================================================

export interface WsBookEvent {
  event_type: 'book';
  asset_id: string;
  market?: string;
  hash: string;
  timestamp: string;
  bids: Array<{ price: string; size: string } | [string, string]>;
  asks: Array<{ price: string; size: string } | [string, string]>;
}

export interface WsPriceChangeEvent {
  event_type: 'price_change';
  asset_id: string;
  price_changes: Array<{
    side: 'BUY' | 'SELL';
    price: string;
    size: string;
    best_bid?: string;
    best_ask?: string;
  }>;
}

export interface WsLastTradeEvent {
  event_type: 'last_trade_price';
  asset_id: string;
  price: string;
  side: 'BUY' | 'SELL';
  size?: string;
}

export interface WsTickSizeChangeEvent {
  event_type: 'tick_size_change';
  asset_id: string;
  old_tick_size: string;
  new_tick_size: string;
}

export type WsMarketEvent = WsBookEvent | WsPriceChangeEvent | WsLastTradeEvent | WsTickSizeChangeEvent;

// ============================================================================
// Connection & Subscription Management
// ============================================================================

export interface ConnectionHealth {
  state: ConnectionState;
  connectedAt?: number;
  lastMessageAt?: number;
  messageCount: number;
  errorCount: number;
  reconnectCount: number;
  latencyMs?: number;
}

export interface SubscriptionBatch {
  tokenIds: string[];
  timestamp: number;
  status: 'pending' | 'sent' | 'confirmed' | 'failed';
}

// ============================================================================
// Streaming Metrics
// ============================================================================

export interface MarketMetrics {
  tokenId: string;
  wsUpdatesPerMinute: number;
  restUpdatesPerMinute: number;
  duplicateRate: number;
  avgLatencyMs: number;
  candleCompleteness: number; // 0-1, percentage of complete candles
  sourceDistribution: {
    rest: number;
    ws: number;
    merged: number;
  };
  lastHourStats: {
    tickCount: number;
    errorCount: number;
    gapCount: number;
  };
}

export interface StreamingMetrics {
  connection: ConnectionHealth;
  markets: Map<string, MarketMetrics>;
  global: {
    totalMarkets: number;
    activeMarkets: number;
    totalTicksProcessed: number;
    totalDuplicatesSkipped: number;
    uptimeMs: number;
    memoryUsageMb: number;
  };
}

// ============================================================================
// Configuration
// ============================================================================

export interface HybridStreamConfig {
  // REST polling
  restPollIntervalMs: number;       // Default: 5000 (5s)
  restPollBackoffMs: number;        // Backoff on error: 10000
  restTimeoutMs: number;            // Request timeout: 5000
  
  // WebSocket
  wsReconnectIntervalMs: number;    // Default: 5000
  wsMaxReconnectAttempts: number;   // Default: 10
  wsPingIntervalMs: number;         // Heartbeat: 30000
  
  // Staleness detection
  wsStaleThresholdMs: number;       // Consider WS stale after: 60000
  marketStaleThresholdMs: number;   // Consider market stale after: 120000
  
  // Deduplication
  tickDedupeWindowMs: number;       // Dedup window: 1000ms
  
  // Batching
  subscriptionBatchSize: number;    // Max 500 per WS connection
  subscriptionBatchDelayMs: number; // Batch delay: 100ms
  
  // Memory limits
  maxMarketsPerInstance: number;    // Default: 100
  maxTicksInMemory: number;         // Per market: 1000
}

export const DEFAULT_STREAM_CONFIG: HybridStreamConfig = {
  restPollIntervalMs: 2000,     // Reduced from 5000ms to 2000ms (faster fallback)
  restPollBackoffMs: 10000,
  restTimeoutMs: 5000,
  wsReconnectIntervalMs: 5000,
  wsMaxReconnectAttempts: 10,
  wsPingIntervalMs: 30000,
  wsStaleThresholdMs: 30000,    // Reduced from 60000ms to 30000ms (faster staleness detection)
  marketStaleThresholdMs: 120000,
  tickDedupeWindowMs: 1000,
  subscriptionBatchSize: 500,
  subscriptionBatchDelayMs: 100,
  maxMarketsPerInstance: 100,
  maxTicksInMemory: 1000,
};

// ============================================================================
// Event Handlers
// ============================================================================

export type TickHandler = (tick: EnrichedTick) => void;
export type MarketStateHandler = (tokenId: string, state: MarketState, error?: Error) => void;
export type ConnectionHandler = (state: ConnectionState, error?: Error) => void;

export interface StreamEventHandlers {
  onTick?: TickHandler;
  onMarketStateChange?: MarketStateHandler;
  onConnectionStateChange?: ConnectionHandler;
  onError?: (error: Error, context: string) => void;
}
