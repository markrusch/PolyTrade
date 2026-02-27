import { Logger } from "../lib/logger/index.js";
import type { ResearchMarket, ResearchTrade } from "./ResearchDatabase.js";
import { getResearchDB } from "./ResearchDatabase.js";
import axios from "axios";

// ============================================================================
// POLYMARKET CATEGORY TAGS
// ============================================================================

export const POLYMARKET_TAGS = {
  POLITICS: 2,
  FINANCE: 120,
  CRYPTO: 21,
  SPORTS: 100639,
  TECH: 1401,
  CULTURE: 596,
  GEOPOLITICS: 100265,
} as const;

export type PolymarketCategory = keyof typeof POLYMARKET_TAGS;

// ============================================================================
// POLYMARKET API TYPES (from prediction-market-analysis patterns)
// ============================================================================

interface GammaMarketTag {
  id: number;
  slug: string;
  label?: string;
}

interface GammaMarket {
  id: string; // condition_id
  question: string;
  slug: string;
  outcomes: string; // JSON string of outcomes array
  outcomePrices: string; // JSON string of prices array
  volume: string;
  liquidity: string;
  active: boolean;
  closed: boolean;
  endDate?: string;
  createdAt?: string;
  resolutionSource?: string;
  resolution?: string;
  tags?: GammaMarketTag[]; // Category tags from Gamma API
}

interface DataApiTrade {
  id: string;
  market: string; // condition_id
  asset: string; // token_id
  side: "BUY" | "SELL";
  size: string;
  price: string;
  outcome: string;
  outcomeIndex: number;
  timestamp: string;
  transactionHash?: string;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface IngesterConfig {
  gammaApiUrl: string;
  dataApiUrl: string;
  pollingIntervalMs: number;
  marketsPerBatch: number;
  tradesPerBatch: number;
  retentionDays: number;
  maxConcurrentRequests: number;
  maxDbSizeBytes: number;
  // Backfill-specific tuning (higher throughput, doesn't affect live services)
  backfillConcurrency: number;
  backfillPageDelayMs: number;
  backfillBatchDelayMs: number;
  backfillApiTimeoutMs: number;
}

const DEFAULT_CONFIG: IngesterConfig = {
  gammaApiUrl: "https://gamma-api.polymarket.com",
  dataApiUrl: "https://data-api.polymarket.com",
  pollingIntervalMs: 60000, // 1 minute
  marketsPerBatch: 100,
  tradesPerBatch: 500,
  retentionDays: 90,
  maxConcurrentRequests: 10, // used by legacy sync methods
  maxDbSizeBytes: 15 * 1024 * 1024 * 1024, // 15 GB
  // Backfill: aggressive but respectful of Data API rate limits
  backfillConcurrency: 25, // 25 markets in parallel (was 10)
  backfillPageDelayMs: 10, // between pages within a market (was 50)
  backfillBatchDelayMs: 20, // between batches of markets (was 100)
  backfillApiTimeoutMs: 12000, // faster failure on dead markets (was 30s)
};

// ============================================================================
// LIVE DATA INGESTER SERVICE
// ============================================================================

export class LiveDataIngester {
  private logger: Logger;
  private config: IngesterConfig;
  private syncInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private abortController: AbortController | null = null;

  constructor(config: Partial<IngesterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.logger = new Logger({ level: "info", service: "live-data-ingester" });
  }

  // ========================================================================
  // MARKET FETCHING (Gamma API)
  // ========================================================================

