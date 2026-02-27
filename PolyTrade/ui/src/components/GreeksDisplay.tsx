import { memo, useMemo } from 'react';
import { usePricingData } from '../lib/hooks';
import { formatPrice } from '../lib/formatters';

interface GreeksDisplayProps {
  tokenId: string | null;
  compact?: boolean;
}

interface GreekItemProps {
  label: string;
  value: number | null | undefined;
  format: 'decimal' | 'percent' | 'currency';
  suffix?: string;
  description?: string;
  direction?: 'positive' | 'negative' | 'neutral';
}

const GreekItem = memo(function GreekItem({
  label,
  value,
  format,
  suffix = '',
  description,
  direction = 'neutral',
}: GreekItemProps) {
  const formattedValue = useMemo(() => {
    if (value === null || value === undefined || isNaN(value)) return '-';

    switch (format) {
      case 'percent':
        return `${(value * 100).toFixed(2)}%`;
      case 'currency':
        return `$${value.toFixed(4)}`;
      case 'decimal':
      default:
        return value.toFixed(4);
    }
  }, [value, format]);

  const colorClass = useMemo(() => {
    if (value === null || value === undefined) return '';
    if (direction === 'positive') return value > 0 ? 'positive' : value < 0 ? 'negative' : '';
    if (direction === 'negative') return value < 0 ? 'positive' : value > 0 ? 'negative' : '';
    return '';
  }, [value, direction]);

  return (
    <div className={`greek-item ${colorClass}`} title={description}>
      <span className="greek-label">{label}</span>
      <span className="greek-value">
        {formattedValue}
        {suffix && <span className="greek-suffix">{suffix}</span>}
      </span>
    </div>
  );
});

