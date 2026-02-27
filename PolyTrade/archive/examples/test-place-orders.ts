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
  console.log('║          PLACE BUY/SELL ORDERS (Interactive)                    ║');
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

  // 2) Fetch open positions
  console.log('[STEP 2] Fetching OPEN POSITIONS (Data API)');
  let positionsRaw: any[] = [];
  try {
    positionsRaw = await getOpenPositions(userAddress);
  } catch (e) {
    console.error('❌ Failed to fetch open positions:', (e as any)?.message || e);
    process.exit(1);
  }

  const positions = positionsRaw
    .map(normalizePosition)
    .filter((p) => p.assetId && !p.redeemable && p.size > 0 && p.price > 0);

  if (positions.length === 0) {
    console.log('⚠️  No active positions found. Cannot place orders without positions.\n');
    process.exit(0);
  }

  console.log(`✅ Found ${positions.length} active positions:\n`);
  positions.forEach((p, idx) => {
    console.log(
      `  ${idx + 1}. ${p.title.slice(0, 60).padEnd(60)} | ${p.side} ${p.size.toFixed(2)} @ $${p.price.toFixed(4)} | token ${p.assetId.slice(0, 20)}...`
    );
  });
  console.log('');

  // 3) Interactive prompt: Pick market
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string) => new Promise<string>((res) => rl.question(q, res));

  const marketChoice = (await ask('Select market (1-' + positions.length + '): ')).trim();
  const marketIdx = Number(marketChoice);

  if (!Number.isInteger(marketIdx) || marketIdx < 1 || marketIdx > positions.length) {
    console.log('⚠️  Invalid market selection.');
    rl.close();
    process.exit(0);
  }

  const selectedPos = positions[marketIdx - 1];
  console.log(`\n✅ Selected: ${selectedPos.title}`);
  console.log(`   Current position: ${selectedPos.side} ${selectedPos.size.toFixed(2)} @ $${selectedPos.price.toFixed(4)}`);
  console.log(`   Token: ${selectedPos.assetId}`);
  console.log('');

  // 4) Fetch order book for this market
  console.log('[STEP 3] Fetching order book...');
  try {
    const book = await orderBookService.getOrderBook(selectedPos.assetId, 1);
    console.log(`   Mid: $${(book.mid || 0).toFixed(4)}`);
    console.log(`   Spread: $${(book.spread || 0).toFixed(6)}`);
    console.log(`   Best Bid: $${book.bids[book.bids.length - 1]?.price || 'N/A'}`);
    console.log(`   Best Ask: $${book.asks[0]?.price || 'N/A'}\n`);
  } catch (e) {
    console.warn(`⚠️  Could not fetch order book:`, (e as any)?.message);
  }

  // 5) Interactive prompt: Side (BUY or SELL)
  const sideChoice = (await ask('Order side? (B=BUY, S=SELL): ')).trim().toUpperCase();
  if (!['B', 'S'].includes(sideChoice)) {
    console.log('⚠️  Invalid side.');
    rl.close();
    process.exit(0);
  }
  const side = sideChoice === 'B' ? 'BUY' : 'SELL';
  console.log(`✅ Order side: ${side}\n`);

  // 6) Interactive prompt: Price
  const priceStr = (await ask('Enter price (0.01 - 0.99): ')).trim();
  const price = Number(priceStr);
  if (!Number.isFinite(price) || price < 0.01 || price > 0.99) {
    console.log('⚠️  Invalid price.');
    rl.close();
    process.exit(0);
  }
  console.log(`✅ Price: $${price.toFixed(4)}\n`);

  // 7) Interactive prompt: Size
  const sizeStr = (await ask('Enter size (must be > 0): ')).trim();
  const size = Number(sizeStr);
  if (!Number.isFinite(size) || size <= 0) {
    console.log('⚠️  Invalid size.');
    rl.close();
    process.exit(0);
  }
  console.log(`✅ Size: ${size}\n`);

  // 8) Confirm order
  const confirm = (await ask(`Place ${side} ${size} @ $${price.toFixed(4)} on ${selectedPos.title.slice(0, 50)}? (y/n): `)).trim().toLowerCase();
  if (confirm !== 'y') {
    console.log('❌ Order cancelled.\n');
    rl.close();
    process.exit(0);
  }

  rl.close();

  // 9) Place order
  console.log('\n[STEP 4] Placing order...');
  try {
    const result = await orderManager.placeOrder({
      tokenId: selectedPos.assetId,
      side: side,
      price: price,
      size: size,
    });

    console.log('✅ Order placed successfully!');
    console.log('   Order ID:', result.id || result.orderId || 'unknown');
    console.log('   Response:', JSON.stringify(result, null, 2));
  } catch (e) {
    console.error('❌ Failed to place order:', (e as any)?.message || e);
    process.exit(1);
  }

  // 10) Fetch updated open orders
  console.log('\n[STEP 5] Fetching updated open orders...');
  try {
    const openOrders = await orderManager.getOpenOrders();
    console.log(`✅ Total open orders: ${openOrders.length}\n`);
    if (openOrders.length > 0) {
      console.log('Recent orders:');
      openOrders.slice(-5).forEach((o: any, idx) => {
        const side = String(o.side || 'BUY').toUpperCase();
        const price = Number(o.price || o.limit_price || 0).toFixed(4);
        const size = Number(o.size || o.size_remaining || 0);
        console.log(`  ${idx + 1}. ${side} ${size} @ $${price} | status: ${o.status || 'open'}`);
      });
    }
  } catch (e) {
    console.warn('⚠️  Could not fetch updated orders:', (e as any)?.message);
  }

  // 11) Summary
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                      ORDER PLACED                              ║');
  console.log('║                                                                ║');
  console.log(`║  Market: ${selectedPos.title.slice(0, 50).padEnd(50)}`);
  console.log(`║  Side: ${side.padEnd(57)}`);
  console.log(`║  Price: $${price.toFixed(4).padEnd(51)}`);
  console.log(`║  Size: ${String(size).padEnd(57)}`);
  console.log('║                                                                ║');
  console.log('║  ✅ Order successfully submitted to CLOB                       ║');
  console.log('║  ℹ️  Check dashboard or re-run test script to verify          ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  orderBookService.disconnect();
}

main().catch((e) => {
  console.error('❌ Fatal error:', e);
  process.exit(1);
});