  async fetchMarkets(options?: {
    activeOnly?: boolean;
    closedOnly?: boolean;
    tagId?: number;
    limit?: number;
    offset?: number;
  }): Promise<{ markets: GammaMarket[]; hasMore: boolean }> {
    const url = new URL("/markets", this.config.gammaApiUrl);

    if (options?.activeOnly) {
      url.searchParams.set("active", "true");
    }
    if (options?.closedOnly) {
      url.searchParams.set("closed", "true");
    }
    if (options?.tagId) {
      url.searchParams.set("tag_id", options.tagId.toString());
    }

    const limit = options?.limit || this.config.marketsPerBatch;
    url.searchParams.set("limit", limit.toString());

    if (options?.offset) {
      url.searchParams.set("offset", options.offset.toString());
    }

    try {
      const response = await axios.get<
        GammaMarket[] | { data?: GammaMarket[]; next_cursor?: string }
      >(url.toString(), {
        timeout: 30000,
        signal: this.abortController?.signal,
      });

      // Handle both array and object response formats
      if (Array.isArray(response.data)) {
        return {
          markets: response.data,
          hasMore: response.data.length >= limit,
        };
      }

      const markets = response.data.data || [];
      return {
        markets,
        hasMore: markets.length >= limit || !!response.data.next_cursor,
      };
    } catch (error) {
      if (axios.isCancel(error)) {
        throw error;
      }
      this.logger.error("Failed to fetch markets from Gamma API", { error });
      throw error;
    }
  }

  async fetchAllMarkets(options?: {
    activeOnly?: boolean;
    closedOnly?: boolean;
    tagId?: number;
    maxMarkets?: number;
  }): Promise<GammaMarket[]> {
    const allMarkets: GammaMarket[] = [];
    let offset = 0;
    const maxMarkets = options?.maxMarkets || 10000;

    do {
      const { markets, hasMore } = await this.fetchMarkets({
        activeOnly: options?.activeOnly,
        closedOnly: options?.closedOnly,
        tagId: options?.tagId,
        limit: this.config.marketsPerBatch,
        offset,
      });

      allMarkets.push(...markets);
      offset += markets.length;

      // Respect rate limits
      await this.delay(50);

      if (allMarkets.length >= maxMarkets || !hasMore) {
        break;
      }
    } while (true);

    return allMarkets.slice(0, maxMarkets);
  }

  // ========================================================================
  // TRADE FETCHING (Data API)
  // ========================================================================

  async fetchRecentTrades(
    marketId: string,
    limit: number = 500,
    offset: number = 0,
    opts?: { timeoutMs?: number },
  ): Promise<DataApiTrade[]> {
    const url = new URL("/trades", this.config.dataApiUrl);
    url.searchParams.set("market", marketId);
    url.searchParams.set("limit", limit.toString());
    if (offset > 0) {
      url.searchParams.set("offset", offset.toString());
    }

    const timeout = opts?.timeoutMs ?? 30000;

    try {
      const response = await axios.get<DataApiTrade[]>(url.toString(), {
        timeout,
        signal: this.abortController?.signal,
      });

      return response.data || [];
    } catch (error) {
      if (axios.isCancel(error)) {
        throw error;
      }
      // Data API may return 404 for markets with no trades
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return [];
      }
      // Rate limited — back off and retry once
      if (axios.isAxiosError(error) && error.response?.status === 429) {
        const retryAfter = parseInt(
          error.response.headers["retry-after"] || "5",
          10,
        );
        this.logger.warn(
          `Rate limited on market ${marketId}, retrying after ${retryAfter}s`,
        );
        await this.delay(retryAfter * 1000);
        try {
          const retryResponse = await axios.get<DataApiTrade[]>(
            url.toString(),
            {
              timeout,
              signal: this.abortController?.signal,
            },
          );
          return retryResponse.data || [];
        } catch {
          return [];
        }
      }
      // Make trade fetch errors VISIBLE — this is why 0 trades get loaded
      this.logger.error(
        `Trade fetch FAILED for market ${marketId} (offset=${offset})`,
        {
          status: axios.isAxiosError(error)
            ? error.response?.status
            : undefined,
          message: error instanceof Error ? error.message : String(error),
        },
      );
      return [];
    }
  }

