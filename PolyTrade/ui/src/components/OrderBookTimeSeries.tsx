import { memo, useMemo, useState, useCallback } from 'react';
import {
  ComposedChart,
  Line,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

interface OrderBookCandle {
  tokenId: string;
  timeframe: string;
  timestamp: number;
  [key: string]: any;
}

interface OrderBookTimeSeriesProps {
  tokenId: string;
  data: OrderBookCandle[];
  isLoading: boolean;
  isFetching?: boolean;
  isError?: boolean;
  levelDepth: number;
  onLevelDepthChange: (depth: number) => void;
  timeframe?: '1m' | '5m' | '10m' | '15m' | '30m' | '1h' | '4h';
  onTimeframeChange?: (tf: '1m' | '5m' | '10m' | '15m' | '30m' | '1h' | '4h') => void;
  refreshInterval?: number;
  onRefreshIntervalChange?: (interval: number) => void;
}

const BID_COLORS = ['#22c55e', '#16a34a', '#15803d', '#166534', '#14532d', '#052e16', '#064e3b', '#065f46', '#047857', '#059669'];
const ASK_COLORS = ['#ef4444', '#dc2626', '#b91c1c', '#991b1b', '#7f1d1d', '#450a0a', '#7c2d12', '#9a3412', '#c2410c', '#ea580c'];
const MID_PRICE_COLOR = '#6366f1';
const SPREAD_COLOR = 'rgba(99, 102, 241, 0.15)';

type ViewType = 'prices' | 'midSpread' | 'volumes' | 'combined';

const TIMEFRAMES = [
  { value: '1m', label: '1m' },
  { value: '5m', label: '5m' },
  { value: '10m', label: '10m' },
  { value: '15m', label: '15m' },
  { value: '30m', label: '30m' },
  { value: '1h', label: '1h' },
  { value: '4h', label: '4h' },
] as const;

export const OrderBookTimeSeries = memo(function OrderBookTimeSeries({
  tokenId,
  data,
  isLoading,
  isFetching = false,
  isError = false,
  levelDepth,
  onLevelDepthChange,
  timeframe = '5m',
  onTimeframeChange,
  refreshInterval = 30,
  onRefreshIntervalChange,
}: OrderBookTimeSeriesProps) {
  const [viewType, setViewType] = useState<ViewType>('midSpread');
  const [showVolumeBars, setShowVolumeBars] = useState(false);

  // Process chart data with mid-price and spread calculations
  const { chartData, yDomain, avgMid, avgSpread } = useMemo(() => {
    if (!data || data.length === 0) {
      return { chartData: [], yDomain: [0, 1] as [number, number], avgMid: null, avgSpread: null };
    }

    let minPrice = Infinity;
    let maxPrice = -Infinity;
    let totalMid = 0;
    let totalSpread = 0;
    let validPoints = 0;

    const processed = data.map((candle) => {
      const point: any = {
        timestamp: candle.timestamp,
        time: new Date(candle.timestamp).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      };

      // Extract all levels
      for (let i = 1; i <= levelDepth; i++) {
        const bidPrice = Number(candle[`bid${i}Price`]) || 0;
        const bidSize = Number(candle[`bid${i}Size`]) || 0;
        const askPrice = Number(candle[`ask${i}Price`]) || 0;
        const askSize = Number(candle[`ask${i}Size`]) || 0;

        if (bidPrice > 0) {
          point[`bid${i}`] = bidPrice;
          point[`bidVol${i}`] = bidSize;
          if (bidPrice < minPrice) minPrice = bidPrice;
          if (bidPrice > maxPrice) maxPrice = bidPrice;
        }
        if (askPrice > 0) {
          point[`ask${i}`] = askPrice;
          point[`askVol${i}`] = askSize;
          if (askPrice < minPrice) minPrice = askPrice;
          if (askPrice > maxPrice) maxPrice = askPrice;
        }
      }

      // Calculate mid-price and spread from best bid/ask
      const bid1 = Number(candle.bid1Price) || 0;
      const ask1 = Number(candle.ask1Price) || 0;

      if (bid1 > 0 && ask1 > 0) {
        const mid = (bid1 + ask1) / 2;
        const spread = ask1 - bid1;
        const spreadPct = (spread / mid) * 100;

        point.midPrice = mid;
        point.spread = spread;
        point.spreadPct = spreadPct;
        // For area chart showing spread band
        point.spreadBand = [bid1, ask1];

        totalMid += mid;
        totalSpread += spreadPct;
        validPoints++;
      }

      // Total volume at this point
      let totalBidVol = 0;
      let totalAskVol = 0;
      for (let i = 1; i <= levelDepth; i++) {
        totalBidVol += Number(candle[`bid${i}Size`]) || 0;
        totalAskVol += Number(candle[`ask${i}Size`]) || 0;
      }
      point.totalBidVol = totalBidVol;
      point.totalAskVol = totalAskVol;

      return point;
    });

    // Calculate Y-axis domain with padding
    const padding = (maxPrice - minPrice) * 0.1 || 0.01;
    const domain: [number, number] = [
      Math.max(0, minPrice - padding),
      maxPrice + padding,
    ];

    return {
      chartData: processed,
      yDomain: domain,
      avgMid: validPoints > 0 ? totalMid / validPoints : null,
      avgSpread: validPoints > 0 ? totalSpread / validPoints : null,
    };
  }, [data, levelDepth]);

  // Format price for display
  const formatPrice = useCallback((v: number) => {
    if (!Number.isFinite(v)) return '';
    return `$${v.toFixed(4)}`;
  }, []);

  // Format volume for display
  const formatVolume = useCallback((v: number) => {
    if (!Number.isFinite(v)) return '';
    if (v >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
    if (v >= 1000) return `${(v / 1000).toFixed(1)}K`;
    return v.toFixed(0);
  }, []);

  // Custom tooltip content
  const CustomTooltip = useCallback(({ active, payload, label }: any) => {
    if (!active || !payload || payload.length === 0) return null;

    const dataPoint = payload[0]?.payload;
    if (!dataPoint) return null;

    return (
      <div className="custom-tooltip">
        <div className="tooltip-header">{label}</div>
        {dataPoint.midPrice && (
          <div className="tooltip-row mid">
            <span className="label">Mid:</span>
            <span className="value">${dataPoint.midPrice.toFixed(4)}</span>
          </div>
        )}
        {dataPoint.spread && (
          <div className="tooltip-row spread">
            <span className="label">Spread:</span>
            <span className="value">
              ${dataPoint.spread.toFixed(4)} ({dataPoint.spreadPct.toFixed(2)}%)
            </span>
          </div>
        )}
        {viewType === 'prices' || viewType === 'combined' ? (
          <>
            <div className="tooltip-row bid">
              <span className="label">Best Bid:</span>
              <span className="value">${dataPoint.bid1?.toFixed(4) || '-'}</span>
            </div>
            <div className="tooltip-row ask">
              <span className="label">Best Ask:</span>
              <span className="value">${dataPoint.ask1?.toFixed(4) || '-'}</span>
            </div>
          </>
        ) : null}
        {(viewType === 'volumes' || viewType === 'combined' || showVolumeBars) && (
          <>
            <div className="tooltip-row bid-vol">
              <span className="label">Bid Vol:</span>
              <span className="value">{formatVolume(dataPoint.totalBidVol)}</span>
            </div>
            <div className="tooltip-row ask-vol">
              <span className="label">Ask Vol:</span>
              <span className="value">{formatVolume(dataPoint.totalAskVol)}</span>
            </div>
          </>
        )}
      </div>
    );
  }, [viewType, showVolumeBars, formatVolume]);

  if (!tokenId) {
    return (
      <div className="panel timeseries-panel">
        <div className="panel-header">
          <h3>Order Book Time Series</h3>
        </div>
        <div className="panel-body empty">Select a market to view price evolution</div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="panel timeseries-panel">
        <div className="panel-header">
          <h3>Order Book Time Series</h3>
        </div>
        <div className="panel-body loading">
          <div className="spinner" />
          <p>Loading time series data...</p>
        </div>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="panel timeseries-panel">
        <div className="panel-header">
          <h3>Order Book Time Series</h3>
        </div>
        <div className="panel-body empty">
          <p>Waiting for first candle...</p>
          <p className="hint">Time-series data will appear after the current candle completes</p>
        </div>
      </div>
    );
  }

  return (
    <div className="panel timeseries-panel">
      <div className="panel-header">
        <h3>
          Order Book Time Series
          {isFetching && !isLoading && <span className="refreshing-indicator">⟳</span>}
        </h3>
        <div className="chart-controls">
          {/* Timeframe selector */}
          {onTimeframeChange && (
            <div className="control-group">
              <label>Timeframe:</label>
              <div className="timeframe-toggle">
                {TIMEFRAMES.map((tf) => (
                  <button
                    key={tf.value}
                    className={timeframe === tf.value ? 'active' : ''}
                    onClick={() => onTimeframeChange(tf.value)}
                  >
                    {tf.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="control-group">
            <label>Depth:</label>
            <select
              value={levelDepth}
              onChange={(e) => onLevelDepthChange(Number(e.target.value))}
              className="depth-selector"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <option key={n} value={n}>
                  {n} level{n > 1 ? 's' : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="control-group">
            <label>Refresh:</label>
            <select
              value={refreshInterval}
              onChange={(e) => onRefreshIntervalChange?.(Number(e.target.value))}
              className="refresh-selector"
              disabled={!onRefreshIntervalChange}
            >
              <option value={15}>15s</option>
              <option value={30}>30s</option>
              <option value={45}>45s</option>
              <option value={60}>1m</option>
              <option value={90}>1.5m</option>
            </select>
          </div>
          <div className="control-group">
            <label>View:</label>
            <div className="view-toggle">
              <button
                className={viewType === 'midSpread' ? 'active' : ''}
                onClick={() => setViewType('midSpread')}
                title="Mid-price with spread band"
              >
                Mid
              </button>
              <button
                className={viewType === 'prices' ? 'active' : ''}
                onClick={() => setViewType('prices')}
                title="All price levels"
              >
                Levels
              </button>
              <button
                className={viewType === 'volumes' ? 'active' : ''}
                onClick={() => setViewType('volumes')}
                title="Volume only"
              >
                Vol
              </button>
              <button
                className={viewType === 'combined' ? 'active' : ''}
                onClick={() => setViewType('combined')}
                title="Mid-price with volume bars"
              >
                Both
              </button>
            </div>
          </div>
          {(viewType === 'prices' || viewType === 'midSpread') && (
            <div className="control-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={showVolumeBars}
                  onChange={(e) => setShowVolumeBars(e.target.checked)}
                />
                Vol Bars
              </label>
            </div>
          )}
        </div>
      </div>

      {/* Stats bar */}
      <div className="stats-bar">
        {avgMid !== null && (
          <div className="stat">
            <span className="stat-label">Avg Mid:</span>
            <span className="stat-value mid">${avgMid.toFixed(4)}</span>
          </div>
        )}
        {avgSpread !== null && (
          <div className="stat">
            <span className="stat-label">Avg Spread:</span>
            <span className="stat-value">{avgSpread.toFixed(3)}%</span>
          </div>
        )}
        <div className="stat">
          <span className="stat-label">Candles:</span>
          <span className="stat-value">{data.length}</span>
        </div>
        {isError && <span className="error-badge">Error - showing cached</span>}
      </div>

      <div className="panel-body">
        <ResponsiveContainer width="100%" height={380}>
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            <XAxis
              dataKey="time"
              stroke="#94a3b8"
              style={{ fontSize: '11px' }}
              interval="preserveStartEnd"
            />
            <YAxis
              yAxisId="price"
              stroke="#94a3b8"
              style={{ fontSize: '11px' }}
              tickFormatter={formatPrice}
              domain={viewType === 'volumes' ? [0, 'auto'] : yDomain}
              hide={viewType === 'volumes'}
            />
            {(viewType === 'volumes' || viewType === 'combined' || showVolumeBars) && (
              <YAxis
                yAxisId="volume"
                orientation="right"
                stroke="#64748b"
                style={{ fontSize: '10px' }}
                tickFormatter={formatVolume}
                domain={[0, 'auto']}
              />
            )}
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />

            {/* Mid-price view: Spread band + mid-price line */}
            {(viewType === 'midSpread' || viewType === 'combined') && (
              <>
                {/* Spread band (area between bid1 and ask1) */}
                <Area
                  yAxisId="price"
                  dataKey="bid1"
                  stackId="spread"
                  stroke="none"
                  fill="transparent"
                  isAnimationActive={false}
                />
                <Area
                  yAxisId="price"
                  dataKey="ask1"
                  stroke="none"
                  fill={SPREAD_COLOR}
                  isAnimationActive={false}
                  name="Spread"
                />
                {/* Mid-price line */}
                <Line
                  yAxisId="price"
                  type="monotone"
                  dataKey="midPrice"
                  stroke={MID_PRICE_COLOR}
                  strokeWidth={2}
                  dot={false}
                  name="Mid Price"
                  isAnimationActive={false}
                  connectNulls
                />
                {/* Average mid reference line */}
                {avgMid !== null && (
                  <ReferenceLine
                    yAxisId="price"
                    y={avgMid}
                    stroke={MID_PRICE_COLOR}
                    strokeDasharray="5 5"
                    strokeOpacity={0.5}
                  />
                )}
              </>
            )}

            {/* Prices view: All bid/ask levels */}
            {viewType === 'prices' &&
              Array.from({ length: levelDepth }, (_, i) => i + 1).map((level) => (
                <Line
                  key={`bid${level}`}
                  yAxisId="price"
                  type="monotone"
                  dataKey={`bid${level}`}
                  stroke={BID_COLORS[level - 1]}
                  strokeWidth={level === 1 ? 2 : 1}
                  opacity={level === 1 ? 1 : 0.3 + (0.7 / levelDepth) * (levelDepth - level + 1)}
                  dot={false}
                  name={`Bid ${level}`}
                  isAnimationActive={false}
                  connectNulls
                />
              ))}
            {viewType === 'prices' &&
              Array.from({ length: levelDepth }, (_, i) => i + 1).map((level) => (
                <Line
                  key={`ask${level}`}
                  yAxisId="price"
                  type="monotone"
                  dataKey={`ask${level}`}
                  stroke={ASK_COLORS[level - 1]}
                  strokeWidth={level === 1 ? 2 : 1}
                  opacity={level === 1 ? 1 : 0.3 + (0.7 / levelDepth) * (levelDepth - level + 1)}
                  dot={false}
                  name={`Ask ${level}`}
                  isAnimationActive={false}
                  connectNulls
                />
              ))}

            {/* Volume bars overlay */}
            {(viewType === 'volumes' || viewType === 'combined' || showVolumeBars) && (
              <>
                <Bar
                  yAxisId="volume"
                  dataKey="totalBidVol"
                  fill={BID_COLORS[0]}
                  fillOpacity={0.4}
                  name="Bid Volume"
                  isAnimationActive={false}
                />
                <Bar
                  yAxisId="volume"
                  dataKey="totalAskVol"
                  fill={ASK_COLORS[0]}
                  fillOpacity={0.4}
                  name="Ask Volume"
                  isAnimationActive={false}
                />
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <style>{`
        .timeseries-panel .panel-header {
          flex-wrap: wrap;
          gap: 12px;
        }

        .chart-controls {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          align-items: center;
        }

        .control-group {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .control-group label {
          font-size: 11px;
          color: var(--text-secondary, #a0a0b0);
          text-transform: uppercase;
        }

        .control-group select {
          padding: 4px 8px;
          background: var(--bg-tertiary, #252538);
          border: 1px solid var(--border, #2d2d44);
          border-radius: 4px;
          color: var(--text-primary, #fff);
          font-size: 12px;
        }

        .timeframe-toggle,
        .view-toggle {
          display: flex;
          background: var(--bg-tertiary, #252538);
          border-radius: 4px;
          overflow: hidden;
        }

        .timeframe-toggle button,
        .view-toggle button {
          padding: 4px 8px;
          background: transparent;
          border: none;
          color: var(--text-secondary, #a0a0b0);
          font-size: 11px;
          cursor: pointer;
          transition: all 0.15s;
        }

        .timeframe-toggle button:hover,
        .view-toggle button:hover {
          background: rgba(255, 255, 255, 0.05);
        }

        .timeframe-toggle button.active,
        .view-toggle button.active {
          background: var(--accent, #6366f1);
          color: #fff;
        }

        .checkbox-label {
          display: flex;
          align-items: center;
          gap: 4px;
          cursor: pointer;
        }

        .checkbox-label input {
          accent-color: var(--accent, #6366f1);
        }

        .stats-bar {
          display: flex;
          gap: 16px;
          padding: 8px 16px;
          background: var(--bg-tertiary, #252538);
          border-top: 1px solid var(--border, #2d2d44);
          font-size: 12px;
        }

        .stat {
          display: flex;
          gap: 6px;
          align-items: center;
        }

        .stat-label {
          color: var(--text-secondary, #a0a0b0);
        }

        .stat-value {
          font-family: 'SF Mono', Monaco, monospace;
          color: var(--text-primary, #fff);
        }

        .stat-value.mid {
          color: var(--accent, #6366f1);
          font-weight: 600;
        }

        .custom-tooltip {
          background: var(--bg-primary, #0f172a);
          border: 1px solid var(--border, #334155);
          border-radius: 6px;
          padding: 10px 12px;
          font-size: 12px;
        }

        .tooltip-header {
          font-weight: 600;
          color: var(--text-primary, #fff);
          margin-bottom: 8px;
          padding-bottom: 6px;
          border-bottom: 1px solid var(--border, #334155);
        }

        .tooltip-row {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          padding: 2px 0;
        }

        .tooltip-row .label {
          color: var(--text-secondary, #a0a0b0);
        }

        .tooltip-row .value {
          font-family: 'SF Mono', Monaco, monospace;
          color: var(--text-primary, #fff);
        }

        .tooltip-row.mid .value {
          color: var(--accent, #6366f1);
          font-weight: 600;
        }

        .tooltip-row.bid .value,
        .tooltip-row.bid-vol .value {
          color: var(--success, #22c55e);
        }

        .tooltip-row.ask .value,
        .tooltip-row.ask-vol .value {
          color: var(--danger, #ef4444);
        }

        .tooltip-row.spread .value {
          color: var(--warning, #f59e0b);
        }

        .refreshing-indicator {
          display: inline-block;
          margin-left: 8px;
          animation: spin 1s linear infinite;
          color: var(--accent, #6366f1);
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .error-badge {
          color: var(--danger, #ef4444);
          font-size: 11px;
        }

        .timeseries-panel .panel-body.empty,
        .timeseries-panel .panel-body.loading {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 300px;
          color: var(--text-secondary, #a0a0b0);
        }

        .hint {
          font-size: 12px;
          color: var(--text-tertiary, #6b6b80);
        }
      `}</style>
    </div>
  );
});
