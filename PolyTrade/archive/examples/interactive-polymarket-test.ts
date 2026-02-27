import { ClobClientWrapper } from '../services/polymarket/ClobClient';
import { OrderManager } from '../services/polymarket/OrderManager';
import { config } from '../services/polymarket/config';
import axios from 'axios';
import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function ask(question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

let clobClient: ClobClientWrapper;
let orderManager: OrderManager;
const userAddress = config.funderAddress;

async function initialize() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║      POLYMARKET INTERACTIVE TEST - Orders & Positions          ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');
  
  console.log('Initializing CLOB client...');
  clobClient = new ClobClientWrapper();
  await clobClient.initialize();
  orderManager = new OrderManager(clobClient);
  
  console.log('✓ Connected to Polymarket CLOB');
  console.log(`✓ User Address: ${userAddress}\n`);
}

async function viewOpenOrders() {
  console.log('\n' + '═'.repeat(70));
  console.log('OPEN ORDERS (Pending Limit Orders)');
  console.log('═'.repeat(70));
  
  try {
    const orders = await orderManager.getOpenOrders();
    
    if (orders.length === 0) {
      console.log('No open orders found.\n');
      return;
    }
    
    console.log(`Found ${orders.length} open order(s):\n`);
    orders.forEach((order: any, idx: number) => {
      console.log(`${idx + 1}. Order ID: ${order.id || order.order_id}`);
      console.log(`   Market: ${order.market || order.token_id || 'Unknown'}`);
      console.log(`   Side: ${order.side}`);
      console.log(`   Price: $${order.price || order.limit_price}`);
      console.log(`   Size: ${order.size || order.original_size}`);
      console.log(`   Status: ${order.status || 'OPEN'}\n`);
    });
  } catch (err: any) {
    console.error('Error fetching orders:', err.message);
  }
}

async function viewOpenPositions() {
  console.log('\n' + '═'.repeat(70));
  console.log('OPEN POSITIONS (Current Holdings)');
  console.log('═'.repeat(70));
  
  try {
    const response = await axios.get(
      `https://data-api.polymarket.com/positions?user=${userAddress}`,
      { timeout: 10000 }
    );
    const positions = response.data || [];
    
    if (positions.length === 0) {
      console.log('No open positions found.\n');
      return;
    }
    
    console.log(`Found ${positions.length} open position(s):\n`);
    
    const activePositions = positions.filter((p: any) => !p.redeemable);
    const expiredPositions = positions.filter((p: any) => p.redeemable);
    
    if (activePositions.length > 0) {
      console.log(`ACTIVE MARKETS (${activePositions.length}):\n`);
      activePositions.forEach((pos: any, idx: number) => {
        console.log(`${idx + 1}. ${pos.title}`);
        console.log(`   Outcome: ${pos.outcome}`);
        console.log(`   Size: ${pos.size} @ $${pos.avgPrice}`);
        console.log(`   Current Price: $${pos.curPrice}`);
        console.log(`   PnL: $${pos.cashPnl} (${pos.percentPnl}%)`);
        console.log(`   Asset ID: ${pos.asset}\n`);
      });
    }
    
    if (expiredPositions.length > 0) {
      console.log(`EXPIRED MARKETS (${expiredPositions.length}) - Redeemable:\n`);
      expiredPositions.forEach((pos: any, idx: number) => {
        console.log(`${idx + 1}. ${pos.title}`);
        console.log(`   Outcome: ${pos.outcome}`);
        console.log(`   Size: ${pos.size}`);
        console.log(`   Status: REDEEMABLE\n`);
      });
    }
    
    const totalPnL = positions.reduce((sum: number, p: any) => sum + (Number(p.cashPnl) || 0), 0);
    console.log(`Total Unrealized PnL: $${totalPnL.toFixed(2)}\n`);
    
  } catch (err: any) {
    console.error('Error fetching positions:', err.message);
  }
}

async function cancelOrder() {
  console.log('\n' + '═'.repeat(70));
  console.log('CANCEL ORDER');
  console.log('═'.repeat(70));
  
  try {
    const orders = await orderManager.getOpenOrders();
    
    if (orders.length === 0) {
      console.log('No open orders to cancel.\n');
      return;
    }
    
    console.log('Open orders:');
    orders.forEach((order: any, idx: number) => {
      const orderId = order.id || order.order_id;
      const size = order.size || order.original_size || order.size_remaining || 'N/A';
      const price = order.price || order.limit_price || '0';
      console.log(`${idx + 1}. ${orderId} - ${order.side} ${size} @ $${price}`);
    });
    
    const choice = await ask('\nEnter order number to cancel (or 0 to go back): ');
    const num = parseInt(choice);
    
    if (num === 0) return;
    
    if (num < 1 || num > orders.length) {
      console.log('Invalid selection.');
      return;
    }
    
    const orderId = (orders[num - 1] as any).id || (orders[num - 1] as any).order_id;
    console.log(`\nCancelling order ${orderId}...`);
    
    await orderManager.cancelOrder(orderId);
    console.log('✓ Order cancelled successfully!\n');
    
  } catch (err: any) {
    console.error('Error cancelling order:', err.message);
  }
}

