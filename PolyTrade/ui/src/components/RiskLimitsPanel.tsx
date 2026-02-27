import { useQuery } from '@tanstack/react-query';
import { getRiskLimits } from '../lib/api';

// Default values for null-safety
const defaultLimits = {
  maxGammaExposure: 0.5,
  maxQuantityPerMarket: 1000,
  maxNotionalPerCrypto: 10000,
};

const defaultCurrent = {
  gammaExposure: 0,
  netNotional: 0,
  marketCount: 0,
};

const defaultUsage = {
  gammaUtilization: 0,
};

export function RiskLimitsPanel() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['risk-limits'],
    queryFn: getRiskLimits,
    refetchInterval: 5000,
    retry: 2,
  });

  if (isLoading) {
    return (
      <div className="risk-limits-panel panel">
        <div className="panel-header">
          <h2>Risk Limits</h2>
        </div>
        <div className="panel-body loading-state">
          <div className="spinner" />
          <span>Loading limits...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="risk-limits-panel panel">
        <div className="panel-header">
          <h2>Risk Limits</h2>
        </div>
        <div className="panel-body error-state">
          <span>Error loading risk limits</span>
          <small>{String(error)}</small>
        </div>
      </div>
    );
  }

  // Use defaults if data is missing - prevents crashes during initialization
  const limits = { ...defaultLimits, ...data?.limits };
  const current = { ...defaultCurrent, ...data?.current };
  const usage = { ...defaultUsage, ...data?.usage };

  // Safe calculations with fallbacks
  const gammaUsage = isFinite(usage.gammaUtilization) ? usage.gammaUtilization : 0;
  const notionalUsage = limits.maxNotionalPerCrypto > 0
    ? current.netNotional / limits.maxNotionalPerCrypto
    : 0;
  const marketUsage = current.marketCount / 150;

  return (
    <div className="risk-limits-panel panel">
      <div className="panel-header">
        <h2>Risk Limits</h2>
        {!data?.success && <span className="badge warning">Initializing...</span>}
      </div>
      <div className="panel-body">
        <div className="limits-grid">
          {/* Gamma Exposure */}
          <LimitCard
            label="Gamma Exposure"
            current={Math.abs(current.gammaExposure).toFixed(4)}
            limit={limits.maxGammaExposure.toFixed(4)}
            usage={gammaUsage}
            unit=""
          />

          {/* Quantity Per Market */}
          <LimitCard
            label="Max Quantity/Market"
            current="-"
            limit={limits.maxQuantityPerMarket.toString()}
            usage={0}
            unit="contracts"
          />

          {/* Notional Per Crypto */}
          <LimitCard
            label="Max Notional/Crypto"
            current={current.netNotional.toFixed(0)}
            limit={limits.maxNotionalPerCrypto.toString()}
            usage={notionalUsage}
            unit="USD"
          />

          {/* Market Count */}
          <LimitCard
            label="Wired Markets"
            current={current.marketCount.toString()}
            limit="150"
            usage={marketUsage}
            unit="markets"
          />
        </div>

        <div className="limits-note">
          To adjust limits, edit .env file and restart the server.
        </div>
      </div>
    </div>
  );
}

function LimitCard({
  label,
  current,
  limit,
  usage,
  unit,
}: {
  label: string;
  current: string;
  limit: string;
  usage: number;
  unit: string;
}) {
  // Ensure usage is a valid number
  const safeUsage = isFinite(usage) ? usage : 0;
  const percentUsed = (safeUsage * 100).toFixed(1);
  const isWarning = safeUsage > 0.8;
  const isDanger = safeUsage > 0.95;

  return (
    <div className={`limit-card ${isWarning ? 'warning' : ''} ${isDanger ? 'danger' : ''}`}>
      <div className="limit-label">{label}</div>
      <div className="limit-values">
        <span className="limit-current">{current}</span>
        <span className="limit-separator">/</span>
        <span className="limit-max">{limit}</span>
        <span className="limit-unit">{unit}</span>
      </div>
      <div className="limit-bar">
        <div
          className="limit-bar-fill"
          style={{
            width: `${Math.min(safeUsage * 100, 100)}%`,
            backgroundColor: isDanger ? 'var(--danger, #ef4444)' : isWarning ? 'var(--warning, #f59e0b)' : 'var(--success, #10b981)'
          }}
        />
      </div>
      <div className="limit-percent">{percentUsed}% used</div>
    </div>
  );
}
