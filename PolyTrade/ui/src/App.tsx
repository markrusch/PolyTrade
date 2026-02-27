import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, useCallback } from "react";
import { TradingDashboard } from "./components/TradingDashboard";
import { PositionsPanel } from "./components/PositionsPanel";
import { OrdersPanel } from "./components/OrdersPanel";
import { StreamingStatusPanel } from "./components/StreamingStatusPanel";
import { MarketMakerControls } from "./components/MarketMakerControls";
import { PortfolioGreeksPanel } from "./components/PortfolioGreeksPanel";
import { SystemStatusPanel } from "./components/SystemStatusPanel";
import { RiskLimitsPanel } from "./components/RiskLimitsPanel";
import { SafetyMonitorPanel } from "./components/SafetyMonitorPanel";
import { ResearchPage } from "./components/research";
import { AppReadyProvider } from "./lib/contexts/AppReadyContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles/global.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 10000,
      gcTime: 60000,
      networkMode: "always",
    },
  },
});

type TabView = "trading" | "portfolio" | "controls" | "research";

function PortfolioView() {
  return (
    <div className="portfolio-page">
      <h1>Portfolio & Orders</h1>
      <ErrorBoundary name="PortfolioGreeks">
        <PortfolioGreeksPanel />
      </ErrorBoundary>
      <div className="portfolio-main">
        <ErrorBoundary name="Orders">
          <OrdersPanel />
        </ErrorBoundary>
        <ErrorBoundary name="Positions">
          <PositionsPanel />
        </ErrorBoundary>
      </div>
    </div>
  );
}

interface ControlsViewProps {
  mmRunning: boolean;
  onMmToggle: () => void;
}

function ControlsView({ mmRunning, onMmToggle }: ControlsViewProps) {
  return (
    <div className="portfolio-page">
      <h1>System Controls</h1>
      <div className="control-panels-row">
        <ErrorBoundary name="SystemStatus">
          <SystemStatusPanel />
        </ErrorBoundary>
        <ErrorBoundary name="RiskLimits">
          <RiskLimitsPanel />
        </ErrorBoundary>
      </div>
      <div className="control-panels-row">
        <ErrorBoundary name="SafetyMonitor">
          <SafetyMonitorPanel />
        </ErrorBoundary>
      </div>
      <div className="control-panels-row">
        <ErrorBoundary name="StreamingStatus">
          <StreamingStatusPanel />
        </ErrorBoundary>
        <ErrorBoundary name="MMControls">
          <MarketMakerControls isRunning={mmRunning} onToggle={onMmToggle} />
        </ErrorBoundary>
      </div>
    </div>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState<TabView>("trading");
  const [mmRunning, setMmRunning] = useState(false);

  const toggleMM = async () => {
    try {
      const endpoint = mmRunning ? "/api/mm/stop" : "/api/mm/start";
      await fetch(
        `${import.meta.env.VITE_API_URL || "http://localhost:3003"}${endpoint}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
      );
      setMmRunning(!mmRunning);
    } catch (e) {
      console.error("Failed to toggle MM", e);
      alert("Failed to toggle Market Maker");
    }
  };

  const handleKillServers = useCallback(async () => {
    if (
      window.confirm(
        "⚠️ STOP ALL SERVICES\n\nThis will:\n• Stop the backend server (port 3003)\n• Stop the UI dev server (port 5173)\n• Kill all Node.js processes\n\nAre you sure?",
      )
    ) {
      try {
        const btn = document.querySelector(
          'button[style*="#ef4444"]',
        ) as HTMLButtonElement;
        if (btn) {
          btn.disabled = true;
          btn.textContent = "⏳ Stopping...";
          btn.style.background = "#f59e0b";
        }

        await fetch(
          `${import.meta.env.VITE_API_URL || "http://localhost:3003"}/api/shutdown`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          },
        );

        await new Promise((resolve) => setTimeout(resolve, 1000));
        window.close();
        setTimeout(() => {
          alert("✅ Servers stopped!\n\nYou can now close this tab manually.");
        }, 500);
      } catch (error) {
        console.error("Shutdown error:", error);
        alert(
          "⚠️ Error stopping servers.\n\nPlease run: .\\stop.ps1\nor close the terminal windows manually.",
        );
      }
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AppReadyProvider>
        <ErrorBoundary name="AppRoot">
          <div className="app">
            <nav className="app-nav">
              <button
                className={`nav-tab ${activeTab === "trading" ? "active" : ""}`}
                onClick={() => setActiveTab("trading")}
              >
                Trading Dashboard
              </button>
              <div
                style={{
                  width: "1px",
                  height: "24px",
                  background: "#334155",
                  margin: "0 12px",
                }}
              />

              <button
                className={`nav-tab ${activeTab === "portfolio" ? "active" : ""}`}
                onClick={() => setActiveTab("portfolio")}
              >
                Portfolio & Orders
              </button>
              <button
                className={`nav-tab ${activeTab === "controls" ? "active" : ""}`}
                onClick={() => setActiveTab("controls")}
              >
                📡 Controls
              </button>
              <button
                className={`nav-tab ${activeTab === "research" ? "active" : ""}`}
                onClick={() => setActiveTab("research")}
              >
                🔬 Research
              </button>

              <div
                style={{
                  width: "1px",
                  height: "24px",
                  background: "#334155",
                  margin: "0 12px",
                }}
              />

              <button
                onClick={toggleMM}
                title={
                  mmRunning
                    ? "Stop Market Maker Strategy"
                    : "Start Market Maker Strategy"
                }
                style={{
                  padding: "6px 12px",
                  background: mmRunning ? "#f59e0b" : "#10b981",
                  color: "white",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontSize: "13px",
                  fontWeight: "600",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  marginRight: "12px",
                }}
              >
                <span>{mmRunning ? "⏸" : "▶"}</span>
                <span>{mmRunning ? "PAUSE BOT" : "START BOT"}</span>
              </button>

              <button
                onClick={handleKillServers}
                className="stop-button"
                title="Stop all backend and UI servers"
                style={{
                  marginLeft: "auto",
                  padding: "8px 16px",
                  background: "#ef4444",
                  color: "white",
                  border: "none",
                  borderRadius: "6px",
                  cursor: "pointer",
                  fontSize: "13px",
                  fontWeight: "600",
                  transition: "all 0.2s",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "#dc2626")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "#ef4444")
                }
              >
                <span style={{ fontSize: "16px" }}>⏹</span>
                <span>STOP</span>
              </button>
            </nav>
            {activeTab === "trading" && (
              <ErrorBoundary name="TradingDashboard">
                <TradingDashboard />
              </ErrorBoundary>
            )}
            {activeTab === "portfolio" && <PortfolioView />}
            {activeTab === "controls" && (
              <ControlsView
                mmRunning={mmRunning}
                onMmToggle={() => setMmRunning(!mmRunning)}
              />
            )}
            {activeTab === "research" && (
              <ErrorBoundary name="Research">
                <ResearchPage />
              </ErrorBoundary>
            )}
          </div>
        </ErrorBoundary>
      </AppReadyProvider>
    </QueryClientProvider>
  );
}

export default App;
