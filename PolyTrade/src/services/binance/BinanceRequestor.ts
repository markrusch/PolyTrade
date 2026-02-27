/**
 * Binance Requestor
 * HTTP client for Binance public API
 */

import axios, { AxiosInstance } from 'axios';
import { BaseRequestor } from '../../lib/comm/index.js';
import { Logger } from '../../lib/logger/index.js';
import { RetryHandler } from '../../lib/retry/RetryHandler.js';
import { BinanceConfig } from '../../lib/config/schema.js';
import { SpotPrice } from '../../lib/types/index.js';

export interface BinanceRequest {
  endpoint: string;
  params?: Record<string, any>;
}

export interface BinanceResponse<T = any> {
  data: T;
  status: number;
}

export interface BinanceTickerPrice {
  symbol: string;
  price: string;
}

/**
 * Binance HTTP requestor
 */
export class BinanceRequestor extends BaseRequestor<BinanceRequest, BinanceResponse> {
  private client: AxiosInstance;
  private logger: Logger;
  private retryHandler: RetryHandler;
  private requestCount: number = 0;
  private windowStart: number = Date.now();
  private readonly RATE_LIMIT_WINDOW = 60000; // 1 minute
  private readonly MAX_REQUESTS_PER_WINDOW = 1000; // Conservative limit (Binance allows 1200)

  constructor(config: BinanceConfig, logger: Logger, retryHandler: RetryHandler) {
    super();
    this.logger = logger.child('BinanceRequestor');
    this.retryHandler = retryHandler;
    
    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: 10000, // 10 seconds to handle network issues
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'PolyTrade/1.0.0',
      },
    });
  }

  /**
   * Check and enforce rate limits
   */
  private async checkRateLimit(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.windowStart;

    // Reset window if 1 minute has passed
    if (elapsed >= this.RATE_LIMIT_WINDOW) {
      this.requestCount = 0;
      this.windowStart = now;
      return;
    }

    // Check if we're at the limit
    if (this.requestCount >= this.MAX_REQUESTS_PER_WINDOW) {
      const waitTime = this.RATE_LIMIT_WINDOW - elapsed;
      this.logger.warn(`Rate limit reached, waiting ${waitTime}ms`, {
        requestCount: this.requestCount,
        maxRequests: this.MAX_REQUESTS_PER_WINDOW,
      });
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.requestCount = 0;
      this.windowStart = Date.now();
    }
  }

  /**
   * Send HTTP request to Binance API
   */
  async send(request: BinanceRequest): Promise<BinanceResponse> {
    // Check rate limits before sending
    await this.checkRateLimit();

    return this.retryHandler.execute(async () => {
      this.logger.debug(`Sending request to ${request.endpoint}`, {
        params: request.params,
        requestCount: this.requestCount + 1,
      });

      const response = await this.client.get(request.endpoint, {
        params: request.params,
      });

      // Increment request counter
      this.requestCount++;

      // Check for rate limit headers
      const usedWeight = response.headers['x-mbx-used-weight-1m'];
      if (usedWeight) {
        this.logger.debug(`Binance API weight used: ${usedWeight}/1200`);
      }

      this.logger.debug(`Received response from ${request.endpoint}`, {
        status: response.status,
        requestCount: this.requestCount,
      });

      return {
        data: response.data,
        status: response.status,
      };
    }, `Binance:${request.endpoint}`);
  }

  /**
   * Fetch spot price for a symbol
   */
  async fetchSpotPrice(symbol: string): Promise<SpotPrice> {
    const response = await this.send({
      endpoint: '/api/v3/ticker/price',
      params: { symbol },
    });

    const data = response.data as BinanceTickerPrice;
    
    return {
      symbol: data.symbol,
      price: parseFloat(data.price),
      timestamp: Date.now(),
    };
  }

  /**
   * Fetch spot prices for multiple symbols
   */
  async fetchSpotPrices(symbols: string[]): Promise<SpotPrice[]> {
    // Binance allows fetching all prices at once
    const response = await this.send({
      endpoint: '/api/v3/ticker/price',
    });

    const allPrices = response.data as BinanceTickerPrice[];
    const symbolSet = new Set(symbols);
    
    return allPrices
      .filter(p => symbolSet.has(p.symbol))
      .map(p => ({
        symbol: p.symbol,
        price: parseFloat(p.price),
        timestamp: Date.now(),
      }));
  }

  /**
   * Fetch 24hr ticker statistics
   */
  async fetch24hrTicker(symbol: string): Promise<any> {
    const response = await this.send({
      endpoint: '/api/v3/ticker/24hr',
      params: { symbol },
    });

    return response.data;
  }
}