  /**
   * Deep-paginate all trades for a market within a time window.
   * Data API returns newest first, so we stop when we hit trades older than cutoff.
   */
  async fetchAllTradesForMarket(
    marketId: string,
    sinceTimestamp: number,
    opts?: { timeoutMs?: number; pageDelayMs?: number },
  ): Promise<DataApiTrade[]> {
    const allTrades: DataApiTrade[] = [];
    let offset = 0;
    const limit = 500;
    const maxTradesPerMarket = 25000; // Safety cap
    const pageDelay = opts?.pageDelayMs ?? 50;
    const timeoutMs = opts?.timeoutMs ?? 30000;

    while (true) {
      // Check abort signal before each page fetch
      if (this.abortController?.signal.aborted) break;

      const trades = await this.fetchRecentTrades(marketId, limit, offset, {
        timeoutMs,
      });
      if (trades.length === 0) break;

      // Filter by date cutoff (Data API returns newest first)
      const withinWindow = trades.filter(
        (t) => new Date(t.timestamp).getTime() >= sinceTimestamp,
      );
      allTrades.push(...withinWindow);

      // If we got trades older than cutoff, we're done
      if (withinWindow.length < trades.length) break;

      offset += limit;
      if (pageDelay > 0) await this.delay(pageDelay);

      if (offset >= maxTradesPerMarket) break;
    }

    return allTrades;
  }

  async fetchTradesForMarkets(
    marketIds: string[],
    sinceTimestamp?: number,
  ): Promise<Map<string, DataApiTrade[]>> {
    const results = new Map<string, DataApiTrade[]>();
    const batchSize = this.config.maxConcurrentRequests;

    for (let i = 0; i < marketIds.length; i += batchSize) {
      const batch = marketIds.slice(i, i + batchSize);
      const promises = batch.map(async (marketId) => {
        const trades = sinceTimestamp
          ? await this.fetchAllTradesForMarket(marketId, sinceTimestamp)
          : await this.fetchRecentTrades(marketId, this.config.tradesPerBatch);
        return { marketId, trades };
      });

      const batchResults = await Promise.all(promises);
      for (const { marketId, trades } of batchResults) {
        results.set(marketId, trades);
      }

      // Rate limiting between batches
      if (i + batchSize < marketIds.length) {
        await this.delay(500);
      }
    }

    return results;
  }

  // ========================================================================
  // CATEGORY-BASED SYNCHRONIZATION
  // ========================================================================

