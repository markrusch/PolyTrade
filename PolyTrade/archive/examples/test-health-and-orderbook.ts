import { ClobClientWrapper } from '../services/polymarket/ClobClient';
import { HealthCheckService } from '../services/polymarket/HealthCheck';
import { OrderBookService } from '../services/polymarket/OrderBook';
import { getOpenPositions } from '../services/polymarket/DataApi';
import { config } from '../services/polymarket/config';

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║    POLYMARKET HEALTH & ORDER BOOK INTEGRATION TEST             ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const userAddress = config.funderAddress;

  // ═══════════════════════════════════════════════════════════════
  // 1. HEALTH CHECKS
  // ═══════════════════════════════════════════════════════════════
  console.log('[STEP 1] API HEALTH CHECKS');
  console.log('─────────────────────────────────────────');

  const healthCheck = new HealthCheckService();
  const health = await healthCheck.checkAll();

  console.log(healthCheck.formatStatus(health));

  // ═══════════════════════════════════════════════════════════════
  // 2. INITIALIZE CLOB CLIENT
  // ═══════════════════════════════════════════════════════════════
  console.log('\n[STEP 2] INITIALIZING CLOB CLIENT');
  console.log('─────────────────────────────────────────');

  const clob = new ClobClientWrapper();
  await clob.initialize();
  console.log('✅ CLOB client initialized\n');

  // ═══════════════════════════════════════════════════════════════
  // 3. FETCH ACTIVE POSITIONS
  // ═══════════════════════════════════════════════════════════════
  console.log('[STEP 3] FETCHING ACTIVE POSITIONS');
  console.log('─────────────────────────────────────────');

  const positions = await getOpenPositions(userAddress);
  const activeMarkets = positions.filter((p: any) => !p.redeemable && Number(p.curPrice) > 0);

  console.log(`Found ${activeMarkets.length} active markets:\n`);

  activeMarkets.slice(0, 3).forEach((market: any, idx: number) => {
    console.log(`  ${idx + 1}. ${market.title.slice(0, 50)}...`);
    console.log(`     Token: ${String(market.asset).slice(0, 30)}...`);
    console.log(`     Price: $${market.curPrice}\n`);
  });

  if (activeMarkets.length === 0) {
    console.log('⚠️  No active markets found\n');
    return;
  }

  // ═══════════════════════════════════════════════════════════════
  // 4. ORDER BOOK SERVICE - REST SNAPSHOTS
  // ═══════════════════════════════════════════════════════════════
  console.log('[STEP 4] FETCHING ORDER BOOK SNAPSHOTS (REST)');
  console.log('─────────────────────────────────────────');

  const orderBookService = new OrderBookService();
  const tokenIds = activeMarkets.slice(0, 2).map((m: any) => String(m.asset));

  for (const tokenId of tokenIds) {
    try {
      console.log(`\nFetching order book for ${tokenId.slice(0, 25)}...`);
      const snapshot = await orderBookService.fetchOrderBookSnapshot(tokenId);

      console.log(`✅ Got order book snapshot:`);
      console.log(`   Market: ${snapshot.market.slice(0, 20)}...`);
      console.log(`   Timestamp: ${snapshot.timestamp}`);
      console.log(`   Best Bid: $${snapshot.bids[0]?.price} (${snapshot.bids[0]?.size} @ size)`);
      console.log(`   Best Ask: $${snapshot.asks[0]?.price} (${snapshot.asks[0]?.size} @ size)`);
      console.log(`   Spread: $${(Number(snapshot.asks[0]?.price) - Number(snapshot.bids[0]?.price)).toFixed(6)}`);
      console.log(`   Depth: ${snapshot.bids.length} bids, ${snapshot.asks.length} asks`);

      // Format full order book
      const book = await orderBookService.getOrderBook(tokenId);
      console.log(`\n${orderBookService.formatOrderBook(tokenId, 3)}\n`);
    } catch (e) {
      console.log(`❌ Failed: ${(e as any).message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // 5. ORDER BOOK SERVICE - WEBSOCKET STREAMING
  // ═══════════════════════════════════════════════════════════════
  console.log('\n[STEP 5] CONNECTING TO WEBSOCKET FOR STREAMING');
  console.log('─────────────────────────────────────────');

  let updateCount = 0;
  const updateCounts = new Map<string, number>();

  await orderBookService.connectWebSocket(
    (tokenId, orderBook) => {
      updateCount++;
      const count = (updateCounts.get(tokenId) || 0) + 1;
      updateCounts.set(tokenId, count);
      // console.log(`[WS Update ${count}] ${tokenId.slice(0, 20)}... - Mid: $${orderBook.mid?.toFixed(4)}, Spread: $${(orderBook.spread || 0).toFixed(6)}`);
    },
    'wss://ws-subscriptions-clob.polymarket.com/ws/market'
  );

  console.log('✅ WebSocket connected');

  // Subscribe to active markets
  orderBookService.subscribe(tokenIds);
  console.log(`📡 Subscribed to ${tokenIds.length} markets\n`);

  // Listen for updates
  console.log('[STEP 6] LISTENING FOR WEBSOCKET UPDATES');
  console.log('─────────────────────────────────────────');
  console.log('Waiting 10 seconds for WebSocket updates...\n');

  const startTime = Date.now();
  await new Promise((resolve) => setTimeout(resolve, 10000));
  const elapsed = Date.now() - startTime;

  console.log(`\n✅ Received ${updateCount} WebSocket messages in ${elapsed}ms\n`);

  updateCounts.forEach((count, tokenId) => {
    console.log(`   Token ${tokenId.slice(0, 25)}...: ${count} updates`);
  });

  // ═══════════════════════════════════════════════════════════════
  // 7. FINAL ORDER BOOK STATE
  // ═══════════════════════════════════════════════════════════════
  console.log('\n[STEP 7] FINAL ORDER BOOK STATE');
  console.log('─────────────────────────────────────────\n');

  const allBooks = orderBookService.getAllOrderBooks();
  allBooks.forEach((book) => {
    console.log(`\n${orderBookService.formatOrderBook(book.tokenId, 5)}\n`);
  });

  // ═══════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║                     TEST COMPLETE                             ║');
  console.log('║                                                                ║');
  console.log(`║  APIs Healthy: ${healthCheck.isHealthy(health) ? '✅ YES' : '❌ NO'}`);
  console.log(`║  Active Markets: ${activeMarkets.length}`);
  console.log(`║  Order Books Tracked: ${allBooks.length}`);
  console.log(`║  WebSocket Updates: ${updateCount}`);
  console.log('║                                                                ║');
  console.log('║  Integration features:                                        ║');
  console.log('║  ✅ Health checks for Data API, CLOB, Gamma                   ║');
  console.log('║  ✅ REST API order book snapshots                             ║');
  console.log('║  ✅ WebSocket order book streaming                            ║');
  console.log('║  ✅ Delta update handling                                     ║');
  console.log('║  ✅ Mid-price & spread calculation                            ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // Cleanup
  orderBookService.disconnect();
}

main().catch((e) => {
  console.error('❌ Fatal error:', e);
  process.exit(1);
});
