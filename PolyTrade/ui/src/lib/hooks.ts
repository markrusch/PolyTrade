import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  StreamingStatus,
  ResearchStatus,
  DiscoveredMarket,
  CryptoTicker,
  DiscoveryResult,
  StrikesResult,
  WiredMarketInfo,
  PricingResponse,
  IVResponse,
  CryptoStatsResponse,
  Order,
  Position,
  OrderBook,
} from "./api";
import { api } from "./api";
import { REFETCH_INTERVALS, CACHE_TIMES, RETRY_CONFIG } from "./constants";

export function useHealth() {
  return useQuery({
    queryKey: ["health"],
    queryFn: () => api.getHealth(),
    refetchInterval: REFETCH_INTERVALS.HEALTH,
    staleTime: CACHE_TIMES.HEALTH_STALE,
    retry: RETRY_CONFIG.HEALTH_RETRIES,
    retryDelay: (attemptIndex) => {
      // Exponential backoff: 1s, 2s, 4s, 8s, 16s
      return Math.min(
        1000 * Math.pow(2, attemptIndex),
        RETRY_CONFIG.MAX_RETRY_DELAY,
      );
    },
  });
}

export function useMarkets() {
  return useQuery({
    queryKey: ["markets"],
    queryFn: () => api.getMarkets(),
    refetchInterval: REFETCH_INTERVALS.MARKETS,
    staleTime: CACHE_TIMES.DEFAULT_STALE * 2,
  });
}

export function useOrderBook(
  marketId: string | null,
  wsConnected: boolean = false,
) {
  return useQuery({
    queryKey: ["orderbook", marketId],
    queryFn: () => api.getOrderBook(marketId!),
    enabled: !!marketId,
    refetchInterval: wsConnected ? 0 : REFETCH_INTERVALS.ORDERBOOK,
    staleTime: CACHE_TIMES.ORDERBOOK_STALE,
  });
}

export function useOrders() {
  return useQuery({
    queryKey: ["orders"],
    queryFn: () => api.getOrders(),
    refetchInterval: REFETCH_INTERVALS.ORDERS,
    staleTime: CACHE_TIMES.PRICING_STALE,
    select: (data): Order[] => {
      // Handle both array and object formats from backend
      if (Array.isArray(data)) return data;
      return (data as { orders?: Order[] })?.orders || [];
    },
  });
}

export function usePositions(type: "open" | "closed" = "open") {
  return useQuery({
    queryKey: ["positions", type],
    queryFn: () => api.getPositionsByType(type),
    refetchInterval: REFETCH_INTERVALS.POSITIONS,
    staleTime: CACHE_TIMES.ORDERBOOK_STALE,
    select: (data): Position[] => {
      // Handle both array and object formats from backend
      if (Array.isArray(data)) return data;
      return (data as { positions?: Position[] })?.positions || [];
    },
  });
}

export function usePlaceOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (order: {
      tokenId: string;
      side: "BUY" | "SELL";
      price: string | number;
      size: string | number;
    }) => api.placeOrder(order),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      queryClient.invalidateQueries({ queryKey: ["positions"] });
    },
  });
}

export function useCancelOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (orderId: string) => api.cancelOrder(orderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}

export function useCancelAllOrders() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.cancelAllOrders(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}

export function usePricing() {
  return useMutation({
    mutationFn: (params: {
      spot?: number;
      strike: number;
      tte: number;
      iv?: number;
      crypto?: string;
    }) => api.calculatePricing(params),
  });
}

export function useOrderbookHistory(
  tokenId: string | null,
  timeframe: "1m" | "5m" | "10m" | "15m" | "30m" | "1h" | "4h",
  minutes: number = 60,
  refreshIntervalSeconds: number = 30,
) {
  // If refreshIntervalSeconds is 0 or falsy, disable polling (WebSocket provides updates)
  // Otherwise clamp between 15s and 90s
  const clampedInterval =
    refreshIntervalSeconds > 0
      ? Math.max(15, Math.min(90, refreshIntervalSeconds)) * 1000
      : false; // false disables refetch

  return useQuery({
    queryKey: ["orderbook-history", tokenId, timeframe, minutes],
    queryFn: async () => {
      if (!tokenId) return [];
      const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3003";
      const response = await fetch(
        `${BASE_URL}/api/orderbook-history?market=${tokenId}&timeframe=${timeframe}&minutes=${minutes}`,
      );
      if (!response.ok) throw new Error("Failed to fetch orderbook history");
      const data = await response.json();
      // Extract candles array from response object since OrderbookChart expects OrderBookCandle[]
      return data.candles || [];
    },
    enabled: !!tokenId,
    refetchInterval: clampedInterval,
    staleTime: clampedInterval
      ? Math.max(5000, (clampedInterval as number) - 5000)
      : 30000,
    retry: 3, // Retry failed requests 3 times
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000), // Exponential backoff: 1s, 2s, 4s, max 10s
    gcTime: clampedInterval ? (clampedInterval as number) * 2 : 60000, // Keep cached data for 2x refresh interval
  });
}

