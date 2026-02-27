import { memo, useCallback, useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useWsChannel } from '../lib/useWsConnection';
import { useQueryClient } from '@tanstack/react-query';
import type { Position } from '../lib/api';
import { REFETCH_INTERVALS, CACHE_TIMES, UI_TIMING } from '../lib/constants';

// Helper to detect crypto markets
function isCryptoMarket(market: string): boolean {
  const cryptoKeywords = ['Bitcoin', 'BTC', 'Ethereum', 'ETH', 'Solana', 'SOL', 'XRP', 'above', 'below'];
  return cryptoKeywords.some(keyword => market.includes(keyword));
}

export const PositionsPanel = memo(function PositionsPanel() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'redeemable' | 'closed'>('active');
  const [marketTypeFilter, setMarketTypeFilter] = useState<'all' | 'crypto' | 'non-crypto'>('all');
  const [actionMsg, setActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  
  // Fetch both open and closed positions
  const { data: openPositions = [], isLoading: loadingOpen } = useQuery({
    queryKey: ['positions', 'open'],
    queryFn: async () => {
      const data = await api.getPositionsByType('open');
      console.log('[Positions API] Open positions:', data);
      return data;
    },
    refetchInterval: REFETCH_INTERVALS.POSITIONS,
    staleTime: CACHE_TIMES.ORDERBOOK_STALE,
  });

  const { data: closedPositions = [], isLoading: loadingClosed } = useQuery({
    queryKey: ['positions', 'closed'],
    queryFn: async () => {
      const data = await api.getPositionsByType('closed');
      console.log('[Positions API] Closed positions:', data);
      return data;
    },
    refetchInterval: REFETCH_INTERVALS.MARKETS,
    staleTime: CACHE_TIMES.DEFAULT_STALE * 2,
  });

  const handleWsUpdate = useCallback((data: Position[]) => {
    queryClient.setQueryData(['positions', 'open'], data);
  }, [queryClient]);

  // Stream only open positions via WS
  useWsChannel<Position[]>('positions', handleWsUpdate);

  // Combine and filter positions
  const allPositions = useMemo(() => {
    return [...openPositions, ...closedPositions];
  }, [openPositions, closedPositions]);

  const filteredPositions = useMemo(() => {
    let filtered = allPositions;

    // Filter by status
    if (statusFilter === 'active') {
      filtered = filtered.filter(p => p.status === 'ACTIVE');
    } else if (statusFilter === 'redeemable') {
      filtered = filtered.filter(p => p.status === 'REDEEMABLE');
    } else if (statusFilter === 'closed') {
      filtered = filtered.filter(p => p.status === 'CLOSED');
    }

    // Filter by market type (crypto vs non-crypto)
    if (marketTypeFilter === 'crypto') {
      filtered = filtered.filter(p => isCryptoMarket(p.market));
    } else if (marketTypeFilter === 'non-crypto') {
      filtered = filtered.filter(p => !isCryptoMarket(p.market));
    }

    return filtered;
  }, [allPositions, statusFilter, marketTypeFilter]);

  const counts = useMemo(() => ({
    all: allPositions.length,
    active: allPositions.filter(p => p.status === 'ACTIVE').length,
    redeemable: allPositions.filter(p => p.status === 'REDEEMABLE').length,
    closed: allPositions.filter(p => p.status === 'CLOSED').length,
    crypto: allPositions.filter(p => isCryptoMarket(p.market)).length,
    nonCrypto: allPositions.filter(p => !isCryptoMarket(p.market)).length,
  }), [allPositions]);

  const isLoading = loadingOpen || loadingClosed;

  const showMessage = useCallback((type: 'success' | 'error', text: string) => {
    setActionMsg({ type, text });
    setTimeout(() => setActionMsg(null), UI_TIMING.MESSAGE_TIMEOUT);
  }, []);

  const handleSellClick = useCallback(async (pos: Position) => {
    try {
      const defaultSize = parseFloat(pos.size || '0') || 0;
      const defaultPrice = parseFloat(pos.currentPrice || pos.avgEntry || '0') || 0;

      if (!pos.id) {
        showMessage('error', 'Missing token ID for this position.');
        return;
      }

      const sizeInput = window.prompt('Size to sell (tokens):', String(defaultSize));
      if (sizeInput === null) return; // user cancelled
      const size = Number(sizeInput);
      if (!Number.isFinite(size) || size <= 0) {
        showMessage('error', 'Invalid size. Enter a positive number.');
        return;
      }

      const priceInput = window.prompt('Price to sell at:', String(defaultPrice));
      if (priceInput === null) return; // user cancelled
      const price = Number(priceInput);
      if (!Number.isFinite(price) || price <= 0) {
        showMessage('error', 'Invalid price. Enter a positive number.');
        return;
      }

      setLoadingAction(pos.id);
      const order = await api.placeOrder({ tokenId: pos.id, side: 'SELL', price, size });
      // Invalidate orders list on success
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      showMessage('success', `Sell order placed${order?.id ? ` (#${order.id})` : ''}.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showMessage('error', `Sell failed: ${msg}`);
    } finally {
      setLoadingAction(null);
    }
  }, [queryClient, showMessage]);

  const handleBuyMoreClick = useCallback(async (pos: Position) => {
    try {
      const defaultPrice = parseFloat(pos.currentPrice || pos.avgEntry || '0') || 0;

      if (!pos.id) {
        showMessage('error', 'Missing token ID for this position.');
        return;
      }

      const sizeInput = window.prompt('Size to buy (tokens):', '10');
      if (sizeInput === null) return;
      const size = Number(sizeInput);
      if (!Number.isFinite(size) || size <= 0) {
        showMessage('error', 'Invalid size. Enter a positive number.');
        return;
      }

      const priceInput = window.prompt('Price to buy at:', String(defaultPrice));
      if (priceInput === null) return;
      const price = Number(priceInput);
      if (!Number.isFinite(price) || price <= 0) {
        showMessage('error', 'Invalid price. Enter a positive number.');
        return;
      }

      setLoadingAction(pos.id + '_buy');
      const order = await api.placeOrder({ tokenId: pos.id, side: 'BUY', price, size });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['positions'] });
      showMessage('success', `Buy order placed${order?.id ? ` (#${order.id})` : ''}.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showMessage('error', `Buy failed: ${msg}`);
    } finally {
      setLoadingAction(null);
    }
  }, [queryClient, showMessage]);

  const handleCloseAllClick = useCallback(async (pos: Position) => {
    if (!window.confirm(`Close entire position in ${pos.market}?\n\nThis will place a market sell order for ${pos.size} tokens.`)) {
      return;
    }

    try {
      if (!pos.id) {
        showMessage('error', 'Missing token ID for this position.');
        return;
      }

      const size = parseFloat(pos.size || '0') || 0;
      // Use a price slightly below current to ensure fill (market-like order)
      const currentPrice = parseFloat(pos.currentPrice || pos.avgEntry || '0.5');
      const marketPrice = Math.max(0.01, currentPrice - 0.02); // Slightly aggressive

      setLoadingAction(pos.id + '_close');
      await api.placeOrder({ tokenId: pos.id, side: 'SELL', price: marketPrice, size });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['positions'] });
      showMessage('success', `Close order placed for ${size} tokens.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showMessage('error', `Close failed: ${msg}`);
    } finally {
      setLoadingAction(null);
    }
  }, [queryClient, showMessage]);

  return (
    <div className="panel">
      <div className="panel-header">
        <h3>Positions</h3>
        <div className="filter-badges">
          <div className="filter-group">
            <span className="filter-group-label">Status:</span>
            <button
              className={`filter-badge ${statusFilter === 'all' ? 'active' : ''}`}
              onClick={() => setStatusFilter('all')}
              title="Show all positions including redeemable and closed"
            >
              All ({counts.all})
            </button>
            <button
              className={`filter-badge ${statusFilter === 'active' ? 'active' : ''}`}
              onClick={() => setStatusFilter('active')}
              title="Show only active open positions"
            >
              Active ({counts.active})
            </button>
            <button
              className={`filter-badge redeemable ${statusFilter === 'redeemable' ? 'active' : ''}`}
              onClick={() => setStatusFilter('redeemable')}
              title="Show settled positions ready to redeem"
            >
              Redeemable ({counts.redeemable})
            </button>
            <button
              className={`filter-badge ${statusFilter === 'closed' ? 'active' : ''}`}
              onClick={() => setStatusFilter('closed')}
              title="Show closed/exited positions"
            >
              Closed ({counts.closed})
            </button>
          </div>
          <div className="filter-group">
            <span className="filter-group-label">Type:</span>
            <button
              className={`filter-badge ${marketTypeFilter === 'all' ? 'active' : ''}`}
              onClick={() => setMarketTypeFilter('all')}
              title="Show all market types"
            >
              All ({counts.all})
            </button>
            <button
              className={`filter-badge ${marketTypeFilter === 'crypto' ? 'active' : ''}`}
              onClick={() => setMarketTypeFilter('crypto')}
              title="Show only crypto markets"
            >
              Crypto ({counts.crypto})
            </button>
            <button
              className={`filter-badge ${marketTypeFilter === 'non-crypto' ? 'active' : ''}`}
              onClick={() => setMarketTypeFilter('non-crypto')}
              title="Show only non-crypto markets"
            >
              Non-Crypto ({counts.nonCrypto})
            </button>
          </div>
        </div>
      </div>
      <div className="panel-body">
        {actionMsg && (
          <div style={{
            marginBottom: 8,
            fontSize: '12px',
            color: actionMsg.type === 'success' ? 'var(--success)' : 'var(--danger)'
          }}>
            {actionMsg.text}
          </div>
        )}
        {isLoading ? (
          <div className="empty-state">Loading positions...</div>
        ) : (
          <div className="table-wrapper scrollable">
            <table>
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Outcome</th>
                  <th>Status</th>
                  <th>Size</th>
                  <th>Avg Entry</th>
                  <th>Current / Exit</th>
                  <th>PnL</th>
                  <th>PnL %</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredPositions.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="empty-state">
                      {statusFilter === 'all' ? 'No positions' : `No ${statusFilter} positions`}
                    </td>
                  </tr>
                ) : (
                  filteredPositions.map((pos: Position) => (
                    <tr key={(pos.id || pos.market) + '_' + (pos.outcome || '')}>
                      <td className="market">
                        {pos.market}
                        {isCryptoMarket(pos.market) && (
                          <span className="crypto-badge" style={{
                            marginLeft: '6px',
                            padding: '2px 6px',
                            fontSize: '10px',
                            fontWeight: 'bold',
                            background: 'var(--accent, #3b82f6)',
                            color: 'white',
                            borderRadius: '3px'
                          }}>
                            CRYPTO
                          </span>
                        )}
                      </td>
                      <td className="outcome">{pos.outcome || '—'}</td>
                      <td className={`status status-${(pos.status || 'ACTIVE').toLowerCase()}`}>
                        {pos.status || 'ACTIVE'}
                      </td>
                      <td className="size">{pos.size}</td>
                      <td className="entry">{pos.avgEntry !== null ? pos.avgEntry : 'N/A'}</td>
                      <td className="mark">{pos.exitPrice !== null ? pos.exitPrice : (pos.currentPrice !== null ? pos.currentPrice : (pos.avgEntry !== null ? pos.avgEntry : 'N/A'))}</td>
                      <td className={`pnl ${pos.pnl !== null && parseFloat(pos.pnl) >= 0 ? 'positive' : 'negative'}`}>
                        {pos.pnl !== null ? (parseFloat(pos.pnl) >= 0 ? '+' : '') + pos.pnl : 'N/A'}
                      </td>
                      <td className={`pnl ${pos.pnlPercent !== null && parseFloat(pos.pnlPercent) >= 0 ? 'positive' : 'negative'}`}>
                        {pos.pnlPercent !== null ? (parseFloat(pos.pnlPercent) >= 0 ? '+' : '') + pos.pnlPercent + '%' : 'N/A'}
                      </td>
                      <td className="actions">
                        {pos.status === 'ACTIVE' ? (
                          <div className="action-buttons">
                            <button 
                              className="btn-action btn-sell" 
                              onClick={() => handleSellClick(pos)}
                              disabled={loadingAction === pos.id}
                              title="Sell part of position"
                            >
                              {loadingAction === pos.id ? '...' : 'Sell'}
                            </button>
                            <button 
                              className="btn-action btn-buy" 
                              onClick={() => handleBuyMoreClick(pos)}
                              disabled={loadingAction === pos.id + '_buy'}
                              title="Buy more of this position"
                            >
                              {loadingAction === pos.id + '_buy' ? '...' : 'Buy+'}
                            </button>
                            <button 
                              className="btn-action btn-close" 
                              onClick={() => handleCloseAllClick(pos)}
                              disabled={loadingAction === pos.id + '_close'}
                              title="Close entire position"
                            >
                              {loadingAction === pos.id + '_close' ? '...' : 'Close'}
                            </button>
                          </div>
                        ) : pos.status === 'REDEEMABLE' ? (
                          <button className="btn-action btn-redeem" title="Redeem settled position">
                            Redeem
                          </button>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
});
