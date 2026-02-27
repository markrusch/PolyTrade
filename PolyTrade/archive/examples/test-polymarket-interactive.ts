import { ClobClientWrapper } from '../services/polymarket/ClobClient';
import { startPolymarketService } from '../services/polymarket/index';
import {
  getOpenPositions,
  getClosedPositions,
  getUserActivity,
} from '../services/polymarket/DataApi';
import { config } from '../services/polymarket/config';

async function main() {
  const userAddress = config.funderAddress || process.env.POLYMARKET_USER_ADDRESS || '';
  if (!userAddress) throw new Error('Missing funder/user address in env');

  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║     POLYMARKET TEST SCRIPT - Orders, Positions & Streaming     ║');
  console.log('║      User:', userAddress);
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // Initialize CLOB client
  const clob = new ClobClientWrapper();
  await clob.initialize();

  // ═══════════════════════════════════════════════════════════════
  // 1. FETCH OPEN ORDERS
  // ═══════════════════════════════════════════════════════════════
  console.log('\n[STEP 1] Fetching OPEN ORDERS from CLOB...');
  console.log('─────────────────────────────────────────');
  try {
    const openOrders = await clob.getClient().getOpenOrders();
    if (Array.isArray(openOrders) && openOrders.length > 0) {
      console.log(`✅ Found ${openOrders.length} open orders:\n`);
      openOrders.forEach((order: any, idx: number) => {
        console.log(`  Order ${idx + 1}:`);
        console.log(`    ID: ${order.id}`);
        console.log(`    Token: ${order.tokenID}`);
        console.log(`    ${order.side} ${order.size} @ $${order.price}`);
        console.log(`    Status: ${order.status || 'OPEN'}\n`);
      });
    } else {
      console.log('✅ No open orders - ready to trade\n');
    }
  } catch (e) {
    console.log('❌ Error:', (e as any).message, '\n');
  }

  // ═══════════════════════════════════════════════════════════════
  // 2. FETCH OPEN POSITIONS
  // ═══════════════════════════════════════════════════════════════
  console.log('[STEP 2] Fetching OPEN POSITIONS from Core API...');
  console.log('──────────────────────────────────────────────────');
  let activePositions: any[] = [];
  let expiredPositions: any[] = [];
  try {
    const openPos = await getOpenPositions(userAddress);
    const positions = Array.isArray(openPos) ? openPos : [];

    // Categorize into active and expired
    activePositions = positions.filter((p: any) => !p.redeemable);
    expiredPositions = positions.filter((p: any) => p.redeemable);

    console.log(`✅ Found ${positions.length} total positions:\n`);

    if (activePositions.length > 0) {
      console.log(`   🟢 ACTIVE MARKETS (${activePositions.length}):\n`);
      activePositions.forEach((pos: any, idx: number) => {
        console.log(`     ${idx + 1}. ${pos.title}`);
        console.log(`        Outcome: ${pos.outcome} | Size: ${pos.size} @ $${pos.avgPrice}`);
        console.log(`        Current Price: $${pos.curPrice} | PnL: $${pos.cashPnl} (${pos.percentPnl}%)\n`);
      });
    }

    if (expiredPositions.length > 0) {
      console.log(`   🔴 EXPIRED MARKETS (${expiredPositions.length}) - Redeemable:\n`);
      expiredPositions.forEach((pos: any, idx: number) => {
        console.log(`     ${idx + 1}. ${pos.title}`);
        console.log(`        Outcome: ${pos.outcome} | Size: ${pos.size} | Status: REDEEMABLE\n`);
      });
    }

    // Summary
    const totalUnrealized = positions.reduce(
      (sum: number, p: any) => sum + (Number(p.cashPnl) || 0),
      0
    );
    console.log(`   📊 Total Unrealized PnL: $${totalUnrealized.toFixed(2)}\n`);
  } catch (e) {
    console.log('❌ Error:', (e as any).message, '\n');
  }

  // ═══════════════════════════════════════════════════════════════
  // 3. FETCH CLOSED POSITIONS
  // ═══════════════════════════════════════════════════════════════
  console.log('[STEP 3] Fetching CLOSED POSITIONS with PnL...');
  console.log('────────────────────────────────────────────────');
  try {
    const closedPos = await getClosedPositions(userAddress);
    const positions = Array.isArray(closedPos) ? closedPos : [];

    if (positions.length > 0) {
      console.log(`✅ Found ${positions.length} closed positions:\n`);
      positions.forEach((pos: any, idx: number) => {
        console.log(`  ${idx + 1}. ${pos.title}`);
        console.log(`     Outcome: ${pos.outcome}`);
        console.log(`     Bought: ${pos.totalBought} @ $${pos.avgPrice}`);
        console.log(`     Realized PnL: $${pos.realizedPnl} (Final: $${pos.curPrice})\n`);
      });

      const totalRealized = positions.reduce(
        (sum: number, p: any) => sum + (Number(p.realizedPnl) || 0),
        0
      );
      console.log(`  📊 Total Realized PnL: $${totalRealized.toFixed(2)}\n`);
    } else {
      console.log('✅ No closed positions\n');
    }
  } catch (e) {
    console.log('❌ Error:', (e as any).message, '\n');
  }

  // ═══════════════════════════════════════════════════════════════
  // 4. SUBSCRIBE TO ACTIVE MARKET & STREAM
  // ═══════════════════════════════════════════════════════════════
  console.log('[STEP 4] Setting up MARKET SUBSCRIPTION...');
  console.log('────────────────────────────────────────────');

  if (activePositions.length > 0) {
    const firstActiveMarket = activePositions[0];
    const tokenId = String(firstActiveMarket.asset);
    const marketTitle = firstActiveMarket.title;

    console.log(`✅ Subscribing to: ${marketTitle}`);
    console.log(`   Token ID: ${tokenId}\n`);

    // Initialize service and connect
    const assetIdsToSubscribe = [tokenId];
    const svc = await startPolymarketService(assetIdsToSubscribe);

    // Connect to market updates
    await svc.marketWs.connect((update) => {
      if (String(update.asset_id) === tokenId && update.event_type === 'last_trade_price') {
        const ts = new Date().toLocaleTimeString();
        console.log(`   [${ts}] Price Update: $${update.data.price}`);
      }
    });

    console.log(`   📡 Listening for price updates (for 15 seconds)...\n`);

    // Listen for updates for 15 seconds
    await new Promise((resolve) => setTimeout(resolve, 15000));

    // Close connection
    console.log(`\n   ✅ Closing market subscription...\n`);
    svc.stop();
  } else {
    console.log('⚠️  No active positions to subscribe to (all markets expired)\n');
  }

  // ═══════════════════════════════════════════════════════════════
  // 5. SUMMARY
  // ═══════════════════════════════════════════════════════════════
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║                     TEST COMPLETE                             ║');
  console.log('║                                                                ║');
  console.log(`║  Open Orders: ${(await clob.getClient().getOpenOrders()).length}`);
  console.log(`║  Active Positions: ${activePositions.length}`);
  console.log(`║  Expired Positions: ${expiredPositions.length}`);
  console.log('║                                                                ║');
  console.log('║  Next Steps:                                                   ║');
  console.log('║  1. Use orderManager.placeOrder() to trade                    ║');
  console.log('║  2. Use orderManager.cancelOrder(id) to cancel               ║');
  console.log('║  3. Use orderManager.cancelAll() for killswitch              ║');
  console.log('║  4. Monitor positions via positionTracker.updatePositions()  ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
}

main().catch((e) => {
  console.error('❌ Fatal error:', e);
  process.exit(1);
});
