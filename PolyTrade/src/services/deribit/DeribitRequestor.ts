/**
 * Deribit Requestor
 * JSON-RPC client for Deribit public API
 */

import axios, { AxiosInstance } from 'axios';
import { BaseRequestor } from '../../lib/comm/index.js';
import { Logger } from '../../lib/logger/index.js';
import { RetryHandler } from '../../lib/retry/RetryHandler.js';
import { DeribitConfig } from '../../lib/config/schema.js';
import { JsonRpcRequest, JsonRpcResponse } from '../../lib/types/index.js';

export interface DeribitInstrument {
  instrument_name: string;
  kind: string;
  strike: number;
  expiration_timestamp: number;
  option_type: 'call' | 'put';
  currency: string;
  is_active: boolean;
}

export interface DeribitTicker {
  instrument_name: string;
  mark_iv: number; // Implied volatility
  underlying_price: number;
  underlying_index: string;
  mark_price: number;
  last_price: number;
  greeks?: {
    delta: number;
    gamma: number;
    vega: number;
    theta: number;
    rho: number;
  };
}

/**
 * Deribit JSON-RPC requestor
 * Uses a request queue to prevent rate limit violations
 */
export class DeribitRequestor extends BaseRequestor<JsonRpcRequest, JsonRpcResponse> {
  private client: AxiosInstance;
  private logger: Logger;
  private retryHandler: RetryHandler;
  private requestId: number = 1;

  // Rate limiting with proper queue to prevent concurrent request bursts
  private requestQueue: Array<() => void> = [];
  private processingQueue = false;
  private requestTimestamps: number[] = [];
  private readonly RATE_LIMIT_WINDOW = 1000; // 1 second
  private readonly MAX_REQUESTS_PER_SECOND = 10; // Very conservative (Deribit allows 20/sec)
  private readonly MIN_REQUEST_SPACING = 100; // Minimum 100ms between requests

