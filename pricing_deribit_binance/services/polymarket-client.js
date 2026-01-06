// services/polymarket-client.js
// Polymarket CLOB WebSocket client with order book aggregation and auto-reconnect

import { WebSocket } from 'ws';

export class PolymarketClient {
  constructor(config = {}) {
    const envUrl = process.env.POLYMARKET_WS_URL;
    this.wsUrls = config.wsUrls || (envUrl ? [envUrl] : ['wss://ws-subscriptions-clob.polymarket.com/ws/market']);
    this.wsIdx = 0;
    this.apiKey = config.apiKey || process.env.POLYMARKET_API_KEY;
    this.onTick = config.onTick || (() => {});
    this.onError = config.onError || ((err) => console.error('[Polymarket]', err));

    this.ws = null;
    this.subscribed = false;
    this.assetIds = [];
    this.bookYes = { bids: [], asks: [] };
    this.bookNo = { bids: [], asks: [] };
    this.tradesYes = [];
    this.tradesNo = [];
    this.retryMs = 2000;
    this.stopFlag = false;
    this.pingTimer = null;
  }

  // Fetch token IDs for a slug using the same fallbacks as polymarket_demo
  async fetchTokenIds(slug) {
    const POLY_REST = 'https://gamma-api.polymarket.com/markets/slug/';
    const POLY_REST_QUERY = 'https://gamma-api.polymarket.com/markets';
    const POLY_REST_FALLBACK = 'https://clob.polymarket.com/markets';

    const parseMaybeJsonArray = (val) => {
      if (!val) return [];
      if (Array.isArray(val)) return val;
      if (typeof val === 'string') {
        try {
          const parsed = JSON.parse(val);
          if (Array.isArray(parsed)) return parsed;
        } catch (_) {}
      }
      return [];
    };

    const normalizeTokens = (market) => {
      if (!market) return [];
      const outcomes = parseMaybeJsonArray(market.outcomes) || market.outcomes || [];

      const clobIds = parseMaybeJsonArray(market.clobTokenIds);
      if (clobIds.length) return clobIds.map((id, idx) => String(id || outcomes[idx] || `outcome_${idx}`));

      const clobIdsSnake = parseMaybeJsonArray(market.clob_token_ids);
      if (clobIdsSnake.length) return clobIdsSnake.map((id, idx) => String(id || outcomes[idx] || `outcome_${idx}`));

      if (market.tokens && Array.isArray(market.tokens)) {
        return market.tokens
          .filter((t) => t && (t.token_id || t.id || t.clobTokenId))
          .map((t, idx) => String(t.token_id || t.id || t.clobTokenId || outcomes[idx] || `outcome_${idx}`));
      }
      return [];
    };

    const attempts = [
      () => fetch(`${POLY_REST}${encodeURIComponent(slug)}`, { headers: { Accept: 'application/json' } }),
      () => fetch(`${POLY_REST_QUERY}?slug=${encodeURIComponent(slug)}`, { headers: { Accept: 'application/json' } }),
      () => fetch(`${POLY_REST_QUERY}?market_slug=${encodeURIComponent(slug)}`, { headers: { Accept: 'application/json' } }),
      () => fetch(`${POLY_REST_FALLBACK}?slug=${encodeURIComponent(slug)}`, { headers: { Accept: 'application/json' } }),
      () => fetch(`${POLY_REST_FALLBACK}?market_slug=${encodeURIComponent(slug)}`, { headers: { Accept: 'application/json' } }),
    ];

    let lastError = null;
    for (const attempt of attempts) {
      try {
        const resp = await attempt();
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        const market = data?.result || data?.data || data?.markets?.[0] || data?.[0] || data;
        const tokens = normalizeTokens(market);
        if (tokens.length) {
          console.log(`[Polymarket] fetchTokenIds resolved slug=${slug} tokenIds=${tokens.join(',')}`);
          return tokens;
        }
      } catch (err) {
        lastError = err;
      }
    }

    throw new Error(lastError ? lastError.message : 'market not found or missing tokens');
  }

