import axios from 'axios';
import { config } from '../src/services/polymarket/config';

async function testPolymarketDataApi() {
  const funderAddress = config.funderAddress;
  
  console.log('Testing Polymarket Data API\n');
  console.log('='.repeat(60));
  console.log('Funder Address:', funderAddress);
  console.log('='.repeat(60));
  
  try {
    // Test 1: Get positions (official source)
    console.log('\n1. Fetching Open Positions from Data API...');
    const posUrl = `https://data-api.polymarket.com/positions?user=${funderAddress}`;
    console.log('   URL:', posUrl);
    
    const posResponse = await axios.get(posUrl, { timeout: 10000 });
    const positions = posResponse.data || [];
    console.log(`   ✓ Found ${positions.length} open positions`);
    if (positions.length > 0) {
      console.log('   Sample position:', JSON.stringify(positions[0], null, 2).substring(0, 300));
    }
    
    // Test 2: Get trades/activity
    console.log('\n2. Fetching Trade Activity...');
    const tradesUrl = `https://data-api.polymarket.com/trades?user=${funderAddress}&limit=10`;
    console.log('   URL:', tradesUrl);
    
    const tradesResponse = await axios.get(tradesUrl, { timeout: 10000 });
    const trades = tradesResponse.data || [];
    console.log(`   ✓ Found ${trades.length} trades`);
    if (trades.length > 0) {
      console.log('   Sample trade:', JSON.stringify(trades[0], null, 2).substring(0, 300));
    }
    
    // Test 3: Get markets
    console.log('\n3. Fetching Markets...');
    const marketsUrl = `https://data-api.polymarket.com/markets?limit=5`;
    console.log('   URL:', marketsUrl);
    
    const marketsResponse = await axios.get(marketsUrl, { timeout: 10000 });
    const markets = marketsResponse.data || [];
    console.log(`   ✓ Found ${markets.length} markets`);
    
  } catch (error: any) {
    console.error('\nERROR:');
    console.error('Status:', error.response?.status);
    console.error('Message:', error.message);
    if (error.response?.data) {
      console.error('Data:', error.response.data);
    }
  }
}

testPolymarketDataApi();
