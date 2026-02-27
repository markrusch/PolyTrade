import { memo, useState } from 'react';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import { MarketsPanel } from './MarketsPanel';
import { OrderBookPanel } from './OrderBookPanel';
import { OrdersPanel } from './OrdersPanel';
import { PositionsPanel } from './PositionsPanel';
import { PricingPanel } from './PricingPanel';

export const AppLayout = memo(function AppLayout() {
  const [activeView, setActiveView] = useState('markets');
  const [selectedMarket, setSelectedMarket] = useState<string | null>(null);

  const renderView = () => {
    switch (activeView) {
      case 'markets':
        return <MarketsPanel onSelectMarket={setSelectedMarket} selectedMarket={selectedMarket} />;
      case 'orderbook':
        return <OrderBookPanel marketId={selectedMarket} />;
      case 'orders':
        return <OrdersPanel />;
      case 'positions':
        return <PositionsPanel />;
      case 'pricing':
        return <PricingPanel />;
      default:
        return <MarketsPanel onSelectMarket={setSelectedMarket} selectedMarket={selectedMarket} />;
    }
  };

  return (
    <div className="app-layout">
      <Header />
      <div className="app-main">
        <Sidebar activeView={activeView} onViewChange={setActiveView} />
        <main className="app-content">
          {renderView()}
        </main>
      </div>
    </div>
  );
});
