import { memo, useMemo } from 'react';
import { useStreamingStatus, useUnsubscribeMarket } from '../lib/hooks';
import type { StreamingMarket } from '../lib/api';

interface MarketRowProps {
  market: StreamingMarket;
  onUnsubscribe: (tokenId: string) => void;
  isUnsubscribing: boolean;
}

const MarketRow = memo(function MarketRow({ market, onUnsubscribe, isUnsubscribing }: MarketRowProps) {
  const stateColor = market.state === 'active' ? 'var(--success)' 
    : market.state === 'stale' ? 'var(--danger)' 
    : 'var(--text-muted)';

  return (
    <div className="streaming-market-row">
      <div className="market-info">
        <span 
          className="state-indicator" 
          style={{ background: stateColor }}
          title={market.state}
        />
        <span className="market-slug" title={market.tokenId}>
          {market.slug || market.tokenId.slice(0, 16) + '...'}
        </span>
      </div>
      <div className="market-stats">
        <span className="tick-count">{market.tickCount} ticks</span>
        <button
          className="unsubscribe-btn"
          onClick={() => onUnsubscribe(market.tokenId)}
          disabled={isUnsubscribing}
          title="Unsubscribe"
        >
          ×
        </button>
      </div>
    </div>
  );
});

export function StreamingStatusPanel() {
  const { data: status, isLoading, error } = useStreamingStatus();
  const unsubscribeMutation = useUnsubscribeMarket();

  // Memoize sorted markets list to prevent unnecessary re-renders
  const sortedMarkets = useMemo(() => {
    if (!status?.activeMarkets) return [];
    return [...status.activeMarkets].sort((a, b) => b.tickCount - a.tickCount);
  }, [status?.activeMarkets]);

  const handleUnsubscribe = (tokenId: string) => {
    if (window.confirm('Unsubscribe from this market stream?')) {
      unsubscribeMutation.mutate(tokenId);
    }
  };

  if (isLoading) {
    return (
      <div className="panel streaming-status-panel">
        <div className="panel-header">
          <h2>📡 Streaming Status</h2>
        </div>
        <div className="panel-content loading">Loading...</div>
      </div>
    );
  }

  if (error || !status) {
    return (
      <div className="panel streaming-status-panel">
        <div className="panel-header">
          <h2>📡 Streaming Status</h2>
        </div>
        <div className="panel-content error">
          <span className="error-icon">⚠️</span>
          <span>Failed to fetch streaming status</span>
        </div>
      </div>
    );
  }

  const connection = status.connection ?? { connected: false, reconnects: 0 };
  const markets = status.markets ?? { total: 0, enabled: 0, active: 0, stale: 0, byState: {} };
  const global = status.global ?? { totalTicks: 0, uptime: 0 };

  return (
    <div className="panel streaming-status-panel">
      <div className="panel-header">
        <h2>📡 Streaming Status</h2>
        <div className="connection-badge" data-connected={connection.connected}>
          <span className="status-dot" />
          {connection.connected ? 'Connected' : 'Disconnected'}
        </div>
      </div>

      <div className="panel-content">
        {/* Global Stats */}
        <div className="streaming-stats-grid">
          <div className="stat-item">
            <span className="stat-label">Active</span>
            <span className="stat-value success">{markets.active}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Total</span>
            <span className="stat-value">{markets.total}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Stale</span>
            <span className="stat-value danger">{markets.stale}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Ticks</span>
            <span className="stat-value">{global.totalTicks.toLocaleString()}</span>
          </div>
        </div>

        {/* Reconnects Warning */}
        {connection.reconnects > 0 && (
          <div className="reconnect-warning">
            ⚠️ Reconnects: {connection.reconnects}
          </div>
        )}

        {/* Active Markets List */}
        <div className="streaming-markets-header">
          <span>Active Markets ({sortedMarkets.length})</span>
        </div>
        <div className="streaming-markets-list">
          {sortedMarkets.length === 0 ? (
            <div className="no-markets">No active market streams</div>
          ) : (
            sortedMarkets.map((market) => (
              <MarketRow
                key={market.tokenId}
                market={market}
                onUnsubscribe={handleUnsubscribe}
                isUnsubscribing={unsubscribeMutation.isPending}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
