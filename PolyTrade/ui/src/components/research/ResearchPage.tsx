import { useState } from "react";
import { BackfillPanel } from "./BackfillPanel";
import { DataStatusPanel } from "./DataStatusPanel";
import { SqlQueryPanel } from "./SqlQueryPanel";
import { AnalysisPanel } from "./AnalysisPanel";
import { ScannerPanel } from "./ScannerPanel";
import "./research.css";

type ResearchTab = "data" | "query" | "analysis" | "scanner";

const TABS: { id: ResearchTab; label: string; icon: string }[] = [
  { id: "data", label: "Data", icon: "📥" },
  { id: "query", label: "Query", icon: "🔍" },
  { id: "analysis", label: "Analysis", icon: "📊" },
  { id: "scanner", label: "Scanner", icon: "🎯" },
];

export function ResearchPage() {
  const [activeTab, setActiveTab] = useState<ResearchTab>("data");

  return (
    <div className="research-page">
      <nav className="research-nav">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`research-nav-btn ${activeTab === tab.id ? "active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="tab-icon">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </nav>

      <main className="research-content">
        {activeTab === "data" && (
          <div className="research-data-tab">
            <DataStatusPanel compact />
            <BackfillPanel />
          </div>
        )}

        {activeTab === "query" && <SqlQueryPanel />}

        {activeTab === "analysis" && <AnalysisPanel />}

        {activeTab === "scanner" && <ScannerPanel />}
      </main>
    </div>
  );
}
