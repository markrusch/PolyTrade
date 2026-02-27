/**
 * Trading Service Facade
 *
 * Provides a unified, simplified API for trading operations.
 * - Wraps TradingPlatform with validation and error handling
 * - Integrates circuit breaker for external API resilience
 * - Adds logging and telemetry
 * - Provides standardized response formats for API endpoints
 */

import type {
  TradingPlatform,
  OrderParams,
  OrderResult,
  Order,
  Position,
  Balance,
  OrderSide,
  OrderStatus,
} from '../platforms/TradingPlatform.js';
import { CircuitBreaker, createCircuitBreaker } from '../lib/CircuitBreaker.js';
import { caches } from '../lib/SharedCache.js';

// ============================================================================
// Request/Response Types for API
// ============================================================================

export interface TradeRequest {
  tokenId: string;
  side: OrderSide;
  price: number;
  size: number;
}

export interface TradeResponse {
  success: boolean;
  order?: {
    id: string;
    marketId: string;
    side: OrderSide;
    price: number;
    size: number;
    filledSize: number;
    status: OrderStatus;
    createdAt: string;
  };
  error?: string;
}

export interface CancelResponse {
  success: boolean;
  cancelled: boolean;
  error?: string;
}

export interface OrdersResponse {
  success: boolean;
  orders: Order[];
  count: number;
}

export interface PositionsResponse {
  success: boolean;
  positions: Position[];
  count: number;
}

export interface BalanceResponse {
  success: boolean;
  balance: Balance | null;
  error?: string;
}

export interface TradingServiceStats {
  tradesPlaced: number;
  tradesSuccessful: number;
  tradesFailed: number;
  ordersCancelled: number;
  lastTradeAt: number | null;
  circuitBreakerState: string;
}

// ============================================================================
// Trading Service Implementation
// ============================================================================

export class TradingService {
  private platform: TradingPlatform;
  private circuitBreaker: CircuitBreaker;
  private stats = {
    tradesPlaced: 0,
    tradesSuccessful: 0,
    tradesFailed: 0,
    ordersCancelled: 0,
    lastTradeAt: null as number | null,
  };

  constructor(platform: TradingPlatform) {
    this.platform = platform;
    this.circuitBreaker = createCircuitBreaker('trading-service', {
      failureThreshold: 3,
      resetTimeoutMs: 30000,
      successThreshold: 2,
    });
  }

