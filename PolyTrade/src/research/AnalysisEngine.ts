import { Logger } from '../lib/logger/index.js';
import {
  getResearchDB,
  ResearchMarket,
  WinRateByPrice,
  MarketScore,
  MispricingSignal
} from './ResearchDatabase.js';

// ============================================================================
// ANALYSIS TYPES
// ============================================================================

export interface VolumeAnalysis {
  period: string;
  volume: number;
  tradeCount: number;
  avgTradeSize: number;
}

export interface MarketCalibration {
  pricePoint: number;
  expectedWinRate: number;
  actualWinRate: number;
  sampleSize: number;
  overconfidence: number;
}

export interface MispricingOpportunity {
  marketId: string;
  question: string;
  slug: string;
  currentPrice: number;
  estimatedFairValue: number;
  mispricingPercent: number;
  direction: 'BUY_YES' | 'BUY_NO';
  confidence: number;
  reasoning: string;
  volume: number;
  liquidity: number;
}

export interface MarketPerformance {
  marketId: string;
  question: string;
  totalVolume: number;
  tradeCount: number;
  avgPrice: number;
  priceRange: { min: number; max: number };
  resolution: string | null;
  endDate: string | null;
}

// ============================================================================
// ANALYSIS ENGINE
// ============================================================================

export class AnalysisEngine {
  private logger: Logger;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor() {
    this.logger = new Logger({ level: 'info', service: 'analysis-engine' });
  }

  // ========================================================================
  // WIN RATE CALIBRATION ANALYSIS
  // ========================================================================

  /**
   * Calculate win rate by price point
   * This shows market calibration: do prices at X cents win X% of the time?
   */
  async calculateWinRateByPrice(): Promise<WinRateByPrice[]> {
    const db = getResearchDB();

    // Check cache first
    const cached = db.getCachedAnalysis<WinRateByPrice[]>('win_rate_by_price', {});
    if (cached) {
      return cached;
    }

    // Get all resolved markets
    const resolvedMarkets = db.getMarkets({ resolvedOnly: true });

    if (resolvedMarkets.length === 0) {
      this.logger.warn('No resolved markets available for win rate analysis');
      return [];
    }

    // Group by price buckets (0-99 cents)
    const buckets: Map<number, { wins: number; total: number }> = new Map();

    for (let i = 0; i <= 99; i++) {
      buckets.set(i, { wins: 0, total: 0 });
    }

    for (const market of resolvedMarkets) {
      try {
        const prices = JSON.parse(market.outcomePrices || '[]') as number[];
        const outcomes = JSON.parse(market.outcomes || '[]') as string[];
        const resolution = market.resolution;

        if (!resolution || prices.length === 0 || outcomes.length === 0) continue;

        // For each outcome, check if price predicted correctly
        for (let i = 0; i < prices.length; i++) {
          const price = prices[i];
          const outcome = outcomes[i];
          const priceCent = Math.round(price * 100);

          if (priceCent < 0 || priceCent > 99) continue;

          const bucket = buckets.get(priceCent)!;
          bucket.total++;

          // Check if this outcome won
          const isWin = outcome.toUpperCase() === resolution.toUpperCase() ||
                        (resolution === 'YES' && i === 0) ||
                        (resolution === 'NO' && i === 1);

          if (isWin) {
            bucket.wins++;
          }
        }
      } catch {
        // Skip markets with invalid data
      }
    }

    // Calculate win rates
    const results: WinRateByPrice[] = [];

    for (let pricePoint = 0; pricePoint <= 99; pricePoint++) {
      const bucket = buckets.get(pricePoint)!;
      const expectedWinRate = pricePoint / 100;
      const actualWinRate = bucket.total > 0 ? bucket.wins / bucket.total : 0;

      results.push({
        pricePoint,
        expectedWinRate,
        actualWinRate,
        sampleSize: bucket.total,
        overconfidence: actualWinRate - expectedWinRate,
      });
    }

    // Cache results
    db.setCachedAnalysis('win_rate_by_price', {}, results, this.CACHE_TTL_MS);
    db.saveWinRateAnalysis(results);

    return results;
  }

  // ========================================================================
  // TRADE-BASED WIN RATE CALIBRATION (high-fidelity)
  // ========================================================================