  /**
   * Sync markets + trades for a specific category within a rolling time window.
   * This is the main method for building fresh research data.
   */
  async syncByCategory(options: {
    category?: PolymarketCategory;
    days: number;
    includeResolved?: boolean;
    maxMarkets?: number;
  }): Promise<{ marketsSynced: number; tradesSynced: number; errors: number }> {
    const db = getResearchDB();
    const tagId = options.category
      ? POLYMARKET_TAGS[options.category]
      : undefined;
    const sinceTimestamp = Date.now() - options.days * 24 * 60 * 60 * 1000;
    const maxMarkets = options.maxMarkets || 500;
    let marketsSynced = 0;
    let tradesSynced = 0;
    let errors = 0;

    try {
      db.updateSyncStatus({ isRunning: true, lastError: null });
      this.abortController = new AbortController();

      // Step 1: Fetch active markets for this category
      this.logger.info(
        `Syncing ${options.category || "ALL"} markets (last ${options.days} days)...`,
      );
      const activeMarkets = await this.fetchAllMarkets({
        activeOnly: true,
        tagId,
        maxMarkets,
      });

      // Step 2: Optionally fetch closed/resolved markets (needed for calibration)
      let closedMarkets: GammaMarket[] = [];
      if (options.includeResolved) {
        closedMarkets = await this.fetchAllMarkets({
          closedOnly: true,
          tagId,
          maxMarkets,
        });
      }

      const allMarkets = [...activeMarkets, ...closedMarkets];
      // Deduplicate by id
      const uniqueMarkets = new Map<string, GammaMarket>();
      for (const m of allMarkets) {
        uniqueMarkets.set(m.id, m);
      }

      this.logger.info(
        `Fetched ${uniqueMarkets.size} unique markets (${activeMarkets.length} active, ${closedMarkets.length} closed)`,
      );

      // Record sync start with total market count
      db.updateSyncProgress({
        isRunning: true,
        syncStartedAt: Date.now(),
        marketsTotal: uniqueMarkets.size,
        marketsProcessed: 0,
        tradesProcessed: 0,
        dbSizeMB: db.getTotalSizeBytes() / (1024 * 1024),
        currentPhase: "markets",
        lastError: null,
      });

      // Step 3: Store markets with tags
      const researchMarkets: Array<Partial<ResearchMarket> & { id: string }> =
        [];
      for (const m of uniqueMarkets.values()) {
        const tagLabels =
          m.tags?.map((t) => t.slug || t.label || String(t.id)) || [];
        researchMarkets.push({
          id: m.id,
          question: m.question,
          slug: m.slug,
          outcomes: m.outcomes,
          outcomePrices: m.outcomePrices,
          volume: parseFloat(m.volume) || 0,
          liquidity: parseFloat(m.liquidity) || 0,
          active: m.active,
          closed: m.closed,
          endDate: m.endDate || undefined,
          createdAt: m.createdAt || undefined,
          resolution: m.resolution || null,
          tags: tagLabels.length > 0 ? JSON.stringify(tagLabels) : null,
        });
      }

      // Batch insert markets
      const chunkSize = 500;
      for (let i = 0; i < researchMarkets.length; i += chunkSize) {
        const chunk = researchMarkets.slice(i, i + chunkSize);
        try {
          db.upsertMarketsBatch(chunk);
          marketsSynced += chunk.length;
        } catch (error) {
          this.logger.error(`Failed to insert market batch`, { error });
          errors++;
        }
      }

      db.updateSyncStatus({ lastMarketsSync: Date.now() });

      // Transition to trades phase
      db.updateSyncProgress({ currentPhase: "trades" });

      // Step 4: Fetch trades for all markets within the time window
      //
      // Performance-tuned: uses backfill-specific concurrency + delays
      // that are separate from the live service config (maxConcurrentRequests).
      // DB inserts happen after each batch with an event-loop yield (setImmediate)
      // to avoid starving WS connections and other Express handlers.
      const marketIds = Array.from(uniqueMarkets.keys());
      this.logger.info(
        `Fetching trades for ${marketIds.length} markets (since ${new Date(sinceTimestamp).toISOString()})...`,
      );
      this.logger.info(
        `Backfill tuning: concurrency=${this.config.backfillConcurrency}, pageDelay=${this.config.backfillPageDelayMs}ms, batchDelay=${this.config.backfillBatchDelayMs}ms, timeout=${this.config.backfillApiTimeoutMs}ms`,
      );

      let marketsProcessed = 0;
      let totalTradesSynced = 0;
      let lastProgressUpdate = Date.now();
      const syncStartedAt = Date.now();
      let cachedDbSizeMB = db.getTotalSizeBytes() / (1024 * 1024);
      let batchesSinceLastSizeCheck = 0;
      let consecutiveRateLimits = 0;
      const batchSize = this.config.backfillConcurrency;

      for (let i = 0; i < marketIds.length; i += batchSize) {
        // ── Abort check ──
        if (this.abortController?.signal.aborted) {
          this.logger.info("Backfill aborted by user");
          break;
        }

        // ── DB size check (cached, refresh every 10 batches) ──
        batchesSinceLastSizeCheck++;
        if (batchesSinceLastSizeCheck >= 10) {
          cachedDbSizeMB = db.getTotalSizeBytes() / (1024 * 1024);
          batchesSinceLastSizeCheck = 0;
        }
        const currentSize = cachedDbSizeMB * 1024 * 1024;
        if (currentSize >= this.config.maxDbSizeBytes) {
          this.logger.warn(
            `DB size limit reached (${Math.round(currentSize / 1024 / 1024)}MB), running maintenance...`,
          );
          db.runMaintenance(this.config.maxDbSizeBytes);
          cachedDbSizeMB = db.getTotalSizeBytes() / (1024 * 1024);
          batchesSinceLastSizeCheck = 0;
          if (cachedDbSizeMB * 1024 * 1024 >= this.config.maxDbSizeBytes) {
            this.logger.warn(
              "DB still at limit after maintenance, stopping trade sync",
            );
            break;
          }
        }

        // ── Fetch batch of markets concurrently ──
        const batch = marketIds.slice(i, i + batchSize);
        const promises = batch.map(async (marketId) => {
          const trades = await this.fetchAllTradesForMarket(
            marketId,
            sinceTimestamp,
            {
              timeoutMs: this.config.backfillApiTimeoutMs,
              pageDelayMs: this.config.backfillPageDelayMs,
            },
          );
          return { marketId, trades };
        });

        const batchResults = await Promise.all(promises);

        // ── Insert results into DB ──
        // Accumulate first, insert as one transaction, then yield the event loop.
        const pendingInserts: Array<{
          marketId: string;
          trades: Array<Omit<ResearchTrade, "id">>;
        }> = [];
        let batchTradeCount = 0;

        for (const { marketId, trades } of batchResults) {
          marketsProcessed++;

          if (trades.length > 0) {
            const researchTrades: Array<Omit<ResearchTrade, "id">> = trades.map(
              (t) => ({
                conditionId: marketId,
                asset: t.asset,
                side: t.side,
                size: parseFloat(t.size) || 0,
                price: parseFloat(t.price) || 0,
                outcome: t.outcome,
                outcomeIndex: t.outcomeIndex,
                timestamp: new Date(t.timestamp).getTime(),
                transactionHash: t.transactionHash || null,
              }),
            );
            pendingInserts.push({ marketId, trades: researchTrades });
            batchTradeCount += researchTrades.length;
          }
        }

        // Single transaction for the whole batch of inserts
        if (pendingInserts.length > 0) {
          try {
            const allTrades = pendingInserts.flatMap((p) => p.trades);
            db.insertTradesBatch(allTrades);
            tradesSynced += batchTradeCount;
            totalTradesSynced += batchTradeCount;
            consecutiveRateLimits = 0;
          } catch (error) {
            this.logger.error(
              `Failed to insert trade batch (${pendingInserts.length} markets, ${batchTradeCount} trades)`,
              { error },
            );
            errors++;
          }
        }

        // ── Progress update ──
        const now = Date.now();
        if (
          marketsProcessed % 10 === 0 ||
          now - lastProgressUpdate > 5000 ||
          marketsProcessed === uniqueMarkets.size
        ) {
          db.updateSyncProgress({
            marketsProcessed,
            tradesProcessed: totalTradesSynced,
            dbSizeMB: cachedDbSizeMB,
          });
          lastProgressUpdate = now;
        }

        // ── Yield event loop so other Express/WS handlers can run ──
        await new Promise<void>((resolve) => setImmediate(resolve));

        // ── Adaptive rate limiting ──
        // Normally use the fast backfill delay; back off if we're hitting rate limits
        if (i + batchSize < marketIds.length) {
          const delay =
            consecutiveRateLimits > 0
              ? Math.min(
                  2000,
                  this.config.backfillBatchDelayMs *
                    Math.pow(2, consecutiveRateLimits),
                )
              : this.config.backfillBatchDelayMs;
          if (delay > 0) await this.delay(delay);
        }

        // ── Periodic logging ──
        if ((i + batchSize) % 50 === 0 || i === 0) {
          const elapsed = (Date.now() - syncStartedAt) / 1000;
          const tradesPerMin =
            elapsed > 0 ? Math.round((totalTradesSynced / elapsed) * 60) : 0;
          this.logger.info(
            `Trade sync: ${Math.min(i + batchSize, marketIds.length)}/${marketIds.length} markets, ${totalTradesSynced} trades (${tradesPerMin}/min)`,
          );
        }
      }

      // Step 5: Run maintenance to enforce size limit
      db.runMaintenance(this.config.maxDbSizeBytes);

      db.updateSyncStatus({ lastTradesSync: Date.now(), isRunning: false });
      db.updateSyncProgress({
        isRunning: false,
        currentPhase: null,
        dbSizeMB: db.getTotalSizeBytes() / (1024 * 1024),
      });
      this.logger.info(
        `Category sync complete: ${marketsSynced} markets, ${tradesSynced} trades, ${errors} errors`,
      );
    } catch (error) {
      // Don't treat abort as an error — it's a normal stop
      const isAbort =
        axios.isCancel(error) ||
        (error instanceof DOMException && error.name === "AbortError");
      db.updateSyncStatus({
        isRunning: false,
        lastError: isAbort ? null : String(error),
      });
      db.updateSyncProgress({
        isRunning: false,
        currentPhase: null,
        lastError: isAbort
          ? null
          : (error instanceof Error ? error.message : null) || String(error),
      });
      if (isAbort) {
        this.logger.info(
          `Category sync stopped by user: ${marketsSynced} markets, ${tradesSynced} trades so far`,
        );
      } else {
        this.logger.error("Category sync failed", { error });
        throw error;
      }
    }

    return { marketsSynced, tradesSynced, errors };
  }

