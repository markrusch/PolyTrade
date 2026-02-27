import { memo, useState, useEffect, useMemo } from 'react';
import { useWiredMarkets } from '../lib/hooks';
import { useQueryClient } from '@tanstack/react-query';
import type { CryptoTicker, WiredMarketInfo } from '../lib/api';
import { wsClient } from '../lib/wsClient';
import { formatPrice } from '../lib/formatters';

// Format age in human-readable format
const formatAge = (ageMs: number | null | undefined): string => {
  if (ageMs === null || ageMs === undefined) return 'N/A';
  if (ageMs < 1000) return `${ageMs}ms`;
  if (ageMs < 60000) return `${(ageMs / 1000).toFixed(1)}s`;
  return `${(ageMs / 60000).toFixed(1)}m`;
};

// Get freshness status color
const getFreshnessColor = (ageMs: number | null | undefined, thresholdMs: number = 5000): string => {
  if (ageMs === null || ageMs === undefined) return 'var(--text-secondary)';
  if (ageMs < thresholdMs) return 'var(--success, #10b981)'; // Fresh
  if (ageMs < thresholdMs * 2) return 'var(--warning, #f59e0b)'; // Getting stale
  return 'var(--danger, #ef4444)'; // Stale
};

interface LivePricingTableProps {
  crypto: CryptoTicker;
}

