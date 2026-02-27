import { memo, useState, useMemo, useCallback } from "react";
import {
  useHealth,
  useMarkets,
  usePositions,
  usePricingData,
} from "../lib/hooks";
import { useWsConnection } from "../lib/useWsConnection";
import { OrderBookPanel } from "./OrderBookPanel";
import { MarketDiscovery } from "./MarketDiscovery";
import { GreeksDisplay } from "./GreeksDisplay";
import { GreeksSkeleton } from "./Skeleton";
import { useAppReady } from "../lib/contexts/AppReadyContext";

import { MarketsView } from "./MarketsView";

type ViewTab = "trading" | "markets" | "discovery";
// type Timeframe = '1m' | '5m' | '10m' | '15m' | '30m' | '1h' | '4h'; // Removed

export const TradingDashboard = memo(function TradingDashboard() {
  const { isReady, isInitializing, error: appError } = useAppReady();
  const wsConnected = useWsConnection();
  const { data: health } = useHealth();
  const {
    data: markets,
    isLoading: marketsLoading,
    error: marketsError,
  } = useMarkets();
  const { data: positions } = usePositions("open");
  const [selectedMarket, setSelectedMarket] = useState<string | null>(null);
  const [showPositionsOnly, setShowPositionsOnly] = useState(false);
  const [activeTab, setActiveTab] = useState<ViewTab>("trading");
  const [levelDepth] = useState(5);
  // Fetch pricing data for selected market
  const { data: pricingData } = usePricingData(selectedMarket);

  // Disable polling when WebSocket is connected (reduces duplicate requests)
  // const effectiveRefreshInterval = wsConnected ? 0 : refreshInterval; // Removed history polling

  // Get markets with positions
  const marketsWithPositions = useMemo(() => {
    if (!positions || !markets) return new Set<string>();
    const positionMarkets = new Set(positions.map((p) => p.market));
    return new Set(
      markets.filter((m) => positionMarkets.has(m.question)).map((m) => m.id),
    );
  }, [positions, markets]);

  // Filter markets based on position toggle
  const filteredMarkets = useMemo(() => {
    if (!markets) return [];
    if (!showPositionsOnly) return markets;
    return markets.filter((m) => marketsWithPositions.has(m.id));
  }, [markets, showPositionsOnly, marketsWithPositions]);

  // Memoized event handlers to prevent re-renders
  const handleMarketClick = useCallback((marketId: string) => {
    setSelectedMarket(marketId);
  }, []);

  const handleDiscoveryMarketSelect = useCallback((tokenId: string) => {
    setSelectedMarket(tokenId);
    setActiveTab("trading"); // Switch to trading view when a market is selected
  }, []);

  const togglePositionsOnly = useCallback(() => {
    setShowPositionsOnly((prev) => !prev);
  }, []);

  const handleMarketSelect = useCallback((tokenId: string) => {
    setSelectedMarket(tokenId);
    setActiveTab("trading");
  }, []);

  // Show initialization screen
  if (isInitializing) {
    return (
      <div className="trading-dashboard">
        <div className="dashboard-loading">
          <div className="loading-spinner" />
          <p>Initializing services...</p>
        </div>
      </div>
    );
  }

  // Show error screen
  if (appError) {
    return (
      <div className="trading-dashboard">
        <div className="dashboard-error">
          <h2>Failed to initialize</h2>
          <p>{appError}</p>
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      </div>
    );
  }

  // Show warmup screen
  if (!isReady) {
    return (
      <div className="trading-dashboard">
        <div className="dashboard-warmup">
          <div className="warmup-message">
            <div className="spinner" />
            <p>Services warming up...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="trading-dashboard">
      <header className="dashboard-header">
        <div className="header-left">
          <h1>PolyTrade</h1>
          <div className="connection-status">
            <div
              className={`status-dot ${wsConnected ? "connected" : "disconnected"}`}
            />
            <span>{wsConnected ? "Connected" : "Disconnected"}</span>
          </div>
        </div>
        <div className="header-center">
          <div className="tab-nav">
            <button
              className={`tab-btn ${activeTab === "trading" ? "active" : ""}`}
              onClick={() => setActiveTab("trading")}
            >
              Trading
            </button>
            <button
              className={`tab-btn ${activeTab === "markets" ? "active" : ""}`}
              onClick={() => setActiveTab("markets")}
            >
              Markets
            </button>
            <button
              className={`tab-btn ${activeTab === "discovery" ? "active" : ""}`}
              onClick={() => setActiveTab("discovery")}
            >
              Discovery
            </button>
          </div>
        </div>
        <div className="header-right">
          {health && (
            <div className="service-badges">
              <span
                className={`badge ${health.services.clob ? "ok" : "error"}`}
              >
                CLOB
              </span>
              <span
                className={`badge ${health.services.orderbook ? "ok" : "error"}`}
              >
                Orderbook
              </span>
              <span
                className={`badge ${health.services.binance ? "ok" : "error"}`}
              >
                Binance
              </span>
              <span
                className={`badge ${health.services.deribit ? "ok" : "error"}`}
              >
                Deribit
              </span>
            </div>
          )}
        </div>
      </header>

      <main className="dashboard-main">
        {activeTab === "trading" ? (
          <>
            {/* Markets Panel */}
            <div className="panel markets-panel">
              <div className="panel-header">
                <h3>Markets</h3>
                <div className="header-actions">
                  <button
                    className={`filter-btn ${showPositionsOnly ? "active" : ""}`}
                    onClick={togglePositionsOnly}
                    title="Show only markets with positions"
                  >
                    My Positions{" "}
                    {marketsWithPositions.size > 0 &&
                      `(${marketsWithPositions.size})`}
                  </button>
                  <span className="count">{filteredMarkets?.length || 0}</span>
                </div>
              </div>
              <div className="panel-body">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Question</th>
                      <th>Price</th>
                      <th>Volume 24h</th>
                      <th>Ends</th>
                    </tr>
                  </thead>
                  <tbody>
                    {marketsLoading ? (
                      <tr>
                        <td
                          colSpan={4}
                          style={{ textAlign: "center", padding: "20px" }}
                        >
                          Loading markets...
                        </td>
                      </tr>
                    ) : marketsError ? (
                      <tr>
                        <td
                          colSpan={4}
                          style={{
                            textAlign: "center",
                            padding: "20px",
                            color: "red",
                          }}
                        >
                          Error: {String(marketsError)}
                        </td>
                      </tr>
                    ) : !filteredMarkets || filteredMarkets.length === 0 ? (
                      <tr>
                        <td
                          colSpan={4}
                          style={{ textAlign: "center", padding: "20px" }}
                        >
                          {showPositionsOnly
                            ? "No markets with positions"
                            : "No markets available"}
                        </td>
                      </tr>
                    ) : (
                      filteredMarkets?.map((market) => (
                        <tr
                          key={market.id}
                          className={`${selectedMarket === market.id ? "selected" : ""} ${marketsWithPositions.has(market.id) ? "has-position" : ""}`}
                          onClick={() => handleMarketClick(market.id)}
                        >
                          <td className="market-name">
                            {marketsWithPositions.has(market.id) && (
                              <span className="position-badge">*</span>
                            )}
                            {market.question}
                          </td>
                          <td className="price">{market.lastPrice}</td>
                          <td className="volume">${market.volume24h}</td>
                          <td className="date">{market.endDate}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Greeks Display - Shows when market selected */}
            {selectedMarket && !pricingData && <GreeksSkeleton />}
            {selectedMarket && pricingData && (
              <GreeksDisplay tokenId={selectedMarket} />
            )}

            {/* Orderbook Display - Side by Side */}
            <div className="orderbook-container">
              {selectedMarket && (
                <OrderBookPanel
                  marketId={selectedMarket}
                  levelDepth={levelDepth}
                />
              )}
            </div>
          </>
        ) : activeTab === "discovery" ? (
          /* Discovery View */
          <div className="discovery-view">
            <MarketDiscovery onMarketSelect={handleDiscoveryMarketSelect} />
          </div>
        ) : (
          /* Markets View */
          <div
            className="markets-view-container"
            style={{ height: "calc(100vh - 120px)", overflow: "hidden" }}
          >
            <MarketsView
              onSelectMarket={handleMarketSelect}
              selectedMarket={selectedMarket}
            />
          </div>
        )}
      </main>
    </div>
  );
});
