/**
 * WebSocket Connection Pool
 * Manages WebSocket connections with multiplexing, batching, and auto-reconnect
 */

import WebSocket from "ws";
import { Logger } from "../../../lib/logger/index.js";
import {
  ConnectionState,
  ConnectionHealth,
  WsMarketEvent,
  HybridStreamConfig,
  DEFAULT_STREAM_CONFIG,
} from "./types.js";

const WS_MARKET_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";

export interface WsConnectionCallbacks {
  onMessage: (event: WsMarketEvent) => void;
  onStateChange: (state: ConnectionState, error?: Error) => void;
}

export class ConnectionPool {
  private ws: WebSocket | null = null;
  private subscriptions: Set<string> = new Set();
  private pendingSubscriptions: Set<string> = new Set();
  private batchTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts: number = 0;
  private logger: Logger;
  private config: HybridStreamConfig;
  private callbacks: WsConnectionCallbacks | null = null;
  private health: ConnectionHealth;

  constructor(config: Partial<HybridStreamConfig> = {}, logger?: Logger) {
    this.config = { ...DEFAULT_STREAM_CONFIG, ...config };
    this.logger = logger || new Logger({ service: "ConnectionPool" });

    this.health = {
      state: "disconnected",
      messageCount: 0,
      errorCount: 0,
      reconnectCount: 0,
    };
  }

  /**
   * Connect to WebSocket server
   */
  async connect(callbacks: WsConnectionCallbacks): Promise<void> {
    this.callbacks = callbacks;
    return this.doConnect();
  }

  /**
   * Internal connect with retry logic
   */
  private doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      this.updateState("connecting");
      this.logger.info("Connecting to WebSocket...", { url: WS_MARKET_URL });

      this.ws = new WebSocket(WS_MARKET_URL);

      this.ws.on("open", () => {
        this.logger.info("✅ WebSocket connected");
        this.health.connectedAt = Date.now();
        this.health.lastMessageAt = Date.now();
        this.reconnectAttempts = 0;
        this.updateState("connected");

        // Resubscribe to existing subscriptions
        this.resubscribeAll();

        // Start ping interval
        this.startPing();

        resolve();
      });

      this.ws.on("message", (data: WebSocket.RawData) => {
        const raw = data.toString();
        try {
          // Handle potential non-JSON messages (e.g. "INVALID OPERATION")
          if (raw.trim() === "INVALID OPERATION") {
            this.logger.debug("Received INVALID OPERATION from WebSocket");
            return;
          }

          const message = JSON.parse(raw);
          this.health.messageCount++;
          this.health.lastMessageAt = Date.now();

          if (this.callbacks) {
            this.callbacks.onMessage(message);
          }
        } catch (err) {
          this.logger.warn("Failed to parse WebSocket message", {
            error: (err as Error)?.message,
            sample: raw.slice(0, 200),
          });
        }
      });

      this.ws.on("close", (code, reason) => {
        this.logger.warn("WebSocket disconnected", {
          code,
          reason: reason.toString(),
        });
        this.stopPing();
        this.handleDisconnect();
      });

      this.ws.on("error", (err) => {
        this.logger.error("WebSocket error", { error: err.message });
        this.health.errorCount++;

        if (this.health.state === "connecting") {
          reject(err);
        }
      });

