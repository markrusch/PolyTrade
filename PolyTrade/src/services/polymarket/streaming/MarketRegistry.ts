/**
 * Market Registry
 * Persistent tracking of markets to stream, with auto-resume on restart
 */

import { Logger } from '../../../lib/logger/index.js';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import {
  MarketRegistration,
  MarketState,
  HybridStreamConfig,
  DEFAULT_STREAM_CONFIG,
} from './types.js';

// Use process.cwd() for data directory - more portable across module systems
const DATA_DIR = path.join(process.cwd(), 'data');
const REGISTRY_FILE = path.join(DATA_DIR, 'market-registry.json');

export interface MarketRegistryEntry {
  tokenId: string;
  slug?: string;
  outcome?: 'yes' | 'no';
  addedAt: number;
  lastActiveAt: number;
  enabled: boolean;
  priority: number; // 1 = highest priority
  metadata?: Record<string, any>;
}

export class MarketRegistry {
  private markets: Map<string, MarketRegistryEntry> = new Map();
  private registrations: Map<string, MarketRegistration> = new Map();
  private logger: Logger;
  private config: HybridStreamConfig;
  private saveInterval: NodeJS.Timeout;
  private dirty: boolean = false;

  constructor(config: Partial<HybridStreamConfig> = {}, logger?: Logger) {
    this.config = { ...DEFAULT_STREAM_CONFIG, ...config };
    this.logger = logger || new Logger({ service: 'MarketRegistry' });

    // Ensure data directory exists
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }

    // Load existing registry
    this.loadRegistry();

    // Auto-save every 30 seconds if dirty
    this.saveInterval = setInterval(() => {
      if (this.dirty) {
        this.saveRegistry();
        this.dirty = false;
      }
    }, 30000);

