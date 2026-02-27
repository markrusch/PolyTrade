/**
 * StatisticalStrategy
 *
 * Pricing strategy for binary event markets using statistical methods.
 * Uses polling data, historical outcomes, and odds aggregation.
 *
 * @see REDESIGN_V2.md Section 5.3
 */

import {
  BasePricingStrategy,
  type PricingData,
  type PricingResult,
  type PollData,
  type OddsData,
  type HistoricalOutcome,
} from '../PricingStrategy.js';
import type { MarketDefinition, MarketType } from '../../markets/MarketDefinition.js';

// ============================================================================
// Configuration
// ============================================================================

export interface StatisticalStrategyConfig {
  // Weights for different data sources
  pollingWeight?: number;       // Default: 0.5
  oddsWeight?: number;          // Default: 0.3
  historicalWeight?: number;    // Default: 0.2

  // Polling adjustments
  pollRatingWeights?: Map<string, number>;
  recentPollDays?: number;      // Only consider polls from last N days (default: 30)
}

// ============================================================================
// StatisticalStrategy Implementation
// ============================================================================

export class StatisticalStrategy extends BasePricingStrategy {
  readonly name = 'statistical';
  readonly displayName = 'Statistical Model';
  readonly supportedMarketTypes: MarketType[] = ['binary_event', 'categorical'];

  private config: Required<StatisticalStrategyConfig>;

  constructor(config: StatisticalStrategyConfig = {}) {
    super();
    this.config = {
      pollingWeight: config.pollingWeight ?? 0.5,
      oddsWeight: config.oddsWeight ?? 0.3,
      historicalWeight: config.historicalWeight ?? 0.2,
      pollRatingWeights: config.pollRatingWeights ?? new Map([
        ['A+', 1.0],
        ['A', 0.95],
        ['A-', 0.90],
        ['B+', 0.80],
        ['B', 0.75],
        ['B-', 0.70],
        ['C+', 0.60],
        ['C', 0.55],
        ['D', 0.40],
        ['F', 0.25],
      ]),
      recentPollDays: config.recentPollDays ?? 30,
    };
  }

  /**
   * Calculate fair price using statistical aggregation
   */
  calculateFairPrice(
    market: MarketDefinition,
    data: PricingData
  ): PricingResult {
    const estimates: { source: string; probability: number; weight: number }[] = [];

    // 1. Aggregate polling data
    if (data.pollingData && data.pollingData.length > 0) {
      const pollEstimate = this.aggregatePolls(data.pollingData, market);
      if (pollEstimate !== null) {
        estimates.push({
          source: 'polling',
          probability: pollEstimate.probability,
          weight: this.config.pollingWeight * pollEstimate.confidence,
        });
      }
    }

    // 2. Aggregate odds data
    if (data.oddsData && data.oddsData.length > 0) {
      const oddsEstimate = this.aggregateOdds(data.oddsData, market);
      if (oddsEstimate !== null) {
        estimates.push({
          source: 'odds',
          probability: oddsEstimate.probability,
          weight: this.config.oddsWeight * oddsEstimate.confidence,
        });
      }
    }

    // 3. Use historical outcomes
    if (data.historicalOutcomes && data.historicalOutcomes.length > 0) {
      const historicalEstimate = this.analyzeHistorical(data.historicalOutcomes, market);
      if (historicalEstimate !== null) {
        estimates.push({
          source: 'historical',
          probability: historicalEstimate.probability,
          weight: this.config.historicalWeight * historicalEstimate.confidence,
        });
      }
    }

    // If no estimates available, use market prices as fallback
    if (estimates.length === 0) {
      if (data.currentBid !== undefined && data.currentAsk !== undefined) {
        const midPrice = (data.currentBid + data.currentAsk) / 2;
        return this.createResult(
          midPrice,
          0.3, // Low confidence when using market price only
          'market_price_fallback',
          { bid: data.currentBid, ask: data.currentAsk, mid: midPrice }
        );
      }

      return this.createResult(
        0.5, // Default to 50%
        0,
        'no_data',
        { error: 'No pricing data available' }
      );
    }

    // Calculate weighted average
    let totalWeight = 0;
    let weightedSum = 0;
    for (const est of estimates) {
      weightedSum += est.probability * est.weight;
      totalWeight += est.weight;
    }

    const fairPrice = totalWeight > 0 ? weightedSum / totalWeight : 0.5;
    const confidence = this.calculateConfidence(estimates, data);

    return this.createResult(
      fairPrice,
      confidence,
      'statistical_aggregate',
      {
        estimates,
        totalWeight,
        weightedSum,
      }
    );
  }

  /**
   * Get confidence score
   */
  getConfidence(market: MarketDefinition, data: PricingData): number {
    let confidence = 0.5; // Base confidence

    // Increase with more data sources
    const sources = [
      data.pollingData?.length ?? 0,
      data.oddsData?.length ?? 0,
      data.historicalOutcomes?.length ?? 0,
    ].filter(n => n > 0).length;

    confidence += sources * 0.15;

    // Adjust for data quality
    switch (data.dataQuality) {
      case 'high':
        confidence *= 1.0;
        break;
      case 'medium':
        confidence *= 0.8;
        break;
      case 'low':
        confidence *= 0.5;
        break;
      case 'stale':
        confidence *= 0.2;
        break;
    }

    return Math.min(1, confidence);
  }

  // =========================================================================
  // Private Aggregation Methods
  // =========================================================================

