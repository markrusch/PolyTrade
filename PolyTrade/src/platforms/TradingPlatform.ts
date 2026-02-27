/**
 * TradingPlatform Interface
 *
 * Core abstraction for trading on different prediction market platforms.
 * Implementations wrap platform-specific APIs (Polymarket, Kalshi, PredictIt).
 *
 * @see REDESIGN_V2.md Section 5.1
 */

import type { MarketDefinition, MarketType, Outcome } from '../markets/MarketDefinition.js';

// ============================================================================
// Platform Types
// ============================================================================

export type PlatformName = 'polymarket' | 'kalshi' | 'predictit';

export interface PlatformConfig {
  name: PlatformName;
  enabled: boolean;
  apiConfig: Record<string, unknown>;
}

// ============================================================================
// Order Types
// ============================================================================

export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'GTC' | 'GTD' | 'FOK' | 'FAK' | 'MARKET';
export type OrderStatus =
  | 'PENDING'
  | 'OPEN'
  | 'FILLED'
  | 'PARTIALLY_FILLED'
  | 'CANCELLED'
  | 'FAILED'
  | 'EXPIRED';

export interface OrderParams {
  marketId: string;
  outcomeId: string;          // Which outcome to trade
  side: OrderSide;
  price: number;              // 0-1 for prediction markets
  size: number;               // Quantity in shares/contracts
  orderType?: OrderType;      // Default: GTC
  expiration?: number;        // Unix timestamp for GTD orders
}

export interface Order {
  id: string;                 // Platform order ID
  platformOrderId: string;    // Original platform ID
  marketId: string;
  outcomeId: string;
  side: OrderSide;
  price: number;
  size: number;
  filledSize: number;
  status: OrderStatus;
  orderType: OrderType;
  createdAt: Date;
  updatedAt: Date;
  expiration?: Date;
}

export interface OrderResult {
  success: boolean;
  order?: Order;
  errorCode?: string;
  errorMessage?: string;
}

// ============================================================================
// Position Types
// ============================================================================

export interface Position {
  marketId: string;
  outcomeId: string;
  outcomeName: string;
  size: number;               // Negative for short positions
  averagePrice: number;
  currentPrice?: number;
  unrealizedPnL?: number;
  realizedPnL?: number;
  updatedAt: Date;
}

// ============================================================================
// Balance Types
// ============================================================================

export interface Balance {
  total: number;              // Total account balance
  available: number;          // Available for trading
  locked: number;             // Locked in orders/positions
  currency: string;           // e.g., 'USDC', 'USD'
  updatedAt: Date;
}

// ============================================================================
// Orderbook Types
// ============================================================================

export interface OrderbookLevel {
  price: number;
  size: number;
}

export interface OrderbookSnapshot {
  marketId: string;
  outcomeId: string;
  bids: OrderbookLevel[];     // Sorted descending by price
  asks: OrderbookLevel[];     // Sorted ascending by price
  timestamp: Date;
  spread: number;             // Ask - Bid
  midPrice: number;
}

export type OrderbookCallback = (snapshot: OrderbookSnapshot) => void;
export type Unsubscribe = () => void;

// ============================================================================
// Market Discovery Types
// ============================================================================

export interface MarketFilters {
  active?: boolean;
  closed?: boolean;
  resolved?: boolean;
  marketType?: MarketType;
  expiresAfter?: Date;
  expiresBefore?: Date;
  search?: string;            // Text search in question/title
  limit?: number;
  offset?: number;
  sortBy?: 'volume' | 'expiration' | 'created' | 'liquidity';
  sortOrder?: 'asc' | 'desc';
}

// ============================================================================
// Connection Types
// ============================================================================

export interface ConnectionStatus {
  connected: boolean;
  lastConnectedAt?: Date;
  lastError?: string;
  consecutiveFailures: number;
}

// ============================================================================
// TradingPlatform Interface
// ============================================================================

/**
 * Abstract interface for all trading platforms.
 * Each platform (Polymarket, Kalshi, PredictIt) implements this interface.
 */
export interface TradingPlatform {
  // Platform identity
  readonly name: PlatformName;
  readonly displayName: string;
  readonly supportsMarketTypes: MarketType[];

  // =========================================================================
  // Connection Lifecycle
  // =========================================================================

  /**
   * Initialize and connect to the platform
   * @throws Error if connection fails
   */
  connect(): Promise<void>;

  /**
   * Disconnect from the platform
   */
  disconnect(): Promise<void>;

  /**
   * Check if currently connected
   */
  isConnected(): boolean;

