/**
 * API Verification Test
 * Tests Binance and Deribit APIs for Bitcoin and Ethereum
 * Shows results in table format
 */

import axios from 'axios';

const BASE_URL = 'http://localhost:3003';

// Utility to create table row
function tableRow(columns, widths) {
  return '| ' + columns.map((col, i) => String(col).padEnd(widths[i])).join(' | ') + ' |';
}

function tableSeparator(widths) {
  return '| ' + widths.map(w => '-'.repeat(w)).join(' | ') + ' |';
}

// Test Binance API
async function testBinanceAPI(symbol) {
  try {
    const url = `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`;
    const response = await axios.get(url, { timeout: 5000 });
    
    if (response.data && response.data.price) {
      return {
        success: true,
        symbol: response.data.symbol,
        price: parseFloat(response.data.price).toFixed(2),
        timestamp: new Date().toISOString(),
        error: null
      };
    }
    
    return {
      success: false,
      symbol,
      price: null,
      timestamp: new Date().toISOString(),
      error: 'No price data returned'
    };
  } catch (error) {
    return {
      success: false,
      symbol,
      price: null,
      timestamp: new Date().toISOString(),
      error: error.message
    };
  }
}

// Get Deribit available expiries
async function getDeribitExpiries(currency) {
  try {
    const url = 'https://www.deribit.com/api/v2/public/get_instruments';
    const response = await axios.get(url, {
      params: {
        currency,
        kind: 'option'
      },
      timeout: 10000
    });

    if (response.data && response.data.result) {
      const instruments = response.data.result;
      const expiries = new Set();
      
      instruments.forEach(inst => {
        if (inst.expiration_timestamp) {
          const date = new Date(inst.expiration_timestamp);
          expiries.add(date.toISOString().split('T')[0]); // YYYY-MM-DD
        }
      });
      
      return {
        success: true,
        expiries: Array.from(expiries).sort(),
        instrumentCount: instruments.length
      };
    }
    
    return {
      success: false,
      expiries: [],
      instrumentCount: 0,
      error: 'No instruments returned'
    };
  } catch (error) {
    return {
      success: false,
      expiries: [],
      instrumentCount: 0,
      error: error.message
    };
  }
}