    this.logger.debug('MarketRegistry initialized', { markets: this.markets.size });
  }

  /**
   * Load registry from disk
   */
  private loadRegistry(): void {
    try {
      if (existsSync(REGISTRY_FILE)) {
        const data = JSON.parse(readFileSync(REGISTRY_FILE, 'utf-8'));
        if (Array.isArray(data)) {
          for (const entry of data) {
            this.markets.set(entry.tokenId, entry);
          }
        }
        this.logger.info(`Loaded ${this.markets.size} markets from registry`);
      }
    } catch (err) {
      this.logger.warn('Could not load market registry, starting fresh', { error: err });
    }
  }

  /**
   * Save registry to disk
   */
  private saveRegistry(): void {
    try {
      const data = Array.from(this.markets.values());
      writeFileSync(REGISTRY_FILE, JSON.stringify(data, null, 2));
      this.logger.debug('Market registry saved');
    } catch (err) {
      this.logger.error('Failed to save market registry', { error: err });
    }
  }

  /**
   * Register a market for streaming
   */
  register(
    tokenId: string,
    options: {
      slug?: string;
      outcome?: 'yes' | 'no';
      priority?: number;
      metadata?: Record<string, any>;
    } = {}
  ): MarketRegistration {
    const now = Date.now();

    // Create or update market entry
    let entry = this.markets.get(tokenId);
    if (!entry) {
      entry = {
        tokenId,
        slug: options.slug,
        outcome: options.outcome,
        addedAt: now,
        lastActiveAt: now,
        enabled: true,
        priority: options.priority || 5,
        metadata: options.metadata,
      };
      this.markets.set(tokenId, entry);
      this.logger.info(`Market registered: ${tokenId.slice(0, 20)}...`, { slug: options.slug });
    } else {
      // Update existing
      entry.lastActiveAt = now;
      entry.enabled = true;
      if (options.slug) entry.slug = options.slug;
      if (options.outcome) entry.outcome = options.outcome;
      if (options.priority) entry.priority = options.priority;
      if (options.metadata) entry.metadata = { ...entry.metadata, ...options.metadata };
    }

    // Create runtime registration
    const registration: MarketRegistration = {
      tokenId,
      slug: entry.slug,
      outcome: entry.outcome,
      state: 'idle',
      subscribedAt: 0,
      lastRestUpdate: 0,
      lastWsUpdate: 0,
      lastMergedTick: 0,
      tickCount: 0,
      errorCount: 0,
    };
    this.registrations.set(tokenId, registration);

    this.dirty = true;
    return registration;
  }

  /**
   * Unregister a market (disable but keep in registry)
   */
  unregister(tokenId: string): boolean {
    const entry = this.markets.get(tokenId);
    if (entry) {
      entry.enabled = false;
      this.registrations.delete(tokenId);
      this.dirty = true;
      this.logger.info(`Market unregistered: ${tokenId.slice(0, 20)}...`);
      return true;
    }
    return false;
  }

  /**
   * Remove market completely from registry
   */
  remove(tokenId: string): boolean {
    const deleted = this.markets.delete(tokenId);
    this.registrations.delete(tokenId);
    if (deleted) {
      this.dirty = true;
      this.logger.info(`Market removed from registry: ${tokenId.slice(0, 20)}...`);
    }
    return deleted;
  }

  /**
   * Get registration for a market
   */
  get(tokenId: string): MarketRegistration | undefined {
    return this.registrations.get(tokenId);
  }

  /**
   * Get all active registrations
   */
  getActive(): MarketRegistration[] {
    return Array.from(this.registrations.values());
  }

  /**
   * Get all enabled markets (for auto-resume)
   */
  getEnabledMarkets(): MarketRegistryEntry[] {
    return Array.from(this.markets.values())
      .filter(m => m.enabled)
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * Get markets by priority
   */
  getByPriority(maxCount: number = 100): MarketRegistryEntry[] {
    return Array.from(this.markets.values())
      .filter(m => m.enabled)
      .sort((a, b) => a.priority - b.priority)
      .slice(0, maxCount);
  }

  /**
   * Update market state
   */
  updateState(tokenId: string, state: MarketState, error?: string): void {
    const registration = this.registrations.get(tokenId);
    if (registration) {
      registration.state = state;
      if (error) {
        registration.lastError = error;
        registration.errorCount++;
      }
    }
  }

  /**
   * Record tick update
   */
  recordTick(tokenId: string, source: 'rest' | 'ws' | 'merged'): void {
    const registration = this.registrations.get(tokenId);
    if (registration) {
      const now = Date.now();
      if (source === 'rest') {
        registration.lastRestUpdate = now;
      } else if (source === 'ws') {
        registration.lastWsUpdate = now;
      }
      registration.lastMergedTick = now;
      registration.tickCount++;

      // Update entry last active
      const entry = this.markets.get(tokenId);
      if (entry) {
        entry.lastActiveAt = now;
      }
    }
  }

  /**
   * Check for stale markets (no updates in threshold)
   */
  getStaleMarkets(thresholdMs: number = 60000): string[] {
    const now = Date.now();
    const stale: string[] = [];

    for (const [tokenId, reg] of this.registrations) {
      if (reg.state === 'active' && (now - reg.lastMergedTick) > thresholdMs) {
        stale.push(tokenId);
      }
    }

    return stale;
  }

  /**
   * Get registry statistics
   */
  getStats(): {
    totalRegistered: number;
    enabled: number;
    active: number;
    stale: number;
    byState: Record<MarketState, number>;
  } {
    const byState: Record<MarketState, number> = {
      idle: 0,
      subscribing: 0,
      active: 0,
      stale: 0,
      error: 0,
    };

    for (const reg of this.registrations.values()) {
      byState[reg.state]++;
    }

    return {
      totalRegistered: this.markets.size,
      enabled: Array.from(this.markets.values()).filter(m => m.enabled).length,
      active: byState.active,
      stale: byState.stale,
      byState,
    };
  }

  /**
   * Force save registry
   */
  save(): void {
    this.saveRegistry();
    this.dirty = false;
  }

  /**
   * Shutdown and cleanup
   */
  shutdown(): void {
    clearInterval(this.saveInterval);
    if (this.dirty) {
      this.saveRegistry();
    }
    this.logger.debug('MarketRegistry shutdown');
  }
}