  /**
   * Calculate win rate using individual trade prices, not just final market prices.
   * Each trade at price X for a market that resolved YES/NO gives a data point.
   * This produces much smoother calibration curves with thousands of samples per bucket.
   */
  async calculateTradeBasedWinRate(options?: {
    tag?: string;
    minSampleSize?: number;
  }): Promise<WinRateByPrice[]> {
    const db = getResearchDB();
    const minSamples = options?.minSampleSize || 10;

    // Check cache
    const cacheKey = { type: 'trade_based', tag: options?.tag || 'all' };
    const cached = db.getCachedAnalysis<WinRateByPrice[]>('trade_based_win_rate', cacheKey);
    if (cached) {
      return cached;
    }

    // Get resolved markets that have trades
    const resolvedMarkets = db.getResolvedMarketsWithTrades({
      tag: options?.tag,
      limit: 5000,
    });

    if (resolvedMarkets.length === 0) {
      this.logger.warn('No resolved markets with trades for trade-based win rate analysis');
      return [];
    }

    // Buckets: 0-99 cents
    const buckets: Map<number, { wins: number; total: number }> = new Map();
    for (let i = 0; i <= 99; i++) {
      buckets.set(i, { wins: 0, total: 0 });
    }

    let marketsProcessed = 0;
    for (const market of resolvedMarkets) {
      try {
        const outcomes = JSON.parse(market.outcomes || '[]') as string[];
        const resolution = market.resolution;
        if (!resolution || outcomes.length === 0) continue;

        // Get all trades for this market
        const trades = db.getTrades(market.id, 50000);
        if (trades.length === 0) continue;

        for (const trade of trades) {
          const priceCent = Math.round(trade.price * 100);
          if (priceCent < 0 || priceCent > 99) continue;

          const bucket = buckets.get(priceCent)!;
          bucket.total++;

          // Did this trade's outcome win?
          const tradeOutcome = trade.outcome || outcomes[trade.outcomeIndex] || '';
          const isWin = tradeOutcome.toUpperCase() === resolution.toUpperCase() ||
                        (resolution === 'YES' && trade.outcomeIndex === 0) ||
                        (resolution === 'NO' && trade.outcomeIndex === 1);

          if (isWin) {
            bucket.wins++;
          }
        }

        marketsProcessed++;
      } catch {
        // Skip markets with invalid data
      }
    }

    this.logger.info(`Trade-based win rate: processed ${marketsProcessed} resolved markets`);

    // Calculate win rates
    const results: WinRateByPrice[] = [];
    for (let pricePoint = 0; pricePoint <= 99; pricePoint++) {
      const bucket = buckets.get(pricePoint)!;
      const expectedWinRate = pricePoint / 100;
      const actualWinRate = bucket.total > 0 ? bucket.wins / bucket.total : 0;

      if (bucket.total >= minSamples || pricePoint === 0 || pricePoint === 99) {
        results.push({
          pricePoint,
          expectedWinRate,
          actualWinRate,
          sampleSize: bucket.total,
          overconfidence: bucket.total > 0 ? actualWinRate - expectedWinRate : 0,
        });
      }
    }

    // Cache results (10 min TTL since this is expensive)
    db.setCachedAnalysis('trade_based_win_rate', cacheKey, results, 10 * 60 * 1000);
    db.saveWinRateAnalysis(results);

    return results;
  }

  // ========================================================================
  // MARKET SCORING FOR MM
  // ========================================================================