  // ========================================================================
  // LEGACY DATA SYNCHRONIZATION (kept for backward compat)
  // ========================================================================

  async syncMarkets(): Promise<{ synced: number; errors: number }> {
    const db = getResearchDB();
    let synced = 0;
    let errors = 0;

    try {
      db.updateSyncStatus({ isRunning: true, lastError: null });
      this.logger.info("Starting markets sync...");

      const markets = await this.fetchAllMarkets({ activeOnly: false });
      this.logger.info(`Fetched ${markets.length} markets from Gamma API`);

      // Transform and batch insert
      const researchMarkets: Array<Partial<ResearchMarket> & { id: string }> =
        markets.map((m) => {
          const tagLabels =
            m.tags?.map((t) => t.slug || t.label || String(t.id)) || [];
          return {
            id: m.id,
            question: m.question,
            slug: m.slug,
            outcomes: m.outcomes,
            outcomePrices: m.outcomePrices,
            volume: parseFloat(m.volume) || 0,
            liquidity: parseFloat(m.liquidity) || 0,
            active: m.active,
            closed: m.closed,
            endDate: m.endDate || undefined,
            createdAt: m.createdAt || undefined,
            resolution: m.resolution || null,
            tags: tagLabels.length > 0 ? JSON.stringify(tagLabels) : null,
          };
        });

      // Batch insert in chunks
      const chunkSize = 500;
      for (let i = 0; i < researchMarkets.length; i += chunkSize) {
        const chunk = researchMarkets.slice(i, i + chunkSize);
        try {
          db.upsertMarketsBatch(chunk);
          synced += chunk.length;
        } catch (error) {
          this.logger.error(
            `Failed to insert market batch ${i}-${i + chunkSize}`,
            { error },
          );
          errors += chunk.length;
        }
      }

      db.updateSyncStatus({ lastMarketsSync: Date.now(), isRunning: false });
      this.logger.info(
        `Markets sync complete: ${synced} synced, ${errors} errors`,
      );
    } catch (error) {
      db.updateSyncStatus({ isRunning: false, lastError: String(error) });
      this.logger.error("Markets sync failed", { error });
      throw error;
    }

    return { synced, errors };
  }