  constructor(config: DeribitConfig, logger: Logger, retryHandler: RetryHandler) {
    super();
    this.logger = logger.child('DeribitRequestor');
    this.retryHandler = retryHandler;

    this.client = axios.create({
      baseURL: config.baseUrl,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'PolyTrade/1.0.0',
      },
      validateStatus: () => true, // Accept all status codes, handle errors manually
    });
  }

  /**
   * Wait for rate limit slot using a queue-based approach
   * This prevents concurrent requests from bypassing the rate limiter
   */
  private async waitForRateLimit(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.requestQueue.push(resolve);
      this.processQueue();
    });
  }

  /**
   * Process the request queue with proper rate limiting
   */
  private async processQueue(): Promise<void> {
    if (this.processingQueue) return;
    this.processingQueue = true;

    while (this.requestQueue.length > 0) {
      const now = Date.now();

      // Clean old timestamps (older than 1 second)
      this.requestTimestamps = this.requestTimestamps.filter(
        (ts) => now - ts < this.RATE_LIMIT_WINDOW
      );

      // Check if we can make a request
      if (this.requestTimestamps.length >= this.MAX_REQUESTS_PER_SECOND) {
        // Wait until oldest timestamp expires
        const oldestTs = this.requestTimestamps[0];
        const waitTime = this.RATE_LIMIT_WINDOW - (now - oldestTs) + 10; // +10ms buffer
        this.logger.debug(`Rate limit: waiting ${waitTime}ms`, {
          queuedRequests: this.requestTimestamps.length,
          maxRequests: this.MAX_REQUESTS_PER_SECOND,
        });
        await new Promise((r) => setTimeout(r, waitTime));
        continue;
      }

      // Also enforce minimum spacing between requests
      const lastTs = this.requestTimestamps[this.requestTimestamps.length - 1];
      if (lastTs && now - lastTs < this.MIN_REQUEST_SPACING) {
        const spacing = this.MIN_REQUEST_SPACING - (now - lastTs);
        await new Promise((r) => setTimeout(r, spacing));
        continue;
      }

      // Allow request
      this.requestTimestamps.push(Date.now());
      const next = this.requestQueue.shift();
      if (next) next();
    }

    this.processingQueue = false;
  }

  /**
   * Send JSON-RPC request to Deribit API
   */
  async send(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    // Wait for rate limit slot before proceeding
    await this.waitForRateLimit();

    return this.retryHandler.execute(async () => {
      const id = this.requestId++;
      const payload: JsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method: request.method,
        params: request.params || {},
      };

      this.logger.debug(`Sending JSON-RPC request: ${request.method}`, {
        id,
        params: request.params,
        queuedRequests: this.requestTimestamps.length,
      });

      // Deribit uses REST-style URLs for JSON-RPC: /api/v2/public/{method}
      const response = await this.client.post(`/api/v2/${request.method}`, payload);

      if (response.data.error) {
        this.logger.error('Deribit API error', new Error(JSON.stringify(response.data.error, null, 2)));
        throw new Error(`Deribit API error: ${response.data.error.message} (code: ${response.data.error.code})`);
      }

      this.logger.debug(`Received JSON-RPC response: ${request.method}`, {
        id,
        activeRequests: this.requestTimestamps.length,
      });

      return {
        jsonrpc: '2.0',
        id,
        result: response.data.result,
      };
    }, `Deribit:${request.method}`);
  }

  /**
   * Get list of instruments (options)
   */
  async getInstruments(currency: string = 'ETH', kind: string = 'option'): Promise<DeribitInstrument[]> {
    const response = await this.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'public/get_instruments',
      params: {
        currency,
        kind,
        expired: false,
      },
    });

    return response.result as DeribitInstrument[];
  }

  /**
   * Get ticker data for an instrument
   */
  async getTicker(instrumentName: string): Promise<DeribitTicker> {
    const response = await this.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'public/ticker',
      params: {
        instrument_name: instrumentName,
      },
    });

    return response.result as DeribitTicker;
  }

  /**
   * Get index price (spot price)
   */
  async getIndexPrice(indexName: string = 'eth_usd'): Promise<number> {
    const response = await this.send({
      jsonrpc: '2.0',
      id: 1,
      method: 'public/get_index_price',
      params: {
        index_name: indexName,
      },
    });

    return (response.result as any).index_price;
  }

  /**
   * Get DVOL (Deribit Volatility Index) - 30-day forward implied volatility
   * This is similar to VIX and provides market-wide IV rather than individual option IV
   * Uses public/get_volatility_index_data endpoint with 1-hour resolution to get latest value
   *
   * @param currency 'BTC' or 'ETH' (only these two are supported by Deribit DVOL)
   * @returns IV as decimal (e.g., 0.65 for 65%)
   */
  async getDVOL(currency: string = 'ETH'): Promise<{ iv: number; indexName: string } | null> {
    // DVOL is only available for BTC and ETH
    const upperCurrency = currency.toUpperCase();
    if (upperCurrency !== 'BTC' && upperCurrency !== 'ETH') {
      this.logger.debug(`DVOL not available for ${currency}, only BTC and ETH supported`);
      return null;
    }

    try {
      // Get the last hour of DVOL data to find current value
      const now = Date.now();
      const oneHourAgo = now - 60 * 60 * 1000;

      const response = await this.send({
        jsonrpc: '2.0',
        id: 1,
        method: 'public/get_volatility_index_data',
        params: {
          currency: upperCurrency,
          start_timestamp: oneHourAgo,
          end_timestamp: now,
          resolution: '60', // 1-minute candles to get recent data
        },
      });

      const result = response.result as {
        data: Array<[number, number, number, number, number]>; // [timestamp, open, high, low, close]
        continuation?: string | null;
      };

      if (!result || !result.data || result.data.length === 0) {
        this.logger.warn(`No DVOL data available for ${currency}`, { result });
        return null;
      }

      // Get the most recent candle's close value (last element, index 4 is close)
      const latestCandle = result.data[result.data.length - 1];
      const dvolValue = latestCandle[4]; // close price of the candle

      if (typeof dvolValue !== 'number' || dvolValue <= 0) {
        this.logger.warn(`Invalid DVOL value for ${currency}`, { dvolValue });
        return null;
      }

      // DVOL is returned as percentage (e.g., 65.5 for 65.5%)
      // Convert to decimal for consistency with mark_iv
      const iv = dvolValue / 100;

      this.logger.debug(`DVOL for ${currency}: ${dvolValue.toFixed(2)}% (${iv.toFixed(4)})`, {
        currency: upperCurrency,
        rawValue: dvolValue,
        normalizedIv: iv,
        candleTimestamp: new Date(latestCandle[0]).toISOString(),
      });

      return { iv, indexName: `${upperCurrency}_DVOL` };
    } catch (error) {
      this.logger.warn(`Failed to fetch DVOL for ${currency}`, { error: (error as Error).message });
      return null;
    }
  }

  /**
   * Find ATM (At-The-Money) instrument
   */
  findAtmInstrument(instruments: DeribitInstrument[], spotPrice: number): DeribitInstrument | null {
    if (instruments.length === 0 || spotPrice <= 0) {
      return null;
    }

    return instruments.reduce((best, inst) => {
      const strike = inst.strike;
      const bestStrike = best.strike;
      return Math.abs(strike - spotPrice) < Math.abs(bestStrike - spotPrice) ? inst : best;
    });
  }

  /**
   * Find instrument closest to target expiry
   * Falls back to nearest available expiry if target is not available
   */
  findInstrumentByExpiry(
    instruments: DeribitInstrument[],
    targetExpiry: Date,
    spotPrice: number
  ): DeribitInstrument | null {
    if (instruments.length === 0) return null;

    const now = Date.now();
    const minExpiryMs = now + 24 * 60 * 60 * 1000; // At least 1 day from now
    const targetMs = targetExpiry.getTime();

    // Filter to valid instruments (not expired, at least 1 day to expiry)
    const validInstruments = instruments.filter(inst => inst.expiration_timestamp >= minExpiryMs);

    if (validInstruments.length === 0) {
      this.logger.warn('No valid instruments found (all expired or expiring too soon)', {
        availableCount: instruments.length,
      });
      return null;
    }

    // Try to find instruments expiring after target
    let futureInstruments = validInstruments.filter(inst => inst.expiration_timestamp >= targetMs);

    if (futureInstruments.length === 0) {
      // Fallback: use the nearest available expiry (even if before target)
      this.logger.info('No instruments found expiring after target date, using nearest available', {
        targetExpiry: targetExpiry.toISOString(),
        availableCount: validInstruments.length,
      });
      futureInstruments = validInstruments;
    }

    // Find the soonest expiry
    const soonestExpiry = Math.min(...futureInstruments.map(inst => inst.expiration_timestamp));

    // Get all instruments with that expiry
    const sameExpiry = futureInstruments.filter(inst => inst.expiration_timestamp === soonestExpiry);

    this.logger.debug('Selected expiry for IV', {
      expiry: new Date(soonestExpiry).toISOString(),
      instrumentCount: sameExpiry.length,
    });

    // Pick ATM from that expiry
    return this.findAtmInstrument(sameExpiry, spotPrice);
  }

  /**
   * Get available expiry dates for a currency
   */
  async getAvailableExpiries(currency: string = 'ETH'): Promise<Date[]> {
    const instruments = await this.getInstruments(currency, 'option');
    
    const expirySet = new Set<number>();
    instruments.forEach(inst => {
      if (inst.expiration_timestamp) {
        expirySet.add(inst.expiration_timestamp);
      }
    });

    return Array.from(expirySet)
      .sort((a, b) => a - b)
      .map(ts => new Date(ts));
  }
}
