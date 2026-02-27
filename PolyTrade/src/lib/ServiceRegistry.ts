/**
 * Service Registry for Per-Crypto Service Management
 * Manages independent Binance/Deribit listener instances per cryptocurrency
 */

import { BinancePriceListener } from '../services/binance/BinancePriceListener.js';
import { DeribitListener } from '../services/deribit/DeribitListener.js';
import { Logger } from './logger/index.js';
import { PortfolioGreeks } from '../services/market-maker/PortfolioGreeks.js';
import { InventoryTracker } from '../services/market-maker/InventoryTracker.js';
import { SafetyMonitor } from '../services/market-maker/SafetyMonitor.js';
import type { MarketMakerConfig, SafetyConfig } from './config/schema.js';

export type ServiceType = 'binance' | 'deribit';

export interface ServiceInstance {
  crypto: string;
  service: ServiceType;
  instance: BinancePriceListener | DeribitListener;
  enabled: boolean;
  lastUpdate: number | null;
  errorCount: number;
  status: 'running' | 'stopped' | 'error';
}

export interface ServiceStatus {
  crypto: string;
  service: ServiceType;
  enabled: boolean;
  connected: boolean;
  lastUpdate: number | null;
  errorCount: number;
  status: 'running' | 'stopped' | 'error';
}

export class ServiceRegistry {
  private services: Map<string, ServiceInstance> = new Map();
  private logger: Logger;

  // Market maker services
  private portfolioGreeks: PortfolioGreeks;
  private inventoryTracker: InventoryTracker;
  private safetyMonitor: SafetyMonitor;

  constructor(
    logger?: Logger,
    marketMakerConfig?: MarketMakerConfig,
    safetyConfig?: SafetyConfig
  ) {
    this.logger = logger || new Logger({ service: 'ServiceRegistry' });

    // Initialize market maker services with default configs
    this.portfolioGreeks = new PortfolioGreeks(this.logger);

    this.inventoryTracker = new InventoryTracker(this.logger, {
      maxQuantityPerMarket: marketMakerConfig?.maxQuantityPerMarket ?? 1000,
      maxNotionalPerCrypto: marketMakerConfig?.maxNotionalPerCrypto ?? 10000,
      maxGammaExposure: marketMakerConfig?.maxGammaExposure ?? 0.5,
    });

    this.safetyMonitor = new SafetyMonitor(this.logger, {
      maxSpotStalenessMs: safetyConfig?.maxSpotStalenessMs ?? 5000,
      maxIvStalenessMs: safetyConfig?.maxIvStalenessMs ?? 60000,
      maxSpotGapPercent: safetyConfig?.maxSpotGapPercent ?? 0.02,
      maxOrderbookStalenessMs: safetyConfig?.maxOrderbookStalenessMs ?? 10000,
      minOrderbookDepth: safetyConfig?.minOrderbookDepth ?? 100,
    });
  }

  /**
   * Generate unique key for service instance
   */
  private getKey(crypto: string, service: ServiceType): string {
    return `${service}:${crypto}`;
  }

  /**
   * Register a service instance
   */
  register(
    crypto: string,
    service: ServiceType,
    instance: BinancePriceListener | DeribitListener
  ): void {
    const key = this.getKey(crypto, service);
    
    if (this.services.has(key)) {
      this.logger.warn(`Service already registered: ${key}, replacing...`);
    }

    this.services.set(key, {
      crypto,
      service,
      instance,
      enabled: true,
      lastUpdate: null,
      errorCount: 0,
      status: 'stopped',
    });

    this.logger.info(`Registered service: ${key}`);
  }

  /**
   * Unregister a service instance
   */
  unregister(crypto: string, service: ServiceType): void {
    const key = this.getKey(crypto, service);
    
    if (!this.services.has(key)) {
      this.logger.warn(`Service not found for unregistration: ${key}`);
      return;
    }

    this.services.delete(key);
    this.logger.info(`Unregistered service: ${key}`);
  }

  /**
   * Get service instance
   */
  getService(crypto: string, service: ServiceType): BinancePriceListener | DeribitListener | null {
    const key = this.getKey(crypto, service);
    return this.services.get(key)?.instance || null;
  }

  /**
   * Get all registered services
   */
  getAllServices(): ServiceInstance[] {
    return Array.from(this.services.values());
  }

  /**
   * Get services filtered by type
   */
  getServicesByType(service: ServiceType): ServiceInstance[] {
    return this.getAllServices().filter(s => s.service === service);
  }

  /**
   * Get services filtered by crypto
   */
  getServicesByCrypto(crypto: string): ServiceInstance[] {
    return this.getAllServices().filter(s => s.crypto === crypto);
  }

