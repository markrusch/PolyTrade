import WebSocket from 'ws';
import type { ApiKeyCreds } from '@polymarket/clob-client';

export interface MarketUpdate {
  asset_id: string;
  event_type: 'book' | 'last_trade_price' | 'price_change' | string;
  data: any;
}

export class PolymarketWebSocket {
  private ws: WebSocket | null = null;
  private subscriptions: Set<string> = new Set();
  private reconnectInterval = 5000;
  private messageHandler: ((update: MarketUpdate) => void) | null = null;

  constructor(private wsUrl: string = 'wss://ws-subscriptions-clob.polymarket.com/ws/market') {}

  connect(onMessage: (update: MarketUpdate) => void): Promise<void> {
    this.messageHandler = onMessage;
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.on('open', () => {
        console.log('[Market WS] Connected');
        this.resubscribe();
        resolve();
      });

      this.ws.on('message', (data: WebSocket.RawData) => {
        try {
          const message = JSON.parse(data.toString());
          onMessage(message);
        } catch (err) {
          console.error('Market WS parse error:', err);
        }
      });

      this.ws.on('close', () => {
        console.log('[Market WS] Disconnected, reconnecting...');
        setTimeout(() => this.connect(onMessage), this.reconnectInterval);
      });

      this.ws.on('error', (err) => {
        console.error('Market WS error:', err);
        reject(err);
      });
    });
  }

  subscribe(assetIds: string[]) {
    assetIds.forEach((id) => this.subscriptions.add(id));
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Try both formats for compatibility with different endpoints
      const subscription = {
        type: 'market',
        markets: assetIds,
        assets_ids: assetIds, // Alternate format
        asset_ids: assetIds,  // Another variant
      };
      console.log('[Market WS] Subscribing to:', subscription);
      this.ws.send(JSON.stringify(subscription));
    }
  }

  unsubscribe(assetIds: string[]) {
    assetIds.forEach((id) => this.subscriptions.delete(id));
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const unsubscription = {
        type: 'market',
        markets: assetIds,
        assets_ids: assetIds, // Alternate format
        asset_ids: assetIds,  // Another variant
      };
      console.log('[Market WS] Unsubscribing from:', unsubscription);
      this.ws.send(JSON.stringify(unsubscription));
    }
  }

  private resubscribe() {
    if (this.subscriptions.size > 0) {
      this.subscribe(Array.from(this.subscriptions));
    }
  }

  isConnected(): boolean {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export class UserEventsWebSocket {
  private ws: WebSocket | null = null;
  private reconnectInterval = 5000;

  constructor(
    private apiCreds: ApiKeyCreds,
    private wsUrl: string = 'wss://ws-subscriptions-clob.polymarket.com/ws/user'
  ) {}

  connect(onMessage: (event: any) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.on('open', () => {
        console.log('[User WS] Connected');
        // Authenticate with API credentials per documentation
        const subscription = {
          type: 'user',
          auth: {
            apiKey: this.apiCreds.key,
            secret: this.apiCreds.secret,
            passphrase: this.apiCreds.passphrase,
          },
        };
        console.log('[User WS] Authenticating...');
        this.ws!.send(JSON.stringify(subscription));
        resolve();
      });

      this.ws.on('message', (data: WebSocket.RawData) => {
        try {
          const event = JSON.parse(data.toString());
          onMessage(event);
        } catch (err) {
          console.error('User WS parse error:', err);
        }
      });

      this.ws.on('close', () => {
        console.log('[User WS] Disconnected, reconnecting...');
        setTimeout(() => this.connect(onMessage), this.reconnectInterval);
      });

      this.ws.on('error', (err) => {
        console.error('User WS error:', err);
        reject(err);
      });
    });
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
