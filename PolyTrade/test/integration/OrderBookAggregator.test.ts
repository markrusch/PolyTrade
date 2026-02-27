/**
 * Unit Tests for OrderBookAggregator
 * Tests: tick processing, buffer management, candle generation
 * 
 * NOTE: These tests are skipped because the OrderBookAggregator API has completely changed.
 * The new aggregator focuses on API fetching (fetchOrderBooksForStrikes, fetchOrderBook)
 * instead of tick processing (processTick, finalizeAll, getBufferState).
 * 
 * TODO: Write new tests for the API-fetching OrderBookAggregator
 */

import { describe, it, expect } from '@jest/globals';

describe.skip('OrderBookAggregator (Needs Rewrite)', () => {
  it('placeholder - tests need rewrite for new API', () => {
    // Old API methods that no longer exist:
    // - processTick(tick)
    // - finalizeAll()
    // - getBufferState()
    // - aggregateBackfill(tokenId, timeframes)
    //
    // New API methods to test:
    // - fetchOrderBooksForStrikes(strikes)
    // - fetchOrderBook(tokenId)
    expect(true).toBe(true);
  });
});