      // Connection timeout
      setTimeout(() => {
        if (this.health.state === "connecting") {
          this.ws?.close();
          reject(new Error("Connection timeout"));
        }
      }, 10000);
    });
  }

  /**
   * Handle disconnection with auto-reconnect
   */
  private async handleDisconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.config.wsMaxReconnectAttempts) {
      this.logger.error("Max reconnect attempts reached, giving up");
      this.updateState("disconnected", new Error("Max reconnect attempts"));
      return;
    }

    this.updateState("reconnecting");
    this.health.reconnectCount++;
    this.reconnectAttempts++;

    const delay =
      this.config.wsReconnectIntervalMs * Math.min(this.reconnectAttempts, 5);
    this.logger.info(
      `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`,
    );

    await new Promise((resolve) => setTimeout(resolve, delay));

    try {
      await this.doConnect();
    } catch (err) {
      this.logger.error("Reconnect failed", { error: (err as Error).message });
      this.handleDisconnect();
    }
  }

  /**
   * Subscribe to market updates
   * Uses batching to avoid sending many individual subscribe messages
   */
  subscribe(tokenIds: string | string[]): void {
    const ids = Array.isArray(tokenIds) ? tokenIds : [tokenIds];

    for (const id of ids) {
      if (!this.subscriptions.has(id)) {
        this.pendingSubscriptions.add(id);
      }
    }

    // Batch subscriptions
    this.scheduleBatch();
  }

  /**
   * Unsubscribe from market updates
   */
  unsubscribe(tokenIds: string | string[]): void {
    const ids = Array.isArray(tokenIds) ? tokenIds : [tokenIds];
    const toUnsubscribe: string[] = [];

    for (const id of ids) {
      if (this.subscriptions.has(id)) {
        this.subscriptions.delete(id);
        this.pendingSubscriptions.delete(id);
        toUnsubscribe.push(id);
      }
    }

    if (toUnsubscribe.length > 0 && this.isConnected()) {
      this.sendUnsubscribe(toUnsubscribe);
    }
  }

  /**
   * Schedule batch subscription send
   */
  private scheduleBatch(): void {
    if (this.batchTimer) return;

    this.batchTimer = setTimeout(() => {
      this.batchTimer = null;
      this.sendPendingSubscriptions();
    }, this.config.subscriptionBatchDelayMs);
  }

  /**
   * Send pending subscriptions in batches
   */
  private sendPendingSubscriptions(): void {
    if (!this.isConnected() || this.pendingSubscriptions.size === 0) return;

    const pending = Array.from(this.pendingSubscriptions);
    this.pendingSubscriptions.clear();

    // Batch by max size (500 per connection per Polymarket docs)
    for (
      let i = 0;
      i < pending.length;
      i += this.config.subscriptionBatchSize
    ) {
      const batch = pending.slice(i, i + this.config.subscriptionBatchSize);
      this.sendSubscribe(batch);

      // Add to tracked subscriptions
      for (const id of batch) {
        this.subscriptions.add(id);
      }
    }

    this.logger.info(`Subscribed to ${pending.length} markets`);
  }

  /**
   * Send subscribe message
   */
  private sendSubscribe(tokenIds: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const message = {
      type: "market",
      assets_ids: tokenIds,
    };

    this.ws.send(JSON.stringify(message));
    this.logger.debug(`Subscription sent for ${tokenIds.length} markets`);
  }

  /**
   * Send unsubscribe message
   */
  private sendUnsubscribe(tokenIds: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // Polymarket uses same message format, server interprets based on current state
    const message = {
      type: "unsubscribe",
      assets_ids: tokenIds,
    };

    this.ws.send(JSON.stringify(message));
    this.logger.debug(`Unsubscription sent for ${tokenIds.length} markets`);
  }

  /**
   * Resubscribe to all tracked markets after reconnect
   */
  private resubscribeAll(): void {
    if (this.subscriptions.size === 0) return;

    const all = Array.from(this.subscriptions);
    this.logger.info(`Resubscribing to ${all.length} markets after reconnect`);

    // Clear and re-add as pending
    this.subscriptions.clear();
    for (const id of all) {
      this.pendingSubscriptions.add(id);
    }
    this.sendPendingSubscriptions();
  }

  /**
   * Start ping/heartbeat
   */
  private startPing(): void {
    this.stopPing();

    this.pingTimer = setInterval(() => {
      if (this.isConnected()) {
        // Check for stale connection
        const lastMsg = this.health.lastMessageAt || 0;
        if (Date.now() - lastMsg > this.config.wsStaleThresholdMs) {
          this.logger.warn("WebSocket appears stale, reconnecting...");
          this.ws?.close();
          return;
        }

        // Send ping if WebSocket supports it
        if (this.ws?.ping) {
          this.ws.ping();
        }
      }
    }, this.config.wsPingIntervalMs);
  }

  /**
   * Stop ping
   */
  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /**
   * Update connection state
   */
  private updateState(state: ConnectionState, error?: Error): void {
    this.health.state = state;
    if (this.callbacks) {
      this.callbacks.onStateChange(state, error);
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Get connection health
   */
  getHealth(): ConnectionHealth {
    return { ...this.health };
  }

  /**
   * Get subscription count
   */
  getSubscriptionCount(): number {
    return this.subscriptions.size;
  }

  /**
   * Get all subscribed token IDs
   */
  getSubscriptions(): string[] {
    return Array.from(this.subscriptions);
  }

  /**
   * Disconnect and cleanup
   */
  disconnect(): void {
    this.stopPing();

    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.subscriptions.clear();
    this.pendingSubscriptions.clear();
    this.updateState("disconnected");
    this.logger.info("ConnectionPool disconnected");
  }
}
