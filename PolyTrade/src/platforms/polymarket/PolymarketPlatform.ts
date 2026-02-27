/**
 * PolymarketPlatform
 *
 * TradingPlatform adapter for Polymarket.
 * Wraps existing ClobClient, OrderManager, and MarketData services.
 *
 * @see REDESIGN_V2.md Section 5.1
 */

import { v4 as uuidv4 } from 'uuid';
import {
  BaseTradingPlatform,
  type Order,
  type OrderParams,
  type OrderResult,
  type OrderSide,
  type OrderbookCallback,
  type OrderbookSnapshot,
  type Position,
  type Balance,
  type MarketFilters,
  type Unsubscribe,
  type PlatformName,
} from '../TradingPlatform.js';
import type {
  MarketDefinition,
  MarketType,
  Outcome,
  PolymarketMetadata,
} from '../../markets/MarketDefinition.js';
import { ClobClientWrapper } from '../../services/polymarket/ClobClient.js';
import { MarketPricingService } from '../../services/polymarket/MarketPricingService.js';
import { Logger } from '../../lib/logger/index.js';

// ============================================================================
// Configuration
// ============================================================================

export interface PolymarketPlatformConfig {
  gammaApiUrl?: string;
}

// ============================================================================
// PolymarketPlatform Implementation
// ============================================================================

export class PolymarketPlatform extends BaseTradingPlatform {
  readonly name: PlatformName = 'polymarket';
  readonly displayName = 'Polymarket';
  readonly supportsMarketTypes: MarketType[] = ['binary_price', 'binary_event'];

  private clobClient: ClobClientWrapper;
  private pricingService: MarketPricingService;
  private logger: Logger;
  private marketCache: Map<string, MarketDefinition> = new Map();
  private orderbookSubscriptions: Map<string, Set<OrderbookCallback>> = new Map();

  constructor(config: PolymarketPlatformConfig = {}) {
    super();
    this.clobClient = new ClobClientWrapper();
    this.pricingService = new MarketPricingService(config.gammaApiUrl);
    this.logger = new Logger({ level: 'info', service: 'PolymarketPlatform' });
  }

  // =========================================================================
  // Connection Lifecycle
  // =========================================================================