async function killSwitch() {
  console.log('\n' + '═'.repeat(70));
  console.log('KILL SWITCH - Cancel All Orders');
  console.log('═'.repeat(70));
  
  try {
    const orders = await orderManager.getOpenOrders();
    
    if (orders.length === 0) {
      console.log('No open orders to cancel.\n');
      return;
    }
    
    console.log(`Found ${orders.length} open order(s).`);
    const confirm = await ask('\n⚠️  Are you sure you want to cancel ALL orders? (yes/no): ');
    
    if (confirm.toLowerCase() !== 'yes') {
      console.log('Kill switch cancelled.\n');
      return;
    }
    
    console.log('\nCancelling all orders...');
    await orderManager.cancelAll();
    console.log('✓ All orders cancelled successfully!\n');
    
  } catch (err: any) {
    console.error('Error in kill switch:', err.message);
  }
}

async function createOrder() {
  console.log('\n' + '═'.repeat(70));
  console.log('CREATE ORDER');
  console.log('═'.repeat(70));
  
  try {
    console.log('Enter order details:\n');
    
    const tokenId = await ask('Token ID (asset ID from positions): ');
    const side = await ask('Side (BUY/SELL): ');
    const price = await ask('Price ($): ');
    const size = await ask('Size (shares): ');
    
    if (!tokenId || !side || !price || !size) {
      console.log('Missing required fields.');
      return;
    }
    
    const orderParams = {
      tokenId: tokenId.trim(),
      side: side.trim().toUpperCase() as 'BUY' | 'SELL',
      price: parseFloat(price),
      size: parseFloat(size),
      orderType: 'GTC' as const
    };
    
    console.log('\nOrder summary:');
    console.log(`  Token: ${orderParams.tokenId}`);
    console.log(`  Side: ${orderParams.side}`);
    console.log(`  Price: $${orderParams.price}`);
    console.log(`  Size: ${orderParams.size}`);
    
    const confirm = await ask('\nConfirm order? (yes/no): ');
    if (confirm.toLowerCase() !== 'yes') {
      console.log('Order cancelled.\n');
      return;
    }
    
    console.log('\nPlacing order...');
    const result = await orderManager.placeOrder(orderParams);
    console.log('✓ Order placed successfully!');
    console.log('Result:', JSON.stringify(result, null, 2));
    console.log();
    
  } catch (err: any) {
    console.error('Error creating order:', err.message);
  }
}

async function viewClosedPositions() {
  console.log('\n' + '═'.repeat(70));
  console.log('CLOSED POSITIONS (Realized PnL)');
  console.log('═'.repeat(70));
  
  try {
    const response = await axios.get(
      `https://data-api.polymarket.com/closed-positions?user=${userAddress}`,
      { timeout: 10000 }
    );
    const positions = response.data || [];
    
    if (positions.length === 0) {
      console.log('No closed positions found.\n');
      return;
    }
    
    console.log(`Found ${positions.length} closed position(s):\n`);
    positions.forEach((pos: any, idx: number) => {
      console.log(`${idx + 1}. ${pos.title}`);
      console.log(`   Outcome: ${pos.outcome}`);
      console.log(`   Bought: ${pos.totalBought} @ $${pos.avgPrice}`);
      console.log(`   Realized PnL: $${pos.realizedPnl}\n`);
    });
    
    const totalRealized = positions.reduce((sum: number, p: any) => sum + (Number(p.realizedPnl) || 0), 0);
    console.log(`Total Realized PnL: $${totalRealized.toFixed(2)}\n`);
    
  } catch (err: any) {
    console.error('Error fetching closed positions:', err.message);
  }
}

async function showMenu() {
  console.log('\n' + '═'.repeat(70));
  console.log('MAIN MENU');
  console.log('═'.repeat(70));
  console.log('1. View Open Orders');
  console.log('2. View Open Positions');
  console.log('3. View Closed Positions');
  console.log('4. Create Order');
  console.log('5. Cancel Order');
  console.log('6. Kill Switch (Cancel All Orders)');
  console.log('0. Exit');
  console.log('═'.repeat(70));
  
  const choice = await ask('\nSelect option: ');
  
  switch (choice.trim()) {
    case '1':
      await viewOpenOrders();
      break;
    case '2':
      await viewOpenPositions();
      break;
    case '3':
      await viewClosedPositions();
      break;
    case '4':
      await createOrder();
      break;
    case '5':
      await cancelOrder();
      break;
    case '6':
      await killSwitch();
      break;
    case '0':
      console.log('\nGoodbye!\n');
      rl.close();
      process.exit(0);
    default:
      console.log('\nInvalid option. Please try again.');
  }
  
  // Show menu again
  await showMenu();
}

async function main() {
  try {
    await initialize();
    await showMenu();
  } catch (err: any) {
    console.error('\n❌ Fatal error:', err.message);
    rl.close();
    process.exit(1);
  }
}

main();
