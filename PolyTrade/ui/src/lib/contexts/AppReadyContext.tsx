import React, { createContext, useContext, useState, useEffect } from "react";
import { useHealth } from "../hooks";

interface AppReadyContextValue {
  isReady: boolean;
  isInitializing: boolean;
  error: string | null;
  initializationStatus: any;
  retryConnection: () => void;
}

const AppReadyContext = createContext<AppReadyContextValue | undefined>(
  undefined,
);

export function AppReadyProvider({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false);
  const [hasWaited, setHasWaited] = useState(false);
  const [retryTrigger, setRetryTrigger] = useState(0);
  const { data: health, error, isLoading, refetch } = useHealth();

  // Wait 1 second before showing UI to give services time to initialize
  useEffect(() => {
    const timer = setTimeout(() => setHasWaited(true), 1000);
    return () => clearTimeout(timer);
  }, [retryTrigger]);

  // Check if ready
  useEffect(() => {
    if (health?.ready && hasWaited) {
      setIsReady(true);
    }
  }, [health, hasWaited]);

  const retryConnection = () => {
    setHasWaited(false);
    setRetryTrigger((prev) => prev + 1);
    refetch();
  };

  // Context value that will be provided to children
  const isInitializing = !hasWaited || isLoading;
  const contextValue: AppReadyContextValue = {
    isReady,
    isInitializing,
    error: error ? String(error) : null,
    initializationStatus: health?.initialization || null,
    retryConnection,
  };

  // Show loading state only during initial page load (first 1s)
  if (!hasWaited || (isLoading && !health)) {
    return (
      <AppReadyContext.Provider value={contextValue}>
        <div className="app-loading">
          <div className="loading-content">
            <div className="spinner-large" />
            <h2>Initializing PolyTrade</h2>
            <p>Starting services and establishing connections...</p>
          </div>
        </div>
        <AppReadyStyles />
      </AppReadyContext.Provider>
    );
  }

  // True connection failure - backend not reachable at all
  const isConnectionError = error && !health;

  if (isConnectionError) {
    const backendUrl = import.meta.env.VITE_API_URL || "http://localhost:3001";

    return (
      <AppReadyContext.Provider value={contextValue}>
        <div className="app-error">
          <div className="error-content">
            <h2>Cannot Reach Backend</h2>

            <div className="error-details">
              <p className="error-message">
                {String(error)}
              </p>

              <div className="connection-info">
                <h3>Connection Details:</h3>
                <p>
                  <strong>Backend URL:</strong> {backendUrl}
                </p>
                <p>
                  <strong>Status:</strong> Not connected
                </p>
              </div>
            </div>

            <div className="troubleshooting">
              <h3>Troubleshooting Steps:</h3>
              <ol>
                <li>Verify the backend server is running on {backendUrl}</li>
                <li>Check the terminal for any error messages</li>
                <li>
                  Ensure all required environment variables are set (.env file)
                </li>
                <li>Try restarting the backend server</li>
                <li>Check if ports are not blocked by firewall</li>
              </ol>
            </div>

            <button className="retry-button" onClick={retryConnection}>
              Retry Connection
            </button>
          </div>
        </div>
        <AppReadyStyles />
      </AppReadyContext.Provider>
    );
  }

  // Backend reachable but still initializing - show app with banner
  // This is the key change: instead of blocking, show the app in degraded mode
  if (health && !health.ready) {
    const phase = (health as any).phase || 'initializing';
    const elapsed = health.initialization?.elapsedSeconds || '...';

    return (
      <AppReadyContext.Provider value={contextValue}>
        <div className="init-banner">
          <div className="init-banner-content">
            <div className="init-banner-spinner" />
            <span className="init-banner-text">
              Initializing services ({elapsed}s) &mdash; {phase}
            </span>
            <div className="init-banner-services">
              {health.initialization && (
                <>
                  <span className={health.initialization.clobClient ? 'svc-ready' : 'svc-pending'}>CLOB</span>
                  <span className={health.initialization.binance ? 'svc-ready' : 'svc-pending'}>Binance</span>
                  <span className={health.initialization.deribit ? 'svc-ready' : 'svc-pending'}>Deribit</span>
                  <span className={health.initialization.streamManager ? 'svc-ready' : 'svc-pending'}>Streaming</span>
                  <span className={health.initialization.database ? 'svc-ready' : 'svc-pending'}>Database</span>
                </>
              )}
            </div>
          </div>
        </div>
        {children}
        <AppReadyStyles />
      </AppReadyContext.Provider>
    );
  }

  // Services are ready, render the app
  return (
    <AppReadyContext.Provider value={contextValue}>
      {children}
    </AppReadyContext.Provider>
  );
}

