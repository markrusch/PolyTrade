import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

interface DataStatusPanelProps {
  compact?: boolean;
  detailed?: boolean;
}

const CATEGORIES = [
  { id: '', label: 'All Categories' },
  { id: 'POLITICS', label: 'Politics' },
  { id: 'CRYPTO', label: 'Crypto' },
  { id: 'SPORTS', label: 'Sports' },
  { id: 'FINANCE', label: 'Finance' },
  { id: 'TECH', label: 'Tech' },
  { id: 'CULTURE', label: 'Culture' },
  { id: 'GEOPOLITICS', label: 'Geopolitics' },
];

export function DataStatusPanel({ compact, detailed }: DataStatusPanelProps) {
  const queryClient = useQueryClient();
  const [syncCategory, setSyncCategory] = useState('');
  const [syncDays, setSyncDays] = useState(30);
  const [includeResolved, setIncludeResolved] = useState(true);

  const { data: status, isLoading, error } = useQuery({
    queryKey: ['research-status'],
    queryFn: () => api.getResearchStatus(),
    refetchInterval: 10000,
  });

  const syncMutation = useMutation({
    mutationFn: (type: 'markets' | 'trades' | 'full') => api.triggerResearchSync(type),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['research-status'] });
    },
  });

  const startSyncMutation = useMutation({
    mutationFn: () => api.startResearchSync(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['research-status'] });
    },
  });

  const stopSyncMutation = useMutation({
    mutationFn: () => api.stopResearchSync(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['research-status'] });
    },
  });

  const categorySyncMutation = useMutation({
    mutationFn: (opts: { category?: string; days: number; includeResolved: boolean }) =>
      api.syncByCategory({
        category: opts.category || undefined,
        days: opts.days,
        includeResolved: opts.includeResolved,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['research-status'] });
    },
  });

  if (isLoading) {
    return (
      <div className="panel data-status-panel">
        <div className="panel-header">
          <h2>Data Status</h2>
        </div>
        <div className="panel-body loading-state">
          <div className="spinner" />
          <span>Loading...</span>
        </div>
      </div>
    );
  }

  if (error || !status) {
    return (
      <div className="panel data-status-panel">
        <div className="panel-header">
          <h2>Data Status</h2>
        </div>
        <div className="panel-body error-state">
          <span>Error loading status</span>
          <small>{String(error)}</small>
        </div>
      </div>
    );
  }

  const formatAge = (ts: number | null) => {
    if (!ts) return 'N/A';
    const ageMs = Date.now() - ts;
    const minutes = Math.floor(ageMs / 60000);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  return (
    <div className={`panel data-status-panel ${compact ? 'compact' : ''}`}>
      <div className="panel-header">
        <h2>Data Status</h2>
        <div className="sync-badge" data-running={status.ingester.isRunning}>
          {status.ingester.isRunning ? 'Syncing' : 'Stopped'}
        </div>
      </div>
      <div className="panel-body">
        {/* Storage Stats */}
        <div className="status-section">
          <h3>Storage</h3>
          <div className="stats-grid">
            <div className="stat-item">
              <span className="stat-label">Markets</span>
              <span className="stat-value">{status.storage.markets.toLocaleString()}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Trades</span>
              <span className="stat-value">{status.storage.trades.toLocaleString()}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Signals</span>
              <span className="stat-value">{status.storage.signals.toLocaleString()}</span>
            </div>
            <div className="stat-item">
              <span className="stat-label">Positions</span>
              <span className="stat-value">{status.storage.positions.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Sync Status */}
        <div className="status-section">
          <h3>Sync Status</h3>
          <div className="sync-info">
            <div className="sync-item">
              <span className="sync-label">Markets Sync</span>
              <span className="sync-value">{formatAge(status.sync.lastMarketsSync)}</span>
            </div>
            <div className="sync-item">
              <span className="sync-label">Trades Sync</span>
              <span className="sync-value">{formatAge(status.sync.lastTradesSync)}</span>
            </div>
            <div className="sync-item">
              <span className="sync-label">Active Markets</span>
              <span className="sync-value">{status.sync.activeMarkets}</span>
            </div>
            <div className="sync-item">
              <span className="sync-label">Resolved Markets</span>
              <span className="sync-value">{status.sync.resolvedMarkets}</span>
            </div>
          </div>
        </div>

        {/* Controls (only in detailed view) */}
        {detailed && (
          <div className="status-section">
            <h3>Sync Controls</h3>
            <div className="sync-controls">
              <button
                className="sync-btn"
                onClick={() => syncMutation.mutate('markets')}
                disabled={syncMutation.isPending}
              >
                Sync Markets
              </button>
              <button
                className="sync-btn"
                onClick={() => syncMutation.mutate('trades')}
                disabled={syncMutation.isPending}
              >
                Sync Trades
              </button>
              <button
                className="sync-btn primary"
                onClick={() => syncMutation.mutate('full')}
                disabled={syncMutation.isPending}
              >
                Full Sync
              </button>
            </div>
            <div className="sync-controls">
              {status.ingester.isRunning ? (
                <button
                  className="sync-btn danger"
                  onClick={() => stopSyncMutation.mutate()}
                  disabled={stopSyncMutation.isPending}
                >
                  Stop Background Sync
                </button>
              ) : (
                <button
                  className="sync-btn success"
                  onClick={() => startSyncMutation.mutate()}
                  disabled={startSyncMutation.isPending}
                >
                  Start Background Sync
                </button>
              )}
            </div>
            {status.sync.lastError && (
              <div className="sync-error">
                <strong>Last Error:</strong> {status.sync.lastError}
              </div>
            )}
          </div>
        )}

        {/* Category Sync (detailed view) */}
        {detailed && (
          <div className="status-section">
            <h3>Category Sync (Rolling Research)</h3>
            <div className="category-sync-form">
              <div className="form-row">
                <label>Category</label>
                <select value={syncCategory} onChange={e => setSyncCategory(e.target.value)}>
                  {CATEGORIES.map(c => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-row">
                <label>Days: {syncDays}</label>
                <input
                  type="range"
                  min={1}
                  max={90}
                  value={syncDays}
                  onChange={e => setSyncDays(Number(e.target.value))}
                />
              </div>
              <div className="form-row">
                <label>
                  <input
                    type="checkbox"
                    checked={includeResolved}
                    onChange={e => setIncludeResolved(e.target.checked)}
                  />
                  Include resolved markets (for calibration)
                </label>
              </div>
              <button
                className="sync-btn primary"
                onClick={() => categorySyncMutation.mutate({
                  category: syncCategory || undefined,
                  days: syncDays,
                  includeResolved,
                })}
                disabled={categorySyncMutation.isPending}
              >
                {categorySyncMutation.isPending ? 'Syncing...' : `Sync ${syncCategory || 'All'} (${syncDays}d)`}
              </button>
              {categorySyncMutation.data && (
                <div className="sync-result">
                  {categorySyncMutation.data.result.marketsSynced} markets, {categorySyncMutation.data.result.tradesSynced} trades synced
                  {' '}({categorySyncMutation.data.dbSizeMB} MB / 15360 MB)
                </div>
              )}
              {categorySyncMutation.error && (
                <div className="sync-error">
                  {String(categorySyncMutation.error)}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
