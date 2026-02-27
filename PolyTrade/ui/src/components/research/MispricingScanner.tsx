import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { MispricingOpportunity } from '../../lib/api';
import { useResearchOrderbook } from '../../lib/hooks';

interface MispricingScannerProps {
  compact?: boolean;
  limit?: number;
}

export function MispricingScanner({ compact, limit = 25 }: MispricingScannerProps) {
  const [minMispricing, setMinMispricing] = useState(3);
  const [minConfidence, setMinConfidence] = useState(0.5);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['mispricing-opportunities', minMispricing, minConfidence, limit],
    queryFn: () => api.getMispricingOpportunities({
      minMispricing,
      minConfidence,
      minVolume: 1000,
      limit,
    }),
    refetchInterval: 30000,
    staleTime: 15000,
  });

  if (isLoading) {
    return (
      <div className={`panel mispricing-scanner ${compact ? 'compact' : ''}`}>
        <div className="panel-header">
          <h2>Mispricing Scanner</h2>
        </div>
        <div className="panel-body loading-state">
          <div className="spinner" />
          <span>Scanning markets...</span>
        </div>
      </div>
    );
  }

  if (error || !data?.success) {
    return (
      <div className={`panel mispricing-scanner ${compact ? 'compact' : ''}`}>
        <div className="panel-header">
          <h2>Mispricing Scanner</h2>
        </div>
        <div className="panel-body error-state">
          <span>Error loading opportunities</span>
          <small>Run a data sync first</small>
        </div>
      </div>
    );
  }

  const opportunities = data.data || [];

  return (
    <div className={`panel mispricing-scanner ${compact ? 'compact' : ''}`}>
      <div className="panel-header">
        <h2>Mispricing Scanner</h2>
        <span className="badge">{opportunities.length} opportunities</span>
      </div>

      {!compact && (
        <div className="scanner-filters">
          <div className="filter-group">
            <label>Min Mispricing %</label>
            <input
              type="number"
              value={minMispricing}
              onChange={(e) => setMinMispricing(Number(e.target.value))}
              min={0}
              max={50}
              step={1}
            />
          </div>
          <div className="filter-group">
            <label>Min Confidence</label>
            <input
              type="number"
              value={minConfidence}
              onChange={(e) => setMinConfidence(Number(e.target.value))}
              min={0}
              max={1}
              step={0.1}
            />
          </div>
          <button className="refresh-btn" onClick={() => refetch()}>
            Refresh
          </button>
        </div>
      )}

      <div className="panel-body">
        {opportunities.length === 0 ? (
          <div className="empty-state">
            <p>No mispricing opportunities found.</p>
            <small>Try lowering the minimum mispricing threshold.</small>
          </div>
        ) : (
          <div className="opportunities-list">
            {opportunities.map((opp) => (
              <OpportunityCard key={opp.marketId} opportunity={opp} compact={compact} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Order form state ────────────────────────────────────────────────────────

interface OrderFormState {
  showOrderForm: boolean;
  orderSide: 'BUY' | 'SELL';
  orderSize: string;
  orderPrice: string;
  /** Fallback manual token ID when the opportunity lacks one */
  manualTokenId: string;
}

function deriveInitialFormState(opp: MispricingOpportunity): Omit<OrderFormState, 'showOrderForm'> {
  // BUY_YES: buy the YES token at the current YES price
  // BUY_NO:  buy the NO token at (1 - currentPrice), i.e. the implied NO price
  const price = opp.direction === 'BUY_YES'
    ? opp.currentPrice
    : 1 - opp.currentPrice;

  return {
    orderSide: 'BUY',
    orderSize: '10',
    orderPrice: price.toFixed(4),
    manualTokenId: '',
  };
}

// ─── OpportunityCard ─────────────────────────────────────────────────────────

function OpportunityCard({
  opportunity,
  compact,
}: {
  opportunity: MispricingOpportunity;
  compact?: boolean;
}) {
  const directionColor =
    opportunity.direction === 'BUY_YES'
      ? 'var(--success, #10b981)'
      : 'var(--danger, #ef4444)';

  const initialForm = deriveInitialFormState(opportunity);

  const [formState, setFormState] = useState<OrderFormState>({
    showOrderForm: false,
    ...initialForm,
  });

  const [orderResult, setOrderResult] = useState<{ ok: boolean; message: string } | null>(null);

  // ── Resolve the correct token ID for the selected outcome ─────────────────
  // BUY_YES → use yesTokenId; BUY_NO → use noTokenId
  const resolvedTokenId: string | undefined =
    opportunity.direction === 'BUY_YES'
      ? opportunity.yesTokenId
      : opportunity.noTokenId;

  const tokenIdAvailable = Boolean(resolvedTokenId);

  // ── useResearchOrderbook hook ─────────────────────────────────────────────
  const { data: orderbook, isLoading: orderbookLoading } = useResearchOrderbook(
    resolvedTokenId,
    formState.showOrderForm
  );

  // ── useMutation for order placement ──────────────────────────────────────
  const orderMutation = useMutation({
    mutationFn: (params: { tokenId: string; side: 'BUY' | 'SELL'; price: string; size: string }) =>
      api.placeOrder(params),
    onSuccess: () => {
      setOrderResult({ ok: true, message: 'Order placed successfully.' });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Unknown error placing order.';
      setOrderResult({ ok: false, message });
    },
  });

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleToggleForm() {
    setFormState((prev) => {
      if (prev.showOrderForm) {
        // Collapse: reset to defaults
        return { showOrderForm: false, ...initialForm };
      }
      return { ...prev, showOrderForm: true };
    });
    setOrderResult(null);
    orderMutation.reset();
  }

  function handlePlaceOrder() {
    // Determine the token ID to use: resolved from opportunity, or manual fallback
    const tokenId = resolvedTokenId ?? formState.manualTokenId.trim();

    if (!tokenId) {
      setOrderResult({ ok: false, message: 'Token ID is required to place an order.' });
      return;
    }

    const price = parseFloat(formState.orderPrice);
    const size = parseFloat(formState.orderSize);

    if (isNaN(price) || price <= 0 || price >= 1) {
      setOrderResult({ ok: false, message: 'Price must be between 0 and 1 (exclusive).' });
      return;
    }
    if (isNaN(size) || size <= 0) {
      setOrderResult({ ok: false, message: 'Size must be a positive number.' });
      return;
    }

    setOrderResult(null);
    orderMutation.mutate({
      tokenId,
      side: formState.orderSide,
      price: formState.orderPrice,
      size: formState.orderSize,
    });
  }

  function handleCancel() {
    setFormState({ showOrderForm: false, ...initialForm });
    setOrderResult(null);
    orderMutation.reset();
  }

  // Estimated cost in USD: price * size (each share pays $1 at resolution)
  const estimatedCost = (() => {
    const p = parseFloat(formState.orderPrice);
    const s = parseFloat(formState.orderSize);
    if (isNaN(p) || isNaN(s)) return null;
    return (p * s).toFixed(2);
  })();

  // Which outcome label are we trading?
  const outcomeLabel = opportunity.direction === 'BUY_YES' ? 'YES' : 'NO';

  return (
    <div className="opportunity-card">
      {/* ── Card header ── */}
      <div className="opp-header">
        <span
          className="direction-badge"
          style={{ backgroundColor: directionColor }}
        >
          {opportunity.direction.replace('_', ' ')}
        </span>
        <span className="mispricing-badge">
          {opportunity.mispricingPercent.toFixed(1)}% mispriced
        </span>
      </div>

      {/* ── Question ── */}
      <div className="opp-question" title={opportunity.question}>
        {opportunity.question.length > 80
          ? opportunity.question.slice(0, 80) + '...'
          : opportunity.question}
      </div>

      {/* ── Market details ── */}
      <div className="opp-details">
        <div className="detail-item">
          <span className="detail-label">Market Price</span>
          <span className="detail-value">{(opportunity.currentPrice * 100).toFixed(1)}¢</span>
        </div>
        <div className="detail-item">
          <span className="detail-label">Fair Value</span>
          <span className="detail-value">{(opportunity.estimatedFairValue * 100).toFixed(1)}¢</span>
        </div>
        <div className="detail-item">
          <span className="detail-label">Confidence</span>
          <span className="detail-value">{(opportunity.confidence * 100).toFixed(0)}%</span>
        </div>
        <div className="detail-item">
          <span className="detail-label">Volume</span>
          <span className="detail-value">${opportunity.volume.toLocaleString()}</span>
        </div>
      </div>

      {/* ── Reasoning (full mode only) ── */}
      {!compact && opportunity.reasoning && (
        <div className="opp-reasoning">
          {opportunity.reasoning}
        </div>
      )}

      {/* ── Trade toggle button (full mode only) ── */}
      {!compact && (
        <div style={{ marginTop: '8px' }}>
          <button
            className="refresh-btn"
            onClick={handleToggleForm}
            style={{ fontSize: '12px', padding: '4px 10px' }}
          >
            {formState.showOrderForm ? 'Trade \u25b2' : 'Trade \u25bc'}
          </button>
        </div>
      )}

      {/* ── Inline order form (full mode, expanded) ── */}
      {!compact && formState.showOrderForm && (
        <>
          {/* Orderbook display */}
          {orderbookLoading && (
            <div style={{ fontSize: '11px', color: 'var(--muted, #94a3b8)', padding: '8px 0' }}>
              Loading orderbook...
            </div>
          )}
          {orderbook && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '8px',
              marginTop: '8px',
              marginBottom: '8px',
              padding: '8px',
              background: 'var(--surface-2, #1e293b)',
              borderRadius: '6px',
              border: '1px solid var(--border, #334155)',
              fontSize: '11px',
            }}>
              {/* Bids column */}
              <div>
                <div style={{
                  fontWeight: 600,
                  color: 'var(--success, #10b981)',
                  marginBottom: '4px',
                  borderBottom: '1px solid var(--border, #334155)',
                  paddingBottom: '2px',
                }}>
                  Bids
                </div>
                {orderbook.bids.length === 0 ? (
                  <div style={{ color: 'var(--muted, #94a3b8)' }}>No bids</div>
                ) : (
                  orderbook.bids.slice(0, 5).map((bid, i) => (
                    <div key={i} style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '1px 0',
                      color: i === 0 ? 'var(--success, #10b981)' : 'var(--text, #e2e8f0)',
                      fontWeight: i === 0 ? 600 : 400,
                    }}>
                      <span>{(Number(bid.price) * 100).toFixed(1)}¢</span>
                      <span style={{ color: 'var(--muted, #94a3b8)' }}>{Number(bid.size).toLocaleString()}</span>
                    </div>
                  ))
                )}
              </div>
              {/* Asks column */}
              <div>
                <div style={{
                  fontWeight: 600,
                  color: 'var(--danger, #ef4444)',
                  marginBottom: '4px',
                  borderBottom: '1px solid var(--border, #334155)',
                  paddingBottom: '2px',
                }}>
                  Asks
                </div>
                {orderbook.asks.length === 0 ? (
                  <div style={{ color: 'var(--muted, #94a3b8)' }}>No asks</div>
                ) : (
                  orderbook.asks.slice(0, 5).map((ask, i) => (
                    <div key={i} style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '1px 0',
                      color: i === 0 ? 'var(--danger, #ef4444)' : 'var(--text, #e2e8f0)',
                      fontWeight: i === 0 ? 600 : 400,
                    }}>
                      <span>{(Number(ask.price) * 100).toFixed(1)}¢</span>
                      <span style={{ color: 'var(--muted, #94a3b8)' }}>{Number(ask.size).toLocaleString()}</span>
                    </div>
                  ))
                )}
              </div>
              {/* Spread indicator */}
              {orderbook.bids.length > 0 && orderbook.asks.length > 0 && (
                <div style={{
                  gridColumn: '1 / -1',
                  textAlign: 'center',
                  color: 'var(--muted, #94a3b8)',
                  borderTop: '1px solid var(--border, #334155)',
                  paddingTop: '4px',
                  marginTop: '2px',
                }}>
                  Spread: {((Number(orderbook.asks[0].price) - Number(orderbook.bids[0].price)) * 100).toFixed(2)}¢
                </div>
              )}
            </div>
          )}

          <div
            className="order-form"
            style={{
              marginTop: '10px',
              padding: '12px',
              border: '1px solid var(--border, #334155)',
              borderRadius: '6px',
              background: 'var(--surface-2, #1e293b)',
            }}
          >
            {/* Token ID availability notice or manual input */}
            {!tokenIdAvailable && (
            <div style={{ marginBottom: '10px' }}>
              <div
                style={{
                  padding: '6px 8px',
                  background: 'var(--warning-bg, #451a03)',
                  border: '1px solid var(--warning, #f59e0b)',
                  borderRadius: '4px',
                  fontSize: '11px',
                  color: 'var(--warning, #f59e0b)',
                  marginBottom: '6px',
                }}
              >
                Token ID not available from scanner — enter manually.
              </div>
              <div className="filter-group">
                <label style={{ fontSize: '11px' }}>Token ID ({outcomeLabel})</label>
                <input
                  type="text"
                  value={formState.manualTokenId}
                  onChange={(e) => setFormState((prev) => ({ ...prev, manualTokenId: e.target.value }))}
                  placeholder="0x..."
                  style={{ fontFamily: 'monospace', fontSize: '11px', width: '100%' }}
                />
              </div>
            </div>
          )}

          {/* Form rows */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: '8px',
              marginBottom: '8px',
            }}
          >
            {/* Side selector */}
            <div className="filter-group">
              <label style={{ fontSize: '11px' }}>Side</label>
              <div style={{ display: 'flex', gap: '6px', marginTop: '2px' }}>
                {(['BUY', 'SELL'] as const).map((side) => (
                  <label
                    key={side}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      fontSize: '12px',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="radio"
                      name={`side-${opportunity.marketId}`}
                      value={side}
                      checked={formState.orderSide === side}
                      onChange={() => setFormState((prev) => ({ ...prev, orderSide: side }))}
                    />
                    {side}
                  </label>
                ))}
              </div>
            </div>

            {/* Outcome label (informational) */}
            <div className="filter-group">
              <label style={{ fontSize: '11px' }}>Outcome</label>
              <span
                style={{
                  display: 'inline-block',
                  marginTop: '4px',
                  padding: '2px 8px',
                  background: directionColor,
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: 600,
                }}
              >
                {outcomeLabel}
              </span>
            </div>

            {/* Size */}
            <div className="filter-group">
              <label style={{ fontSize: '11px' }}>Size (shares)</label>
              <input
                type="number"
                value={formState.orderSize}
                onChange={(e) => setFormState((prev) => ({ ...prev, orderSize: e.target.value }))}
                min={1}
                step={1}
                style={{ width: '100%' }}
              />
            </div>

            {/* Price */}
            <div className="filter-group">
              <label style={{ fontSize: '11px' }}>Price (0–1)</label>
              <input
                type="number"
                value={formState.orderPrice}
                onChange={(e) => setFormState((prev) => ({ ...prev, orderPrice: e.target.value }))}
                min={0.01}
                max={0.99}
                step={0.01}
                style={{ width: '100%' }}
              />
            </div>
          </div>

          {/* Estimated cost */}
          {estimatedCost !== null && (
            <div style={{ fontSize: '11px', color: 'var(--muted, #94a3b8)', marginBottom: '8px' }}>
              Est. Cost: <strong style={{ color: 'var(--text, #f1f5f9)' }}>${estimatedCost}</strong>
              {' '}({formState.orderSize} shares @ {(parseFloat(formState.orderPrice) * 100).toFixed(1)}¢)
            </div>
          )}

          {/* Result message */}
          {orderResult && (
            <div
              style={{
                padding: '6px 8px',
                borderRadius: '4px',
                fontSize: '11px',
                marginBottom: '8px',
                background: orderResult.ok
                  ? 'var(--success-bg, #052e16)'
                  : 'var(--danger-bg, #2d0505)',
                border: `1px solid ${orderResult.ok ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)'}`,
                color: orderResult.ok ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)',
              }}
            >
              {orderResult.message}
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className="refresh-btn"
              onClick={handlePlaceOrder}
              disabled={orderMutation.isPending}
              style={{
                background: 'var(--success, #10b981)',
                color: '#fff',
                border: 'none',
                padding: '5px 14px',
                fontSize: '12px',
                cursor: orderMutation.isPending ? 'not-allowed' : 'pointer',
                opacity: orderMutation.isPending ? 0.7 : 1,
              }}
            >
              {orderMutation.isPending ? 'Placing...' : 'Place Order'}
            </button>
            <button
              className="refresh-btn"
              onClick={handleCancel}
              disabled={orderMutation.isPending}
              style={{
                fontSize: '12px',
                padding: '5px 14px',
                opacity: orderMutation.isPending ? 0.7 : 1,
              }}
            >
              Cancel
            </button>
          </div>
        </div>
        </>
      )}
    </div>
  );
}