  /**
   * Score markets for market making suitability
   */
  async scoreMarketsForMM(options?: {
    minVolume24h?: number;
    minLiquidity?: number;
    excludeCrypto?: boolean;
    limit?: number;
  }): Promise<MarketScore[]> {
    const db = getResearchDB();

    // Check cache
    const cacheKey = JSON.stringify(options || {});
    const cached = db.getCachedAnalysis<MarketScore[]>('market_scores', options || {});
    if (cached) {
      return cached;
    }

    const markets = db.getMarkets({ activeOnly: true, limit: 1000 });
    const scores: MarketScore[] = [];

    for (const market of markets) {
      // Skip crypto markets if requested
      if (options?.excludeCrypto) {
        const question = market.question.toLowerCase();
        if (
          question.includes('bitcoin') ||
          question.includes('btc') ||
          question.includes('ethereum') ||
          question.includes('eth') ||
          question.includes('crypto')
        ) {
          continue;
        }
      }

      // Apply minimum filters
      if (options?.minVolume24h && market.volume < options.minVolume24h) continue;
      if (options?.minLiquidity && market.liquidity < options.minLiquidity) continue;

      // Calculate scores
      const volumeScore = this.normalizeScore(market.volume, 0, 1000000);
      const liquidityScore = this.normalizeScore(market.liquidity, 0, 100000);

      // Estimate spread from prices
      let spreadBps = 0;
      try {
        const prices = JSON.parse(market.outcomePrices || '[]') as number[];
        if (prices.length >= 2) {
          // Higher prices typically have lower spreads
          const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
          spreadBps = Math.max(50, 500 - avgPrice * 400); // Rough estimate
        }
      } catch {
        spreadBps = 200; // Default
      }

      const spreadScore = this.normalizeScore(500 - spreadBps, 0, 450); // Inverse: lower spread = higher score

      // Overall weighted score
      const overallScore = (volumeScore * 0.4) + (liquidityScore * 0.4) + (spreadScore * 0.2);

      // Recommendation
      let recommendation: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR';
      if (overallScore >= 80) recommendation = 'EXCELLENT';
      else if (overallScore >= 60) recommendation = 'GOOD';
      else if (overallScore >= 40) recommendation = 'FAIR';
      else recommendation = 'POOR';

      const score: MarketScore = {
        marketId: market.id,
        question: market.question,
        slug: market.slug,
        liquidityScore,
        spreadScore,
        volumeScore,
        overallScore,
        recommendation,
        volume24h: market.volume,
        liquidity: market.liquidity,
        spreadBps,
        computedAt: Date.now(),
      };

      scores.push(score);
      db.upsertMarketScore(score);
    }

    // Sort by overall score
    scores.sort((a, b) => b.overallScore - a.overallScore);

    // Apply limit
    const limited = options?.limit ? scores.slice(0, options.limit) : scores;

    // Cache
    db.setCachedAnalysis('market_scores', options || {}, limited, this.CACHE_TTL_MS);

    return limited;
  }

  // ========================================================================
  // MISPRICING DETECTION
  // ========================================================================

  /**
   * Detect mispriced markets using historical calibration
   */
  async detectMispricing(options?: {
    minMispricingPercent?: number;
    minConfidence?: number;
    minVolume?: number;
    limit?: number;
  }): Promise<MispricingOpportunity[]> {
    const db = getResearchDB();
    const minMispricing = options?.minMispricingPercent || 3;
    const minConfidence = options?.minConfidence || 0.7;
    const minVolume = options?.minVolume || 1000;

    // Get win rate calibration
    const winRates = await this.calculateWinRateByPrice();

    // Build calibration lookup
    const calibrationMap = new Map<number, WinRateByPrice>();
    for (const wr of winRates) {
      if (wr.sampleSize >= 10) { // Only use buckets with enough data
        calibrationMap.set(wr.pricePoint, wr);
      }
    }

    // Get active markets
    const markets = db.getMarkets({ activeOnly: true, limit: 500 });
    const opportunities: MispricingOpportunity[] = [];

    for (const market of markets) {
      if (market.volume < minVolume) continue;

      try {
        const prices = JSON.parse(market.outcomePrices || '[]') as number[];
        const outcomes = JSON.parse(market.outcomes || '[]') as string[];

        if (prices.length < 2 || outcomes.length < 2) continue;

        // Check each outcome for mispricing
        for (let i = 0; i < prices.length; i++) {
          const currentPrice = prices[i];
          const priceCent = Math.round(currentPrice * 100);

          const calibration = calibrationMap.get(priceCent);
          if (!calibration || calibration.sampleSize < 10) continue;

          // Calculate fair value based on calibration
          const fairValue = calibration.actualWinRate;
          const mispricingRaw = fairValue - currentPrice;
          const mispricingPercent = Math.abs(mispricingRaw * 100);

          // Apply filters
          if (mispricingPercent < minMispricing) continue;

          // Calculate confidence based on sample size and overconfidence consistency
          const sampleConfidence = Math.min(calibration.sampleSize / 100, 1);
          const confidence = sampleConfidence * 0.8 + 0.2; // Minimum 0.2 confidence

          if (confidence < minConfidence) continue;

          // Determine direction
          const direction: 'BUY_YES' | 'BUY_NO' = mispricingRaw > 0
            ? (i === 0 ? 'BUY_YES' : 'BUY_NO')
            : (i === 0 ? 'BUY_NO' : 'BUY_YES');

          // Build reasoning
          const reasoning = `Historical calibration shows ${priceCent}¢ outcomes win ${(calibration.actualWinRate * 100).toFixed(1)}% of the time (expected ${priceCent}%). ` +
            `Current price ${(currentPrice * 100).toFixed(1)}¢ suggests ${mispricingRaw > 0 ? 'undervalued' : 'overvalued'} by ${mispricingPercent.toFixed(1)}%.`;

          opportunities.push({
            marketId: market.id,
            question: market.question,
            slug: market.slug,
            currentPrice,
            estimatedFairValue: fairValue,
            mispricingPercent,
            direction,
            confidence,
            reasoning,
            volume: market.volume,
            liquidity: market.liquidity,
          });

          // Also save as signal
          const signalId = `${market.id}-${i}-${Date.now()}`;
          db.upsertMispricingSignal({
            id: signalId,
            marketId: market.id,
            detectedAt: Date.now(),
            fairValue,
            marketPrice: currentPrice,
            mispricingPercent,
            confidence,
            direction: mispricingRaw > 0 ? 'BUY' : 'SELL',
            status: 'PENDING',
            reasoning,
          });
        }
      } catch {
        // Skip markets with invalid data
      }
    }

    // Sort by mispricing percent (highest first)
    opportunities.sort((a, b) => b.mispricingPercent - a.mispricingPercent);

    return options?.limit ? opportunities.slice(0, options.limit) : opportunities;
  }

