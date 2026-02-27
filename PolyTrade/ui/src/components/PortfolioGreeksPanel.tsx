import { memo } from 'react';
import { usePortfolioGreeks } from '../lib/hooks';
import { formatGreek, formatPrice } from '../lib/formatters';

export const PortfolioGreeksPanel = memo(function PortfolioGreeksPanel() {
  const { data: greeks, isLoading, error } = usePortfolioGreeks();

  if (isLoading) {
    return (
      <div className="panel portfolio-greeks-panel">
        <div className="panel-header">
          <h3>Portfolio Greeks</h3>
        </div>
        <div className="panel-body loading-state">
          <div className="spinner" />
          <span>Loading portfolio Greeks...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel portfolio-greeks-panel">
        <div className="panel-header">
          <h3>Portfolio Greeks</h3>
        </div>
        <div className="panel-body error-state">
          <p>Failed to load portfolio Greeks</p>
          <small>{String(error)}</small>
        </div>
      </div>
    );
  }

  if (!greeks || greeks.positionCount === 0) {
    return (
      <div className="panel portfolio-greeks-panel">
        <div className="panel-header">
          <h3>Portfolio Greeks</h3>
        </div>
        <div className="panel-body empty-state">
          <p>{greeks?.message || 'No positions with Greeks data'}</p>
        </div>
      </div>
    );
  }

  // Helper to get risk description
  const getDeltaDescription = (delta: number) => {
    if (Math.abs(delta) < 0.1) return 'Delta neutral';
    return delta > 0 ? 'Bullish exposure' : 'Bearish exposure';
  };

  const getThetaDescription = (theta: number) => {
    if (Math.abs(theta) < 0.01) return 'Minimal time decay';
    return theta > 0 ? 'Earning from time decay' : 'Losing to time decay';
  };

  return (
    <div className="panel portfolio-greeks-panel">
      <div className="panel-header">
        <h3>Portfolio Greeks</h3>
        <div className="header-badges">
          <span className="badge">{greeks.positionCount} positions</span>
          {greeks.status === 'partial' && (
            <span className="badge warning" title={greeks.message}>
              Partial Data
            </span>
          )}
        </div>
      </div>
      <div className="panel-body">
        {/* Summary Section */}
        <div className="greeks-summary">
          <div className="greek-item">
            <div className="greek-header">
              <span className="greek-label">Total Delta</span>
              <span className={`greek-value ${greeks.totalDelta >= 0 ? 'positive' : 'negative'}`}>
                {greeks.totalDelta >= 0 ? '+' : ''}{formatGreek(greeks.totalDelta, 4)}
              </span>
            </div>
            <span className="greek-desc">{getDeltaDescription(greeks.totalDelta)}</span>
          </div>

          <div className="greek-item">
            <div className="greek-header">
              <span className="greek-label">Total Gamma</span>
              <span className="greek-value">{formatGreek(greeks.totalGamma, 6)}</span>
            </div>
            <span className="greek-desc">Position convexity</span>
          </div>

          <div className="greek-item">
            <div className="greek-header">
              <span className="greek-label">Total Vega</span>
              <span className="greek-value">{formatGreek(greeks.totalVega, 4)}</span>
            </div>
            <span className="greek-desc">IV sensitivity (per 1%)</span>
          </div>

          <div className="greek-item">
            <div className="greek-header">
              <span className="greek-label">Total Theta</span>
              <span className={`greek-value ${greeks.totalTheta >= 0 ? 'positive' : 'negative'}`}>
                {greeks.totalTheta >= 0 ? '+' : ''}{formatGreek(greeks.totalTheta, 4)}
              </span>
            </div>
            <span className="greek-desc">{getThetaDescription(greeks.totalTheta)}</span>
          </div>
        </div>

        {/* Per-Crypto Exposure */}
        {greeks.byCrypto && Object.keys(greeks.byCrypto).length > 0 && (
          <div className="crypto-breakdown">
            <h4>Exposure by Crypto</h4>
            <div className="crypto-cards">
              {Object.entries(greeks.byCrypto).map(([crypto, exposure]: [string, any]) => (
                <div key={crypto} className="crypto-card">
                  <div className="crypto-name">{crypto}</div>
                  <div className="crypto-greeks-grid">
                    <div className="crypto-greek">
                      <span className="crypto-greek-label">Delta</span>
                      <span className={`crypto-greek-value ${exposure.delta >= 0 ? 'positive' : 'negative'}`}>
                        {exposure.delta >= 0 ? '+' : ''}{formatGreek(exposure.delta, 4)}
                      </span>
                    </div>
                    <div className="crypto-greek">
                      <span className="crypto-greek-label">Gamma</span>
                      <span className="crypto-greek-value">{formatGreek(exposure.gamma, 6)}</span>
                    </div>
                    <div className="crypto-greek">
                      <span className="crypto-greek-label">Vega</span>
                      <span className="crypto-greek-value">{formatGreek(exposure.vega, 4)}</span>
                    </div>
                    <div className="crypto-greek">
                      <span className="crypto-greek-label">Theta</span>
                      <span className={`crypto-greek-value ${exposure.theta >= 0 ? 'positive' : 'negative'}`}>
                        {exposure.theta >= 0 ? '+' : ''}{formatGreek(exposure.theta, 4)}
                      </span>
                    </div>
                  </div>
                  <div className="crypto-positions-count">{exposure.positionCount} positions</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Position Breakdown Table */}
        <div className="greeks-breakdown">
          <h4>Position Breakdown</h4>
          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Outcome</th>
                  <th>Size</th>
                  <th>Delta</th>
                  <th>Gamma</th>
                  <th>Vega</th>
                  <th>Theta</th>
                </tr>
              </thead>
              <tbody>
                {greeks.positions.map((pos) => (
                  <tr key={pos.tokenId}>
                    <td className="market-name" title={pos.market}>
                      {pos.market.length > 40 ? pos.market.slice(0, 40) + '...' : pos.market}
                    </td>
                    <td>
                      <span className={`outcome-badge ${pos.outcome.toLowerCase()}`}>
                        {pos.outcome}
                      </span>
                    </td>
                    <td className="size-cell">{formatPrice(pos.size, 0)}</td>
                    <td className={`greek-cell ${pos.delta >= 0 ? 'positive' : 'negative'}`}>
                      {pos.delta >= 0 ? '+' : ''}{formatGreek(pos.delta, 4)}
                    </td>
                    <td className="greek-cell">{formatGreek(pos.gamma, 6)}</td>
                    <td className="greek-cell">{formatGreek(pos.vega, 4)}</td>
                    <td className={`greek-cell ${pos.theta >= 0 ? 'positive' : 'negative'}`}>
                      {pos.theta >= 0 ? '+' : ''}{formatGreek(pos.theta, 4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <style>{`
        .portfolio-greeks-panel {
          background: var(--bg-secondary, #1a1a2e);
          border: 1px solid var(--border, #2d2d44);
          border-radius: 8px;
          display: flex;
          flex-direction: column;
          height: 100%;
        }

        .portfolio-greeks-panel .panel-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          border-bottom: 1px solid var(--border, #2d2d44);
        }

        .portfolio-greeks-panel .panel-header h3 {
          margin: 0;
          font-size: 14px;
          color: var(--text-primary, #fff);
        }

        .header-badges {
          display: flex;
          gap: 8px;
        }

        .badge {
          padding: 4px 8px;
          background: var(--bg-tertiary, #252538);
          border-radius: 4px;
          font-size: 11px;
          color: var(--text-secondary, #a0a0b0);
        }

        .badge.warning {
          background: rgba(251, 191, 36, 0.2);
          color: #fbbf24;
        }

        .portfolio-greeks-panel .panel-body {
          flex: 1;
          overflow-y: auto;
          padding: 16px;
        }

        .loading-state, .error-state, .empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8px;
          height: 200px;
          color: var(--text-secondary, #a0a0b0);
        }

        .error-state {
          color: var(--danger, #ef4444);
        }

        .greeks-summary {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 16px;
          margin-bottom: 24px;
        }

        .greek-item {
          background: var(--bg-tertiary, #252538);
          border: 1px solid var(--border, #2d2d44);
          border-radius: 6px;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .greek-header {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
        }

        .greek-label {
          font-size: 11px;
          text-transform: uppercase;
          color: var(--text-tertiary, #6b6b80);
          letter-spacing: 0.5px;
        }

        .greek-value {
          font-size: 18px;
          font-weight: 700;
          color: var(--text-primary, #fff);
          font-family: 'SF Mono', Monaco, monospace;
        }

        .greek-value.positive {
          color: var(--success, #10b981);
        }

        .greek-value.negative {
          color: var(--danger, #ef4444);
        }

        .greek-desc {
          font-size: 11px;
          color: var(--text-secondary, #a0a0b0);
        }

        .crypto-breakdown {
          margin-bottom: 24px;
        }

        .crypto-breakdown h4 {
          font-size: 12px;
          text-transform: uppercase;
          color: var(--text-tertiary, #6b6b80);
          margin: 0 0 12px 0;
          letter-spacing: 0.5px;
        }

        .crypto-cards {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 12px;
        }

        .crypto-card {
          background: var(--bg-tertiary, #252538);
          border: 1px solid var(--border, #2d2d44);
          border-radius: 6px;
          padding: 12px;
        }

        .crypto-name {
          font-size: 16px;
          font-weight: 700;
          color: var(--text-primary, #fff);
          margin-bottom: 8px;
        }

        .crypto-greeks-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 6px;
        }

        .crypto-greek {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
        }

        .crypto-greek-label {
          font-size: 10px;
          text-transform: uppercase;
          color: var(--text-tertiary, #6b6b80);
        }

        .crypto-greek-value {
          font-size: 12px;
          font-weight: 600;
          font-family: 'SF Mono', Monaco, monospace;
          color: var(--text-primary, #fff);
        }

        .crypto-greek-value.positive {
          color: var(--success, #10b981);
        }

        .crypto-greek-value.negative {
          color: var(--danger, #ef4444);
        }

        .crypto-positions-count {
          font-size: 10px;
          color: var(--text-secondary, #a0a0b0);
          margin-top: 8px;
          text-align: right;
        }

        .greeks-breakdown {
          margin-top: 16px;
        }

        .greeks-breakdown h4 {
          font-size: 12px;
          text-transform: uppercase;
          color: var(--text-tertiary, #6b6b80);
          margin: 0 0 12px 0;
          letter-spacing: 0.5px;
        }

        .table-container {
          overflow-x: auto;
        }

        .data-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12px;
        }

        .data-table thead {
          background: var(--bg-tertiary, #252538);
          border-bottom: 1px solid var(--border, #2d2d44);
        }

        .data-table th {
          padding: 8px;
          text-align: left;
          font-size: 10px;
          text-transform: uppercase;
          color: var(--text-tertiary, #6b6b80);
          letter-spacing: 0.5px;
          font-weight: 600;
        }

        .data-table td {
          padding: 8px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          color: var(--text-secondary, #a0a0b0);
        }

        .data-table tbody tr:hover {
          background: rgba(255, 255, 255, 0.03);
        }

        .market-name {
          color: var(--text-primary, #fff);
          font-weight: 500;
        }

        .outcome-badge {
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
        }

        .outcome-badge.yes {
          background: rgba(16, 185, 129, 0.2);
          color: #10b981;
        }

        .outcome-badge.no {
          background: rgba(239, 68, 68, 0.2);
          color: #ef4444;
        }

        .size-cell {
          font-family: 'SF Mono', Monaco, monospace;
          font-weight: 600;
        }

        .greek-cell {
          font-family: 'SF Mono', Monaco, monospace;
          font-size: 11px;
        }

        .greek-cell.positive {
          color: var(--success, #10b981);
        }

        .greek-cell.negative {
          color: var(--danger, #ef4444);
        }

        .spinner {
          width: 24px;
          height: 24px;
          border: 2px solid var(--border, #2d2d44);
          border-top-color: var(--accent, #6366f1);
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
});
