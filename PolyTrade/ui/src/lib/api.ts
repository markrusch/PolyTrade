const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3003";

console.log(
  "%c[API CONFIG]",
  "color: #8b5cf6; font-weight: bold; font-size: 14px",
  "\n  Base URL:",
  BASE_URL,
  "\n  Mode:",
  import.meta.env.MODE,
  "\n  Env VITE_API_URL:",
  import.meta.env.VITE_API_URL,
);

export interface Market {
  id: string;
  question: string;
  endDate: string;
  volume24h: string;
  lastPrice: string;
}

export interface OrderBookLevel {
  price: string;
  size: string;
}

export interface OrderBook {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestamp: number;
}

export interface StreamingOrderBookResponse {
  source: "streaming";
  warmingUp: boolean;
  latestOrderBook: OrderBook | null;
  bufferState: unknown;
  candles: unknown[];
}

export interface Order {
  id: string;
  market: string;
  title?: string;
  side: "BUY" | "SELL";
  price: string;
  size: string;
  filled: string;
  status: string;
  timestamp: string;
}

export interface Position {
  id?: string;
  market: string;
  outcome?: string;
  size: string;
  avgEntry: string;
  pnl: string;
  pnlPercent: string;
  currentPrice?: string;
  exitPrice?: string;
  status?: string;
  redeemable?: boolean;
  type?: string;
}

export interface PositionsResponse {
  open: Position[];
  closed: Position[];
}

export interface PortfolioGreeks {
  success: boolean;
  totalDelta: number;
  totalGamma: number;
  totalVega: number;
  totalTheta: number;
  totalCharm: number;
  totalVanna: number;
  positionCount: number;
  positions: Array<{
    tokenId: string;
    market: string;
    outcome: string;
    size: number;
    delta: number;
    gamma: number;
    vega: number;
    theta: number;
    charm: number;
    vanna: number;
  }>;
  byCrypto?: Record<string, {
    delta: number;
    gamma: number;
    vega: number;
    theta: number;
    positionCount: number;
  }>;
  timestamp: number;
  status: "ok" | "partial" | "no_data";
  message?: string;
}

export interface PricingResult {
  fair: string;
  iv: string;
  spread: string;
  spot?: string;
  strike?: string;
  tte?: string;
  crypto?: string;
  greeks: {
    delta: string;
    gamma: string;
    theta: string;
    vega: string;
  };
  callPrice?: string;
  putPrice?: string;
  probAbove?: string;
}

export interface HealthStatus {
  status: string;
  timestamp: string;
  services: {
    clob: boolean;
    orderbook: boolean;
    binance: boolean;
    deribit: boolean;
  };
  initialization: {
    complete: boolean;
    clobClient: boolean;
    streamManager: boolean;
    database: boolean;
    marketMaker: boolean;
    binance: boolean;
    deribit: boolean;
    elapsedSeconds: string;
    errors: Array<{ service: string; error: string; timestamp: number }>;
  };
  ready: boolean;
  uptime: number;
}

export interface MarketMetadata {
  id?: string;
  slug?: string;
  question?: string;
  strike?: number;
  endDate?: string;
  clobTokenIds?: string[];
  crypto?: string;
}

// Streaming Status Types
export interface StreamingMarket {
  tokenId: string;
  slug?: string;
  state: "active" | "stale" | "warming_up";
  tickCount: number;
  lastUpdate?: string;
}

export interface StreamingStatus {
  connection: {
    connected: boolean;
    reconnects: number;
  };
  markets: {
    total: number;
    enabled: number;
    active: number;
    stale: number;
    byState: Record<string, number>;
  };
  global: {
    totalTicks: number;
    uptime: number;
  };
  activeMarkets: StreamingMarket[];
}

// Market Maker Types
export interface DiscoveredMarket {
  slug: string;
  question: string;
  volume24h: string;
  liquidity: string;
  active: boolean;
}

// Market Discovery Types
export type CryptoTicker = "BTC" | "ETH" | "SOL" | "XRP";

export interface StrikeMarketInfo {
  strike: number;
  slug: string;
  yesTokenId: string;
  noTokenId: string;
  yesPrice: number;
  noPrice: number;
  bestBid: number | null;
  bestAsk: number | null;
  volume24hr: number;
  liquidity: number;
  spread: number;
  active: boolean;
}

export interface CryptoEventInfo {
  eventDate: string;
  eventSlug: string;
  eventTitle: string;
  strikeCount: number;
  strikes: StrikeMarketInfo[];
}

