import { ClobClientWrapper } from '../src/services/polymarket/ClobClient';
import { OrderManager } from '../src/services/polymarket/OrderManager';
import { config as polyConfig } from '../src/services/polymarket/config';
import { config as envConfig } from 'dotenv';

envConfig();

async function testOrdersViaOrderManager() {
  console.log('Testing Open Orders via OrderManager\n');
  console.log('='.repeat(60));
  console.log('Configuration');
  console.log('='.repeat(60));
  console.log('Funder Address from .env:', polyConfig.funderAddress);
  console.log('Private Key loaded:', polyConfig.privateKey ? 'Yes (hidden)' : 'No');
  console.log('API Credentials loaded:', polyConfig.apiCreds ? 'Yes' : 'No');
  
  try {
    // Initialize CLOB client wrapper
    console.log('\n1. Initializing CLOB client...');
    const clobClient = new ClobClientWrapper();
    await clobClient.initialize();
    console.log('✓ CLOB client initialized');
    
    // Check the underlying client has funderAddress
    const client = clobClient.getClient();
    console.log('CLOB Client properties:');
    console.log('  - Signer address:', await client.signer.getAddress());
    console.log('  - Has credentials:', !!client.creds);
    
    // Create order manager
    const orderManager = new OrderManager(clobClient);
    
    // Get open orders - try different methods
    console.log('\n2. Fetching open orders...');
    let orders: any;
    
    // Method 1: Try without funder address (default signer address)
    console.log('  Attempt 1: Default (signer address)...');
    orders = await orderManager.getOpenOrders();
    console.log(`  → Found ${orders.length} orders`);
    
    // Method 2: Try calling client.getOpenOrders directly with funder address
    if (orders.length === 0) {
      console.log('  Attempt 2: With funder address parameter...');
      try {
        const client = clobClient.getClient();
        // Try passing funder address as second parameter (some clients support this)
        orders = await (client as any).getOpenOrders({ funder: polyConfig.funderAddress });
        console.log(`  → Found ${orders.length} orders`);
      } catch (err: any) {
        console.log(`  → Error: ${err.message}`);
      }
    }
    
    // Method 3: If still empty, check what the client actually supports
    if (orders.length === 0) {
      console.log('  Attempt 3: Checking client.getOpenOrders signature...');
      const client = clobClient.getClient();
      const methodStr = client.getOpenOrders.toString();
      console.log('  → Method accepts:', methodStr.substring(0, 150) + '...');
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('RESULTS:');
    console.log('='.repeat(60));
    console.log('Orders found:', Array.isArray(orders) ? orders.length : 'N/A');
    
    if (Array.isArray(orders) && orders.length > 0) {
      console.log('\nOrder Details:');
      orders.forEach((order: any, idx: number) => {
        console.log(`\n  Order ${idx + 1}:`);
        console.log('  -', JSON.stringify(order, null, 4));
      });
    } else {
      console.log('No open orders found');
    }
    
  } catch (error: any) {
    console.error('\n' + '='.repeat(60));
    console.error('ERROR:');
    console.error('='.repeat(60));
    console.error('Message:', error.message);
    if (error.response?.status) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    }
    console.error('\nStack:', error.stack);
  }
}

testOrdersViaOrderManager();
