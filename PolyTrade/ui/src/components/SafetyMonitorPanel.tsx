import { useQuery } from '@tanstack/react-query';
import { getSafetyMonitorStatus } from '../lib/api';

// Default values for null-safety
const defaultStats = {
  totalMarkets: 0,
  safeMarkets: 0,
  unsafeMarkets: 0,
  safetyRate: 1,
};

export function SafetyMonitorPanel() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['safety-monitor'],
    queryFn: getSafetyMonitorStatus,
    refetchInterval: 3000,
    retry: 2,
  });

  if (isLoading) {
    return (
      <div className="safety-monitor-panel panel">
        <div className="panel-header">
          <h2>Safety Monitor</h2>
        </div>
        <div className="panel-body loading-state">
          <div className="spinner" />
          <span>Loading safety status...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="safety-monitor-panel panel">
        <div className="panel-header">
          <h2>Safety Monitor</h2>
        </div>
        <div className="panel-body error-state">
          <span>Error loading safety status</span>
          <small>{String(error)}</small>
        </div>
      </div>
    );
  }

  // Use defaults if data is missing - prevents crashes during initialization
  const stats = { ...defaultStats, ...data?.stats };
  const unsafeMarkets = Array.isArray(data?.unsafeMarkets) ? data.unsafeMarkets : [];
  const commonReasons = data?.commonReasons || {};

  return (
    <div className="safety-monitor-panel panel">
      <div className="panel-header">
        <h2>Safety Monitor</h2>
        {!data?.success && <span className="badge warning">Initializing...</span>}
      </div>
      <div className="panel-body">
        {/* Summary Stats */}
        <div className="safety-stats">
          <StatCard label="Total Markets" value={stats.totalMarkets} />
          <StatCard label="Safe Markets" value={stats.safeMarkets} className="safe" />
          <StatCard label="Unsafe Markets" value={stats.unsafeMarkets} className="unsafe" />
          <StatCard
            label="Safety Rate"
            value={`${(stats.safetyRate * 100).toFixed(1)}%`}
            className={stats.safetyRate > 0.8 ? 'safe' : 'warning'}
          />
        </div>

        {/* Unsafe Markets Table */}
        {unsafeMarkets.length > 0 && (
          <div className="unsafe-markets-section">
            <h3>Unsafe Markets ({unsafeMarkets.length})</h3>
            <div className="table-container">
              <table className="unsafe-markets-table data-table">
                <thead>
                  <tr>
                    <th>Token ID</th>
                    <th>Reasons</th>
                    <th>Last Check</th>
                  </tr>
                </thead>
                <tbody>
                  {unsafeMarkets.map((market: any) => (
                    <tr key={market.tokenId || Math.random()}>
                      <td className="token-id" title={market.tokenId || ''}>
                        {(market.tokenId || 'unknown').slice(0, 12)}...
                      </td>
                      <td className="reasons">
                        {(market.reasons || []).map((r: string, i: number) => (
                          <span key={i} className="reason-tag">{r}</span>
                        ))}
                      </td>
                      <td className="last-check">
                        {market.lastCheck ? new Date(market.lastCheck).toLocaleTimeString() : 'N/A'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Common Reasons Chart */}
        {Object.keys(commonReasons).length > 0 && stats.unsafeMarkets > 0 && (
          <div className="common-reasons">
            <h3>Common Reasons</h3>
            <div className="reasons-list">
              {Object.entries(commonReasons).map(([reason, count]: [string, any]) => (
                <div key={reason} className="reason-row">
                  <span className="reason-name">{reason}</span>
                  <div className="reason-bar-container">
                    <div
                      className="reason-bar"
                      style={{
                        width: `${Math.min((count / stats.unsafeMarkets) * 100, 100)}%`,
                        backgroundColor: 'var(--warning, #f59e0b)'
                      }}
                    />
                  </div>
                  <span className="reason-count">{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Show message when no markets are tracked yet */}
        {stats.totalMarkets === 0 && (
          <div className="no-markets-message">
            <p>No markets being monitored yet.</p>
            <small>Markets will appear here once they are wired for pricing.</small>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  className = ''
}: {
  label: string;
  value: any;
  className?: string;
}) {
  return (
    <div className={`stat-card ${className}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value ?? 0}</div>
    </div>
  );
}
