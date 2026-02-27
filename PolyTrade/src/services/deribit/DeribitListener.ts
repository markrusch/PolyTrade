/**
 * Deribit Listener
 * Polling-based listener for Deribit options data (IV, strikes, expiries)
 */

import { BaseListener } from '../../lib/comm/index.js';
import { Logger } from '../../lib/logger/index.js';
import { DeribitConfig } from '../../lib/config/schema.js';
import { DeribitSnapshot } from '../../lib/types/index.js';
import { DeribitRequestor, DeribitInstrument, DeribitTicker } from './DeribitRequestor.js';
import { CacheManager } from '../../lib/cache/CacheManager.js';

export interface DeribitEvent {
  type: 'snapshot:updated' | 'error:connection' | 'expiry:changed';
  timestamp: number;
  data: DeribitSnapshot | Error | { expiry: Date };
}

export type IVSource = 'dvol' | 'option_mark_iv' | 'fallback';

/**
 * Polling-based listener for Deribit options data
 * Prefers DVOL (Deribit Volatility Index) over individual option mark_iv
 */
export class DeribitListener extends BaseListener<DeribitEvent> {
  private requestor: DeribitRequestor;
  private logger: Logger;
  private config: DeribitConfig;
  private cache: CacheManager<DeribitInstrument[]>;
  private currency: string;
  private targetExpiry: Date | null = null;
  private spotPrice: number = 0;
  private pollingInterval?: NodeJS.Timeout;
  private lastSnapshot: DeribitSnapshot | null = null;

  // Data readiness tracking
  private dataReady = false;
  private initialDataPromise: Promise<void> | null = null;

  // IV source tracking
  private lastIVSource: IVSource = 'fallback';
  private lastDVOL: number | null = null;

  constructor(
    config: DeribitConfig,
    requestor: DeribitRequestor,
    logger: Logger,
    currency: string = 'ETH'
  ) {
    super();
    this.config = config;
    this.requestor = requestor;
    this.logger = logger.child('DeribitListener');
    this.currency = currency;
    this.cache = new CacheManager<DeribitInstrument[]>({ 
      defaultTtl: 300000 // 5 minutes for instruments list
    });
  }

  /**
   * Start polling for IV snapshots
   */
  async start(config: { spotPrice: number; targetExpiry?: Date }): Promise<void> {
    if (this.connected) {
      this.logger.warn('Listener already started');
      return;
    }

    this.spotPrice = config.spotPrice;
    this.targetExpiry = config.targetExpiry || null;

    this.logger.info(`Starting Deribit listener for ${this.currency}`, {
      interval: this.config.interval,
      spotPrice: this.spotPrice,
      targetExpiry: this.targetExpiry?.toISOString(),
    });

    this.connected = true;

    // Initial fetch
    await this.pollSnapshot();

    // Start polling
    this.pollingInterval = setInterval(async () => {
      await this.pollSnapshot();
    }, this.config.interval);
    
    // Don't block process exit
    if (this.pollingInterval.unref) {
      this.pollingInterval.unref();
    }
  }