  // ========================================================================
  // MARKET PERFORMANCE ANALYSIS
  // ========================================================================

  /**
   * Analyze historical performance of a specific market
   */
  async analyzeMarketPerformance(marketId: string): Promise<MarketPerformance | null> {
    const db = getResearchDB();
    const market = db.getMarket(marketId);

    if (!market) {
      return null;
    }

    const trades = db.getTrades(marketId, 10000);

    if (trades.length === 0) {
      return {
        marketId,
        question: market.question,
        totalVolume: market.volume,
        tradeCount: 0,
        avgPrice: 0,
        priceRange: { min: 0, max: 0 },
        resolution: market.resolution,
        endDate: market.endDate,
      };
    }

    const prices = trades.map(t => t.price);
    const totalVolume = trades.reduce((sum, t) => sum + (t.size * t.price), 0);
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;

    return {
      marketId,
      question: market.question,
      totalVolume,
      tradeCount: trades.length,
      avgPrice,
      priceRange: {
        min: Math.min(...prices),
        max: Math.max(...prices),
      },
      resolution: market.resolution,
      endDate: market.endDate,
    };
  }

  // ========================================================================
  // VOLUME ANALYSIS
  // ========================================================================

  /**
   * Get volume analysis over time
   */
  async getVolumeOverTime(granularity: 'daily' | 'weekly' | 'monthly' = 'daily'): Promise<VolumeAnalysis[]> {
    const db = getResearchDB();

    // For now, aggregate from markets (trades would require more complex queries)
    const markets = db.getMarkets({ limit: 1000 });

    // Group by creation date
    const periodMap = new Map<string, { volume: number; count: number }>();

    for (const market of markets) {
      if (!market.createdAt) continue;

      const date = new Date(market.createdAt);
      let period: string;

      switch (granularity) {
        case 'daily':
          period = date.toISOString().split('T')[0];
          break;
        case 'weekly':
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay());
          period = weekStart.toISOString().split('T')[0];
          break;
        case 'monthly':
          period = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          break;
      }

      const existing = periodMap.get(period) || { volume: 0, count: 0 };
      existing.volume += market.volume;
      existing.count++;
      periodMap.set(period, existing);
    }

    const results: VolumeAnalysis[] = [];
    for (const [period, data] of periodMap) {
      results.push({
        period,
        volume: data.volume,
        tradeCount: data.count,
        avgTradeSize: data.count > 0 ? data.volume / data.count : 0,
      });
    }

    // Sort by period
    results.sort((a, b) => a.period.localeCompare(b.period));

    return results;
  }

  // ========================================================================
  // UTILITIES
  // ========================================================================

  private normalizeScore(value: number, min: number, max: number): number {
    if (max === min) return 50;
    const normalized = (value - min) / (max - min);
    return Math.max(0, Math.min(100, normalized * 100));
  }
}

// Export singleton
let analysisEngineInstance: AnalysisEngine | null = null;

export function getAnalysisEngine(): AnalysisEngine {
  if (!analysisEngineInstance) {
    analysisEngineInstance = new AnalysisEngine();
  }
  return analysisEngineInstance;
}
