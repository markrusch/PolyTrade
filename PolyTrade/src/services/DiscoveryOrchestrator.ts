/**
 * Discovery Orchestrator
 *
 * Orchestrates batch wiring of all discovered markets for a cryptocurrency.
 * Discovers markets, extracts strikes, and wires them to pricing feeds in parallel.
 */

import pLimit from 'p-limit';
import { Logger } from '../lib/logger/index.js';
import type { MarketFinderService, CryptoTicker, StrikeMarket } from './polymarket/MarketFinderService.js';
import type { MarketPricingWirer, WiredMarket } from './MarketPricingWirer.js';

export interface WireAllResult {
  crypto: CryptoTicker;
  totalDiscovered: number;
  totalWired: number;
  wiredMarkets: WiredMarket[];
  failedMarkets: Array<{ strike: number; error: string }>;
  duration: number;
}

export interface DiscoveryOrchestratorConfig {
  maxConcurrent?: number;      // Max concurrent wire operations (default: 5)
  wireTimeout?: number;         // Timeout per market in ms (default: 30000)
}

export class DiscoveryOrchestrator {
  private logger: Logger;
  private marketFinder: MarketFinderService;
  private pricingWirer: MarketPricingWirer;
  private config: Required<DiscoveryOrchestratorConfig>;

  constructor(
    logger: Logger,
    marketFinder: MarketFinderService,
    pricingWirer: MarketPricingWirer,
    config: DiscoveryOrchestratorConfig = {}
  ) {
    this.logger = logger.child('DiscoveryOrchestrator');
    this.marketFinder = marketFinder;
    this.pricingWirer = pricingWirer;
    this.config = {
      maxConcurrent: config.maxConcurrent ?? 5,
      wireTimeout: config.wireTimeout ?? 30000,
    };
  }

  /**
   * Wire all discovered markets for a cryptocurrency
   */
  async wireAllMarketsForCrypto(
    crypto: CryptoTicker,
    days: number = 30
  ): Promise<WireAllResult> {
    const startTime = Date.now();

    this.logger.info(`Starting batch wiring for ${crypto} (${days} days ahead)`);

    try {
      // 1. Discover all markets
      const discovery = await this.marketFinder.discoverMarkets(crypto, days);

      this.logger.info(`Discovered ${discovery.events.length} events with ${discovery.totalStrikes} strikes for ${crypto}`);

      if (discovery.totalStrikes === 0) {
        return {
          crypto,
          totalDiscovered: 0,
          totalWired: 0,
          wiredMarkets: [],
          failedMarkets: [],
          duration: Date.now() - startTime,
        };
      }

      // 2. Extract all strikes from all events
      type StrikeWithEvent = StrikeMarket & { eventDate: Date };
      const allStrikes: StrikeWithEvent[] = discovery.events.flatMap(event =>
        event.strikes.map(strike => ({
          ...strike,
          eventDate: event.eventDate,
        }))
      );

      this.logger.info(`Extracted ${allStrikes.length} strikes to wire`);

      // 3. Wire markets in parallel with concurrency limit
      const limiter = pLimit(this.config.maxConcurrent);
      const wiredMarkets: WiredMarket[] = [];
      const failedMarkets: Array<{ strike: number; error: string }> = [];

      const wirePromises = allStrikes.map(strike =>
        limiter(async () => {
          try {
            this.logger.debug(`Wiring ${crypto} strike ${strike.strike} expiring ${strike.eventDate.toISOString()}`);

            // Wire with timeout
            const wiredMarket = await this.wireWithTimeout(
              strike,
              crypto,
              strike.eventDate,
              this.config.wireTimeout
            );

            if (wiredMarket.status === 'active' || wiredMarket.status === 'initializing') {
              wiredMarkets.push(wiredMarket);
              this.logger.debug(`Successfully wired ${crypto} strike ${strike.strike}`);
            } else {
              failedMarkets.push({
                strike: strike.strike,
                error: wiredMarket.errors.join(', ') || 'Unknown error',
              });
              this.logger.warn(`Failed to wire ${crypto} strike ${strike.strike}: ${wiredMarket.errors.join(', ')}`);
            }

            return wiredMarket;
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            failedMarkets.push({
              strike: strike.strike,
              error: errorMessage,
            });
            this.logger.error(`Error wiring ${crypto} strike ${strike.strike}`, error as Error);
            return null;
          }
        })
      );

      // Wait for all wire operations to complete
      await Promise.all(wirePromises);

      const duration = Date.now() - startTime;

      this.logger.info(
        `Batch wiring complete for ${crypto}: ${wiredMarkets.length}/${allStrikes.length} markets wired in ${duration}ms`
      );

      return {
        crypto,
        totalDiscovered: allStrikes.length,
        totalWired: wiredMarkets.length,
        wiredMarkets,
        failedMarkets,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`Batch wiring failed for ${crypto}`, error as Error);

      throw new Error(
        `Failed to wire ${crypto} markets: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Wire a market with timeout
   */
  private async wireWithTimeout(
    strike: StrikeMarket,
    crypto: CryptoTicker,
    expiry: Date,
    timeout: number
  ): Promise<WiredMarket> {
    return Promise.race([
      this.pricingWirer.wireMarket(strike, crypto, expiry),
      new Promise<WiredMarket>((_, reject) =>
        setTimeout(() => reject(new Error(`Wire timeout after ${timeout}ms`)), timeout)
      ),
    ]);
  }

  /**
   * Get all currently wired markets for a crypto
   */
  getWiredMarketsForCrypto(crypto: CryptoTicker): WiredMarket[] {
    return this.pricingWirer
      .getAllWiredMarkets()
      .filter(market => market.crypto === crypto);
  }

  /**
   * Unwire all markets for a crypto
   */
  async unwireAllMarketsForCrypto(crypto: CryptoTicker): Promise<number> {
    const wiredMarkets = this.getWiredMarketsForCrypto(crypto);

    this.logger.info(`Unwiring ${wiredMarkets.length} markets for ${crypto}`);

    await Promise.all(
      wiredMarkets.map(market => this.pricingWirer.unwireMarket(market.tokenId))
    );

    this.logger.info(`Unwired all ${crypto} markets`);

    return wiredMarkets.length;
  }
}
