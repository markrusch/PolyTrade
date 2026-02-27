import { ClobClientWrapper } from '../src/services/polymarket/ClobClient';
import { config as polyConfig } from '../src/services/polymarket/config';
import { config as envConfig } from 'dotenv';
import { Wallet } from 'ethers';

envConfig();

async function testUserMethods() {
  console.log('Testing User-Specific CLOB Methods\n');
  console.log('='.repeat(60));
  
  const funderAddress = polyConfig.funderAddress;
  const proxyAddress = new Wallet(polyConfig.privateKey).address;
  
  console.log('Proxy Address:', proxyAddress);
  console.log('Funder Address:', funderAddress);
  console.log('='.repeat(60));
  
  try {
    console.log('\nInitializing CLOB client...');
    const clobClient = new ClobClientWrapper();
    await clobClient.initialize();
    const client = clobClient.getClient() as any;
    
    // Test getUserEarningsAndMarketsConfig
    console.log('\nTesting getUserEarningsAndMarketsConfig...');
    try {
      const funderEarnings = await client.getUserEarningsAndMarketsConfig(funderAddress);
      console.log('Funder earnings config found:', !!funderEarnings);
      if (funderEarnings) {
        console.log(JSON.stringify(funderEarnings, null, 2).substring(0, 500) + '...');
      }
    } catch (err: any) {
      console.log('Error:', err.message?.substring(0, 100));
    }
    
    // Test getTotalEarningsForUserForDay
    console.log('\nTesting getTotalEarningsForUserForDay...');
    try {
      const today = Math.floor(Date.now() / 1000);
      const funderEarnings = await client.getTotalEarningsForUserForDay(funderAddress, today);
      console.log('Funder earnings today:', funderEarnings);
    } catch (err: any) {
      console.log('Error:', err.message?.substring(0, 100));
    }
    
    // Test getEarningsForUserForDay
    console.log('\nTesting getEarningsForUserForDay...');
    try {
      const today = Math.floor(Date.now() / 1000);
      const funderEarnings = await client.getEarningsForUserForDay(funderAddress, today);
      console.log('Funder earnings result:', funderEarnings);
    } catch (err: any) {
      console.log('Error:', err.message?.substring(0, 100));
    }
    
    // Check if getOpenOrders actually takes a userAddress as first parameter
    console.log('\nRetesting getOpenOrders with address as first param...');
    try {
      const orders1 = await (client.getOpenOrders as any)(funderAddress);
      console.log('getOpenOrders(funderAddress):', orders1?.length, 'orders');
    } catch (err: any) {
      console.log('Error:', err.message?.substring(0, 100));
    }
    
    // Try calling getOrder on a specific order ID (if we knew one)
    console.log('\nFetching order book to see market structure...');
    try {
      const orderBook = await client.getOrderBooks({ limit: 1 });
      if (orderBook && orderBook.length > 0) {
        console.log('Sample market:', JSON.stringify(orderBook[0], null, 2).substring(0, 300) + '...');
      }
    } catch (err: any) {
      console.log('Error:', err.message?.substring(0, 100));
    }
    
  } catch (error: any) {
    console.error('\nERROR:', error.message);
  }
}

testUserMethods();
