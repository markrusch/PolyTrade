import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { WinRateByPrice } from '../../lib/api';

interface WinRateChartProps {
  tag?: string;
}

export function WinRateChart({ tag }: WinRateChartProps = {}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['win-rate-analysis', tag ?? 'all'],
    queryFn: () => api.getTradeBasedWinRate(tag),
    refetchInterval: 60000,
    staleTime: 30000,
  });

  if (isLoading) {
    return (
      <div className="panel win-rate-chart">
        <div className="panel-header">
          <h2>Market Calibration</h2>
        </div>
        <div className="panel-body loading-state">
          <div className="spinner" />
          <span>Loading analysis...</span>
        </div>
      </div>
    );
  }

  if (error || !data?.success) {
    return (
      <div className="panel win-rate-chart">
        <div className="panel-header">
          <h2>Market Calibration</h2>
        </div>
        <div className="panel-body error-state">
          <span>Error loading analysis</span>
          <small>Run a sync first to populate data</small>
        </div>
      </div>
    );
  }

  const winRates = data.data || [];

  // Filter to significant price points (every 5 cents with enough samples)
  const significantPoints = winRates.filter(
    (w) => w.pricePoint % 5 === 0 && w.sampleSize >= 5
  );

  // Calculate max overconfidence for scaling
  const maxOverconfidence = Math.max(
    ...significantPoints.map((w) => Math.abs(w.overconfidence)),
    0.1
  );

  return (
    <div className="panel win-rate-chart">
      <div className="panel-header">
        <h2>Market Calibration</h2>
        <span className="subtitle">
          Trade-level calibration{tag ? ` (${tag})` : ''} — do prices at X¢ win X% of the time?
        </span>
      </div>
      <div className="panel-body">
        {winRates.length === 0 ? (
          <div className="empty-state">
            <p>No trade data available for calibration analysis.</p>
            <small>Run a category sync with "Include Resolved" enabled to populate trade-level data.</small>
          </div>
        ) : (
          <>
            <div className="calibration-summary">
              <div className="summary-stat">
                <span className="label">Total Samples</span>
                <span className="value">{data.summary.totalSamples.toLocaleString()}</span>
              </div>
              <div className="summary-stat">
                <span className="label">Avg Overconfidence</span>
                <span className={`value ${data.summary.avgOverconfidence > 0 ? 'positive' : 'negative'}`}>
                  {(data.summary.avgOverconfidence * 100).toFixed(2)}%
                </span>
              </div>
            </div>

            <div className="calibration-chart">
              {significantPoints.map((point) => (
                <CalibrationBar
                  key={point.pricePoint}
                  data={point}
                  maxOverconfidence={maxOverconfidence}
                />
              ))}
            </div>

            <div className="chart-legend">
              <span className="legend-item">
                <span className="legend-color positive" />
                Underpriced (actual {'>'} expected)
              </span>
              <span className="legend-item">
                <span className="legend-color negative" />
                Overpriced (actual {'<'} expected)
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CalibrationBar({
  data,
  maxOverconfidence,
}: {
  data: WinRateByPrice;
  maxOverconfidence: number;
}) {
  const isPositive = data.overconfidence > 0;
  const barWidth = Math.abs(data.overconfidence / maxOverconfidence) * 50;

  return (
    <div className="calibration-row">
      <span className="price-label">{data.pricePoint}¢</span>
      <div className="bar-container">
        <div className="bar-center" />
        <div
          className={`bar-fill ${isPositive ? 'positive' : 'negative'}`}
          style={{
            width: `${barWidth}%`,
            [isPositive ? 'left' : 'right']: '50%',
          }}
        />
      </div>
      <span className="overconfidence-label">
        {isPositive ? '+' : ''}{(data.overconfidence * 100).toFixed(1)}%
      </span>
      <span className="sample-size">n={data.sampleSize}</span>
    </div>
  );
}
