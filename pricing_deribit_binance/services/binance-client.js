// services/binance-client.js
// Lightweight Binance spot price poller with caching and retry logic

export class BinanceClient {
  constructor(config = {}) {
    this.baseUrl = config.baseUrl || process.env.BINANCE_URL || 'https://api.binance.com/api/v3/ticker/price';
    this.interval = config.interval || (Number(process.env.BINANCE_INTERVAL) || 1) * 1000;
    this.onPrice = config.onPrice || (() => {});
    this.onError = config.onError || ((err) => console.error('[Binance]', err));
    
    this.timer = null;
    this.lastPrice = null;
    this.lastError = null;
    this.lastUpdate = null;
  }

  async fetchSpot(symbol = 'ETHUSDT') {
    const url = `${this.baseUrl}?symbol=${symbol}`;
    let lastErr = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const resp = await fetch(url, {
          headers: { 'User-Agent': 'trader-dashboard/1.0' },
          timeout: 10000,
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (!data.price) throw new Error('Missing price field in response');
        
        const price = parseFloat(data.price);
        if (!Number.isFinite(price)) throw new Error('Invalid price value');
        
        this.lastPrice = price;
        this.lastError = null;
        this.lastUpdate = new Date();
        return price;
      } catch (err) {
        lastErr = err;
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 400 * attempt));
        }
      }
    }

    // Use cached price if available
    if (this.lastPrice !== null) {
      const age = Date.now() - (this.lastUpdate?.getTime() || 0);
      const msg = `Binance fetch failed, using cached price (${(age / 1000).toFixed(1)}s old)`;
      this.onError(msg);
      return this.lastPrice;
    }

    this.lastError = lastErr;
    this.onError(`Binance failed after 3 attempts: ${lastErr?.message || lastErr}`);
    throw lastErr;
  }

  async start(symbol = 'ETHUSDT') {
    if (this.timer) return;
    console.log(`[Binance] Starting poller for ${symbol}, interval=${this.interval}ms`);
    
    try {
      const price = await this.fetchSpot(symbol);
      this.onPrice({ symbol, price, ts: this.lastUpdate });
    } catch (_) {}

    this.timer = setInterval(async () => {
      try {
        const price = await this.fetchSpot(symbol);
        this.onPrice({ symbol, price, ts: this.lastUpdate });
      } catch (err) {
        this.onError(`Binance fetch failed: ${err.message}`);
      }
    }, this.interval);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[Binance] Stopped');
    }
  }

  getLastPrice() {
    return this.lastPrice;
  }

  getLastError() {
    return this.lastError;
  }

  getStatus() {
    const age = this.lastUpdate ? Date.now() - this.lastUpdate.getTime() : null;
    return {
      running: !!this.timer,
      lastPrice: this.lastPrice,
      lastUpdate: this.lastUpdate?.toISOString(),
      ageMs: age,
      stale: age && age > 5000,
      error: this.lastError?.message,
    };
  }
}