  async connect(assetIds) {
    if (this.stopFlag) return;
    if (!Array.isArray(assetIds) || assetIds.length === 0) {
      throw new Error('assetIds must be a non-empty array');
    }

    this.assetIds = assetIds.map(String);
    const wsUrl = this.wsUrls[this.wsIdx % this.wsUrls.length];
    console.log(`[Polymarket] Connecting to ${wsUrl} with assetIds:`, this.assetIds);

    const opts = this.apiKey ? { headers: { 'X-API-Key': this.apiKey } } : undefined;
    this.ws = new WebSocket(wsUrl, opts);

    this.ws.on('open', () => {
      this.retryMs = 2000;
      const payload = { type: 'market', assets_ids: this.assetIds, initial_dump: true };
      const payloadStr = JSON.stringify(payload);
      console.log('[Polymarket] Sending subscription:', payloadStr);
      this.ws.send(payloadStr);
      console.log('[Polymarket] Connected and subscribed to', this.assetIds.join(','));

      // Keepalive ping every 50s
      this.pingTimer = setInterval(() => {
        try {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send('PING');
          }
        } catch (_) {}
      }, 50000);
    });

    this.ws.on('message', (data) => {
      const text = data.toString().trim();
      if (text === 'PONG' || text === 'PING' || text === '') return;

      try {
        const obj = JSON.parse(text);
        this.handleMessage(obj);
      } catch (err) {
        this.onError(`WS parse error: ${err.message}`);
      }
    });

    this.ws.on('close', (code, reason) => {
      this.onError(`WS closed (${code}): ${reason}`);
      this.bumpEndpoint();
      this.scheduleReconnect('close');
    });