export interface DiscoveryResult {
  success: boolean;
  crypto: CryptoTicker;
  daysScanned: number;
  eventsFound: number;
  totalStrikes: number;
  discoveredAt: string;
  events: CryptoEventInfo[];
}

export interface StrikesResult {
  success: boolean;
  crypto: CryptoTicker;
  date: string;
  strikeCount: number;
  strikes: StrikeMarketInfo[];
}

// Pricing & Greeks Types
export interface BinaryGreeks {
  delta: number;
  gamma: number;
  vega: number;
  theta: number;
  charm?: number;
  vanna?: number;
}

export interface WiredMarketInfo {
  tokenId: string;
  crypto: CryptoTicker;
  strike: number;
  expiry: string;
  status: "initializing" | "active" | "stale" | "error";
  spotPrice: number | null;
  impliedVolatility: number | null;
  fairPrice: number | null;
  greeks: BinaryGreeks | null;
  edge: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  underlyingPrice: number | null;
  derivedBid?: number;
  derivedAsk?: number;
  derivedMid?: number;
  derivedSpread?: number;
  derivedEdge?: number;
  lastUpdate: string;
  // Data freshness info (milliseconds since last update)
  spotAgeMs?: number | null;
  ivAgeMs?: number | null;
}

// Data freshness info per crypto
export interface DataFreshness {
  spotTimestamp: number;
  ivTimestamp: number;
  spotAgeMs: number | null;
  ivAgeMs: number | null;
}

export interface PricingResponse {
  success: boolean;
  source: "wired" | "calculated";
  tokenId: string;
  crypto?: string;
  strike?: number;
  expiry?: string;
  spotPrice?: number;
  spot?: number;
  impliedVolatility?: number;
  iv?: number;
  timeToExpiry?: number;
  tte?: number;
  fairPrice?: number;
  d1?: number;
  d2?: number;
  greeks?: BinaryGreeks;
  marketBid?: number;
  marketAsk?: number;
  edge?: number;
  status?: string;
  lastUpdate?: string;
}

export interface IVResponse {
  success: boolean;
  crypto: string;
  instrumentName: string;
  markIv: number;
  markIvPercent: string;
  underlyingPrice: number;
  timestamp: number;
  instrument?: {
    strike: number;
    expiration_timestamp: number;
    option_type: "call" | "put";
    currency: string;
  };
  greeks?: BinaryGreeks;
}

export interface CryptoStatsResponse {
  success: boolean;
  crypto: CryptoTicker;
  ulPrice: number | null;
  atmVol: number | null;
  timestamp: number;
  stale: boolean;
  source?: {
    spotSource: string;
    ivSource: string;
  };
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options?: RequestInit,
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const method = options?.method || "GET";

