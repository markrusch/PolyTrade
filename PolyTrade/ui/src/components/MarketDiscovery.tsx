import { memo, useState, useCallback } from 'react';
import {
  useDiscoverCryptoMarkets,
  useSubscribeDiscoveredMarket,
  useWiredMarkets,
  useWireAllMarkets,
} from '../lib/hooks';
import type { CryptoTicker, StrikeMarketInfo, CryptoEventInfo } from '../lib/api';
import { LivePricingTable } from './LivePricingTable';
import { CryptoStatsHeader } from './CryptoStatsHeader';

interface MarketDiscoveryProps {
  onMarketSelect?: (tokenId: string) => void;
}

export const MarketDiscovery = memo(function MarketDiscovery({ onMarketSelect }: MarketDiscoveryProps) {
  const [selectedCrypto, setSelectedCrypto] = useState<CryptoTicker>('BTC');
  const [daysAhead, setDaysAhead] = useState<number>(14);
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);
  const [subscribingTokenId, setSubscribingTokenId] = useState<string | null>(null);
  const [showPricingTable, setShowPricingTable] = useState<boolean>(false);

  const { data: discoveryResult, isLoading, isFetching, refetch } = useDiscoverCryptoMarkets(selectedCrypto, daysAhead);
  const subscribeMutation = useSubscribeDiscoveredMarket();
  const wireAllMutation = useWireAllMarkets();
  const { data: wiredMarketsData } = useWiredMarkets();

  const wiredTokenIds = new Set(wiredMarketsData?.markets?.map(m => m.tokenId) || []);
  const wiredMarketsForCrypto = (wiredMarketsData?.markets || []).filter(m => m.crypto === selectedCrypto);
  const hasWiredMarkets = wiredMarketsForCrypto.length > 0;

  const handleWireAll = useCallback(async () => {
    try {
      const result = await wireAllMutation.mutateAsync({
        crypto: selectedCrypto,
        days: daysAhead,
      });

      console.log(`Wired ${result.wiredCount}/${result.totalMarkets} markets for ${selectedCrypto}`);

      // Automatically show pricing table after wiring
      setShowPricingTable(true);
    } catch (error) {
      console.error('Failed to wire all markets:', error);
    }
  }, [selectedCrypto, daysAhead, wireAllMutation]);

  const handleSubscribe = useCallback(async (strike: StrikeMarketInfo, event: CryptoEventInfo) => {
    setSubscribingTokenId(strike.yesTokenId);
    try {
      await subscribeMutation.mutateAsync({
        tokenId: strike.yesTokenId,
        crypto: selectedCrypto,
        strike: strike.strike,
        expiry: event.eventDate,
        slug: strike.slug,
      });
      onMarketSelect?.(strike.yesTokenId);
    } catch (error) {
      console.error('Failed to subscribe market:', error);
    } finally {
      setSubscribingTokenId(null);
    }
  }, [selectedCrypto, subscribeMutation, onMarketSelect]);

  const formatPrice = (price: number | null) => {
    if (price === null) return '-';
    return `$${price.toFixed(3)}`;
  };

  const formatVolume = (volume: number) => {
    if (volume >= 1000000) return `$${(volume / 1000000).toFixed(1)}M`;
    if (volume >= 1000) return `$${(volume / 1000).toFixed(1)}K`;
    return `$${volume.toFixed(0)}`;
  };

  return (
    <div className="market-discovery">
      <div className="discovery-header">
        <h2>Market Discovery</h2>
        <div className="discovery-controls">
          <div className="control-group">
            <label>Crypto</label>
            <select
              value={selectedCrypto}
              onChange={(e) => setSelectedCrypto(e.target.value as CryptoTicker)}
            >
              <option value="BTC">Bitcoin (BTC)</option>
              <option value="ETH">Ethereum (ETH)</option>
              <option value="SOL">Solana (SOL)</option>
              <option value="XRP">Ripple (XRP)</option>
            </select>
          </div>
          <div className="control-group">
            <label>Days Ahead</label>
            <select
              value={daysAhead}
              onChange={(e) => setDaysAhead(Number(e.target.value))}
            >
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
              <option value={60}>60 days</option>
            </select>
          </div>
          <button
            className="btn-refresh"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            {isFetching ? 'Scanning...' : 'Refresh'}
          </button>
          <button
            className="btn-wire-all"
            onClick={handleWireAll}
            disabled={wireAllMutation.isPending || !selectedCrypto}
          >
            {wireAllMutation.isPending ? 'Wiring All...' : `Wire All ${selectedCrypto} Markets`}
          </button>
          {hasWiredMarkets && (
            <button
              className="btn-toggle-view"
              onClick={() => setShowPricingTable(!showPricingTable)}
            >
              {showPricingTable ? 'Show Discovery' : 'Show Pricing Table'}
            </button>
          )}
        </div>
      </div>

      {/* Live crypto stats header */}
      <CryptoStatsHeader crypto={selectedCrypto} />

      {showPricingTable && hasWiredMarkets ? (
        <LivePricingTable crypto={selectedCrypto} />
      ) : isLoading ? (
        <div className="discovery-loading">
          <div className="spinner" />
          <p>Scanning {selectedCrypto} markets for next {daysAhead} days...</p>
        </div>
      ) : discoveryResult?.events && discoveryResult.events.length > 0 ? (
        <>
          <div className="discovery-summary">
            <span className="summary-item">
              <strong>{discoveryResult.eventsFound}</strong> dates found
            </span>
            <span className="summary-item">
              <strong>{discoveryResult.totalStrikes}</strong> total strikes
            </span>
            <span className="summary-item">
              Discovered {new Date(discoveryResult.discoveredAt).toLocaleTimeString()}
            </span>
          </div>

          <div className="events-list">
            {discoveryResult.events.map((event) => (
              <div key={event.eventSlug} className="event-card">
                <div
                  className="event-header"
                  onClick={() => setExpandedEvent(
                    expandedEvent === event.eventSlug ? null : event.eventSlug
                  )}
                >
                  <div className="event-date">
                    {new Date(event.eventDate).toLocaleDateString('en-US', {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </div>
                  <div className="event-title">{event.eventTitle}</div>
                  <div className="event-strike-count">
                    {event.strikeCount} strikes
                  </div>
                  <div className={`expand-icon ${expandedEvent === event.eventSlug ? 'expanded' : ''}`}>
                    ▼
                  </div>
                </div>

                {expandedEvent === event.eventSlug && (
                  <div className="strikes-table">
                    <div className="strikes-header">
                      <span className="col-strike">Strike</span>
                      <span className="col-yes">YES</span>
                      <span className="col-no">NO</span>
                      <span className="col-spread">Spread</span>
                      <span className="col-volume">24h Vol</span>
                      <span className="col-liquidity">Liquidity</span>
                      <span className="col-action">Action</span>
                    </div>
                    {event.strikes.map((strike) => {
                      const isWired = wiredTokenIds.has(strike.yesTokenId);
                      const isSubscribing = subscribingTokenId === strike.yesTokenId;

                      return (
                        <div
                          key={strike.yesTokenId}
                          className={`strike-row ${!strike.active ? 'inactive' : ''} ${isWired ? 'wired' : ''}`}
                        >
                          <span className="col-strike">
                            ${strike.strike.toLocaleString()}
                          </span>
                          <span className="col-yes price-yes">
                            {formatPrice(strike.yesPrice)}
                          </span>
                          <span className="col-no price-no">
                            {formatPrice(strike.noPrice)}
                          </span>
                          <span className="col-spread">
                            {strike.spread ? `${(strike.spread * 100).toFixed(1)}%` : '-'}
                          </span>
                          <span className="col-volume">
                            {formatVolume(strike.volume24hr)}
                          </span>
                          <span className="col-liquidity">
                            {formatVolume(strike.liquidity)}
                          </span>
                          <span className="col-action">
                            {isWired ? (
                              <button
                                className="btn-wired"
                                onClick={() => onMarketSelect?.(strike.yesTokenId)}
                              >
                                View
                              </button>
                            ) : (
                              <button
                                className="btn-subscribe"
                                onClick={() => handleSubscribe(strike, event)}
                                disabled={isSubscribing || !strike.active}
                              >
                                {isSubscribing ? '...' : 'Wire'}
                              </button>
                            )}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="discovery-empty">
          <p>No {selectedCrypto} prediction markets found for the next {daysAhead} days.</p>
          <p>Try increasing the days ahead or selecting a different cryptocurrency.</p>
        </div>
      )}

      <style>{`
        .market-discovery {
          background: var(--bg-secondary, #1a1a2e);
          border: 1px solid var(--border, #2d2d44);
          border-radius: 8px;
          padding: 16px;
          height: 100%;
          overflow-y: auto;
        }

        .discovery-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
          flex-wrap: wrap;
          gap: 12px;
        }

        .discovery-header h2 {
          margin: 0;
          font-size: 18px;
          color: var(--text-primary, #fff);
        }

        .discovery-controls {
          display: flex;
          gap: 12px;
          align-items: center;
          flex-wrap: wrap;
        }

        .control-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .control-group label {
          font-size: 11px;
          color: var(--text-secondary, #a0a0b0);
          text-transform: uppercase;
        }

        .control-group select {
          padding: 6px 12px;
          background: var(--bg-tertiary, #252538);
          border: 1px solid var(--border, #2d2d44);
          border-radius: 4px;
          color: var(--text-primary, #fff);
          font-size: 13px;
        }

        .btn-refresh, .btn-wire-all, .btn-toggle-view {
          padding: 8px 16px;
          background: var(--accent, #6366f1);
          color: #fff;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 13px;
          transition: background 0.2s;
        }

        .btn-refresh:hover:not(:disabled),
        .btn-wire-all:hover:not(:disabled),
        .btn-toggle-view:hover:not(:disabled) {
          background: var(--accent-hover, #4f46e5);
        }

        .btn-refresh:disabled,
        .btn-wire-all:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .btn-wire-all {
          background: var(--success, #10b981);
        }

        .btn-wire-all:hover:not(:disabled) {
          background: #059669;
        }

        .btn-toggle-view {
          background: var(--bg-tertiary, #252538);
          border: 1px solid var(--border, #2d2d44);
        }

        .btn-toggle-view:hover {
          background: var(--bg-secondary, #1a1a2e);
        }

        .discovery-loading {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 48px;
          gap: 16px;
          color: var(--text-secondary, #a0a0b0);
        }

        .spinner {
          width: 32px;
          height: 32px;
          border: 3px solid var(--border, #2d2d44);
          border-top-color: var(--accent, #6366f1);
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .discovery-summary {
          display: flex;
          gap: 24px;
          padding: 12px;
          background: var(--bg-tertiary, #252538);
          border-radius: 6px;
          margin-bottom: 16px;
        }

        .summary-item {
          font-size: 13px;
          color: var(--text-secondary, #a0a0b0);
        }

        .summary-item strong {
          color: var(--text-primary, #fff);
        }

        .events-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .event-card {
          background: var(--bg-tertiary, #252538);
          border: 1px solid var(--border, #2d2d44);
          border-radius: 6px;
          overflow: hidden;
        }

        .event-header {
          display: flex;
          align-items: center;
          padding: 12px 16px;
          cursor: pointer;
          gap: 16px;
          transition: background 0.2s;
        }

        .event-header:hover {
          background: rgba(255, 255, 255, 0.03);
        }

        .event-date {
          font-weight: 600;
          color: var(--accent, #6366f1);
          min-width: 80px;
        }

        .event-title {
          flex: 1;
          color: var(--text-primary, #fff);
          font-size: 13px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .event-strike-count {
          font-size: 12px;
          color: var(--text-secondary, #a0a0b0);
          background: var(--bg-secondary, #1a1a2e);
          padding: 4px 8px;
          border-radius: 4px;
        }

        .expand-icon {
          color: var(--text-secondary, #a0a0b0);
          transition: transform 0.2s;
          font-size: 10px;
        }

        .expand-icon.expanded {
          transform: rotate(180deg);
        }

        .strikes-table {
          border-top: 1px solid var(--border, #2d2d44);
        }

        .strikes-header {
          display: grid;
          grid-template-columns: 100px 70px 70px 70px 80px 80px 70px;
          gap: 8px;
          padding: 8px 16px;
          background: var(--bg-secondary, #1a1a2e);
          font-size: 11px;
          text-transform: uppercase;
          color: var(--text-secondary, #a0a0b0);
        }

        .strike-row {
          display: grid;
          grid-template-columns: 100px 70px 70px 70px 80px 80px 70px;
          gap: 8px;
          padding: 10px 16px;
          border-top: 1px solid var(--border, #2d2d44);
          font-size: 13px;
          align-items: center;
        }

        .strike-row.inactive {
          opacity: 0.5;
        }

        .strike-row.wired {
          background: rgba(99, 102, 241, 0.1);
        }

        .col-strike {
          font-weight: 600;
          color: var(--text-primary, #fff);
        }

        .price-yes {
          color: var(--success, #10b981);
        }

        .price-no {
          color: var(--danger, #ef4444);
        }

        .col-spread, .col-volume, .col-liquidity {
          color: var(--text-secondary, #a0a0b0);
        }

        .btn-subscribe, .btn-wired {
          padding: 4px 12px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          transition: all 0.2s;
        }

        .btn-subscribe {
          background: var(--accent, #6366f1);
          color: #fff;
        }

        .btn-subscribe:hover:not(:disabled) {
          background: var(--accent-hover, #4f46e5);
        }

        .btn-subscribe:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .btn-wired {
          background: rgba(99, 102, 241, 0.2);
          color: var(--accent, #6366f1);
          border: 1px solid var(--accent, #6366f1);
        }

        .btn-wired:hover {
          background: rgba(99, 102, 241, 0.3);
        }

        .discovery-empty {
          text-align: center;
          padding: 48px;
          color: var(--text-secondary, #a0a0b0);
        }

        .discovery-empty p {
          margin: 8px 0;
        }
      `}</style>
    </div>
  );
});
