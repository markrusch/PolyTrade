import { ClobClientWrapper } from '../src/services/polymarket/ClobClient';
import { config as polyConfig } from '../src/services/polymarket/config';
import { config as envConfig } from 'dotenv';

envConfig();

async function testApiConnection() {
  console.log('Testing CLOB API Connection and Authentication\n');
  console.log('='.repeat(60));
  
  try {
    console.log('Initializing CLOB client...');
    const clobClient = new ClobClientWrapper();
    await clobClient.initialize();
    const client = clobClient.getClient();
    
    console.log('✓ Client initialized\n');
    
    // Test 1: Get markets (confirms API connection)
    console.log('Test 1: Fetching markets (verifies API connection)...');
    try {
      const markets = await client.getMarkets();
      console.log(`✓ API connection working! Found ${markets?.length || 0} markets`);
    } catch (err: any) {
      console.error('✗ Failed to get markets:', err.message);
    }
    
    // Test 2: Get user orders via getUserOrders or similar
    console.log('\nTest 2: Attempting different order query methods...');
    const client_any = client as any;
    
    // List all methods that might query orders
    console.log('Available methods on client:');
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(client))
      .filter(m => m.includes('order') || m.includes('Order') || m.includes('user') || m.includes('User'))
      .slice(0, 20);
    methods.forEach(m => console.log('  -', m));
    
    // Test 3: Try getOpenOrders with verbose error logging
    console.log('\nTest 3: Calling getOpenOrders()...');
    try {
      const orders = await client.getOpenOrders({ funder: polyConfig.funderAddress }, true);
      console.log('Result type:', typeof orders);
      console.log('Is array:', Array.isArray(orders));
      console.log('Length:', orders?.length);
      console.log('Content:', JSON.stringify(orders, null, 2));
    } catch (err: any) {
      console.error('Error:', err.message);
      if (err.response) {
        console.error('Response status:', err.response.status);
        console.error('Response data:', err.response.data);
      }
    }
    
  } catch (error: any) {
    console.error('\nFATAL ERROR:', error.message);
    console.error(error);
  }
}

testApiConnection();
