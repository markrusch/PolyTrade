import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { CalibrationBucket } from '../../lib/api';

interface LongshotBiasPanelProps {
  compact?: boolean;
}

export function LongshotBiasPanel({ compact }: LongshotBiasPanelProps) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['calibration-data'],
    queryFn: () => api.getCalibrationData(),
    refetchInterval: 120000, // Refresh every 2 minutes
    staleTime: 60000, // 1 minute stale time
  });

  if (isLoading) {
    return (
      <div className={`panel longshot-bias-panel ${compact ? 'compact' : ''}`}>
        <div className="panel-header">
          <h2>Longshot Bias Analysis</h2>
        </div>
        <div className="panel-body loading-state">
          <div className="spinner" />
          <span>Analyzing market calibration...</span>
        </div>
      </div>
    );
  }

  if (error || !data?.success) {
    return (
      <div className={`panel longshot-bias-panel ${compact ? 'compact' : ''}`}>
        <div className="panel-header">
          <h2>Longshot Bias Analysis</h2>
        </div>
        <div className="panel-body error-state">
          <span>Error loading calibration data</span>
          <small>Run a data sync first to populate resolved market data</small>
        </div>
      </div>
    );
  }

  const { summary, overconfidentBuckets, underconfidentBuckets } = data.data;

  return (
    <div className={`panel longshot-bias-panel ${compact ? 'compact' : ''}`}>
      <div className="panel-header">
        <h2>Longshot Bias Analysis</h2>
        <span className={`bias-indicator ${summary.hasLongshotBias ? 'detected' : 'none'}`}>
          {summary.hasLongshotBias ? 'BIAS DETECTED' : 'NO SIGNIFICANT BIAS'}
        </span>
      </div>

      {/* Key Insight Box */}
      <div className={`insight-box ${summary.hasLongshotBias ? 'warning' : 'info'}`}>
        <div className="insight-icon">{summary.hasLongshotBias ? '!' : 'i'}</div>
        <div className="insight-text">
          <strong>{summary.biasInterpretation}</strong>
          {summary.hasLongshotBias && (
            <p>
              Consider SELLING cheap contracts ({'<'}20 cents) or BUYING expensive
              ones ({'>'}80 cents) to exploit this bias.
            </p>
          )}
        </div>
      </div>

      {/* Summary Stats */}
      <div className="bias-summary">
        <div className="summary-stat">
          <span className="stat-value">{summary.totalSamples.toLocaleString()}</span>
          <span className="stat-label">Resolved Markets</span>
        </div>
        <div className="summary-stat">
          <span className={`stat-value ${summary.avgOverconfidence > 0 ? 'positive' : 'negative'}`}>
            {summary.avgOverconfidence > 0 ? '+' : ''}
            {(summary.avgOverconfidence * 100).toFixed(2)}%
          </span>
          <span className="stat-label">Avg Overconfidence</span>
        </div>
        <div className="summary-stat">
          <span className="stat-value">{summary.overconfidentCount}</span>
          <span className="stat-label">Overpriced Buckets</span>
        </div>
        <div className="summary-stat">
          <span className="stat-value">{summary.underconfidentCount}</span>
          <span className="stat-label">Underpriced Buckets</span>
        </div>
      </div>

      {!compact && (
        <>
          {/* Strongest Bias */}
          {summary.strongestBias && (
            <div className="strongest-bias">
              <h3>Strongest Bias Found</h3>
              <div className="bias-details">
                <span className="price-bucket">{summary.strongestBias.priceBucket} cents</span>
                <span
                  className={`overconfidence ${summary.strongestBias.overconfidence > 0 ? 'positive' : 'negative'}`}
                >
                  {summary.strongestBias.overconfidence > 0 ? '+' : ''}
                  {(summary.strongestBias.overconfidence * 100).toFixed(1)}% overconfidence
                </span>
                <span className="sample-size">
                  (n={summary.strongestBias.sampleSize.toLocaleString()})
                </span>
              </div>
            </div>
          )}

          {/* Overconfident Buckets - Markets overpriced here */}
          {overconfidentBuckets.length > 0 && (
            <div className="bucket-section overconfident">
              <h3>Overpriced Price Ranges (Sell Opportunities)</h3>
              <p className="section-description">
                Markets at these prices win MORE often than expected - the market undervalues them
              </p>
              <div className="bucket-list">
                {overconfidentBuckets.slice(0, 5).map((bucket) => (
                  <BucketRow key={bucket.priceBucket} bucket={bucket} type="overconfident" />
                ))}
              </div>
            </div>
          )}

          {/* Underconfident Buckets - Markets underpriced here */}
          {underconfidentBuckets.length > 0 && (
            <div className="bucket-section underconfident">
              <h3>Underpriced Price Ranges (Buy Opportunities)</h3>
              <p className="section-description">
                Markets at these prices win LESS often than expected - the market overvalues them
              </p>
              <div className="bucket-list">
                {underconfidentBuckets.slice(0, 5).map((bucket) => (
                  <BucketRow key={bucket.priceBucket} bucket={bucket} type="underconfident" />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div className="panel-footer">
        <button className="refresh-btn" onClick={() => refetch()}>
          Refresh Analysis
        </button>
        <span className="last-updated">
          Updated: {new Date(data.timestamp).toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
}

function BucketRow({
  bucket,
  type,
}: {
  bucket: CalibrationBucket;
  type: 'overconfident' | 'underconfident';
}) {
  const overconfidencePercent = (bucket.overconfidence * 100).toFixed(1);
  const isPositive = bucket.overconfidence > 0;

  return (
    <div className={`bucket-row ${type}`}>
      <div className="bucket-price">
        <span className="price">{bucket.priceBucket}c</span>
        <span className="expected">Expected: {(bucket.expectedWinRate * 100).toFixed(0)}%</span>
      </div>
      <div className="bucket-actual">
        <span className="actual-label">Actual:</span>
        <span className="actual-value">{(bucket.actualWinRate * 100).toFixed(1)}%</span>
      </div>
      <div className="bucket-diff">
        <span className={`diff-value ${isPositive ? 'positive' : 'negative'}`}>
          {isPositive ? '+' : ''}
          {overconfidencePercent}%
        </span>
      </div>
      <div className="bucket-samples">
        <span className="sample-count">n={bucket.sampleSize}</span>
      </div>
    </div>
  );
}
