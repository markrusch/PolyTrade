/**
 * Research Platform Module
 *
 * This module provides research and analysis capabilities for Polymarket,
 * completely separate from the crypto market making operations.
 *
 * Key components:
 * - ResearchDatabase: Separate SQLite database for research data
 * - LiveDataIngester: Fetches and syncs data from Polymarket APIs
 * - AnalysisEngine: Core analysis functions (win rate, mispricing, scoring)
 */

// Database
export {
  ResearchDB,
  getResearchDB,
  closeResearchDB,
  type ResearchMarket,
  type ResearchTrade,
  type AnalysisCache,
  type MispricingSignal,
  type ResearchPosition,
  type WinRateByPrice,
  type MarketScore,
  type DataSyncStatus,
} from './ResearchDatabase.js';

// Live Data Ingestion
export {
  LiveDataIngester,
  getLiveDataIngester,
  stopLiveDataIngester,
  POLYMARKET_TAGS,
  type PolymarketCategory,
  type IngesterConfig,
} from './LiveDataIngester.js';

// Analysis Engine
export {
  AnalysisEngine,
  getAnalysisEngine,
  type VolumeAnalysis,
  type MarketCalibration,
  type MispricingOpportunity,
  type MarketPerformance,
} from './AnalysisEngine.js';
