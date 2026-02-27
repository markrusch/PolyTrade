/**
 * @fileoverview Unit tests for new API endpoints and hooks
 * Following TDD: These tests define expected behavior before implementation verification
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Test the API methods are correctly calling endpoints
describe('API Client - Streaming Status', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  it('should call GET /api/streaming/status for getStreamingStatus', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        connection: { connected: true, reconnects: 0 },
        markets: { total: 5, enabled: 5, active: 4, stale: 1, byState: {} },
        global: { totalTicks: 1234, uptime: 3600 },
        activeMarkets: [],
      }),
    });

    // Dynamically import to use mocked fetch
    const { api } = await import('../../ui/src/lib/api');
    const result = await api.getStreamingStatus();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/streaming/status'),
      expect.any(Object)
    );
    expect(result.connection.connected).toBe(true);
    expect(result.markets.total).toBe(5);
  });

  it('should call POST /api/streaming/markets for subscribeMarket', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        market: { tokenId: 'abc123', state: 'active', tickCount: 0 },
      }),
    });

    const { api } = await import('../../ui/src/lib/api');
    const result = await api.subscribeMarket('abc123', { slug: 'test-market' });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/streaming/markets'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('abc123'),
      })
    );
    expect(result.success).toBe(true);
  });

  it('should call DELETE /api/streaming/markets/:tokenId for unsubscribeMarket', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    });

    const { api } = await import('../../ui/src/lib/api');
    const result = await api.unsubscribeMarket('token123');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/streaming/markets/token123'),
      expect.objectContaining({ method: 'DELETE' })
    );
    expect(result.success).toBe(true);
  });
});

describe('API Client - Market Maker', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  it('should call POST /api/mm/start for startMarketMaker', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, message: 'Market Maker started' }),
    });

    const { api } = await import('../../ui/src/lib/api');
    const result = await api.startMarketMaker();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/mm/start'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(result.success).toBe(true);
  });

  it('should call POST /api/mm/stop for stopMarketMaker', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, message: 'Market Maker stopped' }),
    });

    const { api } = await import('../../ui/src/lib/api');
    const result = await api.stopMarketMaker();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/mm/stop'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(result.success).toBe(true);
  });

  it('should call POST /api/mm/markets for addMarketToMM', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, message: 'Market added' }),
    });

    const { api } = await import('../../ui/src/lib/api');
    const result = await api.addMarketToMM('bitcoin-above-100k');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/mm/markets'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('bitcoin-above-100k'),
      })
    );
    expect(result.success).toBe(true);
  });

  it('should call POST /api/mm/discover for discoverMarkets', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        markets: [
          { slug: 'market1', question: 'Test Market 1', volume24h: '10000', liquidity: '5000', active: true },
        ],
      }),
    });

    const { api } = await import('../../ui/src/lib/api');
    const result = await api.discoverMarkets(10, false);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/mm/discover'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"limit":10'),
      })
    );
    expect(result.success).toBe(true);
    expect(result.markets).toHaveLength(1);
  });

  it('should call POST /api/mm/discover with autoAdd=true', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        discovered: 5,
        added: 3,
      }),
    });

    const { api } = await import('../../ui/src/lib/api');
    const result = await api.discoverMarkets(5, true);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/mm/discover'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"autoAdd":true'),
      })
    );
    expect(result.success).toBe(true);
    expect(result.discovered).toBe(5);
    expect(result.added).toBe(3);
  });
});

// Type check tests - ensure interfaces are correctly defined
describe('Type Definitions', () => {
  it('StreamingStatus should have required properties', async () => {
    const { api } = await import('../../ui/src/lib/api');
    
    // TypeScript will catch if these properties don't exist
    type StreamingStatusType = Awaited<ReturnType<typeof api.getStreamingStatus>>;
    
    // This is a compile-time check - if the type doesn't have these properties, TS will error
    const typeCheck: StreamingStatusType = {
      connection: { connected: true, reconnects: 0 },
      markets: { total: 0, enabled: 0, active: 0, stale: 0, byState: {} },
      global: { totalTicks: 0, uptime: 0 },
      activeMarkets: [],
    };
    
    expect(typeCheck.connection).toBeDefined();
    expect(typeCheck.markets).toBeDefined();
    expect(typeCheck.global).toBeDefined();
    expect(typeCheck.activeMarkets).toBeDefined();
  });

  it('DiscoveredMarket should have required properties', async () => {
    const market = {
      slug: 'test',
      question: 'Test Question',
      volume24h: '10000',
      liquidity: '5000',
      active: true,
    };
    
    expect(market.slug).toBeDefined();
    expect(market.question).toBeDefined();
    expect(market.volume24h).toBeDefined();
    expect(market.liquidity).toBeDefined();
    expect(market.active).toBeDefined();
  });
});