  /**
   * Place a trade (simplified interface for API)
   */
  async trade(request: TradeRequest): Promise<TradeResponse> {
    // Validate request
    const validation = this.validateTradeRequest(request);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error,
      };
    }

    this.stats.tradesPlaced++;

    try {
      const result = await this.circuitBreaker.execute(async () => {
        const orderParams: OrderParams = {
          marketId: request.tokenId, // tokenId maps to marketId
          outcomeId: request.tokenId, // For binary markets, outcomeId = tokenId
          side: request.side,
          price: request.price,
          size: request.size,
          orderType: 'GTC',
        };

        return this.platform.placeOrder(orderParams);
      });

      if (result.success && result.order) {
        this.stats.tradesSuccessful++;
        this.stats.lastTradeAt = Date.now();

        // Invalidate related caches
        caches.polymarket.invalidateNamespace();

        return {
          success: true,
          order: {
            id: result.order.id,
            marketId: result.order.marketId,
            side: result.order.side,
            price: result.order.price,
            size: result.order.size,
            filledSize: result.order.filledSize,
            status: result.order.status,
            createdAt: result.order.createdAt.toISOString(),
          },
        };
      }

      this.stats.tradesFailed++;
      return {
        success: false,
        error: result.errorMessage || 'Order placement failed',
      };
    } catch (error) {
      this.stats.tradesFailed++;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[TradingService] Trade failed:', errorMessage);

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Cancel a specific order
   */
  async cancelTrade(orderId: string): Promise<CancelResponse> {
    if (!orderId || typeof orderId !== 'string') {
      return {
        success: false,
        cancelled: false,
        error: 'Invalid order ID',
      };
    }

    try {
      await this.circuitBreaker.execute(async () => {
        await this.platform.cancelOrder(orderId);
      });

      this.stats.ordersCancelled++;
      caches.polymarket.invalidateNamespace();

      return {
        success: true,
        cancelled: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[TradingService] Cancel failed:', errorMessage);

      return {
        success: false,
        cancelled: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Cancel all open orders
   */
  async cancelAllTrades(marketId?: string): Promise<{ success: boolean; count: number; error?: string }> {
    try {
      // Get current orders first to count
      const orders = await this.getOpenOrders(marketId);
      const orderCount = orders.orders.length;

      await this.circuitBreaker.execute(async () => {
        await this.platform.cancelAllOrders(marketId);
      });

      this.stats.ordersCancelled += orderCount;
      caches.polymarket.invalidateNamespace();

      return {
        success: true,
        count: orderCount,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[TradingService] Cancel all failed:', errorMessage);

      return {
        success: false,
        count: 0,
        error: errorMessage,
      };
    }
  }

  /**
   * Get all open orders
   */
  async getOpenOrders(marketId?: string): Promise<OrdersResponse> {
    try {
      const orders = await this.circuitBreaker.execute(async () => {
        return this.platform.getOrders(marketId);
      });

      return {
        success: true,
        orders,
        count: orders.length,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[TradingService] Get orders failed:', errorMessage);

      return {
        success: false,
        orders: [],
        count: 0,
      };
    }
  }

  /**
   * Get all positions
   */
  async getPositions(): Promise<PositionsResponse> {
    try {
      const positions = await this.circuitBreaker.execute(async () => {
        return this.platform.getPositions();
      });

      return {
        success: true,
        positions,
        count: positions.length,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[TradingService] Get positions failed:', errorMessage);

      return {
        success: false,
        positions: [],
        count: 0,
      };
    }
  }

  /**
   * Get account balance
   */
  async getBalance(): Promise<BalanceResponse> {
    try {
      const balance = await this.circuitBreaker.execute(async () => {
        return this.platform.getBalance();
      });

      return {
        success: true,
        balance,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[TradingService] Get balance failed:', errorMessage);

      return {
        success: false,
        balance: null,
        error: errorMessage,
      };
    }
  }

  /**
   * Get service statistics
   */
  getStats(): TradingServiceStats {
    return {
      ...this.stats,
      circuitBreakerState: this.circuitBreaker.getState(),
    };
  }

  /**
   * Check if trading is available (circuit breaker not open)
   */
  isAvailable(): boolean {
    return this.circuitBreaker.canExecute();
  }

  /**
   * Reset circuit breaker (manual recovery)
   */
  resetCircuitBreaker(): void {
    this.circuitBreaker.reset();
  }

  // =========================================================================
  // Private Helpers
  // =========================================================================

  private validateTradeRequest(request: TradeRequest): { valid: boolean; error?: string } {
    if (!request.tokenId || typeof request.tokenId !== 'string') {
      return { valid: false, error: 'Invalid tokenId' };
    }

    if (!['BUY', 'SELL'].includes(request.side)) {
      return { valid: false, error: 'Side must be BUY or SELL' };
    }

    if (typeof request.price !== 'number' || request.price <= 0 || request.price >= 1) {
      return { valid: false, error: 'Price must be between 0 and 1 (exclusive)' };
    }

    if (typeof request.size !== 'number' || request.size <= 0) {
      return { valid: false, error: 'Size must be a positive number' };
    }

    return { valid: true };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

let tradingServiceInstance: TradingService | null = null;

/**
 * Get or create the singleton TradingService instance
 */
export function getTradingService(platform?: TradingPlatform): TradingService {
  if (!tradingServiceInstance && platform) {
    tradingServiceInstance = new TradingService(platform);
  }

  if (!tradingServiceInstance) {
    throw new Error('TradingService not initialized. Call getTradingService(platform) first.');
  }

  return tradingServiceInstance;
}

/**
 * Reset the trading service instance (for testing)
 */
export function resetTradingService(): void {
  tradingServiceInstance = null;
}
