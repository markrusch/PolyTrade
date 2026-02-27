import { ClobClientWrapper } from '../services/polymarket/ClobClient';
import {
  getOpenPositions,
  getClosedPositions,
  getOpenOrders as dataApiGetOpenOrders,
  getTrades,
  getPortfolioValue,
  getUserActivity,
} from '../services/polymarket/DataApi';
import { config } from '../services/polymarket/config';

async function main() {
  const userAddress = config.funderAddress || process.env.POLYMARKET_USER_ADDRESS || '';
  if (!userAddress) throw new Error('Missing funder/user address in env');

  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║         POLYMARKET COMPREHENSIVE SNAPSHOT                     ║');
  console.log('║      Using Funder Address:', userAddress);
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // Initialize CLOB client for open orders
  const clob = new ClobClientWrapper();
  await clob.initialize();
  const client = clob.getClient();

  // 1. Get Open Orders (from CLOB - requires authentication)
  console.log('\n📋 OPEN ORDERS (CLOB - Pending Execution)');
  console.log('─────────────────────────────────────────');
  try {
    const openOrders = await client.getOpenOrders();
    if (Array.isArray(openOrders) && openOrders.length > 0) {
      console.log(`Found ${openOrders.length} open orders:\n`);
      openOrders.forEach((order: any, idx: number) => {
        console.log(
          `  ${idx + 1}. Order ID: ${order.id}`
        );
        console.log(`     Token: ${order.tokenID}`);
        console.log(`     Side: ${order.side} | Price: $${order.price} | Size: ${order.size}`);
        console.log(`     Status: ${order.status || 'OPEN'}`);
      });
    } else {
      console.log('✅ No open orders (ready to trade)');
    }
  } catch (e) {
    console.log('❌ Error fetching open orders:', (e as any).message);
  }

  // 2. Get ACTIVE/OPEN Positions
  console.log('\n📈 OPEN POSITIONS (ACTIVE - Currently Held)');
  console.log('─────────────────────────────────────────');
  try {
    const openPos = await getOpenPositions(userAddress);
    const positions = Array.isArray(openPos) ? openPos : [];
    if (positions.length > 0) {
      console.log(`Found ${positions.length} active positions:\n`);
      positions.forEach((pos: any, idx: number) => {
        const status = pos.redeemable ? '[EXPIRED - redeemable]' : '[ACTIVE]';
        console.log(
          `  ${idx + 1}. ${pos.title || 'Unknown Market'} ${status}`
        );
        console.log(`     Asset: ${pos.asset} | Outcome: ${pos.outcome}`);
        console.log(
          `     Size: ${pos.size} | Avg Price: $${pos.avgPrice} | Current Price: $${pos.curPrice}`
        );
        console.log(
          `     Unrealized PnL: $${pos.cashPnl} (${pos.percentPnl}%)`
        );
      });
      // Summary
      const totalUnrealized = positions.reduce(
        (sum: number, p: any) => sum + (Number(p.cashPnl) || 0),
        0
      );
      console.log(`\n  📊 Total Unrealized PnL: $${totalUnrealized.toFixed(2)}`);
    } else {
      console.log('✅ No active open positions');
    }
  } catch (e) {
    console.log('❌ Error fetching open positions:', (e as any).message);
  }

  // 3. Get CLOSED Positions
  console.log('\n📉 CLOSED POSITIONS (INACTIVE - Fully Exited)');
  console.log('──────────────────────────────────────────');
  try {
    const closedPos = await getClosedPositions(userAddress);
    const positions = Array.isArray(closedPos) ? closedPos : [];
    if (positions.length > 0) {
      console.log(`Found ${positions.length} closed positions:\n`);
      positions.forEach((pos: any, idx: number) => {
        console.log(
          `  ${idx + 1}. ${pos.title || 'Unknown Market'} [CLOSED]`
        );
        console.log(`     Asset: ${pos.asset} | Outcome: ${pos.outcome}`);
        console.log(
          `     Bought: ${pos.totalBought} @ $${pos.avgPrice}`
        );
        console.log(
          `     Realized PnL: $${pos.realizedPnl} | Final Price: $${pos.curPrice}`
        );
      });
      // Summary
      const totalRealized = positions.reduce(
        (sum: number, p: any) => sum + (Number(p.realizedPnl) || 0),
        0
      );
      console.log(`\n  📊 Total Realized PnL: $${totalRealized.toFixed(2)}`);
    } else {
      console.log('✅ No closed positions');
    }
  } catch (e) {
    console.log('❌ Error fetching closed positions:', (e as any).message);
  }

  // 4. Get Portfolio Value
  console.log('\n💰 PORTFOLIO VALUE');
  console.log('──────────────────');
  try {
    const value = await getPortfolioValue(userAddress);
    console.log(`  Total Value: $${value?.value || 'N/A'}`);
  } catch (e) {
    console.log('❌ Error fetching portfolio value:', (e as any).message);
  }

  // 5. Get Recent Activity/Trades
  console.log('\n📝 RECENT ACTIVITY (Last 10 events)');
  console.log('──────────────────────────────────');
  try {
    const activity = await getUserActivity(userAddress, 10, 0);
    const activities = Array.isArray(activity) ? activity : [];
    if (activities.length > 0) {
      activities.slice(0, 10).forEach((act: any, idx: number) => {
        const ts = new Date((act.timestamp || 0) * 1000).toLocaleString();
        console.log(
          `  ${idx + 1}. ${act.type || 'UNKNOWN'} | ${ts}`
        );
        if (act.side) console.log(`     ${act.side}: ${act.size} @ $${act.price}`);
        if (act.eventSlug) console.log(`     Market: ${act.eventSlug}`);
      });
    } else {
      console.log('✅ No recent activity');
    }
  } catch (e) {
    console.log('❌ Error fetching activity:', (e as any).message);
  }

  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║                  SNAPSHOT COMPLETE                            ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
