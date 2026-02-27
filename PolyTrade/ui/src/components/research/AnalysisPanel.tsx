import { useState } from "react";
import { WinRateChart } from "./WinRateChart";
import { LongshotBiasPanel } from "./LongshotBiasPanel";

const CATEGORY_OPTIONS = [
  { value: "", label: "All Categories" },
  { value: "POLITICS", label: "Politics" },
  { value: "SPORTS", label: "Sports" },
  { value: "CRYPTO", label: "Crypto" },
  { value: "FINANCE", label: "Finance" },
  { value: "TECH", label: "Tech" },
  { value: "CULTURE", label: "Culture" },
  { value: "GEOPOLITICS", label: "Geopolitics" },
];

export function AnalysisPanel() {
  const [selectedCategory, setSelectedCategory] = useState("");

  const tag = selectedCategory || undefined;

  return (
    <div className="analysis-panel">
      {/* Filters bar */}
      <div className="analysis-filters">
        <h2>Market Analysis</h2>
        <p className="analysis-subtitle">
          Calibration curves, longshot bias, and market efficiency — modeled
          after the
          <a
            href="https://www.jbecker.dev/research/prediction-market-microstructure"
            target="_blank"
            rel="noreferrer"
          >
            {" "}
            jbecker.dev research
          </a>
        </p>
        <div className="analysis-filter-controls">
          <label>Category:</label>
          <select
            className="research-category-select"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
          >
            {CATEGORY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Longshot Bias analysis */}
      <LongshotBiasPanel />

      {/* Calibration / Win Rate Chart */}
      <div className="analysis-charts">
        <WinRateChart tag={tag} />
      </div>
    </div>
  );
}
