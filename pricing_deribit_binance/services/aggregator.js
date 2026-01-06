// services/aggregator.js
// Combines Binance spot, Deribit IV, and Polymarket market data into unified ticks

import { BinanceClient } from './binance-client.js';
import { DeribitClient } from './deribit-client.js';
import { PolymarketClient } from './polymarket-client.js';

// Error function approximation (Abramowitz and Stegun)
function erf(x) {
  const sign = x >= 0 ? 1 : -1;
  x = Math.abs(x);
  
  const a1 =  0.254829592;
  const a2 = -0.284496736;
  const a3 =  1.421413741;
  const a4 = -1.453152027;
  const a5 =  1.061405429;
  const p  =  0.3275911;
  
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  
  return sign * y;
}

// Risk-neutral probability calculation (simplified Black-Scholes)
function normCdf(x) {
  return 0.5 * (1 + erf(x / Math.sqrt(2)));
}

function riskNeutralProbAbove(S, K, sigma, T, r = 0) {
  if (T <= 0) return S > K ? 1 : 0;
  if (sigma <= 0) return S > K ? 1 : 0;

  const sqrtT = Math.sqrt(T);
  const d2 = (Math.log(S / K) + (r - 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  return normCdf(d2);
}

export class Aggregator {
  constructor(config = {}) {
    this.config = config;
    this.binance = new BinanceClient({
      interval: (Number(process.env.BINANCE_INTERVAL) || 0.1) * 1000, // 10/s default
      onPrice: (data) => this.onBinancePrice(data),
      onError: (err) => console.error('[Aggregator:Binance]', err),
    });

    this.deribit = new DeribitClient({
      interval: (Number(process.env.DERIBIT_INTERVAL) || 0.2) * 1000, // 5/s default
      onSnapshot: (snap) => this.onDeribitSnapshot(snap),
      onError: (err) => console.error('[Aggregator:Deribit]', err),
    });

    this.polymarket = new PolymarketClient({
      onTick: (tick) => this.onPolymarketTick(tick),
      onError: (err) => console.error('[Aggregator:Polymarket]', err),
    });

    this.onTick = config.onTick || (() => {});
    this.onError = config.onError || ((err) => console.error('[Aggregator]', err));

    this.market = {
      slug: null,
      asset: 'ETH',
      strike: null,
      endDate: null,
    };

    this.state = {
      spot: null,
      iv: null,
      polyBid: null,
      polyAsk: null,
      polyMid: null,
      polyTrades: [],
    };

    // Time series history buffer - store all ticks for historical data retrieval
    // Keep 60 minutes of data (much longer than frontend display window)
    this.history = [];
    this.HISTORY_RETENTION_MS = 60 * 60 * 1000; // 60 minutes
    this.MAX_HISTORY_POINTS = 36000; // Safety limit (~10 ticks/sec * 60min)
  }

  async init(slug, asset = 'ETH') {
    console.log(`[Aggregator] Initializing for slug=${slug}, asset=${asset}`);
    
    try {
      // Fetch market metadata from Gamma API
      const market = await this.fetchMarketMetadata(slug);
      
      this.market = {
        slug,
        asset,
        strike: market.strike,
        endDate: market.endDate,
        clobTokenIds: market.clobTokenIds || [],
      };

      if (!this.market.endDate) {
        throw new Error(`Missing endDate for market ${slug}. API response may be invalid.`);
      }

      if (this.market.strike === null || this.market.strike === 0) {
        console.warn(`[Aggregator] Warning: strike is ${this.market.strike}. Market may have unusual format.`);
      }

      console.log('[Aggregator] Market metadata:', this.market);
    } catch (err) {
      console.error('[Aggregator] Failed to initialize:', err.message);
      throw err;
    }
  }

  async fetchMarketMetadata(slug) {
    const url = `${process.env.GAMMA_API_URL || 'https://gamma-api.polymarket.com/markets/slug/'}${encodeURIComponent(slug)}`;
    console.log(`[Aggregator] Fetching market metadata from ${url}`);
    
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Gamma API HTTP ${resp.status}`);
    const data = await resp.json();
    
    // Navigate response structure
    const market = data.result || data.data || data;
    if (!market) {
      console.error('[Aggregator] Invalid response:', JSON.stringify(data).slice(0, 200));
      throw new Error('Invalid Gamma API response structure');
    }

    console.log(`[Aggregator] Market response keys:`, Object.keys(market).slice(0, 10));

    // Extract endDate (must be present)
    const endDate = market.endDate || market.end_date;
    if (!endDate) {
      console.error('[Aggregator] No endDate found. Response:', JSON.stringify(market).slice(0, 500));
      throw new Error('Market missing endDate field');
    }

    // Extract strike from multiple sources
    let strike = null;
    const title = market.title || '';

    // Try from slug first (most reliable for format: {crypto}-above-{strike}-on-{date})
    let match = slug.match(/above[- ](\d+(?:\.\d+)?)/i);
    if (match) {
      strike = parseFloat(match[1]);
      console.log(`[Aggregator] Extracted strike ${strike} from slug pattern`);
    }

    // Fallback: Try regex from title
    if (!strike) {
      match = title.match(/above[- ](\d+(?:\.\d+)?)/i);
      if (match) {
        strike = parseFloat(match[1]);
        console.log(`[Aggregator] Extracted strike ${strike} from title pattern`);
      }
    }

    // Fallback: try "above $X" or just "$X" pattern
    if (!strike) {
      match = title.match(/\$(\d+(?:\.\d+)?)/);
      if (match) {
        strike = parseFloat(match[1]);
        console.log(`[Aggregator] Extracted strike ${strike} from $ pattern`);
      }
    }

    // Fallback: try from tokenMetadata or questions
    if (!strike && market.tokenMetadata) {
      for (const meta of Object.values(market.tokenMetadata)) {
        if (meta.strike !== undefined) {
          strike = parseFloat(meta.strike);
          console.log(`[Aggregator] Extracted strike ${strike} from tokenMetadata`);
          break;
        }
      }
    }

    // Fallback: try from questions array
    if (!strike && market.questions && Array.isArray(market.questions)) {
      for (const q of market.questions) {
        if (q.strike !== undefined) {
          strike = parseFloat(q.strike);
          console.log(`[Aggregator] Extracted strike ${strike} from questions`);
          break;
        }
      }
    }

    if (!strike || strike === 0) {
      console.warn(`[Aggregator] Warning: Could not extract strike from slug "${slug}" or title "${title}". Using 0.`);
      strike = 0;
    }

    // Parse clobTokenIds - handle both array and JSON string
    let clobTokenIds = market.clobTokenIds || market.clob_token_ids || [];
    
    if (typeof clobTokenIds === 'string') {
      try {
        clobTokenIds = JSON.parse(clobTokenIds);
      } catch (err) {
        console.error('[Aggregator] Failed to parse clobTokenIds JSON string:', err.message);
        clobTokenIds = [];
      }
    }

    if (Array.isArray(clobTokenIds)) {
      clobTokenIds = clobTokenIds.map(String);
    } else {
      clobTokenIds = [];
    }

    console.log(`[Aggregator] Parsed market: title="${title}", strike=${strike}, endDate=${endDate}, clobTokenIds=${clobTokenIds.length}`);

    return {
      slug,
      title,
      endDate,
      strike,
      clobTokenIds,
      outcomes: market.outcomes || [],
    };
  }

  async start(slug, asset = 'ETH', assetIds = []) {
    // Clear history buffer for new session
    this.clearHistory();
    
    await this.init(slug, asset);

    const { strike, endDate, clobTokenIds } = this.market;
    if (!strike || !endDate) throw new Error('Missing strike or endDate');

    // Start Binance spot poller
    await this.binance.start(asset + 'USDT');

    // Start Deribit IV poller
    const targetDt = new Date(endDate);
    const spot = this.binance.getLastPrice() || 2500;
    await this.deribit.start({ asset, targetDt, spot });

    // Resolve asset IDs for Polymarket subscription
    let ids = assetIds.length > 0 ? assetIds : (clobTokenIds || []);
    if (ids.length === 0) {
      console.log('[Aggregator] No clobTokenIds from metadata; fetching via Gamma fallbacks...');
      ids = await this.polymarket.fetchTokenIds(slug);
    }
    if (!ids || ids.length === 0) throw new Error('No asset IDs to subscribe to');

    // Subscribe to both YES and NO markets
    if (ids.length >= 2) {
      console.log(`[Aggregator] Subscribing to both YES (${ids[0]}) and NO (${ids[1]}) markets`);
      ids = ids.slice(0, 2);
    } else {
      console.log(`[Aggregator] Only one token found: ${ids[0]}`);
    }

    await this.polymarket.connect(ids);

    console.log('[Aggregator] All services started');
  }

  stop() {
    this.binance.stop();
    this.deribit.stop();
    this.polymarket.stop();
    console.log('[Aggregator] All services stopped');
  }

  onBinancePrice(data) {
    this.state.spot = data.price;
    this.emitTick('binance_update');
  }

  onDeribitSnapshot(snap) {
    this.state.iv = snap.markIv;
    this.emitTick('deribit_update');
  }

  onPolymarketTick(tick) {
    this.state.polyYes = tick.yes || { bid: null, ask: null, mid: null, bids: [], asks: [], recentTrades: [] };
    this.state.polyNo = tick.no || { bid: null, ask: null, mid: null, bids: [], asks: [], recentTrades: [] };
    console.log(
      `[Aggregator] Polymarket tick: ` +
      `YES bid=${tick.yes?.bid}, ask=${tick.yes?.ask}, bids=${tick.yes?.bids?.length}, asks=${tick.yes?.asks?.length} | ` +
      `NO bid=${tick.no?.bid}, ask=${tick.no?.ask}, bids=${tick.no?.bids?.length}, asks=${tick.no?.asks?.length}`
    );
    this.emitTick('polymarket_update');
  }

  emitTick(source) {
    const { spot, iv, polyYes, polyNo } = this.state;
    const { strike, endDate, asset } = this.market;

    // Allow partial ticks so books update even if one source lags
    const now = new Date();
    const endDt = endDate ? new Date(endDate) : null;
    const timeToExpiry = endDt ? Math.max(0, (endDt - now) / (365.25 * 24 * 60 * 60 * 1000)) : null;

    let impliedProbYes = null;
    let impliedProbNo = null;
    if (spot && iv && strike && timeToExpiry !== null) {
      impliedProbYes = riskNeutralProbAbove(spot, strike, iv, timeToExpiry);
      impliedProbNo = 1 - impliedProbYes;
    }

    // Calculate fair value distances (implied prob vs best bid/ask)
    const yesFairDist = {
      bidDist: impliedProbYes !== null && polyYes?.bid !== null ? impliedProbYes - polyYes.bid : null,
      askDist: impliedProbYes !== null && polyYes?.ask !== null ? polyYes.ask - impliedProbYes : null,
    };
    
    const noFairDist = {
      bidDist: impliedProbNo !== null && polyNo?.bid !== null ? impliedProbNo - polyNo.bid : null,
      askDist: impliedProbNo !== null && polyNo?.ask !== null ? polyNo.ask - impliedProbNo : null,
    };

    // Get Deribit expiry from last snapshot
    const deribitExpiry = this.deribit.getLastSnapshot()?.expiryTs 
      ? new Date(this.deribit.getLastSnapshot().expiryTs * 1000).toISOString() 
      : null;
    const deribitStrike = this.deribit.getLastSnapshot()?.strike || null;

    const tick = {
      ts: now.toISOString(),
      type: 'tick',
      source,
      asset,
      strike,
      spot: spot || null,
      endDate,
      timeToExpiry,
      polymarket: {
        yes: {
          bid: polyYes?.bid || null,
          ask: polyYes?.ask || null,
          mid: polyYes?.mid || null,
          spread: polyYes?.bid && polyYes?.ask ? polyYes.ask - polyYes.bid : null,
          bids: polyYes?.bids || [],
          asks: polyYes?.asks || [],
          recentTrades: polyYes?.recentTrades || [],
        },
        no: {
          bid: polyNo?.bid || null,
          ask: polyNo?.ask || null,
          mid: polyNo?.mid || null,
          spread: polyNo?.bid && polyNo?.ask ? polyNo.ask - polyNo.bid : null,
          bids: polyNo?.bids || [],
          asks: polyNo?.asks || [],
          recentTrades: polyNo?.recentTrades || [],
        },
      },
      deribit: {
        atmIv: iv || null,
        sigmaH: iv && timeToExpiry !== null ? iv * Math.sqrt(timeToExpiry) : null,
        impliedProbYes,
        impliedProbNo,
        expiry: deribitExpiry,
        strike: deribitStrike,
      },
      fairValue: {
        yes: yesFairDist,
        no: noFairDist,
      },
    };

    console.log(
      `[Aggregator] Emitting tick: spot=${spot}, ` +
      `yBid=${tick.polymarket.yes.bid}, yAsk=${tick.polymarket.yes.ask}, yBids=${tick.polymarket.yes.bids?.length}, yAsks=${tick.polymarket.yes.asks?.length}, ` +
      `nBid=${tick.polymarket.no.bid}, nAsk=${tick.polymarket.no.ask}, nBids=${tick.polymarket.no.bids?.length}, nAsks=${tick.polymarket.no.asks?.length}`
    );

    // Store in history buffer
    this.history.push(tick);
    
    // Trim old history data
    const cutoff = now.getTime() - this.HISTORY_RETENTION_MS;
    while (this.history.length > 0 && new Date(this.history[0].ts).getTime() < cutoff) {
      this.history.shift();
    }
    
    // Enforce max points as safety
    if (this.history.length > this.MAX_HISTORY_POINTS) {
      const excess = this.history.length - this.MAX_HISTORY_POINTS;
      this.history.splice(0, excess);
    }

    this.onTick(tick);
  }

  getStatus() {
    return {
      market: this.market,
      binance: this.binance.getStatus(),
      deribit: this.deribit.getStatus(),
      polymarket: this.polymarket.getStatus(),
      historySize: this.history.length,
    };
  }

  getHistory(minutes = 30) {
    const cutoff = Date.now() - (minutes * 60 * 1000);
    return this.history.filter(tick => new Date(tick.ts).getTime() >= cutoff);
  }

  clearHistory() {
    this.history = [];
  }

  async getAvailableExpiries() {
    if (!this.deribit) {
      throw new Error('Deribit client not initialized');
    }
    return await this.deribit.getAvailableExpiries(this.market.asset);
  }

  async setExpiry(expiryDate) {
    if (!this.deribit) {
      throw new Error('Deribit client not initialized');
    }
    
    console.log(`[Aggregator] Setting expiry to ${expiryDate}`);
    this.deribit.setTargetExpiry(expiryDate);
    
    // Immediately refresh to get new IV with selected expiry
    await this.deribit.refreshSnapshot();
  }
}