  /**
   * Get detailed connection status
   */
  getConnectionStatus(): ConnectionStatus;

  // =========================================================================
  // Market Discovery
  // =========================================================================

  /**
   * Discover markets matching filters
   * Returns normalized MarketDefinition objects
   */
  discoverMarkets(filters?: MarketFilters): Promise<MarketDefinition[]>;

  /**
   * Get a specific market by ID
   * @param id Internal market ID or platform market ID
   */
  getMarket(id: string): Promise<MarketDefinition | null>;

  /**
   * Get markets by platform-specific IDs
   */
  getMarketsByPlatformIds(platformIds: string[]): Promise<MarketDefinition[]>;

  // =========================================================================
  // Trading Operations
  // =========================================================================

  /**
   * Place an order
   * @returns OrderResult with success status and order details
   */
  placeOrder(params: OrderParams): Promise<OrderResult>;

  /**
   * Cancel a specific order
   */
  cancelOrder(orderId: string): Promise<void>;

  /**
   * Cancel all open orders, optionally for a specific market
   */
  cancelAllOrders(marketId?: string): Promise<void>;

  // =========================================================================
  // Portfolio Management
  // =========================================================================

  /**
   * Get all open orders
   */
  getOrders(marketId?: string): Promise<Order[]>;

  /**
   * Get all positions
   */
  getPositions(): Promise<Position[]>;

  /**
   * Get account balance
   */
  getBalance(): Promise<Balance>;

  // =========================================================================
  // Market Data
  // =========================================================================

  /**
   * Subscribe to orderbook updates for a market/outcome
   * @returns Unsubscribe function
   */
  subscribeOrderbook(
    marketId: string,
    outcomeId: string,
    callback: OrderbookCallback
  ): Unsubscribe;

  /**
   * Get current orderbook snapshot
   */
  getOrderbook(marketId: string, outcomeId: string): Promise<OrderbookSnapshot>;

  /**
   * Get recent trades for a market
   */
  getRecentTrades(marketId: string, limit?: number): Promise<{
    id: string;
    price: number;
    size: number;
    side: OrderSide;
    timestamp: Date;
  }[]>;
}

// ============================================================================
// Abstract Base Class (Optional Helper)
// ============================================================================

/**
 * Optional abstract base class providing common functionality.
 * Platforms can extend this or implement TradingPlatform directly.
 */
export abstract class BaseTradingPlatform implements TradingPlatform {
  abstract readonly name: PlatformName;
  abstract readonly displayName: string;
  abstract readonly supportsMarketTypes: MarketType[];

  protected _connected: boolean = false;
  protected _lastConnectedAt?: Date;
  protected _lastError?: string;
  protected _consecutiveFailures: number = 0;

  isConnected(): boolean {
    return this._connected;
  }

  getConnectionStatus(): ConnectionStatus {
    return {
      connected: this._connected,
      lastConnectedAt: this._lastConnectedAt,
      lastError: this._lastError,
      consecutiveFailures: this._consecutiveFailures,
    };
  }

  protected markConnected(): void {
    this._connected = true;
    this._lastConnectedAt = new Date();
    this._lastError = undefined;
    this._consecutiveFailures = 0;
  }

  protected markDisconnected(error?: string): void {
    this._connected = false;
    if (error) {
      this._lastError = error;
      this._consecutiveFailures++;
    }
  }

  // Abstract methods to be implemented by platforms
  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract discoverMarkets(filters?: MarketFilters): Promise<MarketDefinition[]>;
  abstract getMarket(id: string): Promise<MarketDefinition | null>;
  abstract getMarketsByPlatformIds(platformIds: string[]): Promise<MarketDefinition[]>;
  abstract placeOrder(params: OrderParams): Promise<OrderResult>;
  abstract cancelOrder(orderId: string): Promise<void>;
  abstract cancelAllOrders(marketId?: string): Promise<void>;
  abstract getOrders(marketId?: string): Promise<Order[]>;
  abstract getPositions(): Promise<Position[]>;
  abstract getBalance(): Promise<Balance>;
  abstract subscribeOrderbook(
    marketId: string,
    outcomeId: string,
    callback: OrderbookCallback
  ): Unsubscribe;
  abstract getOrderbook(marketId: string, outcomeId: string): Promise<OrderbookSnapshot>;
  abstract getRecentTrades(marketId: string, limit?: number): Promise<{
    id: string;
    price: number;
    size: number;
    side: OrderSide;
    timestamp: Date;
  }[]>;
}