  /**
   * Start a specific service
   */
  async startService(crypto: string, service: ServiceType): Promise<void> {
    const key = this.getKey(crypto, service);
    const entry = this.services.get(key);

    if (!entry) {
      throw new Error(`Service not found: ${key}`);
    }

    if (entry.status === 'running') {
      this.logger.warn(`Service already running: ${key}`);
      return;
    }

    try {
      this.logger.info(`Starting service: ${key}`);
      
      // Both services use start() but Deribit requires config
      // Services should already be started during initialization
      // This method just marks them as running in the registry
      
      entry.status = 'running';
      entry.enabled = true;
      entry.errorCount = 0;
    } catch (err) {
      entry.status = 'error';
      entry.errorCount++;
      this.logger.error(`Failed to start service ${key}:`, err);
      throw err;
    }
  }

  /**
   * Stop a specific service
   */
  async stopService(crypto: string, service: ServiceType): Promise<void> {
    const key = this.getKey(crypto, service);
    const entry = this.services.get(key);

    if (!entry) {
      throw new Error(`Service not found: ${key}`);
    }

    if (entry.status === 'stopped') {
      this.logger.warn(`Service already stopped: ${key}`);
      return;
    }

    try {
      this.logger.info(`Stopping service: ${key}`);
      
      if (entry.service === 'binance') {
        (entry.instance as BinancePriceListener).disconnect();
      } else {
        await (entry.instance as DeribitListener).disconnect();
      }

      entry.status = 'stopped';
      entry.enabled = false;
    } catch (err) {
      entry.status = 'error';
      entry.errorCount++;
      this.logger.error(`Failed to stop service ${key}:`, err);
      throw err;
    }
  }

  /**
   * Start all registered services
   */
  async startAll(): Promise<void> {
    this.logger.info('Starting all registered services...');
    
    for (const entry of this.services.values()) {
      try {
        await this.startService(entry.crypto, entry.service);
      } catch (err) {
        this.logger.error(`Failed to start ${entry.service}:${entry.crypto}`, err);
      }
    }
  }

  /**
   * Stop all running services
   */
  async stopAll(): Promise<void> {
    this.logger.info('Stopping all running services...');
    
    for (const entry of this.services.values()) {
      if (entry.status === 'running') {
        try {
          await this.stopService(entry.crypto, entry.service);
        } catch (err) {
          this.logger.error(`Failed to stop ${entry.service}:${entry.crypto}`, err);
        }
      }
    }
  }

  /**
   * Get status of a specific service
   */
  getServiceStatus(crypto: string, service: ServiceType): ServiceStatus | null {
    const key = this.getKey(crypto, service);
    const entry = this.services.get(key);

    if (!entry) {
      return null;
    }

    return {
      crypto: entry.crypto,
      service: entry.service,
      enabled: entry.enabled,
      connected: entry.instance.isConnected(),
      lastUpdate: entry.lastUpdate,
      errorCount: entry.errorCount,
      status: entry.status,
    };
  }

  /**
   * Get status of all services
   */
  getAllStatuses(): ServiceStatus[] {
    return this.getAllServices().map(entry => ({
      crypto: entry.crypto,
      service: entry.service,
      enabled: entry.enabled,
      connected: entry.instance.isConnected(),
      lastUpdate: entry.lastUpdate,
      errorCount: entry.errorCount,
      status: entry.status,
    }));
  }

  /**
   * Update last update timestamp for a service
   */
  recordUpdate(crypto: string, service: ServiceType): void {
    const key = this.getKey(crypto, service);
    const entry = this.services.get(key);

    if (entry) {
      entry.lastUpdate = Date.now();
    }
  }

  /**
   * Increment error count for a service
   */
  recordError(crypto: string, service: ServiceType): void {
    const key = this.getKey(crypto, service);
    const entry = this.services.get(key);

    if (entry) {
      entry.errorCount++;
      if (entry.errorCount > 10) {
        entry.status = 'error';
        this.logger.error(`Service ${key} has exceeded error threshold`);
      }
    }
  }

  /**
   * Get count of services by status
   */
  getServiceCounts(): { running: number; stopped: number; error: number; total: number } {
    const services = this.getAllServices();

    return {
      running: services.filter(s => s.status === 'running').length,
      stopped: services.filter(s => s.status === 'stopped').length,
      error: services.filter(s => s.status === 'error').length,
      total: services.length,
    };
  }

  /**
   * Get Portfolio Greeks service
   */
  getPortfolioGreeks(): PortfolioGreeks {
    return this.portfolioGreeks;
  }

  /**
   * Get Inventory Tracker service
   */
  getInventoryTracker(): InventoryTracker {
    return this.inventoryTracker;
  }

  /**
   * Get Safety Monitor service
   */
  getSafetyMonitor(): SafetyMonitor {
    return this.safetyMonitor;
  }
}
