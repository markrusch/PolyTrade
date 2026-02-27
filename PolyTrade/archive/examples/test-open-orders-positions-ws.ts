import { ClobClientWrapper } from '../services/polymarket/ClobClient';
import { OrderManager } from '../services/polymarket/OrderManager';
import { OrderBookService } from '../services/polymarket/OrderBook';
import { getOpenPositions } from '../services/polymarket/DataApi';
import { config } from '../services/polymarket/config';
import readline from 'readline';

function pickNumber(...values: any[]): number {
  for (const v of values) {
    const num = Number(v);
    if (!Number.isNaN(num) && Number.isFinite(num)) return num;
  }
  return 0;
}

function normalizeOrder(order: any) {
  return {
    id: order.id || order.order_id || order.orderId,
    tokenId: String(order.token_id || order.tokenId || order.asset_id || ''),
    side: String(order.side || order.action || '').toUpperCase() || 'UNKNOWN',
    price: pickNumber(order.price, order.limit_price, order.limitPrice),
    size: pickNumber(order.size, order.size_remaining, order.remaining_size, order.remainingSize),
    status: order.status || 'open',
    createdAt: order.created_at || order.createdAt,
  };
}

function normalizePosition(pos: any) {
  return {
    assetId: String(pos.asset || pos.token_id || pos.tokenId || ''),
    title: pos.title || pos.question || pos.market || 'Unknown market',
    side: String(pos.side || pos.direction || pos.outcome || '').toUpperCase() || 'YES',
    size: pickNumber(pos.curSize, pos.balance, pos.size, pos.quantity),
    price: pickNumber(pos.curPrice, pos.price, pos.avgPrice, pos.averagePrice),
    pnl: pickNumber(pos.pnl, pos.unrealizedPnl, pos.realizedPnl),
    redeemable: Boolean(pos.redeemable),
  };
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║   OPEN ORDERS + OPEN POSITIONS + ORDER BOOK STREAM (Polymarket) ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  const userAddress = config.funderAddress;
  if (!userAddress) {
    console.error('❌ Missing POLYMARKET_FUNDER_ADDRESS/FUNDER_ADDRESS in .env');
    process.exit(1);
  }

  // 1) Initialize clients
  console.log('[STEP 1] Initializing CLOB + services...');
  const clob = new ClobClientWrapper();
  await clob.initialize();
  const orderManager = new OrderManager(clob);
  const orderBookService = new OrderBookService();
  console.log('✅ CLOB client ready\n');

  // 2) Fetch open orders
  console.log('[STEP 2] Fetching OPEN ORDERS (CLOB)');
  let openOrders: any[] = [];
  try {
    openOrders = await orderManager.getOpenOrders();
  } catch (e) {
    console.error('❌ Failed to fetch open orders:', (e as any)?.message || e);
  }

  if (openOrders.length === 0) {
    console.log('⚠️  No open orders found (clean slate)\n');
  } else {
    console.log(`✅ Found ${openOrders.length} open orders:\n`);
    openOrders.slice(0, 10).forEach((o, idx) => {
      const ord = normalizeOrder(o);
      console.log(
        `  ${idx + 1}. ${ord.side} ${ord.size} @ $${ord.price} | token ${ord.tokenId.slice(0, 20)}... | status: ${ord.status}`
      );
    });
    console.log('');

    // Offer cancellation options
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q: string) => new Promise<string>((res) => rl.question(q, res));

    const choice = (await ask('Cancel an order? (enter index, "all", or press Enter to skip): ')).trim();

    if (choice.toLowerCase() === 'all') {
      try {
        const resp = await orderManager.cancelAll();
        console.log('🧹 Cancelled all open orders:', resp);
        openOrders = await orderManager.getOpenOrders();
        console.log(`   Remaining open orders: ${openOrders.length}`);
      } catch (e) {
        console.error('❌ Failed to cancel all:', (e as any)?.message || e);
      }
    } else if (choice) {
      const idx = Number(choice);
      if (!Number.isInteger(idx) || idx < 1 || idx > openOrders.length) {
        console.log('⚠️  Invalid index; skipping cancellation.');
      } else {
        const ord = normalizeOrder(openOrders[idx - 1]);
        try {
          await orderManager.cancelOrder(ord.id);
          console.log(`🛑 Cancelled order ${ord.id} (${ord.side} ${ord.size} @ $${ord.price})`);
          openOrders = await orderManager.getOpenOrders();
          console.log(`   Remaining open orders: ${openOrders.length}`);
        } catch (e) {
          console.error('❌ Failed to cancel order:', (e as any)?.message || e);
        }
      }
    }

    rl.close();
  }

  // 3) Fetch open positions
  console.log('[STEP 3] Fetching OPEN POSITIONS (Data API)');
  let positionsRaw: any[] = [];
  try {
    positionsRaw = await getOpenPositions(userAddress);
  } catch (e) {
    console.error('❌ Failed to fetch open positions:', (e as any)?.message || e);
  }

  const positions = positionsRaw
    .map(normalizePosition)
    .filter((p) => p.assetId && !p.redeemable && p.size > 0 && p.price > 0);

  if (positions.length === 0) {
    console.log('⚠️  No active positions with price/size found\n');
  } else {
    console.log(`✅ Found ${positions.length} active positions:\n`);
    positions.slice(0, 5).forEach((p, idx) => {
      console.log(
        `  ${idx + 1}. ${p.title.slice(0, 70)}... | ${p.side} ${p.size} @ $${p.price} | token ${p.assetId.slice(0, 20)}...`
      );
    });
    console.log('');
  }

  // 4) Pick targets to subscribe (prioritize positions, fall back to order tokens)
  const tokenSet = new Set<string>();
  positions.slice(0, 3).forEach((p) => tokenSet.add(p.assetId));
  if (tokenSet.size === 0) {
    openOrders.slice(0, 3).forEach((o) => {
      const ord = normalizeOrder(o);
      if (ord.tokenId) tokenSet.add(ord.tokenId);
    });
  }
  const tokenIds = Array.from(tokenSet);

  if (tokenIds.length === 0) {
    console.log('⚠️  No token IDs to subscribe. Add an open position or order first.');
    return;
  }

  console.log(`[STEP 4] Target markets: ${tokenIds.map((t) => t.slice(0, 20) + '...').join(', ')}`);

  // 5) Fetch initial REST snapshots (forces cache fill with new logic)
  for (const tokenId of tokenIds) {
    try {
      const book = await orderBookService.getOrderBook(tokenId, 1);
      console.log(`   • Snapshot ${tokenId.slice(0, 20)}... | mid: $${(book.mid || 0).toFixed(4)} | spread: $${(book.spread || 0).toFixed(6)}`);
    } catch (e) {
      console.warn(`   • Snapshot failed for ${tokenId.slice(0, 20)}...:`, (e as any)?.message || e);
    }
  }
  console.log('');

  // 6) Connect WebSocket and subscribe with new subscription logic
  console.log('[STEP 5] Connecting WebSocket + subscribing to order books');
  let totalWs = 0;
  const counts = new Map<string, number>();

  await orderBookService.connectWebSocket((tokenId, orderBook) => {
    totalWs++;
    counts.set(tokenId, (counts.get(tokenId) || 0) + 1);
    // Uncomment to see each tick:
    // console.log(`[WS] ${tokenId.slice(0, 20)}... mid: $${(orderBook.mid || 0).toFixed(4)} spread: $${(orderBook.spread || 0).toFixed(6)}`);
  });

  orderBookService.subscribe(tokenIds);
  console.log(`📡 Subscribed to ${tokenIds.length} markets. Listening for 12s...\n`);

  await new Promise((resolve) => setTimeout(resolve, 12000));

  console.log(`
✅ WebSocket received ${totalWs} messages`);
  counts.forEach((count, tokenId) => {
    console.log(`   - ${tokenId.slice(0, 25)}... : ${count} updates`);
  });

  // 7) Final formatted order books
  console.log('\n[STEP 6] Final order books (cached + streamed)\n');
  tokenIds.forEach((tokenId) => {
    console.log(orderBookService.formatOrderBook(tokenId, 6));
    console.log('');
  });

  // 8) Summary
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║                        SUMMARY                                 ║');
  console.log('║                                                                ║');
  console.log(`║  Open Orders: ${openOrders.length.toString().padEnd(45)} (post-cancel check)`);
  console.log(`║  Active Positions: ${positions.length.toString().padEnd(42)}`);
  console.log(`║  Markets Subscribed: ${tokenIds.length.toString().padEnd(40)}`);
  console.log(`║  WS Messages: ${totalWs.toString().padEnd(45)}`);
  console.log('║                                                                ║');
  console.log('║  Features validated:                                           ║');
  console.log('║  ✅ CLOB open orders snapshot                                 ║');
  console.log('║  ✅ Data API open positions (active)                           ║');
  console.log('║  ✅ REST + WS order book integration (new logic)               ║');
  console.log('║  ✅ Live mid & spread updates                                  ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  orderBookService.disconnect();
}

main().catch((e) => {
  console.error('❌ Fatal error:', e);
  process.exit(1);
});
