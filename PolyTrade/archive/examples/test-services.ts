import dotenv from 'dotenv';
dotenv.config();

import { getConfig } from '../src/lib/config/loader.js';
import { Logger } from '../src/lib/logger/index.js';
import { RetryHandler } from '../src/lib/retry/RetryHandler.js';

const logger = new Logger({ level: 'info', serviceName: 'test-services' });
const appConfig = getConfig();

console.log('\n=== TESTING SERVICE INITIALIZATION ===\n');

// Test 1: Binance
async function testBinance() {
  console.log('1️⃣  Testing Binance Service...');
  try {
    const { BinanceRequestor } = await import('../src/services/binance/BinanceRequestor.js');
    const { BinancePriceListener } = await import('../src/services/binance/BinancePriceListener.js');
    
    const retry = new RetryHandler({
      maxRetries: 3,
      initialDelay: 1000,
      maxDelay: 10000,
      backoffMultiplier: 2,
    }, logger);
    
    const requestor = new BinanceRequestor(appConfig.binance, logger, retry);
    const listener = new BinancePriceListener(
      appConfig.binance,
      requestor,
      logger,
      ['ETHUSDT']
    );

    listener.subscribe((event) => {
      if (event.type === 'price:updated') {
        console.log(`✅ Binance: ${event.data.symbol} = $${event.data.price}`);
      }
    });

    await listener.start();
    console.log('✅ Binance initialized successfully\n');
    
    // Let it run for 3 seconds
    await new Promise(resolve => setTimeout(resolve, 3000));
    await listener.stop();
    return true;
  } catch (err) {
    console.error('❌ Binance failed:', err);
    return false;
  }
}

// Test 2: Deribit
async function testDeribit() {
  console.log('\n2️⃣  Testing Deribit Service...');
  try {
    const { DeribitRequestor } = await import('../src/services/deribit/DeribitRequestor.js');
    const { DeribitListener } = await import('../src/services/deribit/DeribitListener.js');
    
    const retry = new RetryHandler({
      maxRetries: 3,
      initialDelay: 1000,
      maxDelay: 10000,
      backoffMultiplier: 2,
    }, logger);
    
    const requestor = new DeribitRequestor(appConfig.deribit, logger, retry);
    const listener = new DeribitListener(
      appConfig.deribit,
      requestor,
      logger,
      'ETH'
    );

    listener.subscribe((event) => {
      if (event.type === 'snapshot:updated') {
        console.log(`✅ Deribit: IV = ${event.data.markIv}%`);
      }
    });

    const spotPrice = 3500;
    const targetExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await listener.start({ spotPrice, targetExpiry });
    console.log('✅ Deribit initialized successfully\n');
    
    // Let it run for 3 seconds
    await new Promise(resolve => setTimeout(resolve, 3000));
    await listener.stop();
    return true;
  } catch (err) {
    console.error('❌ Deribit failed:', err);
    return false;
  }
}

// Test 3: CLOB Client
async function testCLOB() {
  console.log('\n3️⃣  Testing CLOB Client...');
  try {
    const { ClobClientWrapper } = await import('../src/services/polymarket/ClobClient.js');
    
    const client = new ClobClientWrapper();
    await client.initialize();
    console.log('✅ CLOB Client initialized successfully\n');
    return true;
  } catch (err) {
    console.error('❌ CLOB Client failed:', err);
    return false;
  }
}

// Test 4: OrderBook Service  
async function testOrderBook() {
  console.log('4️⃣  Testing OrderBook Service...');
  try {
    const { OrderBookService } = await import('../src/services/polymarket/OrderBook.js');
    
    const service = new OrderBookService();
    console.log('✅ OrderBook Service initialized successfully\n');
    return true;
  } catch (err) {
    console.error('❌ OrderBook Service failed:', err);
    return false;
  }
}

// Test 5: Health Check Service
async function testHealthCheck() {
  console.log('5️⃣  Testing Health Check Service...');
  try {
    const { HealthCheckService } = await import('../src/services/polymarket/HealthCheck.js');
    
    const service = new HealthCheckService();
    const health = await service.checkAll();
    console.log('Health Status:', JSON.stringify(health, null, 2));
    console.log('✅ Health Check Service initialized successfully\n');
    return true;
  } catch (err) {
    console.error('❌ Health Check Service failed:', err);
    return false;
  }
}

// Run all tests
async function runTests() {
  const results = {
    binance: await testBinance(),
    deribit: await testDeribit(),
    clob: await testCLOB(),
    orderbook: await testOrderBook(),
    health: await testHealthCheck()
  };

  console.log('\n=== TEST RESULTS ===');
  console.log('Binance:', results.binance ? '✅ PASS' : '❌ FAIL');
  console.log('Deribit:', results.deribit ? '✅ PASS' : '❌ FAIL');
  console.log('CLOB:', results.clob ? '✅ PASS' : '❌ FAIL');
  console.log('OrderBook:', results.orderbook ? '✅ PASS' : '❌ FAIL');
  console.log('Health Check:', results.health ? '✅ PASS' : '❌ FAIL');
  
  const allPassed = Object.values(results).every(r => r);
  console.log('\n' + (allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'));
  
  process.exit(allPassed ? 0 : 1);
}

runTests().catch((err) => {
  console.error('\n❌ Test runner failed:', err);
  process.exit(1);
});
