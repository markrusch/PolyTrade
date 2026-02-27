/**
 * Test script to verify orderbook history and candle aggregation in console
 */

import WebSocket from 'ws';

const SERVER_URL = 'ws://localhost:3003/ws';
const MARKET_TOKEN_ID = '21742633143463906290569050155826241533067272736897614950488156847949938836455'; // ETH market - replace with your position

console.log('🔵 Connecting to WebSocket server...');
const ws = new WebSocket(SERVER_URL);

ws.on('open', () => {
  console.log('✅ Connected to server\n');
  
  // Subscribe to orderbook
  console.log(`📊 Subscribing to orderbook for market ${MARKET_TOKEN_ID.slice(0, 20)}...`);
  ws.send(JSON.stringify({
    action: 'subscribe',
    channel: 'orderbook',
    key: MARKET_TOKEN_ID
  }));
  
  // Request latest candles after 5 seconds
  setTimeout(() => {
    console.log('\n🕐 Requesting latest 1-minute candles...');
    ws.send(JSON.stringify({
      type: 'request',
      channel: 'orderbook-candles',
      market: MARKET_TOKEN_ID,
      timeframe: '1m'
    }));
  }, 5000);
  
  // Request 5-minute candles after 10 seconds
  setTimeout(() => {
    console.log('\n🕐 Requesting latest 5-minute candles...');
    ws.send(JSON.stringify({
      type: 'request',
      channel: 'orderbook-candles',
      market: MARKET_TOKEN_ID,
      timeframe: '5m'
    }));
  }, 10000);
  
  // Get DB stats after 15 seconds
  setTimeout(() => {
    console.log('\n📈 Requesting database stats...');
    ws.send(JSON.stringify({
      type: 'request',
      channel: 'orderbook-stats'
    }));
  }, 15000);
  
  // Disconnect after 20 seconds
  setTimeout(() => {
    console.log('\n✅ Test complete, disconnecting...');
    ws.close();
    process.exit(0);
  }, 20000);
});

ws.on('message', (data: Buffer) => {
  const msg = JSON.parse(data.toString());
  
  if (msg.type === 'orderbook' && msg.data) {
    console.log('📖 Orderbook Update:');
    console.log(`  Market: ${msg.market?.slice(0, 20)}...`);
    console.log(`  Source: ${msg.data.source}`);
    console.log(`  Mid Price: $${msg.data.mid?.toFixed(4) || 'N/A'}`);
    console.log(`  Spread: $${msg.data.spread?.toFixed(6) || 'N/A'}`);
    console.log(`  Best Bid: $${msg.data.bids?.[0]?.price || 'N/A'} (${msg.data.bids?.[0]?.size || 0})`);
    console.log(`  Best Ask: $${msg.data.asks?.[0]?.price || 'N/A'} (${msg.data.asks?.[0]?.size || 0})`);
    console.log(`  Updated: ${new Date(msg.data.lastUpdate).toLocaleTimeString()}`);
    
    // Show if candles are being computed
    if (msg.candles) {
      console.log(`  📊 Latest Candles:`);
      Object.entries(msg.candles).forEach(([timeframe, candle]: [string, any]) => {
        console.log(`    ${timeframe}: OHLC [$${candle.open.toFixed(4)}, $${candle.high.toFixed(4)}, $${candle.low.toFixed(4)}, $${candle.close.toFixed(4)}] | Ticks: ${candle.tickCount}`);
      });
    }
  }
  
  if (msg.type === 'orderbook-candles' && msg.data) {
    console.log(`\n📈 Candle Data (${msg.timeframe}):`);
    msg.data.forEach((candle: any, idx: number) => {
      const time = new Date(candle.timestamp).toLocaleTimeString();
      console.log(`  ${idx + 1}. ${time}: O=$${candle.open.toFixed(4)} H=$${candle.high.toFixed(4)} L=$${candle.low.toFixed(4)} C=$${candle.close.toFixed(4)} | ${candle.tickCount} ticks`);
    });
  }
  
  if (msg.type === 'orderbook-stats' && msg.data) {
    console.log('\n📊 Database Statistics:');
    console.log(`  Total Ticks: ${msg.data.totalTicks}`);
    console.log(`  Total Candles: ${msg.data.totalCandles}`);
    console.log(`  Markets Tracked: ${msg.data.markets?.join(', ') || 'None'}`);
  }
  
  if (msg.type === 'error') {
    console.error('❌ Error:', msg.error);
  }
});

ws.on('error', (err) => {
  console.error('❌ WebSocket error:', err.message);
  process.exit(1);
});

ws.on('close', () => {
  console.log('\n👋 Connection closed');
});
