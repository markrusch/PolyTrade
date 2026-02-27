/**
 * Market Subscription Manager
 *
 * Unified manager for market subscriptions with batched operations,
 * automatic lifecycle management, and health monitoring.
 */

import { Logger } from '../lib/logger/index.js';
import type { HybridStreamManager } from './polymarket/streaming/HybridStreamManager.js';

export type CryptoTicker = 'BTC' | 'ETH' | 'SOL' | 'XRP';

export interface MarketSubscription {
  tokenId: string;
  crypto: CryptoTicker;
  strike?: number;
  expiry?: Date;
  slug?: string;
  subscribedAt: Date;
  status: 'pending' | 'active' | 'error' | 'unsubscribing';
  lastUpdate?: Date;
  errors: string[];
}

export interface SubscriptionResult {
  success: boolean;
  tokenId: string;
  error?: string;
}

export interface SubscriptionManagerConfig {
  batchDelayMs?: number;      // Delay before processing batch (default: 100ms)
  maxBatchSize?: number;      // Max subscriptions per batch (default: 10)
  healthCheckInterval?: number; // Health check interval (default: 30000ms)
}

export class MarketSubscriptionManager {
  private logger: Logger;
  private streamManager: HybridStreamManager | null = null;
  private config: Required<SubscriptionManagerConfig>;

  private subscriptions = new Map<string, MarketSubscription>();
  private pendingSubscribes = new Map<string, { crypto: CryptoTicker; slug?: string }>();
  private pendingUnsubscribes = new Set<string>();
  private batchTimer: NodeJS.Timeout | null = null;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(logger: Logger, config: SubscriptionManagerConfig = {}) {
    this.logger = logger;
    this.config = {
      batchDelayMs: config.batchDelayMs ?? 100,
      maxBatchSize: config.maxBatchSize ?? 10,
      healthCheckInterval: config.healthCheckInterval ?? 30000,
    };
  }

  /**
   * Set the stream manager (allows late binding)
   */
  setStreamManager(streamManager: HybridStreamManager): void {
    this.streamManager = streamManager;
    this.logger.info('MarketSubscriptionManager: Stream manager set');
  }

  /**
   * Start the subscription manager
   */
  start(): void {
    this.logger.info('MarketSubscriptionManager: Starting');

    // Start periodic health check
    this.healthCheckTimer = setInterval(() => {
      this.checkSubscriptionHealth();
    }, this.config.healthCheckInterval);
  }