  async syncTrades(
    marketIds?: string[],
    sinceTimestamp?: number,
  ): Promise<{ synced: number; errors: number }> {
    const db = getResearchDB();
    let synced = 0;
    let errors = 0;

    try {
      db.updateSyncStatus({ isRunning: true, lastError: null });

      // If no market IDs provided, get top markets by volume
      const targetMarkets =
        marketIds ||
        db
          .getMarkets({
            activeOnly: true,
            orderBy: "volume",
            limit: 100,
          })
          .map((m) => m.id);

      this.logger.info(
        `Starting trades sync for ${targetMarkets.length} markets...`,
      );

      const tradesMap = await this.fetchTradesForMarkets(
        targetMarkets,
        sinceTimestamp,
      );

      for (const [marketId, trades] of tradesMap) {
        if (trades.length === 0) continue;

        const researchTrades: Array<Omit<ResearchTrade, "id">> = trades.map(
          (t) => ({
            conditionId: marketId,
            asset: t.asset,
            side: t.side,
            size: parseFloat(t.size) || 0,
            price: parseFloat(t.price) || 0,
            outcome: t.outcome,
            outcomeIndex: t.outcomeIndex,
            timestamp: new Date(t.timestamp).getTime(),
            transactionHash: t.transactionHash || null,
          }),
        );

        try {
          db.insertTradesBatch(researchTrades);
          synced += researchTrades.length;
        } catch (error) {
          this.logger.error(`Failed to insert trades for market ${marketId}`, {
            error,
          });
          errors += researchTrades.length;
        }
      }

      db.updateSyncStatus({ lastTradesSync: Date.now(), isRunning: false });
      this.logger.info(
        `Trades sync complete: ${synced} synced, ${errors} errors`,
      );
    } catch (error) {
      db.updateSyncStatus({ isRunning: false, lastError: String(error) });
      this.logger.error("Trades sync failed", { error });
      throw error;
    }

    return { synced, errors };
  }

