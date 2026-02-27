import { memo } from 'react';
import { useGeneralCryptoStats } from '../lib/hooks';
import type { CryptoTicker } from '../lib/api';

interface CryptoStatsHeaderProps {
  crypto: CryptoTicker;
}

export const CryptoStatsHeader = memo(function CryptoStatsHeader({
  crypto
}: CryptoStatsHeaderProps) {
  const { data, isLoading, isError, dataUpdatedAt } = useGeneralCryptoStats(crypto);

  if (isLoading) {
    return (
      <div className="crypto-stats-header loading">
        <div className="spinner-small" />
        <span>Loading {crypto} data...</span>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="crypto-stats-header error">
        <span className="icon-warning">⚠️</span>
        <span>Unable to load {crypto} stats</span>
      </div>
    );
  }

  const timeSinceUpdate = Math.floor((Date.now() - dataUpdatedAt) / 1000);
  const isStale = timeSinceUpdate > 30 || data.stale;

  return (
    <>
      <div className={`crypto-stats-header ${isStale ? 'stale' : ''}`}>
        <div className="stat-group">
          <span className="stat-label">{crypto}:</span>
          <span className="stat-value spot-price">
            ${data.ulPrice?.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2
            }) || 'N/A'}
          </span>
        </div>

        <div className="stat-separator">|</div>

        <div className="stat-group">
          <span className="stat-label">ATM Vol:</span>
          <span className="stat-value iv">
            {data.atmVol
              ? `${(data.atmVol * 100).toFixed(1)}%`
              : 'N/A'}
          </span>
        </div>

        <div className="stat-meta">
          <span className={`update-time ${isStale ? 'stale' : ''}`}>
            Updated {timeSinceUpdate}s ago
          </span>
          {data.source && (
            <span
              className="source-badge"
              title={`Spot: ${data.source.spotSource}, IV: ${data.source.ivSource}`}
            >
              📡 Live
            </span>
          )}
        </div>
      </div>

      <style>{`
        .crypto-stats-header {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 0.75rem 1rem;
          background: linear-gradient(135deg, #1a1a2e 0%, #252538 100%);
          border: 1px solid var(--border, #2d2d44);
          border-radius: 8px;
          margin-bottom: 1rem;
          font-size: 0.95rem;
          transition: all 0.3s ease;
        }

        .crypto-stats-header.loading {
          opacity: 0.7;
          animation: pulse 2s ease-in-out infinite;
        }

        .crypto-stats-header.error {
          background: rgba(239, 68, 68, 0.1);
          border-color: rgba(239, 68, 68, 0.3);
        }

        .crypto-stats-header.stale {
          opacity: 0.8;
          border-color: rgba(251, 191, 36, 0.5);
          background: linear-gradient(135deg, rgba(251, 191, 36, 0.05) 0%, rgba(251, 191, 36, 0.02) 100%);
        }

        .stat-group {
          display: flex;
          align-items: baseline;
          gap: 0.5rem;
        }

        .stat-label {
          color: var(--text-secondary, #a0a0b0);
          font-weight: 500;
        }

        .stat-value {
          font-weight: 700;
          font-size: 1.1rem;
        }

        .stat-value.spot-price {
          color: var(--success, #10b981);
        }

        .stat-value.iv {
          color: #6366f1;
        }

        .stat-separator {
          color: var(--border, #2d2d44);
          font-weight: 300;
          font-size: 1.2rem;
        }

        .stat-meta {
          margin-left: auto;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.8rem;
          color: #6b6b80;
        }

        .update-time.stale {
          color: #fbbf24;
        }

        .source-badge {
          padding: 0.2rem 0.4rem;
          background: rgba(99, 102, 241, 0.2);
          border-radius: 4px;
          font-size: 0.75rem;
          cursor: help;
        }

        .icon-warning {
          font-size: 1.2rem;
          margin-right: 0.5rem;
        }

        .spinner-small {
          width: 16px;
          height: 16px;
          border: 2px solid rgba(99, 102, 241, 0.2);
          border-top-color: #6366f1;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin-right: 0.5rem;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        @keyframes pulse {
          0%, 100% { opacity: 0.7; }
          50% { opacity: 0.9; }
        }
      `}</style>
    </>
  );
});
