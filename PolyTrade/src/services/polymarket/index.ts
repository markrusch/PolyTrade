import { ClobClientWrapper } from './ClobClient';
import { PolymarketWebSocket, UserEventsWebSocket } from './WebSocketClient';
import { OrderManager } from './OrderManager';
import { PositionTracker } from './PositionTracker';
import { MarketData } from './MarketData';
import { HealthCheckService } from './HealthCheck';
import { OrderBookService } from './OrderBook';
import { MarketPricingService } from './MarketPricingService';
import { config } from './config';

// Export services for external use
export { ClobClientWrapper } from './ClobClient';
export { OrderManager } from './OrderManager';
export { PositionTracker } from './PositionTracker';
export { MarketData } from './MarketData';
export { HealthCheckService } from './HealthCheck';
export { OrderBookService } from './OrderBook';
export { PolymarketWebSocket, UserEventsWebSocket } from './WebSocketClient';
export { MarketPricingService } from './MarketPricingService';
export type { MarketMetadata, PricingSnapshot } from './MarketPricingService';

export async function startPolymarketService(assetIdsToSubscribe: string[] = []) {
  const clobClient = new ClobClientWrapper();
  await clobClient.initialize();

  const orderManager = new OrderManager(clobClient);
  const positionTracker = new PositionTracker(clobClient);
  const marketData = new MarketData(clobClient);
  const healthCheck = new HealthCheckService();
  const orderBookService = new OrderBookService();

  // Market WebSocket
  const marketWs = new PolymarketWebSocket();
  await marketWs.connect((update) => {
    // You can route updates to dashboards/PnL calculators here
    // console.log('Market update:', update);
  });
  if (assetIdsToSubscribe.length) marketWs.subscribe(assetIdsToSubscribe);

  // Order Book WebSocket & REST Integration
  await orderBookService.connectWebSocket(
    (tokenId, orderBook) => {
      // console.log(`[OrderBook Updated] ${tokenId.slice(0, 20)}... - Mid: $${orderBook.mid?.toFixed(4)}`);
    },
    'wss://ws-subscriptions-clob.polymarket.com/ws/market'
  );

  if (assetIdsToSubscribe.length) {
    orderBookService.subscribe(assetIdsToSubscribe);
    
    // Fetch initial REST snapshots for all subscribed tokens
    for (const tokenId of assetIdsToSubscribe) {
      try {
        await orderBookService.getOrderBook(tokenId, 1);
      } catch (e) {
        console.warn(`Failed to fetch order book for ${tokenId.slice(0, 20)}...:`, (e as any)?.message);
      }
    }
  }

  // User WebSocket for order/trade events if creds are present
  const apiCreds = (clobClient as any).creds || null;
  let userWs: UserEventsWebSocket | null = null;
  if (apiCreds) {
    userWs = new UserEventsWebSocket(apiCreds);
    await userWs.connect((event) => {
      // Handle fills, cancels, etc.
      // console.log('User event:', event);
    });
  }

  // Initial snapshot examples
  let positions: any[] = [];
  let openOrders: any[] = [];
  try {
    positions = await positionTracker.updatePositions();
  } catch (e) {
    console.warn('Position snapshot failed:', (e as any)?.message || e);
  }
  try {
    openOrders = await orderManager.getOpenOrders();
  } catch (e) {
    console.warn('Open orders snapshot failed:', (e as any)?.message || e);
  }

  return {
    clobClient,
    orderManager,
    positionTracker,
    marketData,
    healthCheck,
    orderBookService,
    marketWs,
    userWs,
    snapshot: { positions, openOrders },
    stop: () => {
      marketWs.disconnect();
      orderBookService.disconnect();
      if (userWs) userWs.disconnect();
    },
  };
}

// Optional standalone run
if (import.meta.url === `file://${process.argv[1]}`) {
  startPolymarketService().then(({ stop }) => {
    process.on('SIGINT', () => {
      stop();
      process.exit(0);
    });
  });
}