  async fullSync(): Promise<{
    markets: { synced: number; errors: number };
    trades: { synced: number; errors: number };
  }> {
    const marketsResult = await this.syncMarkets();
    const tradesResult = await this.syncTrades();
    return { markets: marketsResult, trades: tradesResult };
  }

  // ========================================================================
  // DATA MAINTENANCE
  // ========================================================================

  async pruneOldData(): Promise<{ prunedTrades: number; prunedCache: number }> {
    const db = getResearchDB();
    const cutoff = Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000;

    const prunedTrades = db.pruneOldTrades(cutoff);
    const prunedCache = db.pruneExpiredCache();

    this.logger.info(
      `Pruned ${prunedTrades} old trades and ${prunedCache} expired cache entries`,
    );

    return { prunedTrades, prunedCache };
  }

  // ========================================================================
  // BACKGROUND SYNC CONTROL
  // ========================================================================

  startBackgroundSync(): void {
    if (this.syncInterval) {
      this.logger.warn("Background sync already running");
      return;
    }

    this.abortController = new AbortController();
    this.isRunning = true;

    this.logger.info(
      `Starting background sync with ${this.config.pollingIntervalMs}ms interval`,
    );

    // Run initial sync
    this.runSyncCycle();

    // Schedule periodic syncs
    this.syncInterval = setInterval(() => {
      this.runSyncCycle();
    }, this.config.pollingIntervalMs);
  }

  stopBackgroundSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    this.isRunning = false;
    this.logger.info("Background sync stopped");
  }

  private async runSyncCycle(): Promise<void> {
    if (!this.isRunning) return;

    try {
      // Sync markets first
      await this.syncMarkets();

      // Then sync trades for active markets
      await this.syncTrades();

      // Periodic cleanup
      await this.pruneOldData();
    } catch (error) {
      if (!axios.isCancel(error)) {
        this.logger.error("Sync cycle failed", { error });
      }
    }
  }

  getStatus(): {
    isRunning: boolean;
    syncInterval: number;
    config: IngesterConfig;
  } {
    return {
      isRunning: this.isRunning,
      syncInterval: this.config.pollingIntervalMs,
      config: this.config,
    };
  }

  // ========================================================================
  // UTILITIES
  // ========================================================================

  private delay(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Export singleton instance
let ingesterInstance: LiveDataIngester | null = null;

export function getLiveDataIngester(
  config?: Partial<IngesterConfig>,
): LiveDataIngester {
  if (!ingesterInstance) {
    ingesterInstance = new LiveDataIngester(config);
  }
  return ingesterInstance;
}

export function stopLiveDataIngester(): void {
  if (ingesterInstance) {
    ingesterInstance.stopBackgroundSync();
    ingesterInstance = null;
  }
}
