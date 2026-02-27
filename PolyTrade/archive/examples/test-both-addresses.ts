import { ClobClientWrapper } from '../src/services/polymarket/ClobClient';
import { config as polyConfig } from '../src/services/polymarket/config';
import { config as envConfig } from 'dotenv';
import { Wallet } from 'ethers';

envConfig();

async function testBothAddresses() {
  console.log('Testing Open Orders for Both Addresses\n');
  console.log('='.repeat(60));
  
  // Get the proxy wallet address from private key
  const proxyAddress = new Wallet(polyConfig.privateKey).address;
  const funderAddress = polyConfig.funderAddress;
  
  console.log('Proxy Wallet Address:', proxyAddress);
  console.log('Funder Address:', funderAddress);
  console.log('='.repeat(60));
  
  try {
    // Initialize CLOB client
    console.log('\nInitializing CLOB client...');
    const clobClient = new ClobClientWrapper();
    await clobClient.initialize();
    const client = clobClient.getClient();
    
    // Test 1: Query for proxy address
    console.log('\n1. Querying for Proxy Address:', proxyAddress);
    const proxyOrders = await client.getOpenOrders({ funder: proxyAddress }, true);
    console.log(`   Found ${proxyOrders.length} orders`);
    if (proxyOrders.length > 0) {
      console.log('   Orders:', JSON.stringify(proxyOrders, null, 2));
    }
    
    // Test 2: Query for funder address
    console.log('\n2. Querying for Funder Address:', funderAddress);
    const funderOrders = await client.getOpenOrders({ funder: funderAddress }, true);
    console.log(`   Found ${funderOrders.length} orders`);
    if (funderOrders.length > 0) {
      console.log('   Orders:', JSON.stringify(funderOrders, null, 2));
    }
    
    // Test 3: Query with empty params (uses default from client initialization)
    console.log('\n3. Querying with empty params (uses client default):');
    const defaultOrders = await client.getOpenOrders({}, true);
    console.log(`   Found ${defaultOrders.length} orders`);
    if (defaultOrders.length > 0) {
      console.log('   Orders:', JSON.stringify(defaultOrders, null, 2));
    }
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY:');
    console.log('='.repeat(60));
    console.log('Proxy Address Orders:', proxyOrders.length);
    console.log('Funder Address Orders:', funderOrders.length);
    console.log('Default (Client init) Orders:', defaultOrders.length);
    
    if (proxyOrders.length === 0 && funderOrders.length === 0 && defaultOrders.length === 0) {
      console.log('\n⚠️  No open orders found for ANY address.');
      console.log('Either:');
      console.log('  - The account has no open orders');
      console.log('  - The orders have been filled or cancelled');
      console.log('  - The API credentials or authentication is not working');
    }
    
  } catch (error: any) {
    console.error('\nERROR:', error.message);
    if (error.response?.data) {
      console.error('Response:', error.response.data);
    }
  }
}

testBothAddresses();