  /**
   * Stop the subscription manager
   */
  stop(): void {
    this.logger.info('MarketSubscriptionManager: Stopping');

    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * Subscribe to a market (batched)
   */
  subscribe(tokenId: string, crypto: CryptoTicker, slug?: string): void {
    this.logger.debug(`MarketSubscriptionManager: Queueing subscribe for ${tokenId}`);

    // Remove from pending unsubscribes if present
    this.pendingUnsubscribes.delete(tokenId);

    // Add to pending subscribes
    this.pendingSubscribes.set(tokenId, { crypto, slug });

    // Schedule batch processing
    this.scheduleBatch();
  }

  /**
   * Unsubscribe from a market (batched)
   */
  unsubscribe(tokenId: string): void {
    this.logger.debug(`MarketSubscriptionManager: Queueing unsubscribe for ${tokenId}`);

    // Remove from pending subscribes if present
    this.pendingSubscribes.delete(tokenId);

    // Only add to pending unsubscribes if currently subscribed
    if (this.subscriptions.has(tokenId)) {
      this.pendingUnsubscribes.add(tokenId);
      this.scheduleBatch();
    }
  }

  /**
   * Get current subscription status
   */
  getSubscription(tokenId: string): MarketSubscription | undefined {
    return this.subscriptions.get(tokenId);
  }

  /**
   * Get all active subscriptions
   */
  getActiveSubscriptions(): MarketSubscription[] {
    return Array.from(this.subscriptions.values())
      .filter(sub => sub.status === 'active');
  }

  /**
   * Get subscription count by status
   */
  getStats(): { total: number; active: number; pending: number; errors: number } {
    const subs = Array.from(this.subscriptions.values());
    return {
      total: subs.length,
      active: subs.filter(s => s.status === 'active').length,
      pending: subs.filter(s => s.status === 'pending').length + this.pendingSubscribes.size,
      errors: subs.filter(s => s.status === 'error').length,
    };
  }

  /**
   * Schedule batch processing
   */
  private scheduleBatch(): void {
    if (this.batchTimer || this.isProcessing) return;

    this.batchTimer = setTimeout(() => {
      this.batchTimer = null;
      this.processBatch();
    }, this.config.batchDelayMs);
  }

  /**
   * Process pending subscribes and unsubscribes
   */
  private async processBatch(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      // Process unsubscribes first (to free resources)
      const unsubscribes = Array.from(this.pendingUnsubscribes);
      this.pendingUnsubscribes.clear();

      for (const tokenId of unsubscribes) {
        await this.processUnsubscribe(tokenId);
      }

      // Process subscribes (limited by batch size)
      const subscribes = Array.from(this.pendingSubscribes.entries())
        .slice(0, this.config.maxBatchSize);

      for (const [tokenId, { crypto, slug }] of subscribes) {
        this.pendingSubscribes.delete(tokenId);
        await this.processSubscribe(tokenId, crypto, slug);
      }

      // If there are more pending subscribes, schedule another batch
      if (this.pendingSubscribes.size > 0) {
        this.scheduleBatch();
      }
    } catch (err) {
      this.logger.error('MarketSubscriptionManager: Batch processing error', err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process a single subscribe
   */
  private async processSubscribe(tokenId: string, crypto: CryptoTicker, slug?: string): Promise<void> {
    // Create subscription record
    const subscription: MarketSubscription = {
      tokenId,
      crypto,
      slug,
      subscribedAt: new Date(),
      status: 'pending',
      errors: [],
    };

    this.subscriptions.set(tokenId, subscription);

    try {
      if (!this.streamManager) {
        throw new Error('Stream manager not available');
      }

      // Subscribe via stream manager
      await this.streamManager.subscribeMarket(tokenId);

      // Update status
      subscription.status = 'active';
      subscription.lastUpdate = new Date();

      this.logger.info(`MarketSubscriptionManager: Subscribed to ${tokenId} (${crypto})`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      subscription.status = 'error';
      subscription.errors.push(error);

      this.logger.error(`MarketSubscriptionManager: Failed to subscribe to ${tokenId}`, new Error(error));
    }
  }

  /**
   * Process a single unsubscribe
   */
  private async processUnsubscribe(tokenId: string): Promise<void> {
    const subscription = this.subscriptions.get(tokenId);
    if (!subscription) return;

    subscription.status = 'unsubscribing';

    try {
      if (this.streamManager) {
        this.streamManager.unsubscribeMarket(tokenId);
      }

      // Remove subscription record
      this.subscriptions.delete(tokenId);

      this.logger.info(`MarketSubscriptionManager: Unsubscribed from ${tokenId}`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      subscription.status = 'error';
      subscription.errors.push(`Unsubscribe failed: ${error}`);

      this.logger.error(`MarketSubscriptionManager: Failed to unsubscribe from ${tokenId}`, new Error(error));
    }
  }

  /**
   * Check health of all subscriptions
   */
  private checkSubscriptionHealth(): void {
    const now = Date.now();
    const staleThreshold = 60000; // 1 minute

    for (const [tokenId, subscription] of this.subscriptions) {
      if (subscription.status !== 'active') continue;

      const lastUpdate = subscription.lastUpdate?.getTime() || subscription.subscribedAt.getTime();
      const age = now - lastUpdate;

      if (age > staleThreshold) {
        this.logger.warn(`MarketSubscriptionManager: Subscription ${tokenId} is stale (${Math.round(age / 1000)}s)`);

        // Could implement auto-resubscribe here if needed
        subscription.status = 'error';
        subscription.errors.push(`Stale subscription (no update for ${Math.round(age / 1000)}s)`);
      }
    }
  }

  /**
   * Update last activity for a subscription
   */
  updateActivity(tokenId: string): void {
    const subscription = this.subscriptions.get(tokenId);
    if (subscription) {
      subscription.lastUpdate = new Date();
      if (subscription.status === 'error') {
        // Clear error state on activity
        subscription.status = 'active';
      }
    }
  }
}