  /**
   * Aggregate polling data with quality weighting
   */
  private aggregatePolls(
    polls: PollData[],
    market: MarketDefinition
  ): { probability: number; confidence: number } | null {
    // Filter to recent polls
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.recentPollDays);
    const recentPolls = polls.filter(p => p.date > cutoffDate);

    if (recentPolls.length === 0) return null;

    // Get the primary outcome name for binary markets
    const primaryOutcome = this.getPrimaryOutcomeName(market);

    let totalWeight = 0;
    let weightedSum = 0;

    for (const poll of recentPolls) {
      // Find matching outcome in poll
      const outcomeData = poll.outcomes.find(
        o => o.name.toLowerCase() === primaryOutcome.toLowerCase()
      );
      if (!outcomeData) continue;

      // Calculate weight based on poll rating and sample size
      let weight = 1.0;

      if (poll.rating) {
        weight *= this.config.pollRatingWeights.get(poll.rating) ?? 0.5;
      }

      if (poll.sampleSize) {
        // Larger samples get more weight (diminishing returns)
        weight *= Math.min(1, Math.sqrt(poll.sampleSize / 1000));
      }

      // Recency weighting (more recent = higher weight)
      const daysAgo = (Date.now() - poll.date.getTime()) / (1000 * 60 * 60 * 24);
      weight *= Math.exp(-daysAgo / 14); // Half-life of 14 days

      const probability = outcomeData.percentage / 100;
      weightedSum += probability * weight;
      totalWeight += weight;
    }

    if (totalWeight === 0) return null;

    return {
      probability: weightedSum / totalWeight,
      confidence: Math.min(1, totalWeight / recentPolls.length),
    };
  }

  /**
   * Aggregate odds data
   */
  private aggregateOdds(
    odds: OddsData[],
    market: MarketDefinition
  ): { probability: number; confidence: number } | null {
    const primaryOutcome = this.getPrimaryOutcomeName(market);
    const probabilities: number[] = [];

    for (const oddsEntry of odds) {
      const outcomeData = oddsEntry.outcomes.find(
        o => o.name.toLowerCase() === primaryOutcome.toLowerCase()
      );
      if (!outcomeData) continue;

      // Use implied probability if available, otherwise convert odds
      const prob = outcomeData.impliedProb ?? this.oddsToProb(outcomeData.odds);
      if (prob !== null && prob >= 0 && prob <= 1) {
        probabilities.push(prob);
      }
    }

    if (probabilities.length === 0) return null;

    // Use median to reduce impact of outliers
    probabilities.sort((a, b) => a - b);
    const median = probabilities.length % 2 === 0
      ? (probabilities[probabilities.length / 2 - 1] + probabilities[probabilities.length / 2]) / 2
      : probabilities[Math.floor(probabilities.length / 2)];

    return {
      probability: median,
      confidence: Math.min(1, probabilities.length / 5), // More sources = more confidence
    };
  }

  /**
   * Analyze historical outcomes
   */
  private analyzeHistorical(
    outcomes: HistoricalOutcome[],
    market: MarketDefinition
  ): { probability: number; confidence: number } | null {
    if (outcomes.length < 5) return null; // Need minimum data

    const primaryOutcome = this.getPrimaryOutcomeName(market);
    const wins = outcomes.filter(
      o => o.outcome.toLowerCase() === primaryOutcome.toLowerCase()
    ).length;

    // Use Laplace smoothing
    const probability = (wins + 1) / (outcomes.length + 2);
    const confidence = Math.min(1, outcomes.length / 100); // More history = more confidence

    return { probability, confidence };
  }

  /**
   * Calculate overall confidence from estimates
   */
  private calculateConfidence(
    estimates: { source: string; probability: number; weight: number }[],
    data: PricingData
  ): number {
    // Base confidence on number of sources
    let confidence = estimates.length * 0.25;

    // Check for agreement between sources
    if (estimates.length >= 2) {
      const probs = estimates.map(e => e.probability);
      const min = Math.min(...probs);
      const max = Math.max(...probs);
      const range = max - min;

      // Higher confidence if sources agree
      if (range < 0.05) {
        confidence += 0.2;
      } else if (range < 0.10) {
        confidence += 0.1;
      } else if (range > 0.20) {
        confidence -= 0.1;
      }
    }

    // Adjust for data quality
    switch (data.dataQuality) {
      case 'stale':
        confidence *= 0.5;
        break;
      case 'low':
        confidence *= 0.7;
        break;
    }

    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Get primary outcome name for binary markets
   */
  private getPrimaryOutcomeName(market: MarketDefinition): string {
    // Look for YES outcome first
    const yesOutcome = market.outcomes.find(
      o => o.name.toUpperCase() === 'YES' ||
        o.name.toUpperCase() === 'TRUE' ||
        o.name.toUpperCase() === 'WILL'
    );
    if (yesOutcome) return yesOutcome.name;

    // Otherwise return first outcome
    return market.outcomes[0]?.name || 'YES';
  }

  /**
   * Convert American odds to probability
   */
  private oddsToProb(odds: number): number | null {
    if (odds === 0) return null;

    if (odds > 0) {
      // Positive odds: e.g., +150 means 100/(150+100) = 40%
      return 100 / (odds + 100);
    } else {
      // Negative odds: e.g., -150 means 150/(150+100) = 60%
      return Math.abs(odds) / (Math.abs(odds) + 100);
    }
  }
}
