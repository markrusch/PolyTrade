import { MispricingScanner } from "./MispricingScanner";
import { MarketScoresPanel } from "./MarketScoresPanel";
import { ResearchPositionsPanel } from "./ResearchPositionsPanel";

export function ScannerPanel() {
  return (
    <div className="scanner-panel">
      {/* Market Scores — ranked fairness */}
      <MarketScoresPanel />

      {/* Mispricing Scanner — top opportunities */}
      <MispricingScanner limit={50} />

      {/* Research Positions — track bets */}
      <ResearchPositionsPanel />
    </div>
  );
}