    this.ws.on('error', (err) => {
      this.onError(`WS error: ${err.message}`);
      this.bumpEndpoint();
      this.scheduleReconnect('error');
    });
  }

  bumpEndpoint() {
    this.wsIdx = (this.wsIdx + 1) % this.wsUrls.length;
    console.log(`[Polymarket] Switching to endpoint index ${this.wsIdx}`);
  }

  handleMessage(obj) {
    const eventType = obj.event_type || obj.type || 'unknown';
    const assetId = obj.asset_id;
    console.log(`[Polymarket] Received event_type: ${eventType}, asset_id: ${assetId || 'N/A'}`);

    // Determine if YES or NO market
    const isYes = assetId === this.assetIds[0];
    const isNo = assetId === this.assetIds[1];
    const marketType = isYes ? 'YES' : isNo ? 'NO' : 'unknown';

    // Update order book
    if (eventType === 'book' || eventType === 'book_delta') {
      const isDelta = eventType === 'book_delta';
      console.log(`[Polymarket] Processing ${isDelta ? 'delta' : 'snapshot'} book update for ${marketType}`);
      this.updateBook(obj, isDelta, marketType);
      const book = isYes ? this.bookYes : this.bookNo;
      console.log(`[Polymarket] ${marketType} Book state: ${book.bids.length} bids, ${book.asks.length} asks`);
      if (book.bids.length > 0) {
        console.log(`[Polymarket] ${marketType} Best bid: ${book.bids[0].price}, Best ask: ${book.asks[0]?.price}`);
      }
    }

    // Extract trade info
    if (eventType === 'last_trade_price' || eventType.includes('trade')) {
      const trade = this.extractTrade(obj, marketType);
      if (trade) {
        console.log(`[Polymarket] ${marketType} Trade: ${trade.side} ${trade.size} @ ${trade.price}`);
        if (isYes) {
          this.tradesYes.unshift(trade);
          this.tradesYes = this.tradesYes.slice(0, 50);
        } else if (isNo) {
          this.tradesNo.unshift(trade);
          this.tradesNo = this.tradesNo.slice(0, 50);
        }
      }
    }

    // Emit tick with current state
    this.emitTick(obj);
  }

  updateBook(data, isDelta, marketType) {
    const book = data.book || data;
    const bids = book.bids || book.B || [];
    const asks = book.asks || book.A || [];
    
    console.log(`[Polymarket] Raw book data - bids: ${Array.isArray(bids) ? bids.length : 'not array'}, asks: ${Array.isArray(asks) ? asks.length : 'not array'}`);
    if (Array.isArray(bids) && bids.length > 0) {
      console.log(`[Polymarket] Sample bid entry:`, JSON.stringify(bids[0]));
    }
    if (Array.isArray(asks) && asks.length > 0) {
      console.log(`[Polymarket] Sample ask entry:`, JSON.stringify(asks[0]));
    }

    const targetBook = marketType === 'YES' ? this.bookYes : this.bookNo;

    if (!isDelta) {
      // Full snapshot
      targetBook.bids = this.normalizeSide(bids, 'bids');
      targetBook.asks = this.normalizeSide(asks, 'asks');
      console.log(`[Polymarket] Snapshot applied - ${targetBook.bids.length} bids, ${targetBook.asks.length} asks`);
    } else {
      // Delta update
      this.applyDelta(targetBook.bids, bids);
      this.applyDelta(targetBook.asks, asks);
      console.log(`[Polymarket] Delta applied - ${targetBook.bids.length} bids, ${targetBook.asks.length} asks`);
    }
  }

  normalizeSide(entries, side) {
    if (!Array.isArray(entries)) return [];
    const map = new Map();
    for (const entry of entries) {
      const level = this.parseLevel(entry);
      if (!level) continue;
      if (level.size > 0) map.set(level.price, level.size);
    }
    const arr = Array.from(map).map(([px, sz]) => ({ price: px, size: sz }));
    return arr.sort((a, b) => side === 'bids' ? b.price - a.price : a.price - b.price);
  }

  applyDelta(sideArray, entries) {
    const map = new Map(sideArray.map((l) => [l.price, l.size]));
    for (const entry of entries) {
      const level = this.parseLevel(entry);
      if (!level) continue;
      if (level.size <= 0) map.delete(level.price);
      else map.set(level.price, level.size);
    }
    sideArray.length = 0;
    for (const [px, sz] of map) {
      sideArray.push({ price: px, size: sz });
    }
    sideArray.sort((a, b) => sideArray === this.book.bids ? b.price - a.price : a.price - b.price);
  }

  parseLevel(entry) {
    if (!entry) return null;
    if (Array.isArray(entry)) {
      const px = Number(entry[0]);
      const sz = Number(entry[1] || entry[2]);
      return Number.isFinite(px) && Number.isFinite(sz) ? { price: px, size: sz } : null;
    }
    if (typeof entry === 'object') {
      const px = Number(entry.price || entry.px || entry[0]);
      const sz = Number(entry.size || entry.qty || entry.quantity || entry[1]);
      return Number.isFinite(px) && Number.isFinite(sz) ? { price: px, size: sz } : null;
    }
    return null;
  }

  extractTrade(obj, marketType) {
    const price = Number(obj.last_trade_price || obj.price || obj.trade_price);
    if (!Number.isFinite(price)) return null;
    const size = Number(obj.size || obj.amount || obj.quantity || 0);
    return {
      ts: Date.now(),
      price,
      size,
      side: obj.side || 'unknown',
      market: marketType,
      assetId: obj.asset_id || this.assetIds[0] || 'unknown',
    };
  }

  emitTick(obj) {
    // YES market data
    const bestBidYes = this.bookYes.bids[0] || null;
    const bestAskYes = this.bookYes.asks[0] || null;
    const midYes = bestBidYes && bestAskYes ? (bestBidYes.price + bestAskYes.price) / 2 : null;
    const spreadYes = bestBidYes && bestAskYes ? bestAskYes.price - bestBidYes.price : null;

    // NO market data
    const bestBidNo = this.bookNo.bids[0] || null;
    const bestAskNo = this.bookNo.asks[0] || null;
    const midNo = bestBidNo && bestAskNo ? (bestBidNo.price + bestAskNo.price) / 2 : null;
    const spreadNo = bestBidNo && bestAskNo ? bestAskNo.price - bestBidNo.price : null;

    this.onTick({
      ts: new Date().toISOString(),
      eventType: obj.event_type || obj.type || 'tick',
      yes: {
        bid: bestBidYes?.price || null,
        ask: bestAskYes?.price || null,
        mid: midYes,
        spread: spreadYes,
        bids: this.bookYes.bids.slice(0, 50),
        asks: this.bookYes.asks.slice(0, 50),
        recentTrades: this.tradesYes.slice(0, 20),
      },
      no: {
        bid: bestBidNo?.price || null,
        ask: bestAskNo?.price || null,
        mid: midNo,
        spread: spreadNo,
        bids: this.bookNo.bids.slice(0, 50),
        asks: this.bookNo.asks.slice(0, 50),
        recentTrades: this.tradesNo.slice(0, 20),
      },
    });
  }

  scheduleReconnect(reason) {
    if (this.stopFlag) return;
    const wait = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, 20000);
    console.log(`[Polymarket] Reconnecting in ${wait}ms (reason: ${reason})`);
    setTimeout(() => this.connect(this.assetIds), wait);
  }

  stop() {
    this.stopFlag = true;
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    console.log('[Polymarket] Stopped');
  }

  getStatus() {
    return {
      connected: this.ws?.readyState === 1,
      assetIds: this.assetIds,
      yesBids: this.bookYes.bids.length,
      yesAsks: this.bookYes.asks.length,
      noBids: this.bookNo.bids.length,
      noAsks: this.bookNo.asks.length,
      yesTradesCount: this.tradesYes.length,
      noTradesCount: this.tradesNo.length,
    };
  }
}
