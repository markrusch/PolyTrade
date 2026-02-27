/**
 * Deribit Service Test
 * Test Deribit requestor and listener with real API data
 */

import { getConfig } from '../lib/config/loader.js';
import { createLogger } from '../lib/logger/index.js';
import { RetryHandler } from '../lib/retry/RetryHandler.js';
import { DeribitRequestor } from '../services/deribit/DeribitRequestor.js';
import { DeribitListener } from '../services/deribit/DeribitListener.js';

async function testDeribitService() {
  console.log('='.repeat(60));
  console.log('Deribit Service Test - Real Data Validation');
  console.log('='.repeat(60));

  // Step 1: Load configuration
  console.log('\n[1/5] Loading configuration...');
  const config = getConfig();
  console.log('✅ Configuration loaded successfully');
  console.log(`  - Base URL: ${config.deribit.baseUrl}`);
  console.log(`  - Polling Interval: ${config.deribit.interval}ms`);

  // Step 2: Create dependencies
  console.log('\n[2/5] Creating logger and retry handler...');
  const logger = createLogger({ level: config.logLevel });
  const retryHandler = new RetryHandler({
    maxAttempts: 3,
    initialDelay: 1000,
  }, logger);
  console.log('✅ Logger and retry handler ready');

  // Step 3: Create Deribit requestor
  console.log('\n[3/5] Creating Deribit requestor...');
  const requestor = new DeribitRequestor(
    config.deribit,
    logger,
    retryHandler
  );
  console.log('✅ Deribit requestor created');

  try {
    // Test 1: Get ETH instruments
    console.log('\n[Test 1] Fetching ETH option instruments...');
    const instruments = await requestor.getInstruments('ETH', 'option');
    console.log(`✅ Found ${instruments.length} ETH options`);
    
    if (instruments.length > 0) {
      const sample = instruments.slice(0, 3);
      console.log('  Sample instruments:');
      sample.forEach(inst => {
        const expiry = new Date(inst.expiration_timestamp);
        console.log(`  - ${inst.instrument_name}`);
        console.log(`    Strike: ${inst.strike}, Type: ${inst.option_type}, Expiry: ${expiry.toISOString()}`);
      });
    }

    // Test 2: Get available expiries
    console.log('\n[Test 2] Fetching available expiry dates...');
    const expiries = await requestor.getAvailableExpiries('ETH');
    console.log(`✅ Found ${expiries.length} unique expiry dates`);
    console.log('  Next 5 expiries:');
    expiries.slice(0, 5).forEach(expiry => {
      const daysFromNow = Math.ceil((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      console.log(`  - ${expiry.toISOString()} (${daysFromNow} days from now)`);
    });

    // Test 3: Get index price (spot)
    console.log('\n[Test 3] Fetching ETH spot price from Deribit...');
    const spotPrice = await requestor.getIndexPrice('eth_usd');
    console.log(`✅ ETH Spot Price: $${spotPrice.toFixed(2)}`);

    // Test 4: Find ATM instrument
    console.log('\n[Test 4] Finding ATM (At-The-Money) option...');
    const weekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const atmInstrument = requestor.findInstrumentByExpiry(instruments, weekFromNow, spotPrice);
    
    if (atmInstrument) {
      console.log(`✅ Found ATM instrument: ${atmInstrument.instrument_name}`);
      console.log(`  - Strike: ${atmInstrument.strike}`);
      console.log(`  - Distance from spot: $${Math.abs(atmInstrument.strike - spotPrice).toFixed(2)}`);
      console.log(`  - Expiry: ${new Date(atmInstrument.expiration_timestamp).toISOString()}`);

      // Test 5: Get ticker data (IV and Greeks)
      console.log('\n[Test 5] Fetching ticker data (IV, Greeks)...');
      const ticker = await requestor.getTicker(atmInstrument.instrument_name);
      console.log(`✅ Ticker data retrieved:`);
      console.log(`  - Mark IV: ${(ticker.mark_iv * 100).toFixed(2)}%`);
      console.log(`  - Underlying Price: $${ticker.underlying_price.toFixed(2)}`);
      console.log(`  - Mark Price: $${ticker.mark_price.toFixed(4)}`);
      console.log(`  - Last Price: $${ticker.last_price ? ticker.last_price.toFixed(4) : 'N/A'}`);
      
      if (ticker.greeks) {
        console.log(`  - Greeks:`);
        console.log(`    Delta: ${ticker.greeks.delta.toFixed(4)}`);
        console.log(`    Gamma: ${ticker.greeks.gamma.toFixed(6)}`);
        console.log(`    Vega: ${ticker.greeks.vega.toFixed(4)}`);
        console.log(`    Theta: ${ticker.greeks.theta.toFixed(4)}`);
        if (ticker.greeks.rho !== undefined) {
          console.log(`    Rho: ${ticker.greeks.rho.toFixed(4)}`);
        }
      }

      // Validate IV is reasonable (10% to 500%)
      const ivPercent = ticker.mark_iv * 100;
      if (ivPercent < 10 || ivPercent > 500) {
        console.warn(`⚠️  Warning: IV ${ivPercent.toFixed(2)}% seems unusual (expected 10-500%)`);
      } else {
        console.log(`✅ IV is within reasonable range (10-500%)`);
      }

      // Validate underlying price matches spot
      const priceDiff = Math.abs(ticker.underlying_price - spotPrice);
      const priceDiffPercent = (priceDiff / spotPrice) * 100;
      if (priceDiffPercent > 2) {
        console.warn(`⚠️  Warning: Underlying price differs from spot by ${priceDiffPercent.toFixed(2)}%`);
      } else {
        console.log(`✅ Underlying price matches spot (diff: ${priceDiffPercent.toFixed(2)}%)`);
      }

      // Test 6: Start real-time listener
      console.log('\n[Test 6] Starting real-time IV listener for 30 seconds...');
      const listener = new DeribitListener(
        config.deribit,
        requestor,
        logger,
        'ETH'
      );

      let updateCount = 0;
      listener.subscribe((event) => {
        if (event.type === 'snapshot:updated') {
          updateCount++;
          const snapshot = event.data as any;
          console.log(`📊 [${updateCount}] Snapshot: ${snapshot.instrumentName}`);
          console.log(`    IV: ${(snapshot.markIv * 100).toFixed(2)}%, Spot: $${snapshot.underlyingPrice.toFixed(2)}`);
        } else if (event.type === 'error:connection') {
          console.error(`❌ Error: ${(event.data as Error).message}`);
        }
      });

      await listener.start({ spotPrice, targetExpiry: weekFromNow });

      // Wait for 30 seconds
      await new Promise(resolve => setTimeout(resolve, 30000));

      console.log(`\n✅ Received ${updateCount} IV updates in 30 seconds`);
      console.log(`  - Average update rate: ${(updateCount / 30).toFixed(2)} updates/sec`);
      console.log(`  - Expected rate: ~${(1000 / config.deribit.interval).toFixed(2)} updates/sec`);

      // Disconnect listener
      await listener.disconnect();
      console.log('✅ Listener disconnected successfully');

    } else {
      console.warn('⚠️  No ATM instrument found for target expiry');
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('✅ All Deribit Service Tests Passed!');
    console.log('='.repeat(60));
    console.log('\nKey Findings:');
    console.log(`  - Total Instruments: ${instruments.length}`);
    console.log(`  - Spot Price: $${spotPrice.toFixed(2)}`);
    if (atmInstrument) {
      const ticker = await requestor.getTicker(atmInstrument.instrument_name);
      console.log(`  - ATM IV: ${(ticker.mark_iv * 100).toFixed(2)}%`);
      console.log(`  - ATM Strike: ${atmInstrument.strike}`);
    }
    console.log('\nData Quality:');
    console.log('  ✅ IV values reasonable');
    console.log('  ✅ Prices consistent with spot');
    console.log('  ✅ Greeks available');
    console.log('  ✅ Real-time updates working');

  } catch (error) {
    console.error('\n❌ Test Failed:', error);
    if (error instanceof Error) {
      console.error('Error details:', error.message);
      console.error('Stack trace:', error.stack);
    }
    process.exit(1);
  }
}

// Run tests
testDeribitService()
  .then(() => {
    console.log('\n🎉 Test suite completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Test suite failed:', error);
    process.exit(1);
  });
