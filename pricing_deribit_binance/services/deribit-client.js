// services/deribit-client.js
// Deribit options & IV poller with caching and ATM/target selection

export class DeribitClient {
  constructor(config = {}) {
    this.baseUrl = config.baseUrl || process.env.DERIBIT_URL || 'https://www.deribit.com/api/v2/';
    this.interval = config.interval || (Number(process.env.DERIBIT_INTERVAL) || 2) * 1000;
    this.onSnapshot = config.onSnapshot || (() => {});
    this.onError = config.onError || ((err) => console.error('[Deribit]', err));

    this.timer = null;
    this.instrumentsCache = null;
    this.instrumentsCacheTime = null;
    this.lastSnapshot = null;
    this.lastError = null;
    
    // Expiry selection
    this.asset = null;
    this.spot = null;
    this.targetExpiry = null;  // User-selected or auto-selected expiry
  }

  async _post(method, params) {
    const url = `${this.baseUrl}${method}`;
    const payload = JSON.stringify({ jsonrpc: '2.0', method, id: 1, params });

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'trader-dashboard/1.0',
          },
          body: payload,
          timeout: 10000,
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (!data.result) throw new Error(`Missing result: ${data.error?.message || 'unknown'}`);
        return data.result;
      } catch (err) {
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 400 * attempt));
        } else {
          throw err;
        }
      }
    }
  }

  async listOptions(currency = 'ETH') {
    const now = Date.now();
    const cacheTTL = (Number(process.env.DERIBIT_INSTRUMENTS_CACHE_TTL) || 300) * 1000;

    if (this.instrumentsCache && this.instrumentsCacheTime && now - this.instrumentsCacheTime < cacheTTL) {
      return this.instrumentsCache;
    }

    const instruments = await this._post('public/get_instruments', {
      currency,
      kind: 'option',
      expired: false,
    });

    this.instrumentsCache = instruments;
    this.instrumentsCacheTime = now;
    return instruments;
  }

  async getTicker(instrumentName) {
    return await this._post('public/ticker', { instrument_name: instrumentName });
  }

  pickAtmInstrument(instruments, spot) {
    if (spot <= 0) throw new Error('Spot must be positive');
    return instruments.reduce((best, inst) => {
      const strike = Number(inst.strike || 0);
      const bestStrike = Number(best.strike || 0);
      return Math.abs(strike - spot) < Math.abs(bestStrike - spot) ? inst : best;
    });
  }

  pickInstrumentForTarget(instruments, targetDt, spot) {
    if (spot <= 0) throw new Error('Spot must be positive');
    
    const targetMs = new Date(targetDt).getTime();
    const future = instruments.filter((inst) => {
      const expMs = (inst.expiration_timestamp || 0);
      return expMs >= targetMs;
    });

    if (future.length === 0) throw new Error('No options expiring after target date');

    const soonest = future.reduce((a, b) => 
      (a.expiration_timestamp || 0) < (b.expiration_timestamp || 0) ? a : b
    );
    const soonestExp = soonest.expiration_timestamp;
    
    const same = future.filter((inst) => inst.expiration_timestamp === soonestExp);
    return same.reduce((best, inst) => {
      const strike = Number(inst.strike || 0);
      const bestStrike = Number(best.strike || 0);
      return Math.abs(strike - spot) < Math.abs(bestStrike - spot) ? inst : best;
    });
  }

  async getSnapshotForTarget(targetDt, spot, currency = 'ETH') {
    const instruments = await this.listOptions(currency);
    const chosen = this.pickInstrumentForTarget(instruments, targetDt, spot);
    const ticker = await this.getTicker(chosen.instrument_name);

    let iv = ticker.mark_iv;
    if (!iv) throw new Error('Missing mark_iv in ticker');
    if (iv > 10) iv = iv / 100; // Normalize if in percent
    if (iv <= 0) throw new Error(`Non-positive IV: ${iv}`);

    const underlying = ticker.underlying_price;
    if (!underlying) throw new Error('Missing underlying_price in ticker');

    const expiryMs = chosen.expiration_timestamp;
    const now = Date.now();
    if (expiryMs <= now) throw new Error('Instrument already expired');

    return {
      instrumentName: chosen.instrument_name,
      strike: Number(chosen.strike),
      expiryTs: expiryMs / 1000,
      markIv: iv,
      underlyingPrice: Number(underlying),
    };
  }

  async start(config = {}) {
    const { asset = 'ETH', targetDt = null, spot = null } = config;
    if (!spot) throw new Error('spot is required');

    // Store for later use (expiry changes, etc.)
    this.asset = asset;
    this.spot = spot;
    this.targetExpiry = targetDt ? new Date(targetDt) : null;

    if (this.timer) return;
    console.log(`[Deribit] Starting poller for ${asset}, interval=${this.interval}ms`);

    const doFetch = async () => {
      try {
        const snapshot = await this.getSnapshotForTarget(
          this.targetExpiry || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          this.spot,
          this.asset
        );
        this.lastSnapshot = snapshot;
        this.lastError = null;
        this.onSnapshot(snapshot);
      } catch (err) {
        this.lastError = err;
        this.onError(`Deribit fetch failed: ${err.message}`);
        if (this.lastSnapshot) {
          this.onError(`Using cached IV snapshot from ${new Date(this.lastSnapshot.expiryTs * 1000).toISOString()}`);
        }
      }
    };

    await doFetch();
    this.timer = setInterval(doFetch, this.interval);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[Deribit] Stopped');
    }
  }

  getLastSnapshot() {
    return this.lastSnapshot;
  }

  getStatus() {
    const age = this.lastSnapshot ? Date.now() - (this.lastSnapshot.expiryTs * 1000) : null;
    return {
      running: !!this.timer,
      lastSnapshot: this.lastSnapshot,
      error: this.lastError?.message,
    };
  }

  async getAvailableExpiries(currency = 'ETH') {
    try {
      const instruments = await this.listOptions(currency);
      
      // Extract unique expiry timestamps
      const expirySet = new Set();
      instruments.forEach(inst => {
        if (inst.expiration_timestamp) {
          expirySet.add(inst.expiration_timestamp);
        }
      });
      
      // Convert to sorted array of dates (ascending)
      const expiries = Array.from(expirySet)
        .sort((a, b) => a - b)
        .map(ts => new Date(ts).toISOString());
      
      return expiries;
    } catch (err) {
      console.error('[Deribit] Failed to get available expiries:', err.message);
      return [];
    }
  }

  setTargetExpiry(expiryDate) {
    this.targetExpiry = new Date(expiryDate);
    console.log(`[Deribit] Target expiry set to ${this.targetExpiry.toISOString()}`);
  }

  async refreshSnapshot() {
    if (!this.asset || !this.spot) {
      console.warn('[Deribit] Cannot refresh: asset or spot not set');
      return;
    }
    
    try {
      const snapshot = await this.getSnapshotForTarget(
        this.targetExpiry || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        this.spot,
        this.asset
      );
      this.lastSnapshot = snapshot;
      this.lastError = null;
      this.onSnapshot(snapshot);
    } catch (err) {
      this.lastError = err;
      this.onError(`Deribit refresh failed: ${err.message}`);
    }
  }
}