  /**
   * Wait for initial data to be available
   */
  async waitForData(timeout = 15000): Promise<boolean> {
    if (this.dataReady) return Promise.resolve(true);

    if (!this.initialDataPromise) {
      this.initialDataPromise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('Timeout waiting for Deribit IV data'));
        }, timeout);

        const checkData = () => {
          if (this.lastSnapshot !== null) {
            clearTimeout(timer);
            this.dataReady = true;
            resolve();
          }
        };

        // Poll will update lastSnapshot
        const interval = setInterval(checkData, 100);

        setTimeout(() => {
          clearInterval(interval);
          if (!this.dataReady) {
            reject(new Error('No Deribit data after timeout'));
          }
        }, timeout);
      });
    }

    return this.initialDataPromise
      .then(() => true)
      .catch(() => false);
  }

  /**
   * Poll for current IV snapshot
   * Prefers DVOL (30-day implied volatility index) over individual option mark_iv
   */
  private async pollSnapshot(): Promise<void> {
    try {
      // First, try to get DVOL (preferred source - market-wide 30-day IV like VIX)
      const dvolResult = await this.requestor.getDVOL(this.currency);

      let iv: number;
      let ivSource: IVSource;
      let instrumentName: string;

      if (dvolResult && dvolResult.iv > 0 && dvolResult.iv < 5) {
        // DVOL is valid (between 0% and 500% - sanity check)
        iv = dvolResult.iv;
        ivSource = 'dvol';
        instrumentName = dvolResult.indexName;
        this.lastDVOL = iv;

        this.logger.info(`Using DVOL for ${this.currency}: ${(iv * 100).toFixed(2)}%`, {
          source: 'dvol',
          indexName: dvolResult.indexName,
        });
      } else {
        // Fallback to individual option mark_iv
        this.logger.warn(`DVOL unavailable for ${this.currency}, falling back to option mark_iv`);

        // Get instruments (from cache or API)
        const instruments = await this.getInstruments();

        if (instruments.length === 0) {
          throw new Error(`No ${this.currency} options found`);
        }

        // Find appropriate instrument
        let chosenInstrument: DeribitInstrument | null;

        if (this.targetExpiry) {
          chosenInstrument = this.requestor.findInstrumentByExpiry(
            instruments,
            this.targetExpiry,
            this.spotPrice
          );
        } else {
          // Default: find ATM with soonest expiry > 7 days
          const weekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
          chosenInstrument = this.requestor.findInstrumentByExpiry(
            instruments,
            weekFromNow,
            this.spotPrice
          );
        }

        if (!chosenInstrument) {
          throw new Error('No suitable instrument found');
        }

        // Get ticker data
        const ticker = await this.requestor.getTicker(chosenInstrument.instrument_name);

        // Validate data
        if (!ticker.mark_iv || ticker.mark_iv <= 0) {
          throw new Error(`Invalid mark_iv: ${ticker.mark_iv}`);
        }

        // Normalize IV (if in percentage form)
        iv = ticker.mark_iv;
        if (iv > 10) {
          iv = iv / 100;
        }

        ivSource = 'option_mark_iv';
        instrumentName = chosenInstrument.instrument_name;

        this.logger.debug(`Using option mark_iv for ${this.currency}: ${(iv * 100).toFixed(2)}%`, {
          source: 'option_mark_iv',
          instrument: instrumentName,
        });
      }

      // Get underlying price (for snapshot)
      let underlyingPrice = this.spotPrice;
      try {
        const indexName = `${this.currency.toLowerCase()}_usd`;
        underlyingPrice = await this.requestor.getIndexPrice(indexName);
      } catch {
        // Use cached spot price
        this.logger.debug('Using cached spot price for underlying');
      }

      this.lastIVSource = ivSource;

      // Create snapshot
      const snapshot: DeribitSnapshot = {
        instrumentName,
        underlyingPrice,
        markIv: iv,
        timestamp: Date.now(),
        instrument: {
          strike: 0, // Not applicable for DVOL
          expiration_timestamp: 0, // DVOL is 30-day forward-looking
          option_type: 'call', // Not applicable
          currency: this.currency,
        },
      };

      this.lastSnapshot = snapshot;

      // Mark data as ready after first snapshot
      if (this.lastSnapshot && !this.dataReady) {
        this.dataReady = true;
      }

      this.logger.debug(`Snapshot updated: ${instrumentName}`, {
        iv: (iv * 100).toFixed(2) + '%',
        source: ivSource,
        underlyingPrice: underlyingPrice.toFixed(2),
      });

      // Emit event
      const event: DeribitEvent = {
        type: 'snapshot:updated',
        timestamp: snapshot.timestamp,
        data: snapshot,
      };

      this.emit(event);

    } catch (error) {
      this.logger.error('Failed to poll snapshot', error as Error);

      // Use cached snapshot if available
      if (this.lastSnapshot) {
        const age = Date.now() - this.lastSnapshot.timestamp;
        this.logger.warn(`Using cached snapshot (age: ${Math.floor(age / 1000)}s)`);
      }

      // Emit error event
      const errorEvent: DeribitEvent = {
        type: 'error:connection',
        timestamp: Date.now(),
        data: error instanceof Error ? error : new Error(String(error)),
      };

      this.emit(errorEvent);
    }
  }

  /**
   * Get instruments with caching
   */
  private async getInstruments(): Promise<DeribitInstrument[]> {
    const cacheKey = `instruments:${this.currency}`;
    
    return await this.cache.getOrSet(
      cacheKey,
      async () => {
        this.logger.debug(`Fetching instruments list for ${this.currency}`);
        return await this.requestor.getInstruments(this.currency, 'option');
      },
      300000 // 5 minutes TTL
    );
  }

  /**
   * Update spot price (triggers re-calculation)
   */
  updateSpotPrice(spotPrice: number): void {
    if (spotPrice !== this.spotPrice) {
      this.logger.debug(`Spot price updated: ${this.spotPrice} → ${spotPrice}`);
      this.spotPrice = spotPrice;
      // Will use new spot price on next poll
    }
  }

  /**
   * Set target expiry
   */
  async setTargetExpiry(expiry: Date): Promise<void> {
    this.logger.info(`Target expiry changed: ${expiry.toISOString()}`);
    this.targetExpiry = expiry;
    
    // Clear instruments cache to force refresh
    this.cache.clear();
    
    // Trigger immediate re-fetch
    await this.pollSnapshot();

    // Emit event
    const event: DeribitEvent = {
      type: 'expiry:changed',
      timestamp: Date.now(),
      data: { expiry },
    };
    this.emit(event);
  }

  /**
   * Get available expiry dates
   */
  async getAvailableExpiries(): Promise<Date[]> {
    return await this.requestor.getAvailableExpiries(this.currency);
  }

  /**
   * Get last known snapshot
   */
  getLastSnapshot(): DeribitSnapshot | null {
    return this.lastSnapshot;
  }

  /**
   * Get timestamp of last IV update
   * @returns Timestamp in milliseconds, or 0 if no data
   */
  getLastUpdateTimestamp(): number {
    return this.lastSnapshot?.timestamp ?? 0;
  }

  /**
   * Get the source of the current IV data
   * @returns 'dvol' | 'option_mark_iv' | 'fallback'
   */
  getIVSource(): IVSource {
    return this.lastIVSource;
  }

  /**
   * Get the last DVOL value (if available)
   * @returns IV as decimal or null if DVOL unavailable
   */
  getLastDVOL(): number | null {
    return this.lastDVOL;
  }

  /**
   * Check if data is ready
   */
  isDataReady(): boolean {
    return this.dataReady;
  }

  /**
   * Get health status for monitoring
   */
  getHealthStatus(): {
    connected: boolean;
    isDataFresh: boolean;
    lastUpdate: number | null;
    ivSource: IVSource;
    currentIV: number | null;
  } {
    const timestamp = this.lastSnapshot?.timestamp ?? null;
    const isDataFresh = timestamp ? Date.now() - timestamp < 120000 : false; // 2 minutes

    return {
      connected: this.connected,
      isDataFresh,
      lastUpdate: timestamp,
      ivSource: this.lastIVSource,
      currentIV: this.lastSnapshot?.markIv ?? null,
    };
  }

  /**
   * Disconnect and stop polling
   */
  async disconnect(): Promise<void> {
    if (!this.connected) {
      return;
    }

    this.logger.info('Disconnecting Deribit listener');

    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = undefined;
    }

    this.connected = false;
    this.handlers.clear();
    this.cache.destroy();
  }

  /**
   * Manually refresh snapshot (useful for testing)
   */
  async refresh(): Promise<void> {
    await this.pollSnapshot();
  }
}
