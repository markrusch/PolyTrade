import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { MarketScore } from '../../lib/api';

export function MarketScoresPanel() {
  const [excludeCrypto, setExcludeCrypto] = useState(true);
  const [minScore, setMinScore] = useState(40);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['market-scores', excludeCrypto, minScore],
    queryFn: () => api.getMarketScores({
      excludeCrypto,
      minScore,
      limit: 100,
    }),
    refetchInterval: 60000,
    staleTime: 30000,
  });

  if (isLoading) {
    return (
      <div className="panel market-scores-panel">
        <div className="panel-header">
          <h2>Market Scores</h2>
        </div>
        <div className="panel-body loading-state">
          <div className="spinner" />
          <span>Loading scores...</span>
        </div>
      </div>
    );
  }

  if (error || !data?.success) {
    return (
      <div className="panel market-scores-panel">
        <div className="panel-header">
          <h2>Market Scores</h2>
        </div>
        <div className="panel-body error-state">
          <span>Error loading scores</span>
          <small>Run a data sync first</small>
        </div>
      </div>
    );
  }

  const scores = data.data || [];

  const countByRecommendation = {
    EXCELLENT: scores.filter(s => s.recommendation === 'EXCELLENT').length,
    GOOD: scores.filter(s => s.recommendation === 'GOOD').length,
    FAIR: scores.filter(s => s.recommendation === 'FAIR').length,
    POOR: scores.filter(s => s.recommendation === 'POOR').length,
  };

  return (
    <div className="panel market-scores-panel">
      <div className="panel-header">
        <h2>Market Scores for MM</h2>
        <span className="badge">{scores.length} markets</span>
      </div>

      <div className="scores-filters">
        <div className="filter-group">
          <label>
            <input
              type="checkbox"
              checked={excludeCrypto}
              onChange={(e) => setExcludeCrypto(e.target.checked)}
            />
            Exclude Crypto Markets
          </label>
        </div>
        <div className="filter-group">
          <label>Min Score</label>
          <input
            type="number"
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            min={0}
            max={100}
            step={10}
          />
        </div>
        <button className="refresh-btn" onClick={() => refetch()}>
          Refresh
        </button>
      </div>

      <div className="recommendation-summary">
        <div className="rec-badge excellent">{countByRecommendation.EXCELLENT} Excellent</div>
        <div className="rec-badge good">{countByRecommendation.GOOD} Good</div>
        <div className="rec-badge fair">{countByRecommendation.FAIR} Fair</div>
        <div className="rec-badge poor">{countByRecommendation.POOR} Poor</div>
      </div>

      <div className="panel-body">
        {scores.length === 0 ? (
          <div className="empty-state">
            <p>No markets match your criteria.</p>
            <small>Try lowering the minimum score.</small>
          </div>
        ) : (
          <div className="table-container">
            <table className="scores-table data-table">
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Score</th>
                  <th>Rec</th>
                  <th>Volume</th>
                  <th>Liquidity</th>
                  <th>Spread</th>
                </tr>
              </thead>
              <tbody>
                {scores.map((score) => (
                  <ScoreRow key={score.marketId} score={score} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function ScoreRow({ score }: { score: MarketScore }) {
  const recClass = score.recommendation.toLowerCase();

  return (
    <tr className="score-row">
      <td className="market-cell" title={score.question}>
        {score.question.length > 50
          ? score.question.slice(0, 50) + '...'
          : score.question}
      </td>
      <td className="score-cell">
        <div className="score-bar-container">
          <div
            className="score-bar"
            style={{
              width: `${score.overallScore}%`,
              backgroundColor: getScoreColor(score.overallScore),
            }}
          />
          <span className="score-value">{score.overallScore.toFixed(0)}</span>
        </div>
      </td>
      <td>
        <span className={`rec-tag ${recClass}`}>
          {score.recommendation}
        </span>
      </td>
      <td>${score.volume24h.toLocaleString()}</td>
      <td>${score.liquidity.toLocaleString()}</td>
      <td>{score.spreadBps.toFixed(0)} bps</td>
    </tr>
  );
}

function getScoreColor(score: number): string {
  if (score >= 80) return 'var(--success, #10b981)';
  if (score >= 60) return 'var(--accent, #6366f1)';
  if (score >= 40) return 'var(--warning, #f59e0b)';
  return 'var(--danger, #ef4444)';
}
