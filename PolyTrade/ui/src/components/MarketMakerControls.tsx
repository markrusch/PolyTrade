import { useState, memo, useCallback } from 'react';
import { 
  useStartMarketMaker, 
  useStopMarketMaker, 
  useAddMarketToMM, 
  useDiscoverMarkets 
} from '../lib/hooks';
import type { DiscoveredMarket } from '../lib/api';

interface DiscoveredMarketRowProps {
  market: DiscoveredMarket;
  onAdd: (slug: string) => void;
  isAdding: boolean;
}

const DiscoveredMarketRow = memo(function DiscoveredMarketRow({ 
  market, 
  onAdd, 
  isAdding 
}: DiscoveredMarketRowProps) {
  return (
    <div className="discovered-market-row">
      <div className="market-info">
        <span className="market-question" title={market.question}>
          {market.question.length > 60 ? market.question.slice(0, 57) + '...' : market.question}
        </span>
        <div className="market-metrics">
          <span className="metric">Vol: ${Number(market.volume24h).toLocaleString()}</span>
          <span className="metric">Liq: ${Number(market.liquidity).toLocaleString()}</span>
        </div>
      </div>
      <button
        className="add-market-btn"
        onClick={() => onAdd(market.slug)}
        disabled={isAdding}
        title="Add to Market Maker"
      >
        {isAdding ? '...' : '+'}
      </button>
    </div>
  );
});

interface MarketMakerControlsProps {
  isRunning: boolean;
  onToggle: () => void;
}

export function MarketMakerControls({ isRunning, onToggle }: MarketMakerControlsProps) {
  const [slugInput, setSlugInput] = useState('');
  const [discoveredMarkets, setDiscoveredMarkets] = useState<DiscoveredMarket[]>([]);
  const [showDiscover, setShowDiscover] = useState(false);

  const startMM = useStartMarketMaker();
  const stopMM = useStopMarketMaker();
  const addMarket = useAddMarketToMM();
  const discoverMarkets = useDiscoverMarkets();

  const handleToggle = useCallback(async () => {
    try {
      if (isRunning) {
        await stopMM.mutateAsync();
      } else {
        await startMM.mutateAsync();
      }
      onToggle();
    } catch (e) {
      console.error('Failed to toggle MM:', e);
      alert('Failed to toggle Market Maker');
    }
  }, [isRunning, startMM, stopMM, onToggle]);

  const handleAddMarket = useCallback(async (slug: string) => {
    try {
      await addMarket.mutateAsync(slug);
      // Remove from discovered list after adding
      setDiscoveredMarkets(prev => prev.filter(m => m.slug !== slug));
      setSlugInput('');
    } catch (e) {
      console.error('Failed to add market:', e);
      alert(`Failed to add market: ${(e as Error).message}`);
    }
  }, [addMarket]);

  const handleDiscover = useCallback(async () => {
    try {
      const result = await discoverMarkets.mutateAsync({ limit: 10, autoAdd: false });
      if (result.markets) {
        setDiscoveredMarkets(result.markets);
        setShowDiscover(true);
      }
    } catch (e) {
      console.error('Failed to discover markets:', e);
      alert('Failed to discover markets');
    }
  }, [discoverMarkets]);

  const handleAutoDiscover = useCallback(async () => {
    if (!window.confirm('Auto-discover and add top 5 high-volume markets to Market Maker?')) {
      return;
    }
    try {
      const result = await discoverMarkets.mutateAsync({ limit: 5, autoAdd: true });
      alert(`✅ Discovered ${result.discovered} markets, added ${result.added} to MM`);
      setShowDiscover(false);
      setDiscoveredMarkets([]);
    } catch (e) {
      console.error('Failed to auto-discover:', e);
      alert('Failed to auto-discover markets');
    }
  }, [discoverMarkets]);

  const handleManualAdd = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (slugInput.trim()) {
      handleAddMarket(slugInput.trim());
    }
  }, [slugInput, handleAddMarket]);

  return (
    <div className="panel mm-controls-panel">
      <div className="panel-header">
        <h2>🤖 Market Maker</h2>
        <button
          className={`mm-toggle-btn ${isRunning ? 'running' : 'stopped'}`}
          onClick={handleToggle}
          disabled={startMM.isPending || stopMM.isPending}
        >
          {startMM.isPending || stopMM.isPending ? '...' : isRunning ? 'STOP' : 'START'}
        </button>
      </div>

      <div className="panel-content">
        {/* Status Indicator */}
        <div className="mm-status">
          <span className={`status-badge ${isRunning ? 'active' : 'inactive'}`}>
            {isRunning ? '● Running' : '○ Stopped'}
          </span>
        </div>

        {/* Add Market Form */}
        <form className="add-market-form" onSubmit={handleManualAdd}>
          <input
            type="text"
            placeholder="Market slug (e.g., bitcoin-above-100k)"
            value={slugInput}
            onChange={(e) => setSlugInput(e.target.value)}
            className="slug-input"
          />
          <button 
            type="submit" 
            className="add-btn"
            disabled={!slugInput.trim() || addMarket.isPending}
          >
            {addMarket.isPending ? '...' : 'Add'}
          </button>
        </form>

        {/* Discovery Actions */}
        <div className="discover-actions">
          <button
            className="discover-btn"
            onClick={handleDiscover}
            disabled={discoverMarkets.isPending}
          >
            {discoverMarkets.isPending ? 'Searching...' : '🔍 Discover Markets'}
          </button>
          <button
            className="auto-discover-btn"
            onClick={handleAutoDiscover}
            disabled={discoverMarkets.isPending}
            title="Auto-add top 5 high-volume markets"
          >
            ⚡ Auto
          </button>
        </div>

        {/* Discovered Markets List */}
        {showDiscover && discoveredMarkets.length > 0 && (
          <div className="discovered-markets">
            <div className="discovered-header">
              <span>Discovered ({discoveredMarkets.length})</span>
              <button 
                className="close-discover"
                onClick={() => { setShowDiscover(false); setDiscoveredMarkets([]); }}
              >
                ×
              </button>
            </div>
            <div className="discovered-list">
              {discoveredMarkets.map((market) => (
                <DiscoveredMarketRow
                  key={market.slug}
                  market={market}
                  onAdd={handleAddMarket}
                  isAdding={addMarket.isPending}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
