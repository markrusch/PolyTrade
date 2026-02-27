import axios from 'axios';
import { config as polyConfig } from '../src/services/polymarket/config';
import { config as envConfig } from 'dotenv';

envConfig();

async function testOrdersViaDataApi() {
  const funderAddress = polyConfig.funderAddress;
  
  console.log('Testing Open Orders - Data API Direct Query\n');
  console.log('='.repeat(60));
  console.log('Funder Address:', funderAddress);
  console.log('='.repeat(60));
  
  try {
    // Query the Data API directly for orders
    const url = `https://data-api.polymarket.com/orders?user=${funderAddress}`;
    
    console.log('\nFetching from:', url);
    const response = await axios.get(url, {
      timeout: 10000,
      headers: { 'Accept': 'application/json' }
    });
    
    const orders = response.data || [];
    
    console.log('\n' + '='.repeat(60));
    console.log('RESULTS:');
    console.log('='.repeat(60));
    console.log('Status:', response.status);
    console.log('Found orders:', Array.isArray(orders) ? orders.length : 'N/A');
    
    if (Array.isArray(orders) && orders.length > 0) {
      console.log('\nOrder Details:');
      console.log(JSON.stringify(orders, null, 2));
    } else {
      console.log('No orders found for this address');
    }
    
  } catch (error: any) {
    console.error('\n' + '='.repeat(60));
    console.error('ERROR:');
    console.error('='.repeat(60));
    console.error('Status:', error.response?.status);
    console.error('Message:', error.message);
    if (error.response?.data) {
      console.error('Response:', error.response.data);
    }
  }
}

testOrdersViaDataApi();