export const GreeksDisplay = memo(function GreeksDisplay({ tokenId, compact = false }: GreeksDisplayProps) {
  const { data: pricingData, isLoading, isError } = usePricingData(tokenId);

  const greeks = pricingData?.greeks;
  const fairPrice = pricingData?.fairPrice;
  const edge = pricingData?.edge;
  const spotPrice = pricingData?.spotPrice ?? pricingData?.spot;
  const iv = pricingData?.impliedVolatility ?? pricingData?.iv;
  const strike = pricingData?.strike;

  if (!tokenId) {
    return (
      <div className="greeks-display empty">
        <p>Select a market to view Greeks</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="greeks-display loading">
        <div className="spinner" />
        <p>Loading pricing data...</p>
      </div>
    );
  }

  if (isError || !pricingData?.success) {
    return (
      <div className="greeks-display error">
        <p>Market not wired to pricing</p>
        <p className="hint">Use Market Discovery to wire this market</p>
      </div>
    );
  }

  if (compact) {
    return (
      <div className="greeks-display compact">
        <div className="greeks-row">
          <GreekItem
            label="Delta"
            value={greeks?.delta}
            format="decimal"
            direction="positive"
            description="Price sensitivity to spot movement"
          />
          <GreekItem
            label="Gamma"
            value={greeks?.gamma}
            format="decimal"
            description="Rate of delta change"
          />
          <GreekItem
            label="Vega"
            value={greeks?.vega}
            format="decimal"
            suffix="/1%"
            description="Sensitivity to IV (per 1% move)"
          />
          <GreekItem
            label="Theta"
            value={greeks?.theta}
            format="decimal"
            suffix="/day"
            direction="negative"
            description="Time decay per day"
          />
        </div>
        <style>{compactStyles}</style>
      </div>
    );
  }

  return (
    <div className="greeks-display full">
      <div className="greeks-header">
        <h3>Pricing & Greeks</h3>
        <span className={`status-badge ${pricingData?.status || 'unknown'}`}>
          {pricingData?.status || 'unknown'}
        </span>
      </div>

      <div className="pricing-summary">
        <div className="pricing-item main">
          <span className="label">Fair Value</span>
          <span className="value">{fairPrice !== null ? `${(fairPrice! * 100).toFixed(2)}%` : '-'}</span>
        </div>
        {edge !== null && edge !== undefined && (
          <div className={`pricing-item edge ${edge > 0 ? 'positive' : edge < 0 ? 'negative' : ''}`}>
            <span className="label">Edge</span>
            <span className="value">{(edge * 100).toFixed(2)}%</span>
          </div>
        )}
      </div>

      <div className="market-inputs">
        <div className="input-item">
          <span className="label">Spot</span>
          <span className="value">${spotPrice?.toLocaleString() ?? '-'}</span>
        </div>
        <div className="input-item">
          <span className="label">Strike</span>
          <span className="value">${strike?.toLocaleString() ?? '-'}</span>
        </div>
        <div className="input-item">
          <span className="label">IV</span>
          <span className="value">{iv ? `${(iv * 100).toFixed(1)}%` : '-'}</span>
        </div>
      </div>

      <div className="greeks-section">
        <h4>Option Greeks</h4>
        <div className="greeks-grid">
          <GreekItem
            label="Delta"
            value={greeks?.delta}
            format="decimal"
            direction="positive"
            description="Price change per $1 spot move. Positive = bullish exposure."
          />
          <GreekItem
            label="Gamma"
            value={greeks?.gamma}
            format="decimal"
            description="Rate at which delta changes. Higher = more convexity."
          />
          <GreekItem
            label="Vega"
            value={greeks?.vega}
            format="decimal"
            suffix="/1%"
            description="Price change per 1% IV move."
          />
          <GreekItem
            label="Theta"
            value={greeks?.theta}
            format="decimal"
            suffix="/day"
            direction="negative"
            description="Daily time decay. Usually negative for long positions."
          />
          {greeks?.charm !== undefined && (
            <GreekItem
              label="Charm"
              value={greeks.charm}
              format="decimal"
              suffix="/day"
              description="Rate at which delta decays over time."
            />
          )}
          {greeks?.vanna !== undefined && (
            <GreekItem
              label="Vanna"
              value={greeks.vanna}
              format="decimal"
              description="Cross-sensitivity of delta to volatility."
            />
          )}
        </div>
      </div>

      <div className="greeks-interpretation">
        <h4>Interpretation</h4>
        <ul>
          {greeks?.delta !== undefined && greeks.delta !== null && spotPrice && (
            <li>
              <strong>Delta {greeks.delta > 0 ? '(Bullish)' : '(Bearish)'}</strong>:
              {' '}A ${formatPrice(Math.abs(spotPrice * 0.01), 0)} spot move ({spotPrice > 0 ? '1%' : ''})
              changes position by ~{formatPrice(Math.abs(greeks.delta * spotPrice * 0.01 * 100))}%
            </li>
          )}
          {greeks?.vega !== undefined && greeks.vega !== null && (
            <li>
              <strong>Vega</strong>:
              {' '}A 1% IV change moves position by ~{formatPrice(Math.abs(greeks.vega * 100))}%
            </li>
          )}
          {greeks?.theta !== undefined && greeks.theta !== null && (
            <li>
              <strong>Theta</strong>:
              {' '}Position loses ~{Math.abs(greeks.theta * 100).toFixed(3)}% per day to time decay
            </li>
          )}
        </ul>
      </div>

      {pricingData?.lastUpdate && (
        <div className="last-update">
          Updated: {new Date(pricingData.lastUpdate).toLocaleTimeString()}
        </div>
      )}

      <style>{fullStyles}</style>
    </div>
  );
});

const compactStyles = `
  .greeks-display.compact {
    padding: 8px 12px;
    background: var(--bg-tertiary, #252538);
    border-radius: 6px;
  }

  .greeks-display.compact .greeks-row {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
  }

  .greeks-display.compact .greek-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .greeks-display.compact .greek-label {
    font-size: 10px;
    text-transform: uppercase;
    color: var(--text-secondary, #a0a0b0);
  }

  .greeks-display.compact .greek-value {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary, #fff);
    font-family: 'SF Mono', Monaco, monospace;
  }

  .greeks-display.compact .greek-suffix {
    font-size: 10px;
    color: var(--text-secondary, #a0a0b0);
    margin-left: 2px;
  }

  .greeks-display.compact .greek-item.positive .greek-value {
    color: var(--success, #10b981);
  }

  .greeks-display.compact .greek-item.negative .greek-value {
    color: var(--danger, #ef4444);
  }
`;

