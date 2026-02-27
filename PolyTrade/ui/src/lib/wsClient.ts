const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3003/ws';

console.log(
  '%c[WS CONFIG]',
  'color: #ec4899; font-weight: bold; font-size: 14px',
  '\n  WebSocket URL:', WS_URL,
  '\n  Env VITE_WS_URL:', import.meta.env.VITE_WS_URL
);

type Channel = 'orderbook' | 'positions' | 'orders' | 'marks' | 'health' | 'spot' | 'iv' | 'pricing';

export interface WsMessage {
  type: 'snapshot' | 'update' | 'subscribed' | 'unsubscribed' | 'error';
  channel?: Channel;
  data?: unknown;
  error?: string;
}

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<(data: unknown) => void>>();
  private reconnectTimer: number | null = null;
  private shouldReconnect = true;
  private subscriptions = new Set<string>();
  private statusListeners = new Set<(connected: boolean) => void>();

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  onStatusChange(callback: (connected: boolean) => void) {
    this.statusListeners.add(callback);
    return () => this.statusListeners.delete(callback);
  }

  private notifyStatusChange(connected: boolean) {
    console.log(`%c[WS] Status changed: ${connected ? '✓ CONNECTED' : '✗ DISCONNECTED'}`, 
      `color: ${connected ? '#10b981' : '#ef4444'}; font-weight: bold`);
    this.statusListeners.forEach(cb => cb(connected));
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('%c[WS] Already connected', 'color: #10b981');
      return;
    }

    console.log(`%c[WS] Connecting to ${WS_URL}...`, 'color: #3b82f6; font-weight: bold');
    this.ws = new WebSocket(WS_URL);

    this.ws.onopen = () => {
      console.log('%c[WS] ✓ Connected successfully', 'color: #10b981; font-weight: bold; font-size: 12px');
      this.notifyStatusChange(true);
      // Re-subscribe to channels
      if (this.subscriptions.size > 0) {
        console.log(`%c[WS] Re-subscribing to ${this.subscriptions.size} channels...`, 'color: #3b82f6');
        this.subscriptions.forEach(channel => {
          console.log(`%c[WS]   ⇒ ${channel}`, 'color: #6366f1');
          this.send({ type: 'subscribe', channel: channel as Channel });
        });
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const msg: WsMessage = JSON.parse(event.data);
        console.log(`%c[WS] ⬇ ${msg.type}`, 'color: #8b5cf6', msg.channel || '(no channel)');
        
        if (msg.channel && msg.data) {
          const channelListeners = this.listeners.get(msg.channel);
          if (channelListeners) {
            channelListeners.forEach(listener => listener(msg.data));
          }
        }
      } catch (err) {
        console.error('%c[WS] ✗ Parse error', 'color: #ef4444; font-weight: bold', err);
      }
    };

    this.ws.onerror = (err) => {
      console.error('%c[WS] ✗ Connection error', 'color: #ef4444; font-weight: bold', err);
      this.notifyStatusChange(false);
    };

    this.ws.onclose = (event) => {
      console.log(`%c[WS] ✗ Disconnected (code: ${event.code})`, 'color: #f59e0b; font-weight: bold');
      this.ws = null;
      this.notifyStatusChange(false);
      
      if (this.shouldReconnect) {
        console.log('%c[WS] ↻ Reconnecting in 3s...', 'color: #3b82f6');
        this.reconnectTimer = setTimeout(() => this.connect(), 3000) as any;
      }
    };
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  subscribe(channel: Channel, callback: (data: unknown) => void) {
    console.log(`%c[WS] ✓ Subscribing to channel: ${channel}`, 'color: #3b82f6');
    if (!this.listeners.has(channel)) {
      this.listeners.set(channel, new Set());
    }
    this.listeners.get(channel)!.add(callback);
    
    this.subscriptions.add(channel);
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log(`%c[WS]   ⇒ Sending subscribe request for ${channel}`, 'color: #6366f1');
      this.send({ type: 'subscribe', channel });
    } else {
      console.log(`%c[WS]   ⌛ Will subscribe when connected`, 'color: #f59e0b');
    }

    return () => {
      const channelListeners = this.listeners.get(channel);
      if (channelListeners) {
        channelListeners.delete(callback);
        if (channelListeners.size === 0) {
          this.listeners.delete(channel);
          this.subscriptions.delete(channel);
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.send({ type: 'unsubscribe', channel });
          }
        }
      }
    };
  }

  private send(msg: { type: string; channel?: Channel }) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}

export const wsClient = new WebSocketClient();
