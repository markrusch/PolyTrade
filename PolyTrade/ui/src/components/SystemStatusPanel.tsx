import { useQuery } from '@tanstack/react-query';
import { getSystemStatus } from '../lib/api';

// Default values to prevent crashes during initialization
const defaultServices = {
  binance: { ETH: 'disconnected', BTC: 'disconnected' },
  deribit: { ETH: 'disconnected', BTC: 'disconnected' },
  polymarket: { websocket: 'disconnected', clob: 'disconnected' },
};

const defaultQpServices = {
  safetyMonitor: { totalMarkets: 0, safetyRate: 0 },
  portfolioGreeks: { positionCount: 0, totalGamma: 0 },
  inventoryTracker: { totalPositions: 0, totalPnL: 0 },
};

const defaultConfig = {
  riskFreeRate: 0.04,
  baseSpread: 0.02,
  gammaCoefficient: 100,
  inventoryCoefficient: 0.0001,
};

export function SystemStatusPanel() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['system-status'],
    queryFn: getSystemStatus,
    refetchInterval: 5000,
    retry: 2,
  });

  if (isLoading) {
    return (
      <div className="system-status-panel panel">
        <div className="panel-header">
          <h2>System Status</h2>
        </div>
        <div className="panel-body loading-state">
          <div className="spinner" />
          <span>Loading system status...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="system-status-panel panel">
        <div className="panel-header">
          <h2>System Status</h2>
        </div>
        <div className="panel-body error-state">
          <span>Error loading status</span>
          <small>{String(error)}</small>
        </div>
      </div>
    );
  }

  // Use defaults if data is missing or incomplete - prevents crashes
  const services = {
    binance: { ...defaultServices.binance, ...data?.services?.binance },
    deribit: { ...defaultServices.deribit, ...data?.services?.deribit },
    polymarket: { ...defaultServices.polymarket, ...data?.services?.polymarket },
  };

  const qpServices = {
    safetyMonitor: { ...defaultQpServices.safetyMonitor, ...data?.qpServices?.safetyMonitor },
    portfolioGreeks: { ...defaultQpServices.portfolioGreeks, ...data?.qpServices?.portfolioGreeks },
    inventoryTracker: { ...defaultQpServices.inventoryTracker, ...data?.qpServices?.inventoryTracker },
  };

  const config = { ...defaultConfig, ...data?.config };

  return (
    <div className="system-status-panel panel">
      <div className="panel-header">
        <h2>System Status</h2>
        {!data?.success && <span className="badge warning">Initializing...</span>}
      </div>
      <div className="panel-body">
        {/* Connection Status */}
        <section className="status-section">
          <h3>Data Feeds</h3>
          <div className="status-grid">
            <StatusIndicator label="Binance ETH" status={services.binance.ETH} />
            <StatusIndicator label="Binance BTC" status={services.binance.BTC} />
            <StatusIndicator label="Deribit ETH" status={services.deribit.ETH} />
            <StatusIndicator label="Deribit BTC" status={services.deribit.BTC} />
            <StatusIndicator label="Polymarket WS" status={services.polymarket.websocket} />
            <StatusIndicator label="Polymarket CLOB" status={services.polymarket.clob} />
          </div>
        </section>

        {/* QP Services Status */}
        <section className="status-section">
          <h3>QP Services</h3>
          <div className="qp-stats">
            <StatCard
              label="Safety Monitor"
              value={`${qpServices.safetyMonitor.totalMarkets} markets`}
              sublabel={`${(qpServices.safetyMonitor.safetyRate * 100).toFixed(1)}% safe`}
            />
            <StatCard
              label="Portfolio Greeks"
              value={`${qpServices.portfolioGreeks.positionCount} positions`}
              sublabel={`Gamma: ${qpServices.portfolioGreeks.totalGamma.toFixed(6)}`}
            />
            <StatCard
              label="Inventory Tracker"
              value={`${qpServices.inventoryTracker.totalPositions} positions`}
              sublabel={`P&L: $${qpServices.inventoryTracker.totalPnL.toFixed(2)}`}
            />
          </div>
        </section>

        {/* Configuration */}
        <section className="status-section">
          <h3>Configuration</h3>
          <div className="config-grid">
            <ConfigItem label="Risk-Free Rate" value={`${(config.riskFreeRate * 100).toFixed(1)}%`} />
            <ConfigItem label="Base Spread" value={`${(config.baseSpread * 100).toFixed(1)}%`} />
            <ConfigItem label="Gamma Coefficient" value={config.gammaCoefficient} />
            <ConfigItem label="Inventory Coefficient" value={config.inventoryCoefficient} />
          </div>
        </section>
      </div>
    </div>
  );
}

function StatusIndicator({ label, status }: { label: string; status: string }) {
  const isConnected = status === 'connected';
  return (
    <div className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`}>
      <span className={`indicator-dot ${isConnected ? 'dot-connected' : 'dot-disconnected'}`} />
      <span className="indicator-label">{label}</span>
      <span className="indicator-status">{status || 'unknown'}</span>
    </div>
  );
}

function StatCard({ label, value, sublabel }: { label: string; value: string; sublabel: string }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-sublabel">{sublabel}</div>
    </div>
  );
}

function ConfigItem({ label, value }: { label: string; value: any }) {
  return (
    <div className="config-item">
      <span className="config-label">{label}:</span>
      <span className="config-value">{value ?? 'N/A'}</span>
    </div>
  );
}
