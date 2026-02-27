import { memo, useState } from 'react';
import { useHealth, useCancelAllOrders, useStartAllServices, useStopAllServices } from '../lib/hooks';
import { useWsConnection } from '../lib/useWsConnection';

export const Header = memo(function Header() {
  const { data: health } = useHealth();
  const wsConnected = useWsConnection();
  const cancelAll = useCancelAllOrders();
  const startAll = useStartAllServices();
  const stopAll = useStopAllServices();
  const [showServiceControls, setShowServiceControls] = useState(false);

  const handleCancelAll = () => {
    if (confirm('Cancel all open orders? This cannot be undone.')) {
      cancelAll.mutate();
    }
  };

  const handleStartAll = () => {
    if (confirm('Start all services (Binance and Deribit for all cryptos)?')) {
      startAll.mutate();
    }
  };

  const handleStopAll = () => {
    if (confirm('Stop all services? This will disable price feeds.')) {
      stopAll.mutate();
    }
  };

  return (
    <header className="app-header">
      <div className="header-left">
        <h1>PolyTrade</h1>
        <div className="status-indicators">
          <div className={`status-dot ${wsConnected ? 'connected' : 'disconnected'}`} title="WebSocket" />
          <div className={`status-dot ${health?.status === 'healthy' ? 'connected' : 'disconnected'}`} title="API" />
        </div>
      </div>
      <div className="header-center">
        <div className="service-controls-group">
          <button
            className="btn-service-toggle"
            onClick={() => setShowServiceControls(!showServiceControls)}
            title="Toggle service controls"
          >
            ⚙️ Services
          </button>
          {showServiceControls && (
            <div className="service-controls-dropdown">
              <button
                className="btn-service-start"
                onClick={handleStartAll}
                disabled={startAll.isPending}
                title="Start all data services"
              >
                {startAll.isPending ? '⏳' : '▶️'} Start All
              </button>
              <button
                className="btn-service-stop"
                onClick={handleStopAll}
                disabled={stopAll.isPending}
                title="Stop all data services"
              >
                {stopAll.isPending ? '⏳' : '⏸️'} Stop All
              </button>
            </div>
          )}
        </div>
        <button
          className="btn-killswitch"
          onClick={handleCancelAll}
          disabled={cancelAll.isPending}
          title="Cancel all open orders"
        >
          {cancelAll.isPending ? 'Cancelling...' : '⚠️ CANCEL ALL'}
        </button>
      </div>
      <div className="header-right">
        {health && (
          <div className="service-status">
            <span className={health.services.clob ? 'service-ok' : 'service-down'}>CLOB</span>
            <span className={health.services.orderbook ? 'service-ok' : 'service-down'}>OB</span>
            <span className={health.services.binance ? 'service-ok' : 'service-down'}>BNC</span>
            <span className={health.services.deribit ? 'service-ok' : 'service-down'}>DBT</span>
          </div>
        )}
      </div>
    </header>
  );
});