export function useLatestCandles(tokenId: string | null) {
  return useQuery({
    queryKey: ["orderbook-candles", tokenId],
    queryFn: async () => {
      if (!tokenId) return null;
      const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3003";
      const response = await fetch(
        `${BASE_URL}/api/orderbook-candles?market=${tokenId}`,
      );
      if (!response.ok) throw new Error("Failed to fetch latest candles");
      return response.json();
    },
    enabled: !!tokenId,
    refetchInterval: 10000, // Refetch every 10s
    staleTime: 5000,
  });
}

// ═══════════════════════════════════════════════════════════
// STREAMING STATUS HOOKS
// ═══════════════════════════════════════════════════════════

export function useStreamingStatus() {
  return useQuery<StreamingStatus>({
    queryKey: ["streaming-status"],
    queryFn: () => api.getStreamingStatus(),
    refetchInterval: 5000,
    staleTime: 3000,
    retry: 2,
  });
}

export function useSubscribeMarket() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      tokenId,
      slug,
      outcome,
    }: {
      tokenId: string;
      slug?: string;
      outcome?: "yes" | "no";
    }) => api.subscribeMarket(tokenId, { slug, outcome }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["streaming-status"] });
    },
  });
}

export function useUnsubscribeMarket() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (tokenId: string) => api.unsubscribeMarket(tokenId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["streaming-status"] });
    },
  });
}

// ═══════════════════════════════════════════════════════════
// MARKET MAKER HOOKS
// ═══════════════════════════════════════════════════════════

export function useStartMarketMaker() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.startMarketMaker(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["health"] });
    },
  });
}

export function useStopMarketMaker() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.stopMarketMaker(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["health"] });
    },
  });
}

export function useAddMarketToMM() {
  return useMutation({
    mutationFn: (slug: string) => api.addMarketToMM(slug),
  });
}

export function useDiscoverMarkets() {
  return useMutation<
    {
      success: boolean;
      markets?: DiscoveredMarket[];
      discovered?: number;
      added?: number;
    },
    Error,
    { limit?: number; autoAdd?: boolean }
  >({
    mutationFn: ({ limit = 10, autoAdd = false }) =>
      api.discoverMarkets(limit, autoAdd),
  });
}

// ═══════════════════════════════════════════════════════════
// SERVICE CONTROL HOOKS
// ═══════════════════════════════════════════════════════════

export function useServicesStatus() {
  return useQuery({
    queryKey: ["services-status"],
    queryFn: () => api.getServicesStatus(),
    refetchInterval: 5000,
    staleTime: 3000,
  });
}

export function useStartService() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      crypto,
      service,
    }: {
      crypto: string;
      service: "binance" | "deribit";
    }) => api.startService(crypto, service),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["services-status"] });
      queryClient.invalidateQueries({ queryKey: ["health"] });
    },
  });
}

export function useStopService() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      crypto,
      service,
    }: {
      crypto: string;
      service: "binance" | "deribit";
    }) => api.stopService(crypto, service),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["services-status"] });
      queryClient.invalidateQueries({ queryKey: ["health"] });
    },
  });
}

export function useStartAllServices() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.startAllServices(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["services-status"] });
      queryClient.invalidateQueries({ queryKey: ["health"] });
    },
  });
}

export function useStopAllServices() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.stopAllServices(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["services-status"] });
      queryClient.invalidateQueries({ queryKey: ["health"] });
    },
  });
}

// ═══════════════════════════════════════════════════════════
// MARKET DISCOVERY HOOKS
// ═══════════════════════════════════════════════════════════

export function useDiscoverCryptoMarkets(
  crypto: CryptoTicker,
  days: number = 30,
) {
  return useQuery<DiscoveryResult>({
    queryKey: ["discovery", crypto, days],
    queryFn: () => api.discoverCryptoMarkets(crypto, days),
    staleTime: 300000, // 5 minutes - discovery results are relatively stable
    gcTime: 600000, // 10 minutes cache
    retry: 2,
    enabled: !!crypto,
  });
}

