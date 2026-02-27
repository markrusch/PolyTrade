import { ClobClientWrapper } from '../src/services/polymarket/ClobClient';
import { config as polyConfig } from '../src/services/polymarket/config';
import { config as envConfig } from 'dotenv';

envConfig();

async function testGetOrders() {
  console.log('Testing CLOB Client - Get Open Orders\n');
  console.log('='.repeat(60));
  console.log('CONFIGURATION');
  console.log('='.repeat(60));
  console.log('Funder Address from .env:', polyConfig.funderAddress);
  console.log('Private Key loaded:', polyConfig.privateKey ? 'Yes (hidden)' : 'No');
  console.log('API Key loaded:', polyConfig.apiCreds?.key ? 'Yes' : 'No');
  console.log('Secret loaded:', polyConfig.apiCreds?.secret ? 'Yes (hidden)' : 'No');
  console.log('Passphrase loaded:', polyConfig.apiCreds?.passphrase ? 'Yes (hidden)' : 'No');
  console.log('Chain ID:', polyConfig.chainId);
  console.log('CLOB Host:', polyConfig.clobHost);
  
  try {
    // Initialize CLOB client
    console.log('\n1. Initializing CLOB client...');
    const clobClient = new ClobClientWrapper();
    await clobClient.initialize();
    console.log('✓ CLOB client initialized');

    // Get open orders
    console.log('\n2. Fetching open orders for configured address...');
    const client = clobClient.getClient();
    
    // Get signer address
    if (client.signer) {
      try {
        const address = await client.signer.getAddress();
        console.log('Signer Address (proxy):', address);
        if (address.toLowerCase() === polyConfig.funderAddress?.toLowerCase()) {
          console.log('✓ Matches configured FUNDER_ADDRESS');
        } else {
          console.log('⚠ Signer is proxy wallet for:', polyConfig.funderAddress);
        }
      } catch (err) {
        console.log('Could not get address from signer');
      }
    }
    
    // Check credentials
    if (client.creds) {
      console.log('API Credentials loaded:', 'Yes');
    }
    
    // Try getOpenOrders with funder address parameter
    let orders: any;
    try {
      // Method 1: Try with funder address as parameter
      orders = await client.getOpenOrders({ funder: polyConfig.funderAddress }, true);
      console.log('✓ Called getOpenOrders with funder address parameter');
    } catch (err: any) {
      console.log('⚠ Method with funder address failed, trying without parameter');
      // Method 2: Try without parameter (uses default from client init)
      orders = await client.getOpenOrders({}, true);
      console.log('✓ Called getOpenOrders with empty options');
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('RAW RESPONSE:');
    console.log('='.repeat(60));
    console.log('Type:', typeof orders);
    console.log('Is Array:', Array.isArray(orders));
    console.log('Length:', orders?.length);
    console.log('Content:', JSON.stringify(orders, null, 2));
    
    console.log('\n' + '='.repeat(60));
    console.log('RESULTS:');
    console.log('='.repeat(60));
    
    if (!orders || (Array.isArray(orders) && orders.length === 0)) {
      console.log('✓ No open orders found (empty result)');
      console.log('  This could mean:');
      console.log('  - You have no active orders on Polymarket');
      console.log('  - Orders were recently filled/cancelled');
    } else {
      console.log(`✓ Found ${Array.isArray(orders) ? orders.length : 'N/A'} open order(s)\n`);
      console.log('Order Details:');
      console.log(JSON.stringify(orders, null, 2));
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('TEST COMPLETE ✓');
    console.log('='.repeat(60));
    
  } catch (error: any) {
    console.error('\n' + '='.repeat(60));
    console.error('ERROR:');
    console.error('='.repeat(60));
    console.error('Message:', error.message);
    if (error.response) {
      console.error('Response Status:', error.response.status);
      console.error('Response Data:', error.response.data);
    }
    console.error('\nFull Error:', error);
    process.exit(1);
  }
}

testGetOrders();