    // Timeout: 60s for health (backend may take time to init), 30s for others
    const timeoutMs = endpoint === "/api/health" ? 60000 : 30000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    console.log(
      `%c[API] ${method} ${url}`,
      "color: #3b82f6; font-weight: bold",
    );

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...options?.headers,
        },
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        let errorDetails = "";
        try {
          const errorJson = await response.json();
          errorDetails = JSON.stringify(errorJson, null, 2);
        } catch {
          errorDetails = await response.text().catch(() => response.statusText);
        }

        console.error(
          `%c[API] ✗ ${method} ${url}\n` +
            `%cStatus: ${response.status} ${response.statusText}\n` +
            `%cResponse: ${errorDetails}`,
          "color: #ef4444; font-weight: bold",
          "color: #f59e0b",
          "color: #dc2626",
        );

        throw new Error(
          `${response.status} ${response.statusText}: ${errorDetails}`,
        );
      }

      const data = await response.json();
      console.log(
        `%c[API] ✓ ${method} ${url}`,
        "color: #10b981; font-weight: bold",
        data,
      );
      return data;
    } catch (error) {
      clearTimeout(timeoutId);

      // AbortError is expected when TanStack Query cancels an in-flight request
      // (e.g. adaptive polling fires a new request before the old one completes).
      // Do not log these as network errors — just re-throw so TanStack Query can
      // handle them silently.
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }

      if (error instanceof Error && !error.message.includes("Status")) {
        console.error(
          `%c[API] ✗ Network Error\n` +
            `%cURL: ${url}\n` +
            `%cError: ${error.message}\n` +
            `%cTip: Check if backend server is running on ${this.baseUrl}`,
          "color: #ef4444; font-weight: bold",
          "color: #f59e0b",
          "color: #dc2626",
          "color: #6366f1",
        );
      }
      throw error;
    }
  }

  async getHealth(): Promise<HealthStatus> {
    return this.request<HealthStatus>("/api/health");
  }

  async getMarkets(): Promise<Market[]> {
    return this.request<Market[]>("/api/markets");
  }

  async getMarketBySlug(
    slug: string,
  ): Promise<{ success: boolean; market: MarketMetadata }> {
    return this.request<{ success: boolean; market: MarketMetadata }>(
      `/api/markets/${slug}`,
    );
  }

  async getOrderBook(tokenId: string): Promise<OrderBook> {
    // Use streaming endpoint which has correct bid/ask sorting from HybridStreamManager
    const response = await this.request<StreamingOrderBookResponse>(
      `/api/streaming/orderbook/${tokenId}`,
    );

    // Extract orderbook from streaming response, with fallback to empty arrays
    if (
      response?.latestOrderBook &&
      Array.isArray(response.latestOrderBook.bids) &&
      Array.isArray(response.latestOrderBook.asks)
    ) {
      return response.latestOrderBook;
    }

    // Return empty orderbook if still warming up or malformed
    return {
      bids: [],
      asks: [],
      timestamp: Date.now(),
    };
  }

  // Legacy method - kept for reference but not recommended
  async getOrderBookLegacy(tokenId: string): Promise<OrderBook> {
    return this.request<OrderBook>(`/api/orderbook?market=${tokenId}`);
  }

  async getOrderBookBySlug(
    slug: string,
    outcome: "yes" | "no" = "yes",
  ): Promise<OrderBook & { slug: string; outcome: string; tokenId: string }> {
    return this.request<
      OrderBook & { slug: string; outcome: string; tokenId: string }
    >(`/api/orderbook/slug/${slug}?outcome=${outcome}`);
  }

  async getOrders(): Promise<Order[]> {
    return this.request<Order[]>("/api/orders");
  }

  async getPositions(): Promise<Position[]> {
    const response = await this.request<Position[] | PositionsResponse>(
      "/api/positions?type=open",
    );
    // Handle both array and object response formats
    return Array.isArray(response) ? response : response.open || [];
  }

  async getPositionsByType(type: "open" | "closed"): Promise<Position[]> {
    const response = await this.request<Position[] | PositionsResponse>(
      `/api/positions?type=${type}`,
    );
    if (Array.isArray(response)) return response;
    return type === "open" ? response.open || [] : response.closed || [];
  }

  async getPortfolioGreeks(): Promise<PortfolioGreeks> {
    return this.request<PortfolioGreeks>("/api/portfolio/greeks");
  }

  async placeOrder(order: {
    tokenId: string;
    side: "BUY" | "SELL";
    price: number | string;
    size: number | string;
  }): Promise<Order | any> {
    const payload = {
      tokenId: order.tokenId,
      side: order.side,
      price: order.price,
      size: order.size,
    };

    const resp = await this.request<any>("/api/orders", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    // Handle both wrapped { success, order } and raw order response forms
    if (
      resp &&
      typeof resp === "object" &&
      "success" in resp &&
      "order" in resp
    ) {
      return resp.order;
    }
    return resp;
  }

  async cancelOrder(orderId: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(`/api/orders/${orderId}/cancel`, {
      method: "POST",
    });
  }

  async cancelAllOrders(): Promise<{ cancelled: number }> {
    return this.request<{ cancelled: number }>("/api/orders/cancelAll", {
      method: "POST",
    });
  }

  async calculatePricing(params: {
    spot?: number;
    strike: number;
    tte: number;
    iv?: number;
    crypto?: string;
  }): Promise<PricingResult> {
    return this.request<PricingResult>("/api/pricing/bs", {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  // ═══════════════════════════════════════════════════════════
  // STREAMING STATUS API
  // ═══════════════════════════════════════════════════════════

  async getStreamingStatus(): Promise<StreamingStatus> {
    return this.request<StreamingStatus>("/api/streaming/status");
  }

  async subscribeMarket(
    tokenId: string,
    options?: { slug?: string; outcome?: "yes" | "no"; priority?: number },
  ): Promise<{ success: boolean; market: StreamingMarket }> {
    return this.request<{ success: boolean; market: StreamingMarket }>(
      "/api/streaming/markets",
      {
        method: "POST",
        body: JSON.stringify({ tokenId, ...options }),
      },
    );
  }

  async unsubscribeMarket(tokenId: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(
      `/api/streaming/markets/${tokenId}`,
      {
        method: "DELETE",
      },
    );
  }

  // ═══════════════════════════════════════════════════════════
  // MARKET MAKER API
  // ═══════════════════════════════════════════════════════════

  async startMarketMaker(): Promise<{ success: boolean; message: string }> {
    return this.request<{ success: boolean; message: string }>(
      "/api/mm/start",
      {
        method: "POST",
      },
    );
  }

  async stopMarketMaker(): Promise<{ success: boolean; message: string }> {
    return this.request<{ success: boolean; message: string }>("/api/mm/stop", {
      method: "POST",
    });
  }

  async addMarketToMM(
    slug: string,
  ): Promise<{ success: boolean; message: string }> {
    return this.request<{ success: boolean; message: string }>(
      "/api/mm/markets",
      {
        method: "POST",
        body: JSON.stringify({ slug }),
      },
    );
  }

  async discoverMarkets(
    limit: number = 10,
    autoAdd: boolean = false,
  ): Promise<{
    success: boolean;
    markets?: DiscoveredMarket[];
    discovered?: number;
    added?: number;
  }> {
    return this.request<{
      success: boolean;
      markets?: DiscoveredMarket[];
      discovered?: number;
      added?: number;
    }>("/api/mm/discover", {
      method: "POST",
      body: JSON.stringify({ limit, autoAdd }),
    });
  }

  // ═══════════════════════════════════════════════════════════
  // SERVICE CONTROL API
  // ═══════════════════════════════════════════════════════════

  async startService(
    crypto: string,
    service: "binance" | "deribit",
  ): Promise<{ success: boolean; message: string }> {
    return this.request<{ success: boolean; message: string }>(
      "/api/services/start",
      {
        method: "POST",
        body: JSON.stringify({ crypto, service }),
      },
    );
  }

  async stopService(
    crypto: string,
    service: "binance" | "deribit",
  ): Promise<{ success: boolean; message: string }> {
    return this.request<{ success: boolean; message: string }>(
      "/api/services/stop",
      {
        method: "POST",
        body: JSON.stringify({ crypto, service }),
      },
    );
  }

  async startAllServices(): Promise<{ success: boolean; message: string }> {
    return this.request<{ success: boolean; message: string }>(
      "/api/services/start-all",
      {
        method: "POST",
      },
    );
  }

  async stopAllServices(): Promise<{ success: boolean; message: string }> {
    return this.request<{ success: boolean; message: string }>(
      "/api/services/stop-all",
      {
        method: "POST",
      },
    );
  }

  async getServicesStatus(): Promise<{
    success: boolean;
    counts: any;
    services: any[];
  }> {
    return this.request<{ success: boolean; counts: any; services: any[] }>(
      "/api/services/status",
    );
  }

  // ═══════════════════════════════════════════════════════════
  // MARKET DISCOVERY API
  // ═══════════════════════════════════════════════════════════

  async discoverCryptoMarkets(
    crypto: CryptoTicker = "BTC",
    days: number = 30,
  ): Promise<DiscoveryResult> {
    return this.request<DiscoveryResult>(
      `/api/discovery/markets?crypto=${crypto}&days=${days}`,
    );
  }

  async getStrikesForDate(
    crypto: CryptoTicker,
    date: string,
  ): Promise<StrikesResult> {
    return this.request<StrikesResult>(
      `/api/discovery/strikes?crypto=${crypto}&date=${date}`,
    );
  }

  async subscribeDiscoveredMarket(params: {
    tokenId: string;
    crypto: CryptoTicker;
    strike: number;
    expiry: string;
    slug?: string;
  }): Promise<{ success: boolean; message: string; market: WiredMarketInfo }> {
    return this.request<{
      success: boolean;
      message: string;
      market: WiredMarketInfo;
    }>("/api/discovery/subscribe", {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  async wireAllMarkets(
    crypto: CryptoTicker,
    days: number = 30,
  ): Promise<{
    success: boolean;
    crypto: CryptoTicker;
    totalMarkets: number;
    wiredCount: number;
    failedCount: number;
    duration: number;
    markets: WiredMarketInfo[];
    failedMarkets: Array<{ strike: number; error: string }>;
  }> {
    return this.request<any>(`/api/discovery/wire-all/${crypto}`, {
      method: "POST",
      body: JSON.stringify({ days }),
    });
  }

  // ═══════════════════════════════════════════════════════════
  // PRICING & GREEKS API
  // ═══════════════════════════════════════════════════════════

  async getPricing(tokenId: string): Promise<PricingResponse> {
    return this.request<PricingResponse>(`/api/pricing/${tokenId}`);
  }

  async calculateBinaryPricing(params: {
    spot: number;
    strike: number;
    tte: number;
    iv: number;
    isCall?: boolean;
  }): Promise<{
    success: boolean;
    inputs: any;
    pricing: { fairPrice: number; d1: number; d2: number };
    greeks: BinaryGreeks;
    interpretation: any;
  }> {
    return this.request<any>("/api/pricing/calculate", {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  async getWiredMarkets(): Promise<{
    success: boolean;
    count: number;
    timestamp: number;
    freshness: Record<string, DataFreshness>;
    markets: WiredMarketInfo[];
  }> {
    return this.request<{
      success: boolean;
      count: number;
      timestamp: number;
      freshness: Record<string, DataFreshness>;
      markets: WiredMarketInfo[];
    }>("/api/pricing/wired");
  }

  async getIV(crypto: string, expiry?: string): Promise<IVResponse> {
    const url = expiry
      ? `/api/iv/${crypto}?expiry=${expiry}`
      : `/api/iv/${crypto}`;
    return this.request<IVResponse>(url);
  }

  async getCryptoStats(crypto: CryptoTicker): Promise<CryptoStatsResponse> {
    return this.request<CryptoStatsResponse>(`/api/crypto/stats/${crypto}`);
  }

  // Controls Framework API calls
  async getSystemStatus(): Promise<any> {
    return this.request<any>("/api/system/status");
  }

  async getRiskLimits(): Promise<any> {
    return this.request<any>("/api/risk/limits");
  }

  async getSafetyMonitorStatus(): Promise<any> {
    return this.request<any>("/api/safety-monitor/status");
  }

  async getInventorySummary(): Promise<any> {
    return this.request<any>("/api/inventory/summary");
  }

  // ═══════════════════════════════════════════════════════════
  // RESEARCH API (Separate from Trading)
  // ═══════════════════════════════════════════════════════════

  async getResearchStatus(): Promise<ResearchStatus> {
    return this.request<ResearchStatus>("/api/research/status");
  }

  async getWinRateByPrice(): Promise<WinRateAnalysisResponse> {
    return this.request<WinRateAnalysisResponse>(
      "/api/research/win-rate-by-price",
    );
  }

  async getCalibrationData(): Promise<CalibrationResponse> {
    return this.request<CalibrationResponse>("/api/research/calibration");
  }

  async getVolumeAnalysis(
    granularity: "daily" | "weekly" | "monthly" = "daily",
  ): Promise<VolumeAnalysisResponse> {
    return this.request<VolumeAnalysisResponse>(
      `/api/research/volume-analysis?granularity=${granularity}`,
    );
  }

  async getMarketScores(options?: {
    minScore?: number;
    recommendation?: string;
    excludeCrypto?: boolean;
    limit?: number;
  }): Promise<MarketScoresResponse> {
    const params = new URLSearchParams();
    if (options?.minScore !== undefined)
      params.set("minScore", String(options.minScore));
    if (options?.recommendation)
      params.set("recommendation", options.recommendation);
    if (options?.excludeCrypto) params.set("excludeCrypto", "true");
    if (options?.limit) params.set("limit", String(options.limit));
    return this.request<MarketScoresResponse>(
      `/api/research/market-scores?${params}`,
    );
  }

  async getMispricingOpportunities(options?: {
    minMispricing?: number;
    minConfidence?: number;
    minVolume?: number;
    limit?: number;
  }): Promise<MispricingResponse> {
    const params = new URLSearchParams();
    if (options?.minMispricing !== undefined)
      params.set("minMispricing", String(options.minMispricing));
    if (options?.minConfidence !== undefined)
      params.set("minConfidence", String(options.minConfidence));
    if (options?.minVolume !== undefined)
      params.set("minVolume", String(options.minVolume));
    if (options?.limit) params.set("limit", String(options.limit));
    return this.request<MispricingResponse>(
      `/api/research/mispricing?${params}`,
    );
  }

  async getMispricingHistory(
    status?: "PENDING" | "ACTED" | "EXPIRED",
    limit?: number,
  ): Promise<MispricingHistoryResponse> {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (limit) params.set("limit", String(limit));
    return this.request<MispricingHistoryResponse>(
      `/api/research/mispricing/history?${params}`,
    );
  }

  async getResearchMarket(
    marketId: string,
  ): Promise<ResearchMarketDetailResponse> {
    return this.request<ResearchMarketDetailResponse>(
      `/api/research/market/${marketId}`,
    );
  }

  async getResearchMarkets(options?: {
    active?: boolean;
    closed?: boolean;
    resolved?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<ResearchMarketsResponse> {
    const params = new URLSearchParams();
    if (options?.active) params.set("active", "true");
    if (options?.closed) params.set("closed", "true");
    if (options?.resolved) params.set("resolved", "true");
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.offset) params.set("offset", String(options.offset));
    return this.request<ResearchMarketsResponse>(
      `/api/research/markets?${params}`,
    );
  }

  async getResearchPositions(
    status?: "OPEN" | "CLOSED",
  ): Promise<ResearchPositionsResponse> {
    const params = status ? `?status=${status}` : "";
    return this.request<ResearchPositionsResponse>(
      `/api/research/positions${params}`,
    );
  }

  async getResearchOrderbook(tokenId: string): Promise<OrderBook> {
    return this.request<OrderBook>(`/api/orderbook?market=${encodeURIComponent(tokenId)}`);
  }

  async createResearchPosition(position: {
    marketId: string;
    entryPrice: number;
    size: number;
    direction: "YES" | "NO";
    thesis?: string;
  }): Promise<{
    success: boolean;
    timestamp: number;
    position: ResearchPosition;
  }> {
    return this.request<{
      success: boolean;
      timestamp: number;
      position: ResearchPosition;
    }>("/api/research/positions", {
      method: "POST",
      body: JSON.stringify(position),
    });
  }

  async closeResearchPosition(
    positionId: string,
    exitPrice: number,
  ): Promise<{
    success: boolean;
    timestamp: number;
    position: ResearchPosition;
  }> {
    return this.request<{
      success: boolean;
      timestamp: number;
      position: ResearchPosition;
    }>(`/api/research/positions/${positionId}/close`, {
      method: "POST",
      body: JSON.stringify({ exitPrice }),
    });
  }

  async triggerResearchSync(
    type?: "markets" | "trades" | "full",
  ): Promise<{ success: boolean; syncType: string; result: any }> {
    return this.request<{ success: boolean; syncType: string; result: any }>(
      "/api/research/sync",
      {
        method: "POST",
        body: JSON.stringify({ type: type || "full" }),
      },
    );
  }

  async startResearchSync(): Promise<{ success: boolean; message: string }> {
    return this.request<{ success: boolean; message: string }>(
      "/api/research/sync/start",
      {
        method: "POST",
      },
    );
  }

  async stopResearchSync(): Promise<{ success: boolean; message: string }> {
    return this.request<{ success: boolean; message: string }>(
      "/api/research/sync/stop",
      {
        method: "POST",
      },
    );
  }

  async syncByCategory(options: {
    category?: string;
    days: number;
    includeResolved?: boolean;
    maxMarkets?: number;
  }): Promise<CategorySyncResponse> {
    return this.request<CategorySyncResponse>(
      "/api/research/sync/category",
      {
        method: "POST",
        body: JSON.stringify(options),
      },
    );
  }

  async getCategories(): Promise<CategoriesResponse> {
    return this.request<CategoriesResponse>("/api/research/categories");
  }

  async getTradeBasedWinRate(tag?: string, minSampleSize?: number): Promise<TradeBasedWinRateResponse> {
    const params = new URLSearchParams();
    if (tag) params.set("tag", tag);
    if (minSampleSize) params.set("minSampleSize", String(minSampleSize));
    const qs = params.toString();
    return this.request<TradeBasedWinRateResponse>(
      `/api/research/win-rate-by-trade${qs ? `?${qs}` : ""}`,
    );
  }

  // ═══════════════════════════════════════════════════════════
  // PARQUET RESEARCH DATA (DuckDB SQL Query)
  // ═══════════════════════════════════════════════════════════

  async getParquetStatus(): Promise<ParquetStatusResponse> {
    return this.request<ParquetStatusResponse>(
      "/api/research/parquet/status",
    );
  }

  async executeParquetQuery(sql: string): Promise<ParquetQueryResponse> {
    return this.request<ParquetQueryResponse>(
      "/api/research/parquet/query",
      {
        method: "POST",
        body: JSON.stringify({ sql }),
      },
    );
  }

  async getParquetExamples(): Promise<ParquetExamplesResponse> {
    return this.request<ParquetExamplesResponse>(
      "/api/research/parquet/examples",
    );
  }

  async getParquetTableSchema(
    tableName: string,
  ): Promise<ParquetTableSchemaResponse> {
    return this.request<ParquetTableSchemaResponse>(
      `/api/research/parquet/table/${tableName}`,
    );
  }
}

// ═══════════════════════════════════════════════════════════
// RESEARCH API TYPES
// ═══════════════════════════════════════════════════════════

export interface ResearchStatus {
  success: boolean;
  timestamp: number;
  sync: {
    lastMarketsSync: number | null;
    lastTradesSync: number | null;
    totalMarkets: number;
    totalTrades: number;
    resolvedMarkets: number;
    activeMarkets: number;
    isRunning: boolean;
    lastError: string | null;
    progress: {
      marketsTotal: number;
      marketsProcessed: number;
      tradesProcessed: number;
      dbSizeMB: number;
      dbLimitMB: number;
      currentPhase: string | null;
      startedAt: number | null;
    };
  };
  storage: {
    markets: number;
    trades: number;
    signals: number;
    positions: number;
    cachedAnalyses: number;
  };
  ingester: {
    isRunning: boolean;
    pollingIntervalMs: number;
  };
}

export interface WinRateByPrice {
  pricePoint: number;
  expectedWinRate: number;
  actualWinRate: number;
  sampleSize: number;
  overconfidence: number;
}

export interface WinRateAnalysisResponse {
  success: boolean;
  timestamp: number;
  data: WinRateByPrice[];
  summary: {
    totalSamples: number;
    avgOverconfidence: number;
  };
}

export interface TradeBasedWinRateResponse {
  success: boolean;
  timestamp: number;
  tag: string;
  data: WinRateByPrice[];
  summary: {
    totalBuckets: number;
    significantBuckets: number;
    totalSamples: number;
    avgOverconfidence: number;
  };
}

export interface CategorySyncResponse {
  success: boolean;
  timestamp: number;
  category: string;
  days: number;
  result: {
    marketsSynced: number;
    tradesSynced: number;
    errors: number;
  };
  dbSizeMB: number;
}

export interface CategoriesResponse {
  success: boolean;
  timestamp: number;
  categories: Array<{
    id: string;
    label: string;
    tagId: number;
  }>;
}

export interface VolumeAnalysis {
  period: string;
  volume: number;
  tradeCount: number;
  avgTradeSize: number;
}

export interface VolumeAnalysisResponse {
  success: boolean;
  timestamp: number;
  granularity: string;
  data: VolumeAnalysis[];
}

export interface MarketScore {
  marketId: string;
  question: string;
  slug: string;
  liquidityScore: number;
  spreadScore: number;
  volumeScore: number;
  overallScore: number;
  recommendation: "EXCELLENT" | "GOOD" | "FAIR" | "POOR";
  volume24h: number;
  liquidity: number;
  spreadBps: number;
  computedAt: number;
}

export interface MarketScoresResponse {
  success: boolean;
  timestamp: number;
  total: number;
  data: MarketScore[];
}

export interface MispricingOpportunity {
  marketId: string;
  question: string;
  slug: string;
  currentPrice: number;
  estimatedFairValue: number;
  mispricingPercent: number;
  direction: "BUY_YES" | "BUY_NO";
  confidence: number;
  reasoning: string;
  volume: number;
  liquidity: number;
  /** CLOB token ID for the YES outcome — required for order placement */
  yesTokenId?: string;
  /** CLOB token ID for the NO outcome — required for order placement */
  noTokenId?: string;
}

export interface MispricingResponse {
  success: boolean;
  timestamp: number;
  total: number;
  filters: {
    minMispricing: number;
    minConfidence: number;
    minVolume: number;
  };
  data: MispricingOpportunity[];
}

export interface MispricingSignal {
  id: string;
  marketId: string;
  detectedAt: number;
  fairValue: number;
  marketPrice: number;
  mispricingPercent: number;
  confidence: number;
  direction: "BUY" | "SELL";
  status: "PENDING" | "ACTED" | "EXPIRED";
  reasoning: string | null;
}

export interface MispricingHistoryResponse {
  success: boolean;
  timestamp: number;
  total: number;
  data: MispricingSignal[];
}

// Calibration/Longshot Bias types
export interface CalibrationBucket {
  priceBucket: number;
  expectedWinRate: number;
  actualWinRate: number;
  sampleSize: number;
  overconfidence: number;
}

export interface CalibrationSummary {
  totalSamples: number;
  significantBuckets: number;
  overconfidentCount: number;
  underconfidentCount: number;
  avgOverconfidence: number;
  strongestBias: {
    priceBucket: number;
    overconfidence: number;
    sampleSize: number;
  } | null;
  hasLongshotBias: boolean;
  biasInterpretation: string;
}

export interface CalibrationResponse {
  success: boolean;
  timestamp: number;
  data: {
    winRateByPrice: CalibrationBucket[];
    overconfidentBuckets: CalibrationBucket[];
    underconfidentBuckets: CalibrationBucket[];
    summary: CalibrationSummary;
  };
}

export interface ResearchMarket {
  id: string;
  question: string;
  slug: string;
  outcomes: string;
  outcomePrices: string;
  volume: number;
  liquidity: number;
  active: boolean;
  closed: boolean;
  endDate: string | null;
  createdAt: string;
  resolution: string | null;
  lastUpdated: string;
}

export interface ResearchMarketDetailResponse {
  success: boolean;
  timestamp: number;
  market: ResearchMarket;
  performance: {
    marketId: string;
    question: string;
    totalVolume: number;
    tradeCount: number;
    avgPrice: number;
    priceRange: { min: number; max: number };
    resolution: string | null;
    endDate: string | null;
  } | null;
}

export interface ResearchMarketsResponse {
  success: boolean;
  timestamp: number;
  total: number;
  stats: {
    total: number;
    active: number;
    closed: number;
    resolved: number;
  };
  data: ResearchMarket[];
}

export interface ResearchPosition {
  id: string;
  marketId: string;
  marketQuestion: string;
  entryPrice: number;
  entryDate: number;
  size: number;
  direction: "YES" | "NO";
  thesis: string;
  status: "OPEN" | "CLOSED";
  currentPrice: number | null;
  exitPrice: number | null;
  exitDate: number | null;
  pnl: number | null;
}

export interface ResearchPositionsResponse {
  success: boolean;
  timestamp: number;
  total: number;
  openCount: number;
  totalPnL: number;
  data: ResearchPosition[];
}

export const api = new ApiClient(BASE_URL);

// Convenience functions for React Query
export const getSystemStatus = () => api.getSystemStatus();
export const getRiskLimits = () => api.getRiskLimits();
export const getSafetyMonitorStatus = () => api.getSafetyMonitorStatus();
export const getInventorySummary = () => api.getInventorySummary();

// Research API convenience functions
export const getResearchStatus = () => api.getResearchStatus();
export const getWinRateByPrice = () => api.getWinRateByPrice();
export const getCalibrationData = () => api.getCalibrationData();
export const getVolumeAnalysis = (
  granularity?: "daily" | "weekly" | "monthly",
) => api.getVolumeAnalysis(granularity);
export const getMarketScores = (
  options?: Parameters<typeof api.getMarketScores>[0],
) => api.getMarketScores(options);
export const getMispricingOpportunities = (
  options?: Parameters<typeof api.getMispricingOpportunities>[0],
) => api.getMispricingOpportunities(options);
export const getMispricingHistory = (
  status?: "PENDING" | "ACTED" | "EXPIRED",
  limit?: number,
) => api.getMispricingHistory(status, limit);
export const getResearchMarkets = (
  options?: Parameters<typeof api.getResearchMarkets>[0],
) => api.getResearchMarkets(options);
export const getResearchPositions = (status?: "OPEN" | "CLOSED") =>
  api.getResearchPositions(status);

export const syncByCategory = (
  options: Parameters<typeof api.syncByCategory>[0],
) => api.syncByCategory(options);
export const getCategories = () => api.getCategories();
export const getTradeBasedWinRate = (tag?: string, minSampleSize?: number) =>
  api.getTradeBasedWinRate(tag, minSampleSize);

// Parquet Research Data convenience functions
export const getParquetStatus = () => api.getParquetStatus();
export const executeParquetQuery = (sql: string) =>
  api.executeParquetQuery(sql);
export const getParquetExamples = () => api.getParquetExamples();
export const getParquetTableSchema = (tableName: string) =>
  api.getParquetTableSchema(tableName);

// ═══════════════════════════════════════════════════════════
// PARQUET RESEARCH DATA TYPES
// ═══════════════════════════════════════════════════════════

export interface ParquetTableColumn {
  name: string;
  type: string;
  description: string;
}

export interface ParquetTable {
  name: string;
  description: string;
  rowCount?: number;
  columns: ParquetTableColumn[];
}

export interface ParquetStatusResponse {
  success: boolean;
  data: {
    dataExists: boolean;
    dataDir: string;
    tables: ParquetTable[];
    totalRows: number;
  };
  timestamp: number;
}

export interface ParquetQueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  executionTimeMs: number;
  truncated: boolean;
}

export interface ParquetQueryResponse {
  success: boolean;
  data: ParquetQueryResult;
  timestamp: number;
}

export interface ParquetExample {
  name: string;
  description: string;
  sql: string;
}

export interface ParquetExamplesResponse {
  success: boolean;
  data: ParquetExample[];
  timestamp: number;
}

export interface ParquetTableSchemaResponse {
  success: boolean;
  data: ParquetTable & {
    sample: Record<string, unknown>[];
  };
  timestamp: number;
}
