import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useResearchStatus } from '../../lib/hooks';

const CATEGORIES = [
  { id: '', label: 'All Categories' },
  { id: 'POLITICS', label: 'Politics' },
  { id: 'SPORTS', label: 'Sports' },
  { id: 'CRYPTO', label: 'Crypto' },
  { id: 'FINANCE', label: 'Finance' },
  { id: 'TECH', label: 'Tech' },
  { id: 'CULTURE', label: 'Culture' },
  { id: 'GEOPOLITICS', label: 'Geopolitics' },
];

function formatElapsed(startedAt: number | null): string {
  if (!startedAt) return '--';
  const elapsed = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  return `${minutes}m ${seconds}s`;
}

function formatAge(ts: number | null): string {
  if (!ts) return 'Never';
  const ageMs = Date.now() - ts;
  const minutes = Math.floor(ageMs / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function getDbSizeColor(sizeMB: number): string {
  if (sizeMB > 13312) return 'var(--danger, #ef4444)';
  if (sizeMB > 10240) return 'var(--warning, #f59e0b)';
  return 'var(--success, #10b981)';
}

function getPhaseBadgeLabel(phase: string | null): string {
  if (!phase) return 'Working...';
  switch (phase) {
    case 'fetching_markets':
      return 'Fetching Markets...';
    case 'loading_trades':
      return 'Loading Trades...';
    case 'maintenance':
      return 'Running Maintenance...';
    default:
      return phase;
  }
}

export function BackfillPanel() {
  const queryClient = useQueryClient();
  const { data: status, isLoading, error } = useResearchStatus();

  // Launch form state
  const [category, setCategory] = useState('');
  const [days, setDays] = useState(30);
  const [includeResolved, setIncludeResolved] = useState(true);

  // Elapsed time ticker (updates every second while syncing)
  const [, setTick] = useState(0);
  const isRunning = status?.sync?.isRunning ?? false;
  const progress = status?.sync?.progress;

  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [isRunning]);

  // Start backfill mutation
  const startMutation = useMutation({
    mutationFn: (opts: { category?: string; days: number; includeResolved: boolean; maxMarkets: number }) =>
      api.syncByCategory(opts),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['research-status'] });
    },
  });

  // Stop backfill mutation
  const stopMutation = useMutation({
    mutationFn: () => api.stopResearchSync(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['research-status'] });
    },
  });

  if (isLoading) {
    return (
      <div className="panel backfill-panel">
        <div className="panel-header">
          <h2>Backfill</h2>
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
      <div className="panel backfill-panel">
        <div className="panel-header">
          <h2>Backfill</h2>
        </div>
        <div className="panel-body error-state">
          <span>Error loading status</span>
          <small>{String(error)}</small>
        </div>
      </div>
    );
  }

  const marketsPercent = progress && progress.marketsTotal > 0
    ? Math.round((progress.marketsProcessed / progress.marketsTotal) * 100)
    : 0;

  const dbPercent = progress
    ? Math.min(100, Math.round((progress.dbSizeMB / progress.dbLimitMB) * 100))
    : 0;

  return (
    <div className="panel backfill-panel">
      <div className="panel-header">
        <h2>Backfill</h2>
        <div className="sync-badge" data-running={isRunning}>
          {isRunning ? 'Running' : 'Idle'}
        </div>
      </div>

      <div className="panel-body">
        {/* ── A) Launch Form (when NOT syncing) ── */}
        {!isRunning && (
          <div className="status-section">
            <h3>Launch Backfill</h3>
            <div className="backfill-form">
              <div className="form-row">
                <label>Category</label>
                <select
                  className="research-category-select"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>

              <div className="form-row">
                <label>Days: {days}</label>
                <input
                  type="range"
                  min={1}
                  max={90}
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                />
              </div>

              <div className="form-row">
                <label>
                  <input
                    type="checkbox"
                    checked={includeResolved}
                    onChange={(e) => setIncludeResolved(e.target.checked)}
                  />
                  Include Resolved Markets
                </label>
              </div>

              <button
                className="sync-btn primary"
                onClick={() =>
                  startMutation.mutate({
                    category: category || undefined,
                    days,
                    includeResolved,
                    maxMarkets: 1000,
                  })
                }
                disabled={startMutation.isPending}
              >
                {startMutation.isPending ? 'Starting...' : 'Start Backfill'}
              </button>

              {startMutation.error && (
                <div className="sync-error">
                  {String(startMutation.error)}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── B) Live Progress (when syncing) ── */}
        {isRunning && progress && (
          <div className="status-section">
            <h3>Live Progress</h3>

            {/* Phase badge */}
            <div className="backfill-phase-row">
              <span className="backfill-phase-badge">
                {getPhaseBadgeLabel(progress.currentPhase)}
              </span>
              <span className="backfill-elapsed">
                {formatElapsed(progress.startedAt)}
              </span>
            </div>

            {/* Markets progress bar */}
            <div className="backfill-progress-section">
              <div className="backfill-progress-label">
                <span>Markets</span>
                <span className="backfill-progress-numbers">
                  {progress.marketsProcessed.toLocaleString()} / {progress.marketsTotal.toLocaleString()}
                  {' '}({marketsPercent}%)
                </span>
              </div>
              <div className="backfill-progress-bar-track">
                <div
                  className="backfill-progress-bar-fill"
                  style={{
                    width: `${marketsPercent}%`,
                    background: 'var(--accent, #6366f1)',
                  }}
                />
              </div>
            </div>

            {/* Trades counter */}
            <div className="backfill-trades-counter">
              <span className="stat-label">Trades Loaded</span>
              <span className="stat-value">{progress.tradesProcessed.toLocaleString()}</span>
            </div>

            {/* DB Size gauge */}
            <div className="backfill-progress-section">
              <div className="backfill-progress-label">
                <span>DB Size</span>
                <span className="backfill-progress-numbers">
                  {progress.dbSizeMB.toFixed(0)} MB / {progress.dbLimitMB} MB
                </span>
              </div>
              <div className="backfill-progress-bar-track">
                <div
                  className="backfill-progress-bar-fill"
                  style={{
                    width: `${dbPercent}%`,
                    background: getDbSizeColor(progress.dbSizeMB),
                  }}
                />
              </div>
            </div>

            {/* Stop button */}
            <button
              className="sync-btn danger"
              onClick={() => stopMutation.mutate()}
              disabled={stopMutation.isPending}
              style={{ marginTop: '16px' }}
            >
              {stopMutation.isPending ? 'Stopping...' : 'Stop Backfill'}
            </button>

            {stopMutation.error && (
              <div className="sync-error">
                {String(stopMutation.error)}
              </div>
            )}
          </div>
        )}

        {/* ── C) Last Run Summary (always shown) ── */}
        <div className="status-section">
          <h3>Summary</h3>
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
              <span className="sync-label">Total Markets</span>
              <span className="sync-value">{status.storage.markets.toLocaleString()}</span>
            </div>
            <div className="sync-item">
              <span className="sync-label">Total Trades</span>
              <span className="sync-value">{status.storage.trades.toLocaleString()}</span>
            </div>
          </div>
          {status.sync.lastError && (
            <div className="sync-error" style={{ marginTop: '12px' }}>
              <strong>Last Error:</strong> {status.sync.lastError}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