const fullStyles = `
  .greeks-display {
    background: var(--bg-secondary, #1a1a2e);
    border: 1px solid var(--border, #2d2d44);
    border-radius: 8px;
    padding: 16px;
  }

  .greeks-display.empty,
  .greeks-display.loading,
  .greeks-display.error {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 200px;
    color: var(--text-secondary, #a0a0b0);
    text-align: center;
  }

  .greeks-display .spinner {
    width: 24px;
    height: 24px;
    border: 2px solid var(--border, #2d2d44);
    border-top-color: var(--accent, #6366f1);
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin-bottom: 12px;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .greeks-display .hint {
    font-size: 12px;
    margin-top: 8px;
    opacity: 0.7;
  }

  .greeks-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
  }

  .greeks-header h3 {
    margin: 0;
    font-size: 16px;
    color: var(--text-primary, #fff);
  }

  .status-badge {
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 11px;
    text-transform: uppercase;
    font-weight: 600;
  }

  .status-badge.active {
    background: rgba(16, 185, 129, 0.2);
    color: var(--success, #10b981);
  }

  .status-badge.stale {
    background: rgba(245, 158, 11, 0.2);
    color: var(--warning, #f59e0b);
  }

  .status-badge.error {
    background: rgba(239, 68, 68, 0.2);
    color: var(--danger, #ef4444);
  }

  .pricing-summary {
    display: flex;
    gap: 24px;
    margin-bottom: 16px;
    padding: 12px;
    background: var(--bg-tertiary, #252538);
    border-radius: 6px;
  }

  .pricing-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .pricing-item .label {
    font-size: 11px;
    text-transform: uppercase;
    color: var(--text-secondary, #a0a0b0);
  }

  .pricing-item .value {
    font-size: 20px;
    font-weight: 700;
    color: var(--text-primary, #fff);
    font-family: 'SF Mono', Monaco, monospace;
  }

  .pricing-item.edge.positive .value {
    color: var(--success, #10b981);
  }

  .pricing-item.edge.negative .value {
    color: var(--danger, #ef4444);
  }

  .market-inputs {
    display: flex;
    gap: 16px;
    margin-bottom: 16px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--border, #2d2d44);
  }

  .input-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .input-item .label {
    font-size: 10px;
    text-transform: uppercase;
    color: var(--text-secondary, #a0a0b0);
  }

  .input-item .value {
    font-size: 14px;
    color: var(--text-primary, #fff);
    font-family: 'SF Mono', Monaco, monospace;
  }

  .greeks-section h4 {
    margin: 0 0 12px 0;
    font-size: 13px;
    color: var(--text-secondary, #a0a0b0);
    text-transform: uppercase;
  }

  .greeks-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
    gap: 12px;
  }

  .greek-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px;
    background: var(--bg-tertiary, #252538);
    border-radius: 6px;
    cursor: help;
  }

  .greek-label {
    font-size: 11px;
    text-transform: uppercase;
    color: var(--text-secondary, #a0a0b0);
  }

  .greek-value {
    font-size: 15px;
    font-weight: 600;
    color: var(--text-primary, #fff);
    font-family: 'SF Mono', Monaco, monospace;
  }

  .greek-suffix {
    font-size: 10px;
    color: var(--text-secondary, #a0a0b0);
    margin-left: 2px;
  }

  .greek-item.positive .greek-value {
    color: var(--success, #10b981);
  }

  .greek-item.negative .greek-value {
    color: var(--danger, #ef4444);
  }

  .greeks-interpretation {
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid var(--border, #2d2d44);
  }

  .greeks-interpretation h4 {
    margin: 0 0 8px 0;
    font-size: 13px;
    color: var(--text-secondary, #a0a0b0);
    text-transform: uppercase;
  }

  .greeks-interpretation ul {
    margin: 0;
    padding-left: 20px;
  }

  .greeks-interpretation li {
    font-size: 12px;
    color: var(--text-secondary, #a0a0b0);
    margin-bottom: 6px;
    line-height: 1.5;
  }

  .greeks-interpretation strong {
    color: var(--text-primary, #fff);
  }

  .last-update {
    margin-top: 16px;
    font-size: 11px;
    color: var(--text-tertiary, #6b6b80);
    text-align: right;
  }
`;