function AppReadyStyles() {
  return (
    <style>{`
      .app-loading, .app-error {
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 100vh;
        background: #0d1117;
        color: #c9d1d9;
        padding: 24px;
      }

      .loading-content, .error-content {
        max-width: 600px;
        text-align: center;
      }

      .error-content {
        text-align: left;
        background: #161b22;
        border: 1px solid #30363d;
        border-radius: 12px;
        padding: 32px;
      }

      .spinner-large {
        width: 48px;
        height: 48px;
        border: 4px solid #30363d;
        border-top-color: #58a6ff;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin: 0 auto 24px;
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }

      .loading-content h2 {
        margin: 0 0 12px 0;
        font-size: 24px;
        color: #c9d1d9;
      }

      .loading-content p {
        margin: 0;
        color: #8b949e;
        font-size: 14px;
      }

      .error-content h2 {
        margin: 0 0 24px 0;
        font-size: 24px;
        color: #f85149;
        text-align: center;
      }

      .error-details {
        margin-bottom: 24px;
      }

      .error-message {
        background: rgba(248, 81, 73, 0.1);
        border: 1px solid rgba(248, 81, 73, 0.3);
        border-radius: 6px;
        padding: 12px;
        margin-bottom: 16px;
        color: #f85149;
        font-family: monospace;
        font-size: 13px;
      }

      .connection-info, .initialization-status, .services-status {
        background: #21262d;
        border-radius: 6px;
        padding: 16px;
        margin-bottom: 16px;
      }

      .connection-info h3, .initialization-status h3, .services-status h3 {
        margin: 0 0 12px 0;
        font-size: 14px;
        text-transform: uppercase;
        color: #8b949e;
      }

      .connection-info p {
        margin: 4px 0;
        font-size: 13px;
        color: #8b949e;
      }

      .connection-info strong {
        color: #c9d1d9;
      }

      .troubleshooting {
        background: #21262d;
        border-radius: 6px;
        padding: 16px;
        margin-bottom: 24px;
      }

      .troubleshooting h3 {
        margin: 0 0 12px 0;
        font-size: 14px;
        text-transform: uppercase;
        color: #8b949e;
      }

      .troubleshooting ol {
        margin: 0;
        padding-left: 20px;
        color: #8b949e;
        font-size: 13px;
      }

      .troubleshooting li {
        margin-bottom: 8px;
      }

      .retry-button {
        width: 100%;
        padding: 12px 24px;
        background: #58a6ff;
        color: white;
        border: none;
        border-radius: 6px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.2s;
      }

      .retry-button:hover {
        background: #4d9aef;
      }

      .retry-button:active {
        transform: scale(0.98);
      }

      /* Initialization banner - shows at top of app during init */
      .init-banner {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 9999;
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        border-bottom: 2px solid #58a6ff;
        padding: 8px 16px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      }

      .init-banner-content {
        display: flex;
        align-items: center;
        gap: 12px;
        max-width: 1200px;
        margin: 0 auto;
        flex-wrap: wrap;
      }

      .init-banner-spinner {
        width: 16px;
        height: 16px;
        border: 2px solid #30363d;
        border-top-color: #58a6ff;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        flex-shrink: 0;
      }

      .init-banner-text {
        color: #c9d1d9;
        font-size: 13px;
        font-weight: 500;
      }

      .init-banner-services {
        display: flex;
        gap: 8px;
        margin-left: auto;
      }

      .init-banner-services .svc-ready {
        color: #3fb950;
        font-size: 11px;
        font-weight: 600;
        padding: 2px 8px;
        background: rgba(63, 185, 80, 0.1);
        border-radius: 10px;
        border: 1px solid rgba(63, 185, 80, 0.2);
      }

      .init-banner-services .svc-pending {
        color: #8b949e;
        font-size: 11px;
        font-weight: 500;
        padding: 2px 8px;
        background: rgba(139, 148, 158, 0.1);
        border-radius: 10px;
        border: 1px solid rgba(139, 148, 158, 0.15);
      }
    `}</style>
  );
}

export function useAppReady() {
  const context = useContext(AppReadyContext);
  if (context === undefined) {
    throw new Error("useAppReady must be used within an AppReadyProvider");
  }
  return context;
}