export const LivePricingTable = memo(function LivePricingTable({ crypto }: LivePricingTableProps) {
  const { data: wiredMarketsData, refetch } = useWiredMarkets();
  const [sortBy, setSortBy] = useState<keyof WiredMarketInfo>('strike');
  const [sortAsc, setSortAsc] = useState(true);
  const queryClient = useQueryClient();

  // Subscribe to WebSocket pricing updates
  useEffect(() => {
    // Subscribe to 'pricing' channel for real-time updates
    const unsubscribe = wsClient.subscribe('pricing', () => {
      // Invalidate the wired markets query to trigger a refetch
      // This will cause the table to re-render with new data
      queryClient.invalidateQueries({ queryKey: ['wired-markets'] });
    });

    // Also set up a polling fallback (every 3 seconds as backup)
    const pollInterval = setInterval(() => {
      refetch();
    }, 3000);

    return () => {
      unsubscribe();
      clearInterval(pollInterval);
    };
  }, [queryClient, refetch]);

  // Filter markets for selected crypto
  const markets = (wiredMarketsData?.markets || []).filter(m => m.crypto === crypto);

  // Get freshness data for current crypto
  const freshness = useMemo(() => {
    return wiredMarketsData?.freshness?.[crypto] || { spotAgeMs: null, ivAgeMs: null };
  }, [wiredMarketsData?.freshness, crypto]);

  // Sort markets
  const sortedMarkets = [...markets].sort((a, b) => {
    const aVal = a[sortBy];
    const bVal = b[sortBy];
    if (aVal === null || aVal === undefined) return 1;
    if (bVal === null || bVal === undefined) return -1;

    const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
    return sortAsc ? comparison : -comparison;
  });

  const handleSort = (column: keyof WiredMarketInfo) => {
    if (sortBy === column) {
      setSortAsc(!sortAsc);
    } else {
      setSortBy(column);
      setSortAsc(true);
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return '-';
    }
  };

  const formatNumber = (value: number | null | undefined, decimals: number = 3) => {
    return formatPrice(value, decimals);
  };

  const getEdgeColor = (edge: number | null) => {
    if (edge === null || edge === undefined) return 'var(--text-secondary)';
    return edge > 0 ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)';
  };

  const isNearATM = (market: WiredMarketInfo) => {
    if (!market.spotPrice || !market.strike) return false;
    const moneyness = Math.abs(Math.log(market.strike / market.spotPrice));
    return moneyness < 0.05;
  };

  if (markets.length === 0) {
    return (
      <div className="live-pricing-table-empty">
        <p>No wired markets for {crypto}.</p>
        <p>Click "Wire All {crypto} Markets" to get started.</p>
      </div>
    );
  }

  return (
    <div className="live-pricing-table">
      <div className="table-header-row">
        <h3>{crypto} Live Pricing</h3>
        <div className="header-info">
          <div className="freshness-indicators">
            <span className="freshness-item" title="Time since last spot price update from Binance">
              <span className="freshness-label">Spot:</span>
              <span
                className="freshness-value"
                style={{ color: getFreshnessColor(freshness.spotAgeMs, 5000) }}
              >
                {formatAge(freshness.spotAgeMs)}
              </span>
            </span>
            <span className="freshness-item" title="Time since last IV update from Deribit">
              <span className="freshness-label">IV:</span>
              <span
                className="freshness-value"
                style={{ color: getFreshnessColor(freshness.ivAgeMs, 30000) }}
              >
                {formatAge(freshness.ivAgeMs)}
              </span>
            </span>
          </div>
          <div className="market-count">
            {markets.length} market{markets.length !== 1 ? 's' : ''} wired
          </div>
        </div>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th rowSpan={2} onClick={() => handleSort('strike')} className="sortable">
                Strike {sortBy === 'strike' && (sortAsc ? '▲' : '▼')}
              </th>
              <th rowSpan={2} onClick={() => handleSort('expiry')} className="sortable">
                Expiry {sortBy === 'expiry' && (sortAsc ? '▲' : '▼')}
              </th>
              <th rowSpan={2} onClick={() => handleSort('spotPrice')} className="sortable">
                Spot {sortBy === 'spotPrice' && (sortAsc ? '▲' : '▼')}
              </th>
              <th rowSpan={2} onClick={() => handleSort('fairPrice')} className="sortable">
                Fair {sortBy === 'fairPrice' && (sortAsc ? '▲' : '▼')}
              </th>

              {/* Market Quotes */}
              <th colSpan={3} className="section-header">Market</th>

              {/* Derived Quotes */}
              <th colSpan={4} className="section-header">Derived (Strategy)</th>

              {/* Greeks */}
              <th colSpan={4} className="section-header">Greeks</th>
            </tr>
            <tr>
              {/* Market */}
              <th onClick={() => handleSort('bestBid')} className="sortable">
                Bid {sortBy === 'bestBid' && (sortAsc ? '▲' : '▼')}
              </th>
              <th onClick={() => handleSort('bestAsk')} className="sortable">
                Ask {sortBy === 'bestAsk' && (sortAsc ? '▲' : '▼')}
              </th>
              <th onClick={() => handleSort('spread')} className="sortable">
                Spread {sortBy === 'spread' && (sortAsc ? '▲' : '▼')}
              </th>

              {/* Derived */}
              <th className="sortable">Bid</th>
              <th className="sortable">Ask</th>
              <th className="sortable">Spread</th>
              <th onClick={() => handleSort('edge')} className="sortable">
                Edge {sortBy === 'edge' && (sortAsc ? '▲' : '▼')}
              </th>

              {/* Greeks */}
              <th>Δ</th>
              <th>Γ</th>
              <th>ν</th>
              <th>Θ</th>
            </tr>
          </thead>
          <tbody>
            {sortedMarkets.map((market) => (
              <tr
                key={market.tokenId}
                className={`${isNearATM(market) ? 'near-atm' : ''} ${market.status !== 'active' ? 'inactive' : ''}`}
              >
                <td className="strike">${market.strike.toLocaleString()}</td>
                <td className="expiry">{formatDate(market.expiry)}</td>
                <td className="spot">${formatNumber(market.spotPrice, 2)}</td>
                <td className="fair">${formatNumber(market.fairPrice)}</td>

                {/* Market Quotes */}
                <td className="bid">${formatNumber(market.bestBid)}</td>
                <td className="ask">${formatNumber(market.bestAsk)}</td>
                <td className="spread">
                  {market.spread !== null ? `${market.spread.toFixed(0)} bps` : '-'}
                </td>

                {/* Derived Quotes */}
                <td className="derived-bid">${formatNumber(market.derivedBid)}</td>
                <td className="derived-ask">${formatNumber(market.derivedAsk)}</td>
                <td className="derived-spread">
                  {market.derivedSpread != null
                    ? `${formatPrice(market.derivedSpread * 10000, 0)} bps`
                    : '-'}
                </td>
                <td className="derived-edge" style={{ color: getEdgeColor(market.derivedEdge ?? null) }}>
                  {formatNumber(market.derivedEdge, 4)}
                </td>

                {/* Greeks */}
                <td className="greek">{formatNumber(market.greeks?.delta)}</td>
                <td className="greek">{formatNumber(market.greeks?.gamma, 4)}</td>
                <td className="greek">{formatNumber(market.greeks?.vega)}</td>
                <td className="greek">{formatNumber(market.greeks?.theta, 4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <style>{`
        .live-pricing-table {
          background: var(--bg-secondary, #1a1a2e);
          border: 1px solid var(--border, #2d2d44);
          border-radius: 8px;
          padding: 16px;
          overflow: hidden;
          height: 100%;
          display: flex;
          flex-direction: column;
        }

        .table-header-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
        }

        .table-header-row h3 {
          margin: 0;
          font-size: 18px;
          color: var(--text-primary, #fff);
        }

        .header-info {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .freshness-indicators {
          display: flex;
          gap: 12px;
          font-size: 12px;
        }

        .freshness-item {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 4px 8px;
          background: var(--bg-tertiary, #252538);
          border-radius: 6px;
        }

        .freshness-label {
          color: var(--text-secondary, #a0a0b0);
        }

        .freshness-value {
          font-weight: 600;
          font-family: 'Courier New', monospace;
        }

        .market-count {
          font-size: 13px;
          color: var(--text-secondary, #a0a0b0);
          background: var(--bg-tertiary, #252538);
          padding: 4px 12px;
          border-radius: 12px;
        }

        .table-container {
          overflow-x: auto;
          overflow-y: auto;
          flex: 1;
        }

        .live-pricing-table table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }

        .live-pricing-table thead {
          position: sticky;
          top: 0;
          background: var(--bg-tertiary, #252538);
          z-index: 1;
        }

        .live-pricing-table th {
          padding: 10px 12px;
          text-align: left;
          font-weight: 600;
          color: var(--text-secondary, #a0a0b0);
          text-transform: uppercase;
          font-size: 11px;
          border-bottom: 1px solid var(--border, #2d2d44);
        }

        .live-pricing-table th.sortable {
          cursor: pointer;
          user-select: none;
        }

        .live-pricing-table th.sortable:hover {
          color: var(--text-primary, #fff);
          background: rgba(255, 255, 255, 0.05);
        }

        .live-pricing-table td {
          padding: 10px 12px;
          color: var(--text-primary, #fff);
          border-bottom: 1px solid var(--border, #2d2d44);
        }

        .live-pricing-table tr.near-atm {
          background: rgba(251, 191, 36, 0.1);
        }

        .live-pricing-table th.section-header {
          background: rgba(99, 102, 241, 0.1);
          border-bottom: 2px solid #6366f1;
          font-weight: 700;
          text-transform: uppercase;
          font-size: 11px;
          letter-spacing: 0.05em;
          text-align: center;
        }

        .live-pricing-table td.derived-bid,
        .live-pricing-table td.derived-ask {
          background: rgba(99, 102, 241, 0.05);
        }

        .live-pricing-table td.derived-edge {
          font-weight: 600;
        }

        .live-pricing-table tr.inactive {
          opacity: 0.5;
        }

        .live-pricing-table tbody tr:hover {
          background: rgba(255, 255, 255, 0.03);
        }

        .live-pricing-table .strike {
          font-weight: 600;
        }

        .live-pricing-table .expiry {
          font-size: 12px;
        }

        .live-pricing-table .spot,
        .live-pricing-table .fair,
        .live-pricing-table .bid,
        .live-pricing-table .ask {
          font-family: 'Courier New', monospace;
        }

        .live-pricing-table .edge {
          font-weight: 600;
        }

        .live-pricing-table .greek {
          font-family: 'Courier New', monospace;
          font-size: 12px;
        }

        .live-pricing-table-empty {
          padding: 48px;
          text-align: center;
          color: var(--text-secondary, #a0a0b0);
          background: var(--bg-secondary, #1a1a2e);
          border: 1px solid var(--border, #2d2d44);
          border-radius: 8px;
        }

        .live-pricing-table-empty p {
          margin: 8px 0;
        }
      `}</style>
    </div>
  );
});