  async connect(): Promise<void> {
    try {
      this.logger.info('Connecting to Polymarket...');
      await this.clobClient.initialize();
      this.markConnected();
      this.logger.info('Connected to Polymarket');
    } catch (error) {
      this.markDisconnected(error instanceof Error ? error.message : 'Connection failed');
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.markDisconnected();
    this.orderbookSubscriptions.clear();
    this.marketCache.clear();
    this.logger.info('Disconnected from Polymarket');
  }

  // =========================================================================
  // Market Discovery
  // =========================================================================

  async discoverMarkets(filters?: MarketFilters): Promise<MarketDefinition[]> {
    try {
      const limit = filters?.limit ?? 20;
      const rawMarkets = await this.pricingService.getTopMarkets(limit);

      const markets: MarketDefinition[] = [];

      for (const raw of rawMarkets) {
        try {
          const market = await this.transformToMarketDefinition(raw);
          if (market && this.matchesFilters(market, filters)) {
            markets.push(market);
            this.marketCache.set(market.id, market);
            this.marketCache.set(market.platformMarketId, market);
          }
        } catch (err) {
          this.logger.warn(`Failed to transform market: ${err}`);
        }
      }

      return markets;
    } catch (error) {
      this.logger.error('Failed to discover markets', { error });
      throw error;
    }
  }

  async getMarket(id: string): Promise<MarketDefinition | null> {
    // Check cache first
    const cached = this.marketCache.get(id);
    if (cached) return cached;

    // Try to fetch by slug
    try {
      const metadata = await this.pricingService.fetchMarketMetadata(id);
      const market = this.createMarketFromMetadata(metadata, id);
      this.marketCache.set(market.id, market);
      this.marketCache.set(market.platformMarketId, market);
      return market;
    } catch (error) {
      this.logger.warn(`Market not found: ${id}`);
      return null;
    }
  }

  async getMarketsByPlatformIds(platformIds: string[]): Promise<MarketDefinition[]> {
    const markets: MarketDefinition[] = [];
    for (const id of platformIds) {
      const market = await this.getMarket(id);
      if (market) markets.push(market);
    }
    return markets;
  }

  // =========================================================================
  // Trading Operations
  // =========================================================================

  async placeOrder(params: OrderParams): Promise<OrderResult> {
    try {
      // Find the token ID for this outcome
      const market = await this.getMarket(params.marketId);
      if (!market) {
        return {
          success: false,
          errorCode: 'MARKET_NOT_FOUND',
          errorMessage: `Market ${params.marketId} not found`,
        };
      }

      const outcome = market.outcomes.find(o => o.id === params.outcomeId);
      if (!outcome?.platformTokenId) {
        return {
          success: false,
          errorCode: 'OUTCOME_NOT_FOUND',
          errorMessage: `Outcome ${params.outcomeId} not found or missing token ID`,
        };
      }

      // Map orderType - Polymarket doesn't support MARKET orders directly
      // MARKET orders should use FOK (Fill or Kill) for immediate execution
      const clobOrderType = params.orderType === 'MARKET' ? 'FOK' : (params.orderType ?? 'GTC');

      // Place order via CLOB client
      const response = await this.clobClient.placeOrder({
        tokenID: outcome.platformTokenId,
        side: params.side,
        price: params.price,
        size: params.size,
        orderType: clobOrderType as 'GTC' | 'GTD' | 'FOK' | 'FAK',
        expiration: params.expiration,
        negRisk: market.metadata.polymarket?.negRisk ?? false,
      });

      const order: Order = {
        id: response.orderID || uuidv4(),
        platformOrderId: response.orderID || '',
        marketId: params.marketId,
        outcomeId: params.outcomeId,
        side: params.side,
        price: params.price,
        size: params.size,
        filledSize: 0,
        status: 'OPEN',
        orderType: params.orderType ?? 'GTC',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      return { success: true, order };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Order failed';
      this.logger.error('Failed to place order', { error, params });
      return {
        success: false,
        errorCode: 'ORDER_FAILED',
        errorMessage: message,
      };
    }
  }

  async cancelOrder(orderId: string): Promise<void> {
    try {
      await this.clobClient.cancelOrders([orderId]);
    } catch (error) {
      this.logger.error('Failed to cancel order', { error, orderId });
      throw error;
    }
  }

  async cancelAllOrders(marketId?: string): Promise<void> {
    try {
      const client = this.clobClient.getClient();
      if (marketId) {
        const market = await this.getMarket(marketId);
        if (market?.metadata.polymarket?.conditionId) {
          // Cancel orders for specific market
          const orders = await this.getOrders(marketId);
          const orderIds = orders.map(o => o.platformOrderId);
          if (orderIds.length > 0) {
            await this.clobClient.cancelOrders(orderIds);
          }
        }
      } else {
        await client.cancelAll();
      }
    } catch (error) {
      this.logger.error('Failed to cancel all orders', { error, marketId });
      throw error;
    }
  }

  // =========================================================================
  // Portfolio Management
  // =========================================================================

  async getOrders(marketId?: string): Promise<Order[]> {
    try {
      const rawOrders = await this.clobClient.getOpenOrders();
      const orders: Order[] = [];

      for (const raw of rawOrders as any[]) {
        const order: Order = {
          id: raw.id || raw.order_id,
          platformOrderId: raw.id || raw.order_id,
          marketId: raw.asset_id || raw.market || '',
          outcomeId: raw.token_id || '',
          side: (raw.side?.toUpperCase() === 'BUY' ? 'BUY' : 'SELL') as OrderSide,
          price: Number(raw.price || 0),
          size: Number(raw.original_size || raw.size || 0),
          filledSize: Number(raw.size_matched || 0),
          status: this.mapOrderStatus(raw.status),
          orderType: 'GTC',
          createdAt: new Date(raw.created_at || Date.now()),
          updatedAt: new Date(raw.updated_at || Date.now()),
        };

        if (!marketId || order.marketId === marketId) {
          orders.push(order);
        }
      }

      return orders;
    } catch (error) {
      this.logger.error('Failed to get orders', { error });
      throw error;
    }
  }

  async getPositions(): Promise<Position[]> {
    // This would need to integrate with PositionTracker
    // For now, return empty array - to be implemented
    this.logger.warn('getPositions not fully implemented - returning empty');
    return [];
  }

  async getBalance(): Promise<Balance> {
    // Polymarket uses USDC - need to integrate with wallet
    this.logger.warn('getBalance not fully implemented - returning mock');
    return {
      total: 0,
      available: 0,
      locked: 0,
      currency: 'USDC',
      updatedAt: new Date(),
    };
  }

  // =========================================================================
  // Market Data
  // =========================================================================

  subscribeOrderbook(
    marketId: string,
    outcomeId: string,
    callback: OrderbookCallback
  ): Unsubscribe {
    const key = `${marketId}:${outcomeId}`;

    if (!this.orderbookSubscriptions.has(key)) {
      this.orderbookSubscriptions.set(key, new Set());
    }
    this.orderbookSubscriptions.get(key)!.add(callback);

    // Start polling for orderbook updates
    // In a real implementation, this would use WebSocket
    const intervalId = setInterval(async () => {
      try {
        const snapshot = await this.getOrderbook(marketId, outcomeId);
        callback(snapshot);
      } catch (err) {
        this.logger.warn(`Orderbook poll failed for ${key}`, { error: err });
      }
    }, 5000);

    return () => {
      clearInterval(intervalId);
      this.orderbookSubscriptions.get(key)?.delete(callback);
    };
  }

  async getOrderbook(marketId: string, outcomeId: string): Promise<OrderbookSnapshot> {
    try {
      const market = await this.getMarket(marketId);
      const outcome = market?.outcomes.find(o => o.id === outcomeId);
      const tokenId = outcome?.platformTokenId;

      if (!tokenId) {
        throw new Error(`Token ID not found for ${marketId}:${outcomeId}`);
      }

      const client = this.clobClient.getClient();
      const ob = await client.getOrderBook(tokenId);

      const bids = ((ob as any).bids || []).map((b: any) => ({
        price: Number(b.price),
        size: Number(b.size),
      }));
      const asks = ((ob as any).asks || []).map((a: any) => ({
        price: Number(a.price),
        size: Number(a.size),
      }));

      const bestBid = bids[0]?.price || 0;
      const bestAsk = asks[0]?.price || 1;

      return {
        marketId,
        outcomeId,
        bids,
        asks,
        timestamp: new Date(),
        spread: bestAsk - bestBid,
        midPrice: (bestBid + bestAsk) / 2,
      };
    } catch (error) {
      this.logger.error('Failed to get orderbook', { error, marketId, outcomeId });
      throw error;
    }
  }

  async getRecentTrades(marketId: string, limit: number = 50): Promise<{
    id: string;
    price: number;
    size: number;
    side: OrderSide;
    timestamp: Date;
  }[]> {
    // Polymarket doesn't have a direct trades endpoint in CLOB client
    // This would need to be implemented via Data API
    this.logger.warn('getRecentTrades not implemented');
    return [];
  }

  // =========================================================================
  // Private Helpers
  // =========================================================================

  private async transformToMarketDefinition(raw: any): Promise<MarketDefinition | null> {
    const slug = raw.slug || raw.question_slug;
    if (!slug) return null;

    try {
      const metadata = await this.pricingService.fetchMarketMetadata(slug);
      return this.createMarketFromMetadata(metadata, slug);
    } catch {
      return null;
    }
  }

  private createMarketFromMetadata(
    metadata: any,
    slug: string
  ): MarketDefinition {
    const id = uuidv4();
    const outcomes: Outcome[] = (metadata.outcomes || ['Yes', 'No']).map(
      (name: string, idx: number) => ({
        id: `${id}-outcome-${idx}`,
        name,
        platformTokenId: metadata.clobTokenIds?.[idx],
      })
    );

    // Determine market type based on metadata
    const marketType: MarketType = metadata.strike > 0 ? 'binary_price' : 'binary_event';

    const polymarketMeta: PolymarketMetadata = {
      conditionId: metadata.conditionId || '',
      clobTokenIds: metadata.clobTokenIds || [],
      negRisk: false,
      slug,
    };

    const market: MarketDefinition = {
      id,
      platformMarketId: slug,
      platform: 'polymarket',
      type: marketType,
      question: metadata.title || slug,
      outcomes,
      expiresAt: new Date(metadata.endDate),
      active: true,
      resolved: false,
      metadata: {
        polymarket: polymarketMeta,
      },
      tickSize: 0.01,
      minOrderSize: 1,
    };

    // Add price market metadata if applicable
    if (marketType === 'binary_price' && metadata.strike > 0) {
      // Infer underlying from slug (e.g., "eth-above-4000...")
      const underlyingMatch = slug.match(/^(eth|btc|sol|xrp)/i);
      const underlying = underlyingMatch ? underlyingMatch[1].toUpperCase() : 'UNKNOWN';

      market.metadata.priceMarket = {
        underlying,
        strike: metadata.strike,
        direction: 'above',
      };
    }

    return market;
  }

  private matchesFilters(market: MarketDefinition, filters?: MarketFilters): boolean {
    if (!filters) return true;

    if (filters.active !== undefined && market.active !== filters.active) {
      return false;
    }
    if (filters.resolved !== undefined && market.resolved !== filters.resolved) {
      return false;
    }
    if (filters.marketType && market.type !== filters.marketType) {
      return false;
    }
    if (filters.expiresAfter && market.expiresAt < filters.expiresAfter) {
      return false;
    }
    if (filters.expiresBefore && market.expiresAt > filters.expiresBefore) {
      return false;
    }
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      if (!market.question.toLowerCase().includes(searchLower)) {
        return false;
      }
    }

    return true;
  }

  private mapOrderStatus(status: string): Order['status'] {
    const upper = (status || '').toUpperCase();
    switch (upper) {
      case 'OPEN':
      case 'LIVE':
        return 'OPEN';
      case 'FILLED':
      case 'MATCHED':
        return 'FILLED';
      case 'CANCELLED':
      case 'CANCELED':
        return 'CANCELLED';
      case 'EXPIRED':
        return 'EXPIRED';
      case 'PENDING':
        return 'PENDING';
      default:
        return 'PENDING';
    }
  }
}
