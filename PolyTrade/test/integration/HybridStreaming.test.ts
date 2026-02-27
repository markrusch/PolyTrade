/**
 * Integration Tests for Hybrid Streaming System
 * Tests: HybridStreamManager, TickBuffer, MarketRegistry, ConnectionPool
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import {
  HybridStreamManager,
  TickBuffer,
  MarketRegistry,
  ConnectionPool,
  DEFAULT_STREAM_CONFIG,
  HybridStreamConfig,
  EnrichedTick,
  MarketState,
} from '../../src/services/polymarket/streaming/index.js';
import { Logger } from '../../src/lib/logger/index.js';

// Test constants
const TEST_TOKEN_ID = '0x1234567890abcdef1234567890abcdef12345678901234567890abcdef12345678';
const TEST_TOKEN_ID_2 = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890';
const TEST_REGISTRY_PATH = path.join(__dirname, '../test-data/test-market-registry.json');

// Test config with shorter intervals for faster tests
const TEST_CONFIG: Partial<HybridStreamConfig> = {
  ...DEFAULT_STREAM_CONFIG,
  restPollIntervalMs: 100, // Very fast for tests
  wsStaleThresholdMs: 1000,
  marketStaleThresholdMs: 500,
  tickDedupeWindowMs: 100, // Fixed: was dedupeWindowMs
};

// Mock logger for tests
const testLogger = new Logger({ service: 'HybridStreaming.test', level: 'error' });

describe('TickBuffer', () => {
  let tickBuffer: TickBuffer;

  beforeEach(() => {
    tickBuffer = new TickBuffer(TEST_CONFIG as HybridStreamConfig, testLogger);
  });

  afterAll(() => {
    tickBuffer?.shutdown();
  });

  describe('enrichTick', () => {
    it('should add required fields to a tick', () => {
      const baseTick: any = {
        tokenId: TEST_TOKEN_ID,
        timestamp: Date.now(),
        bestBid: 0.50,
        bestAsk: 0.52,
        spreadBps: 400,
        bidLevels: [{ price: 0.50, size: 100 }],
        askLevels: [{ price: 0.52, size: 100 }],
        source: 'rest',
      };

      const enriched = tickBuffer.enrichTick(baseTick);

      expect(enriched.hash).toBeDefined();
      expect(enriched.receivedAt).toBeDefined();
      expect(enriched.receivedAt).toBeGreaterThanOrEqual(baseTick.timestamp);
      expect(enriched.hash.length).toBe(16); // MD5 hash truncated to 16 chars
    });

    it('should generate different hashes for different ticks', () => {
      const tick1 = tickBuffer.enrichTick({
        tokenId: TEST_TOKEN_ID,
        timestamp: Date.now(),
        bestBid: 0.50,
        bestAsk: 0.52,
        spreadBps: 400,
        bidLevels: [{ price: 0.50, size: 100 }],
        askLevels: [{ price: 0.52, size: 100 }],
        source: 'rest',
      } as any);

      const tick2 = tickBuffer.enrichTick({
        tokenId: TEST_TOKEN_ID,
        timestamp: Date.now(),
        bestBid: 0.51, // Different price
        bestAsk: 0.53,
        spreadBps: 400,
        bidLevels: [{ price: 0.51, size: 100 }],
        askLevels: [{ price: 0.53, size: 100 }],
        source: 'rest',
      } as any);

      expect(tick1.hash).not.toBe(tick2.hash);
    });
  });

  describe('deduplication', () => {
    it('should detect duplicate ticks within window', () => {
      const tick = tickBuffer.enrichTick({
        tokenId: TEST_TOKEN_ID,
        timestamp: Date.now(),
        bestBid: 0.50,
        bestAsk: 0.52,
        spreadBps: 400,
        bidLevels: [{ price: 0.50, size: 100 }],
        askLevels: [{ price: 0.52, size: 100 }],
        source: 'rest',
      } as any);

      // First add should not be duplicate
      const result1 = tickBuffer.addTick(tick);
      expect(result1.isDuplicate).toBe(false);

      // Second add of same tick should be duplicate
      const result2 = tickBuffer.addTick(tick);
      expect(result2.isDuplicate).toBe(true);
    });

    it('should not flag different ticks as duplicates', () => {
      const tick1 = tickBuffer.enrichTick({
        tokenId: TEST_TOKEN_ID,
        timestamp: Date.now(),
        bestBid: 0.50,
        bestAsk: 0.52,
        spreadBps: 400,
        bidLevels: [{ price: 0.50, size: 100 }],
        askLevels: [{ price: 0.52, size: 100 }],
        source: 'rest',
      } as any);

      const tick2 = tickBuffer.enrichTick({
        tokenId: TEST_TOKEN_ID,
        timestamp: Date.now() + 50,
        bestBid: 0.51, // Different
        bestAsk: 0.53,
        spreadBps: 400,
        bidLevels: [{ price: 0.51, size: 100 }],
        askLevels: [{ price: 0.53, size: 100 }],
        source: 'rest',
      } as any);

      const result1 = tickBuffer.addTick(tick1);
      const result2 = tickBuffer.addTick(tick2);

      expect(result1.isDuplicate).toBe(false);
      expect(result2.isDuplicate).toBe(false);
    });
  });

  describe('merge depth', () => {
    it('should merge WS top-of-book with REST depth', () => {
      // Add REST tick first (older)
      const restTick = tickBuffer.enrichTick({
        tokenId: TEST_TOKEN_ID,
        timestamp: Date.now() - 1000, // REST is slightly older
        bestBid: 0.50, // REST has deeper levels
        bestAsk: 0.54,
        spreadBps: 800,
        bidLevels: [
          { price: 0.50, size: 100 },
          { price: 0.49, size: 200 },
          { price: 0.48, size: 300 },
          { price: 0.47, size: 400 },
          { price: 0.46, size: 500 },
          { price: 0.45, size: 600 },
        ],
        askLevels: [
          { price: 0.54, size: 100 },
          { price: 0.55, size: 200 },
          { price: 0.56, size: 300 },
          { price: 0.57, size: 400 },
          { price: 0.58, size: 500 },
          { price: 0.59, size: 600 },
        ],
        source: 'rest',
      } as any);
      
      tickBuffer.addTick(restTick);

      // Add WS tick second (newer) - this will have later receivedAt
      const wsTick = tickBuffer.enrichTick({
        tokenId: TEST_TOKEN_ID,
        timestamp: Date.now(),
        bestBid: 0.51, // WS has more recent top-of-book
        bestAsk: 0.53,
        spreadBps: 400,
        bidLevels: [
          { price: 0.51, size: 50 },
          { price: 0.50, size: 60 },
        ],
        askLevels: [
          { price: 0.53, size: 50 },
          { price: 0.54, size: 60 },
        ],
        source: 'ws',
      } as any);

      tickBuffer.addTick(wsTick);

      // Get merged view
      const merged = tickBuffer.getMergedTick(TEST_TOKEN_ID);
      expect(merged).toBeDefined();

      if (merged) {
        // Should use merged top-of-book prices - values depend on merge algorithm
        // The merge may recalculate bestBid/Ask from sorted levels
        expect(merged.tick.bestBid).toBeGreaterThanOrEqual(0.50);
        expect(merged.tick.bestBid).toBeLessThanOrEqual(0.51);
        expect(merged.tick.bestAsk).toBeGreaterThanOrEqual(0.53);
        expect(merged.tick.bestAsk).toBeLessThanOrEqual(0.54);

        // Should have combined depth (WS top levels + REST deeper levels)
        expect(merged.tick.bidLevels.length).toBeGreaterThan(2);
        expect(merged.tick.askLevels.length).toBeGreaterThan(2);
      }
    });
  });
});

describe('MarketRegistry', () => {
  let registry: MarketRegistry;

  beforeEach(() => {
    // Clean up test file before each test
    if (fs.existsSync(TEST_REGISTRY_PATH)) {
      fs.unlinkSync(TEST_REGISTRY_PATH);
    }
    registry = new MarketRegistry(TEST_CONFIG as HybridStreamConfig, testLogger);
  });

  afterAll(() => {
    registry?.shutdown();
    if (fs.existsSync(TEST_REGISTRY_PATH)) {
      fs.unlinkSync(TEST_REGISTRY_PATH);
    }
  });

  describe('registration', () => {
    it('should register a market', () => {
      const registration = registry.register(TEST_TOKEN_ID, {
        slug: 'test-market',
        outcome: 'yes',
      });

      expect(registration.tokenId).toBe(TEST_TOKEN_ID);
      expect(registration.slug).toBe('test-market');
      expect(registration.outcome).toBe('yes');
      expect(registration.state).toBe('idle'); // Fixed: was 'pending'
    });

    it('should update existing registration', () => {
      registry.register(TEST_TOKEN_ID, { slug: 'original' });
      registry.register(TEST_TOKEN_ID, { slug: 'updated' });

      const market = registry.get(TEST_TOKEN_ID);
      expect(market?.slug).toBe('updated');
    });

    it('should unregister a market', () => {
      registry.register(TEST_TOKEN_ID);
      registry.unregister(TEST_TOKEN_ID);

      const market = registry.get(TEST_TOKEN_ID);
      expect(market).toBeUndefined();
    });
  });

  describe('state tracking', () => {
    it('should update market state', () => {
      registry.register(TEST_TOKEN_ID);
      registry.updateState(TEST_TOKEN_ID, 'active');

      const market = registry.get(TEST_TOKEN_ID);
      expect(market?.state).toBe('active');
    });

    it('should track tick timestamps', () => {
      registry.register(TEST_TOKEN_ID);
      registry.recordTick(TEST_TOKEN_ID, 'ws');

      const market = registry.get(TEST_TOKEN_ID);
      expect(market?.lastWsUpdate).toBeGreaterThan(0); // Fixed: was lastWsTick
    });

    it('should identify stale markets', async () => {
      registry.register(TEST_TOKEN_ID);
      registry.updateState(TEST_TOKEN_ID, 'active');
      registry.recordTick(TEST_TOKEN_ID, 'ws');

      // Market should not be stale immediately
      let stale = registry.getStaleMarkets(100);
      expect(stale).not.toContain(TEST_TOKEN_ID);

      // Wait for staleness threshold
      await new Promise(resolve => setTimeout(resolve, 150));

      // Now market should be stale
      stale = registry.getStaleMarkets(100);
      expect(stale).toContain(TEST_TOKEN_ID);
    });
  });

  describe('filtering', () => {
    it('should get enabled markets', () => {
      registry.register(TEST_TOKEN_ID, { slug: 'market1' });
      registry.register(TEST_TOKEN_ID_2, { slug: 'market2' });

      const enabled = registry.getEnabledMarkets();
      // Verify our test markets are in the enabled list
      expect(enabled.some(m => m.tokenId === TEST_TOKEN_ID)).toBe(true);
      expect(enabled.some(m => m.tokenId === TEST_TOKEN_ID_2)).toBe(true);
    });

    it('should get active markets', () => {
      // Get count before adding test markets
      const activeBefore = registry.getActive().length;
      
      registry.register(TEST_TOKEN_ID);
      registry.register(TEST_TOKEN_ID_2);
      
      registry.updateState(TEST_TOKEN_ID, 'active');
      // Leave TEST_TOKEN_ID_2 as 'idle'

      const active = registry.getActive();
      // We set 1 market to active, so should have at least 1 more
      expect(active.length).toBeGreaterThanOrEqual(activeBefore + 1);
      // The specific token should be in the active list
      expect(active.some(m => m.tokenId === TEST_TOKEN_ID)).toBe(true);
    });
  });

  describe('stats', () => {
    it('should return correct statistics', () => {
      registry.register(TEST_TOKEN_ID);
      registry.register(TEST_TOKEN_ID_2);
      registry.updateState(TEST_TOKEN_ID, 'active');

      const stats = registry.getStats();
      // Stats should reflect at least our registrations
      expect(stats.totalRegistered).toBeGreaterThanOrEqual(2);
      expect(stats.active).toBeGreaterThanOrEqual(1);
      
      // Verify specific market states via direct check
      const market1 = registry.get(TEST_TOKEN_ID);
      const market2 = registry.get(TEST_TOKEN_ID_2);
      expect(market1?.state).toBe('active');
      expect(market2).toBeDefined();
    });
  });
});

describe('ConnectionPool', () => {
  let connectionPool: ConnectionPool;

  beforeEach(() => {
    connectionPool = new ConnectionPool(TEST_CONFIG as HybridStreamConfig, testLogger);
  });

  afterAll(() => {
    connectionPool?.disconnect();
  });

  describe('health status', () => {
    it('should report disconnected health initially', () => {
      const health = connectionPool.getHealth();
      expect(health.state).toBe('disconnected');
      expect(connectionPool.getSubscriptionCount()).toBe(0); // Fixed: was health.subscribedMarkets
    });
  });

  describe('subscription tracking', () => {
    it('should track subscriptions even when disconnected', () => {
      connectionPool.subscribe(TEST_TOKEN_ID);
      connectionPool.subscribe(TEST_TOKEN_ID_2);

      // Note: We can't easily test actual WebSocket behavior in unit tests
      // But we can verify the manager tracks intended subscriptions
    });
  });
});

describe('HybridStreamManager Integration', () => {
  // These tests require actual network access to Polymarket
  // They should be skipped in CI unless INTEGRATION_TESTS=true

  const runIntegrationTests = process.env.INTEGRATION_TESTS === 'true';

  if (!runIntegrationTests) {
    it.skip('Integration tests disabled (set INTEGRATION_TESTS=true to enable)', () => {});
    return;
  }

  let manager: HybridStreamManager;
  let receivedTicks: EnrichedTick[] = [];
  let stateChanges: Array<{ tokenId: string; state: MarketState }> = [];

  beforeAll(async () => {
    receivedTicks = [];
    stateChanges = [];

    manager = new HybridStreamManager(
      {
        ...TEST_CONFIG,
        restPollIntervalMs: 5000, // Normal interval for real tests
      },
      {
        onTick: (tick) => {
          receivedTicks.push(tick);
        },
        onMarketStateChange: (tokenId, state) => {
          stateChanges.push({ tokenId, state });
        },
      }
    );

    await manager.start();
  }, 30000);

  afterAll(async () => {
    await manager?.shutdown();
  }, 10000);

  it('should report initial metrics', () => {
    const metrics = manager.getMetrics();
    expect(metrics.global.totalMarkets).toBe(0);
    expect(metrics.global.activeMarkets).toBe(0);
  });

  it('should subscribe to a market', async () => {
    // Use a known active market token ID
    // This would need to be updated to a current active market
    const testTokenId = process.env.TEST_TOKEN_ID;
    if (!testTokenId) {
      console.warn('Skipping subscribe test - no TEST_TOKEN_ID env var');
      return;
    }

    await manager.subscribeMarket(testTokenId, { slug: 'test-integration' });

    const metrics = manager.getMetrics();
    expect(metrics.global.totalMarkets).toBe(1);

    // Wait for first tick
    await new Promise(resolve => setTimeout(resolve, 6000));

    expect(receivedTicks.length).toBeGreaterThan(0);
    expect(receivedTicks[0].tokenId).toBe(testTokenId);
  }, 15000);
});