export function useStrikesForDate(crypto: CryptoTicker, date: string | null) {
  return useQuery<StrikesResult>({
    queryKey: ["strikes", crypto, date],
    queryFn: () => api.getStrikesForDate(crypto, date!),
    enabled: !!crypto && !!date,
    staleTime: 60000, // 1 minute - strikes can change
    retry: 2,
  });
}

export function useSubscribeDiscoveredMarket() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: {
      tokenId: string;
      crypto: CryptoTicker;
      strike: number;
      expiry: string;
      slug?: string;
    }) => api.subscribeDiscoveredMarket(params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wired-markets"] });
      queryClient.invalidateQueries({ queryKey: ["streaming-status"] });
    },
  });
}

export function useWireAllMarkets() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { crypto: CryptoTicker; days: number }) =>
      api.wireAllMarkets(params.crypto, params.days),
    onSuccess: () => {
      // Invalidate wired markets cache to trigger re-fetch
      queryClient.invalidateQueries({ queryKey: ["wired-markets"] });
      queryClient.invalidateQueries({ queryKey: ["streaming-status"] });
    },
  });
}

// ═══════════════════════════════════════════════════════════
// PRICING & GREEKS HOOKS
// ═══════════════════════════════════════════════════════════

export function usePricingData(tokenId: string | null) {
  return useQuery<PricingResponse>({
    queryKey: ["pricing", tokenId],
    queryFn: () => api.getPricing(tokenId!),
    enabled: !!tokenId,
    refetchInterval: 5000, // Reduced frequency from 2s to 5s
    staleTime: 3000,
    retry: 1,
  });
}

export function useWiredMarkets() {
  return useQuery<{
    success: boolean;
    count: number;
    timestamp: number;
    freshness: Record<
      string,
      {
        spotTimestamp: number;
        ivTimestamp: number;
        spotAgeMs: number | null;
        ivAgeMs: number | null;
      }
    >;
    markets: WiredMarketInfo[];
  }>({
    queryKey: ["wired-markets"],
    queryFn: () => api.getWiredMarkets(),
    refetchInterval: 5000, // Refresh every 5s
    staleTime: 3000,
  });
}

export function useCalculatePricing() {
  return useMutation({
    mutationFn: (params: {
      spot: number;
      strike: number;
      tte: number;
      iv: number;
      isCall?: boolean;
    }) => api.calculateBinaryPricing(params),
  });
}

export function useIV(crypto: string, expiry?: string) {
  return useQuery<IVResponse>({
    queryKey: ["iv", crypto, expiry],
    queryFn: () => api.getIV(crypto, expiry),
    enabled: !!crypto,
    refetchInterval: 30000, // Refresh IV every 30s
    staleTime: 15000,
  });
}

export function useGeneralCryptoStats(crypto: CryptoTicker) {
  return useQuery<CryptoStatsResponse>({
    queryKey: ["cryptoStats", crypto],
    queryFn: () => api.getCryptoStats(crypto),
    enabled: !!crypto,
    refetchInterval: 2000, // Refresh every 2 seconds for live pricing
    staleTime: 1000,
    retry: 2,
  });
}

// ═══════════════════════════════════════════════════════════
// PORTFOLIO GREEKS HOOK
// ═══════════════════════════════════════════════════════════

export function usePortfolioGreeks() {
  return useQuery({
    queryKey: ["portfolio-greeks"],
    queryFn: () => api.getPortfolioGreeks(),
    refetchInterval: 10000, // Refresh every 10s
    staleTime: 8000,
    retry: 1,
  });
}

// ═══════════════════════════════════════════════════════════
// RESEARCH STATUS HOOK (Adaptive Polling)
// ═══════════════════════════════════════════════════════════

export function useResearchStatus() {
  return useQuery<ResearchStatus>({
    queryKey: ["research-status"],
    queryFn: () => api.getResearchStatus(),
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.sync?.isRunning ? 3000 : 10000;
    },
    staleTime: 2000,
    retry: (failureCount, error) => {
      // AbortErrors are expected when TanStack Query cancels a stale in-flight
      // request as a new poll cycle begins. Never retry these — there is nothing
      // wrong and retrying just creates more abort noise.
      if (error instanceof DOMException && error.name === "AbortError") {
        return false;
      }
      return failureCount < 2;
    },
    retryDelay: 1000,
  });
}

export function useResearchOrderbook(tokenId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['research-orderbook', tokenId],
    queryFn: () => tokenId ? api.getResearchOrderbook(tokenId) : Promise.reject(new Error('No tokenId')),
    enabled: enabled && !!tokenId,
    refetchInterval: 5000,
    staleTime: 3000,
    retry: 1,
  });
}
