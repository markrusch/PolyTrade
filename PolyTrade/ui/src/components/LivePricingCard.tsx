import { useState, useEffect } from 'react';
import { useWsChannel } from '../lib/useWsConnection';
import { safeParseFloat, formatPrice, formatPercent } from '../lib/formatters';

interface PricingData {
  fair: string;
  iv: string;
  spot: string;
  strike: string;
  tte: string;
  greeks: {
    delta: string;
    gamma: string;
    theta: string;
    vega: string;
  };
  probAbove: string;
  spread?: string;
}

interface LivePricingCardProps {
  marketQuestion: string;
  tokenId: string;
  marketSlug?: string;
  currentPrice?: number;
}

export default function LivePricingCard({ marketQuestion, tokenId: _tokenId, marketSlug, currentPrice }: LivePricingCardProps) {
  const [pricing, setPricing] = useState<PricingData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [spotPrice, setSpotPrice] = useState<number | null>(null);
  const [iv, setIv] = useState<number | null>(null);

  // Subscribe to live spot price updates
  useWsChannel('spot', (data: any) => {
    if (data.symbol === 'ETHUSDT') {
      setSpotPrice(data.price);
    }
  });

  // Subscribe to live IV updates
  useWsChannel('iv', (data: any) => {
    if (data.asset === 'ETH') {
      setIv(data.iv);
    }
  });

  // Fetch pricing calculation
  const fetchPricing = async () => {
    if (!marketSlug) return;
    
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('http://localhost:3002/api/pricing/bs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: marketSlug })
      });

      if (!response.ok) {
        throw new Error('Failed to fetch pricing');
      }

      const data = await response.json();
      setPricing(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pricing calculation failed');
    } finally {
      setIsLoading(false);
    }
  };

  // Auto-refresh pricing when spot/IV changes
  useEffect(() => {
    if (spotPrice !== null && iv !== null) {
      fetchPricing();
    }
  }, [spotPrice, iv, marketSlug]);

  // Initial fetch
  useEffect(() => {
    fetchPricing();
  }, [marketSlug]);

  const calculateEdge = () => {
    if (!pricing || !currentPrice) return null;
    const fair = parseFloat(pricing.fair);
    const edge = ((currentPrice - fair) / fair) * 100;
    return edge;
  };

  const edge = calculateEdge();

  return (
    <div className="live-pricing-card">
      <div className="card-header">
        <h3>Binary Option Pricing</h3>
        <div className="market-question">{marketQuestion}</div>
      </div>

      {isLoading && !pricing ? (
        <div className="card-loading">Calculating fair value...</div>
      ) : error ? (
        <div className="card-error">
          <span>⚠️</span> {error}
        </div>
      ) : !pricing ? (
        <div className="card-empty">Select a market to view pricing</div>
      ) : (
        <>
          <div className="pricing-grid">
            <div className="pricing-section">
              <h4>Market Data</h4>
              <div className="data-row">
                <span className="label">Spot Price:</span>
                <span className="value spot">${formatPrice(safeParseFloat(pricing.spot))}</span>
              </div>
              <div className="data-row">
                <span className="label">Strike:</span>
                <span className="value">${formatPrice(safeParseFloat(pricing.strike))}</span>
              </div>
              <div className="data-row">
                <span className="label">Implied Vol:</span>
                <span className="value">{pricing.iv}</span>
              </div>
              <div className="data-row">
                <span className="label">Time to Expiry:</span>
                <span className="value">{formatPrice((safeParseFloat(pricing.tte) ?? 0) * 365, 1)} days</span>
              </div>
            </div>

            <div className="pricing-section">
              <h4>Valuation</h4>
              <div className="data-row highlight">
                <span className="label">Fair Value:</span>
                <span className="value fair">{formatPercent(safeParseFloat(pricing.fair))}</span>
              </div>
              {currentPrice !== undefined && (
                <>
                  <div className="data-row">
                    <span className="label">Market Price:</span>
                    <span className="value">{formatPercent(currentPrice)}</span>
                  </div>
                  {edge !== null && (
                    <div className="data-row">
                      <span className="label">Edge:</span>
                      <span className={`value edge ${edge > 0 ? 'overpriced' : 'underpriced'}`}>
                        {edge > 0 ? '+' : ''}{formatPercent(edge / 100)}
                        {edge < -5 ? ' (Buy)' : edge > 5 ? ' (Sell)' : ''}
                      </span>
                    </div>
                  )}
                </>
              )}
              <div className="data-row">
                <span className="label">Probability:</span>
                <span className="value">{formatPercent(safeParseFloat(pricing.probAbove))}</span>
              </div>
            </div>
          </div>

          <div className="greeks-section">
            <h4>Greeks</h4>
            <div className="greeks-grid">
              <div className="greek-item">
                <span className="greek-label">Δ Delta</span>
                <span className="greek-value">{pricing.greeks.delta}</span>
              </div>
              <div className="greek-item">
                <span className="greek-label">Γ Gamma</span>
                <span className="greek-value">{pricing.greeks.gamma}</span>
              </div>
              <div className="greek-item">
                <span className="greek-label">ν Vega</span>
                <span className="greek-value">{pricing.greeks.vega}</span>
              </div>
              <div className="greek-item">
                <span className="greek-label">Θ Theta</span>
                <span className="greek-value">{pricing.greeks.theta}</span>
              </div>
            </div>
          </div>

          <div className="live-feeds">
            <div className="feed-badge">
              <span className="feed-icon">📊</span>
              <span className="feed-label">Binance:</span>
              <span className="feed-value">${spotPrice?.toFixed(2) || '---'}</span>
            </div>
            <div className="feed-badge">
              <span className="feed-icon">📈</span>
              <span className="feed-label">Deribit IV:</span>
              <span className="feed-value">{iv ? `${(iv * 100).toFixed(2)}%` : '---'}</span>
            </div>
          </div>
        </>
      )}

      <style>{`
        .live-pricing-card {
          background: #1e293b;
          border-radius: 8px;
          padding: 16px;
          height: 100%;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .card-header h3 {
          margin: 0 0 8px 0;
          color: #f1f5f9;
          font-size: 16px;
          font-weight: 600;
        }

        .market-question {
          color: #94a3b8;
          font-size: 13px;
          line-height: 1.4;
        }

        .card-loading,
        .card-error,
        .card-empty {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #94a3b8;
          font-size: 14px;
        }

        .card-error {
          color: #f87171;
          gap: 8px;
        }

        .pricing-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }

        .pricing-section h4 {
          margin: 0 0 12px 0;
          color: #cbd5e1;
          font-size: 13px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .data-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 6px 0;
          font-size: 13px;
        }

        .data-row.highlight {
          background: rgba(59, 130, 246, 0.1);
          padding: 8px 12px;
          margin: 0 -12px 8px -12px;
          border-radius: 4px;
        }

        .data-row .label {
          color: #94a3b8;
        }

        .data-row .value {
          color: #e2e8f0;
          font-weight: 600;
        }

        .data-row .value.spot {
          color: #3b82f6;
        }

        .data-row .value.fair {
          color: #22c55e;
          font-size: 15px;
        }

        .data-row .value.edge.underpriced {
          color: #22c55e;
        }

        .data-row .value.edge.overpriced {
          color: #ef4444;
        }

        .greeks-section {
          border-top: 1px solid #334155;
          padding-top: 16px;
        }

        .greeks-section h4 {
          margin: 0 0 12px 0;
          color: #cbd5e1;
          font-size: 13px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .greeks-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 12px;
        }

        .greek-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          background: #0f172a;
          padding: 10px;
          border-radius: 6px;
        }

        .greek-label {
          color: #94a3b8;
          font-size: 11px;
          text-transform: uppercase;
        }

        .greek-value {
          color: #e2e8f0;
          font-size: 14px;
          font-weight: 600;
        }

        .live-feeds {
          display: flex;
          gap: 12px;
          padding-top: 12px;
          border-top: 1px solid #334155;
        }

        .feed-badge {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 6px;
          background: #0f172a;
          padding: 8px 12px;
          border-radius: 6px;
          font-size: 12px;
        }

        .feed-icon {
          font-size: 14px;
        }

        .feed-label {
          color: #94a3b8;
        }

        .feed-value {
          color: #3b82f6;
          font-weight: 600;
          margin-left: auto;
        }
      `}</style>
    </div>
  );
}