// Test Deribit API for specific expiry
async function testDeribitAPI(currency, expiryDate = null) {
  try {
    const url = 'https://www.deribit.com/api/v2/public/get_instruments';
    const response = await axios.get(url, {
      params: {
        currency,
        kind: 'option',
        expired: false
      },
      timeout: 10000
    });

    if (response.data && response.data.result) {
      const instruments = response.data.result;
      
      // Filter by expiry if specified
      let filtered = instruments;
      if (expiryDate) {
        const targetTimestamp = new Date(expiryDate).getTime();
        filtered = instruments.filter(inst => {
          const instDate = new Date(inst.expiration_timestamp).toISOString().split('T')[0];
          return instDate === expiryDate;
        });
      }

      // Get sample instrument data
      if (filtered.length > 0) {
        const sample = filtered[0];
        
        // Get ticker data for this instrument
        const tickerUrl = 'https://www.deribit.com/api/v2/public/ticker';
        const tickerResponse = await axios.get(tickerUrl, {
          params: {
            instrument_name: sample.instrument_name
          },
          timeout: 5000
        });

        const ticker = tickerResponse.data?.result || {};
        
        return {
          success: true,
          currency,
          instrumentName: sample.instrument_name,
          strike: sample.strike,
          optionType: sample.option_type,
          expiry: new Date(sample.expiration_timestamp).toISOString().split('T')[0],
          markIV: ticker.mark_iv ? (ticker.mark_iv * 100).toFixed(2) + '%' : 'N/A',
          underlyingPrice: ticker.underlying_price ? ticker.underlying_price.toFixed(2) : 'N/A',
          instrumentCount: filtered.length,
          totalInstruments: instruments.length,
          timestamp: new Date().toISOString(),
          error: null
        };
      }

      return {
        success: false,
        currency,
        instrumentName: null,
        strike: null,
        optionType: null,
        expiry: expiryDate,
        markIV: null,
        underlyingPrice: null,
        instrumentCount: filtered.length,
        totalInstruments: instruments.length,
        timestamp: new Date().toISOString(),
        error: `No instruments found for expiry ${expiryDate || 'any'}`
      };
    }
    
    return {
      success: false,
      currency,
      error: 'No data returned from API'
    };
  } catch (error) {
    return {
      success: false,
      currency,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

// Main test function
async function runTests() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  API VERIFICATION TEST - BINANCE & DERIBIT');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Test 1: Binance API for BTC and ETH
  console.log('📊 TEST 1: BINANCE SPOT PRICES\n');
  
  const btcBinance = await testBinanceAPI('BTCUSDT');
  const ethBinance = await testBinanceAPI('ETHUSDT');
  
  const widths1 = [15, 10, 15, 30, 40];
  console.log(tableRow(['Market', 'Success', 'Price (USD)', 'Timestamp', 'Error'], widths1));
  console.log(tableSeparator(widths1));
  console.log(tableRow([
    'BTC/USDT',
    btcBinance.success ? '✓' : '✗',
    btcBinance.price || 'N/A',
    btcBinance.timestamp.split('T')[1].split('.')[0],
    btcBinance.error || '-'
  ], widths1));
  console.log(tableRow([
    'ETH/USDT',
    ethBinance.success ? '✓' : '✗',
    ethBinance.price || 'N/A',
    ethBinance.timestamp.split('T')[1].split('.')[0],
    ethBinance.error || '-'
  ], widths1));
  
  console.log('\n');

  // Test 2: Get Deribit Expiries
  console.log('📅 TEST 2: DERIBIT AVAILABLE EXPIRIES\n');
  
  const btcExpiries = await getDeribitExpiries('BTC');
  const ethExpiries = await getDeribitExpiries('ETH');
  
  console.log('BTC Option Expiries:', btcExpiries.success ? btcExpiries.expiries.slice(0, 5).join(', ') + '...' : 'ERROR');
  console.log('BTC Total Instruments:', btcExpiries.instrumentCount);
  console.log('');
  console.log('ETH Option Expiries:', ethExpiries.success ? ethExpiries.expiries.slice(0, 5).join(', ') + '...' : 'ERROR');
  console.log('ETH Total Instruments:', ethExpiries.instrumentCount);
  console.log('');

  // Ask user to select expiry
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('📝 AVAILABLE EXPIRY DATES:');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  if (btcExpiries.success && btcExpiries.expiries.length > 0) {
    console.log('BTC Expiries (showing first 10):');
    btcExpiries.expiries.slice(0, 10).forEach((exp, i) => {
      console.log(`  ${i + 1}. ${exp}`);
    });
    console.log('');
  }
  
  if (ethExpiries.success && ethExpiries.expiries.length > 0) {
    console.log('ETH Expiries (showing first 10):');
    ethExpiries.expiries.slice(0, 10).forEach((exp, i) => {
      console.log(`  ${i + 1}. ${exp}`);
    });
    console.log('');
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('⏸️  PAUSED: Please select an expiry date from above');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log('To continue testing with a specific expiry, run:');
  console.log('  node test/api-verification-test.mjs --btc-expiry=YYYY-MM-DD --eth-expiry=YYYY-MM-DD\n');
  console.log('Example:');
  if (btcExpiries.expiries.length > 0 && ethExpiries.expiries.length > 0) {
    console.log(`  node test/api-verification-test.mjs --btc-expiry=${btcExpiries.expiries[0]} --eth-expiry=${ethExpiries.expiries[0]}\n`);
  }

  // Check if expiries provided via command line
  const args = process.argv.slice(2);
  const btcExpiryArg = args.find(arg => arg.startsWith('--btc-expiry='))?.split('=')[1];
  const ethExpiryArg = args.find(arg => arg.startsWith('--eth-expiry='))?.split('=')[1];

  if (btcExpiryArg || ethExpiryArg) {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('📊 TEST 3: DERIBIT OPTIONS DATA (Selected Expiries)');
    console.log('═══════════════════════════════════════════════════════════════\n');

    const btcDeribit = btcExpiryArg ? 
      await testDeribitAPI('BTC', btcExpiryArg) : 
      await testDeribitAPI('BTC');
    
    const ethDeribit = ethExpiryArg ? 
      await testDeribitAPI('ETH', ethExpiryArg) : 
      await testDeribitAPI('ETH');

    const widths2 = [10, 10, 25, 10, 12, 15, 18, 18];
    console.log(tableRow([
      'Currency',
      'Success',
      'Instrument',
      'Strike',
      'Type',
      'Expiry',
      'Mark IV',
      'Underlying Price'
    ], widths2));
    console.log(tableSeparator(widths2));
    
    console.log(tableRow([
      'BTC',
      btcDeribit.success ? '✓' : '✗',
      btcDeribit.instrumentName || 'N/A',
      btcDeribit.strike || 'N/A',
      btcDeribit.optionType || 'N/A',
      btcDeribit.expiry || 'N/A',
      btcDeribit.markIV || 'N/A',
      btcDeribit.underlyingPrice || 'N/A'
    ], widths2));
    
    console.log(tableRow([
      'ETH',
      ethDeribit.success ? '✓' : '✗',
      ethDeribit.instrumentName || 'N/A',
      ethDeribit.strike || 'N/A',
      ethDeribit.optionType || 'N/A',
      ethDeribit.expiry || 'N/A',
      ethDeribit.markIV || 'N/A',
      ethDeribit.underlyingPrice || 'N/A'
    ], widths2));

    console.log('\n');
    console.log('Instrument Counts:');
    console.log(`  BTC: ${btcDeribit.instrumentCount} (filtered) / ${btcDeribit.totalInstruments} (total)`);
    console.log(`  ETH: ${ethDeribit.instrumentCount} (filtered) / ${ethDeribit.totalInstruments} (total)`);
    console.log('\n');
  }

  // Test 4: Test with NO markets enabled
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('📊 TEST 4: NO MARKETS SCENARIO (Simulated)');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  const widths3 = [15, 10, 40];
  console.log(tableRow(['Service', 'Status', 'Note'], widths3));
  console.log(tableSeparator(widths3));
  console.log(tableRow(['Binance BTC', 'Disabled', 'BINANCE_BTC_ENABLED=false'], widths3));
  console.log(tableRow(['Binance ETH', 'Disabled', 'BINANCE_ETH_ENABLED=false'], widths3));
  console.log(tableRow(['Deribit BTC', 'Disabled', 'DERIBIT_BTC_ENABLED=false'], widths3));
  console.log(tableRow(['Deribit ETH', 'Disabled', 'DERIBIT_ETH_ENABLED=false'], widths3));
  
  console.log('\n');
  console.log('To test this scenario, update your .env file:');
  console.log('  BINANCE_BTC_ENABLED=false');
  console.log('  BINANCE_ETH_ENABLED=false');
  console.log('  DERIBIT_BTC_ENABLED=false');
  console.log('  DERIBIT_ETH_ENABLED=false');
  console.log('\n');

  // Summary
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('📋 TEST SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  const allTests = [
    { name: 'Binance BTC', success: btcBinance.success },
    { name: 'Binance ETH', success: ethBinance.success },
    { name: 'Deribit BTC Expiries', success: btcExpiries.success },
    { name: 'Deribit ETH Expiries', success: ethExpiries.success },
  ];

  const passed = allTests.filter(t => t.success).length;
  const total = allTests.length;

  allTests.forEach(test => {
    console.log(`  ${test.success ? '✓' : '✗'} ${test.name}`);
  });

  console.log('\n');
  console.log(`Results: ${passed}/${total} tests passed`);
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

// Run tests
runTests().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
