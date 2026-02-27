/**
 * Unified Markets View
 * Shows all markets from: Discovery, Positions, Open Orders
 * With clear Yes/No distinction, status, and on-demand connection
 */

import { memo, useState, useCallback, useMemo } from "react";
import {
  useWiredMarkets,
  usePositions,
  useOrders,
  useStreamingStatus,
  useSubscribeMarket,
  useUnsubscribeMarket,
  useSubscribeDiscoveredMarket,
} from "../lib/hooks";
import type {
  WiredMarketInfo,
  Position,
  Order,
} from "../lib/api";
import {
  getOutcomeDisplay,
  getOutcomeClass,
  parseOutcome,
  type MarketRow,
} from "../lib/utils/marketUtils";
import {
  formatPrice,
  formatGreek,
} from "../lib/formatters";

type ViewFilter = "all" | "subscribed" | "positions" | "orders";

interface MarketsViewProps {
  onSelectMarket?: (tokenId: string) => void;
  selectedMarket?: string | null;
}

export const MarketsView = memo(function MarketsView({
  onSelectMarket,
  selectedMarket,
}: MarketsViewProps) {
  const [filter, setFilter] = useState<ViewFilter>("all");
  const [showCryptoOnly, setShowCryptoOnly] = useState(false);

  // Data sources
  const { data: wiredData, isLoading: wiredLoading } = useWiredMarkets();
  const { data: positions, isLoading: positionsLoading } = usePositions("open");
  const { data: orders, isLoading: ordersLoading } = useOrders();
  const { data: streamingStatus } = useStreamingStatus();

  // Mutations
  const subscribeMutation = useSubscribeMarket();
  const unsubscribeMutation = useUnsubscribeMarket();
  const subscribeDiscoveredMutation = useSubscribeDiscoveredMarket();

  // Get subscribed token IDs
  const subscribedTokenIds = useMemo(() => {
    const ids = new Set<string>();
    streamingStatus?.activeMarkets?.forEach((m) => ids.add(m.tokenId));
    return ids;
  }, [streamingStatus]);

  // Build unified market rows
  const marketRows = useMemo(() => {
    const rowMap = new Map<string, MarketRow>();

    // Add wired markets (crypto markets with pricing)
    wiredData?.markets?.forEach((wm: WiredMarketInfo) => {
      rowMap.set(wm.tokenId, {
        tokenId: wm.tokenId,
        title: `${wm.crypto} $${wm.strike.toLocaleString()}`,
        outcome: "YES", // Wired markets default to YES
        crypto: wm.crypto,
        strike: wm.strike,
        expiry: wm.expiry ? new Date(wm.expiry) : null,
        isSubscribed: wm.status === "active",
        isCryptoMarket: true,
        hasPosition: false,
        hasOrders: false,
        lastOrderbookUpdate: null,
        lastPricingUpdate: wm.lastUpdate ? new Date(wm.lastUpdate) : null,
        spotPrice: wm.spotPrice,
        impliedVolatility: wm.impliedVolatility,
        fairPrice: wm.fairPrice,
        greeks: wm.greeks
          ? {
              delta: wm.greeks.delta,
              gamma: wm.greeks.gamma,
              vega: wm.greeks.vega,
              theta: wm.greeks.theta,
            }
          : null,
        edge: wm.edge,
        bestBid: wm.bestBid,
        bestAsk: wm.bestAsk,
        spread: wm.spread,
      });
    });

    // Add positions
    positions?.forEach((pos: Position) => {
      const tokenId = pos.market;
      const existing = rowMap.get(tokenId);
      const posSize = parseFloat(pos.size || "0");
      const outcome = parseOutcome(pos.outcome);

      if (existing) {
        existing.hasPosition = true;
        existing.positionSize = posSize;
        if (outcome !== "UNKNOWN") existing.outcome = outcome;
      } else {
        rowMap.set(tokenId, {
          tokenId,
          title: pos.market, // Will be token ID if no title
          outcome,
          crypto: null,
          strike: null,
          expiry: null,
          isSubscribed: subscribedTokenIds.has(tokenId),
          isCryptoMarket: false,
          hasPosition: true,
          hasOrders: false,
          positionSize: posSize,
          lastOrderbookUpdate: null,
          lastPricingUpdate: null,
          spotPrice: null,
          impliedVolatility: null,
          fairPrice: null,
          greeks: null,
          edge: null,
          bestBid: null,
          bestAsk: null,
          spread: null,
        });
      }
    });

    // Add orders
    orders?.forEach((order: Order) => {
      const tokenId = order.market;
      const existing = rowMap.get(tokenId);

      if (existing) {
        existing.hasOrders = true;
        existing.orderCount = (existing.orderCount || 0) + 1;
        if (order.title && existing.title === tokenId) {
          existing.title = order.title;
        }
      } else {
        rowMap.set(tokenId, {
          tokenId,
          title: order.title || order.market,
          outcome: "UNKNOWN",
          crypto: null,
          strike: null,
          expiry: null,
          isSubscribed: subscribedTokenIds.has(tokenId),
          isCryptoMarket: false,
          hasPosition: false,
          hasOrders: true,
          orderCount: 1,
          lastOrderbookUpdate: null,
          lastPricingUpdate: null,
          spotPrice: null,
          impliedVolatility: null,
          fairPrice: null,
          greeks: null,
          edge: null,
          bestBid: null,
          bestAsk: null,
          spread: null,
        });
      }
    });

    // Update streaming status
    streamingStatus?.activeMarkets?.forEach((sm) => {
      const existing = rowMap.get(sm.tokenId);
      if (existing) {
        existing.isSubscribed = true;
        existing.lastOrderbookUpdate = sm.lastUpdate
          ? new Date(sm.lastUpdate)
          : null;
      }
    });

    return Array.from(rowMap.values());
  }, [wiredData, positions, orders, streamingStatus, subscribedTokenIds]);

  // Apply filters
  const filteredRows = useMemo(() => {
    let rows = marketRows;

    // Filter by view type
    switch (filter) {
      case "subscribed":
        rows = rows.filter((r) => r.isSubscribed);
        break;
      case "positions":
        rows = rows.filter((r) => r.hasPosition);
        break;
      case "orders":
        rows = rows.filter((r) => r.hasOrders);
        break;
    }

    // Filter crypto only
    if (showCryptoOnly) {
      rows = rows.filter((r) => r.isCryptoMarket);
    }

    return rows;
  }, [marketRows, filter, showCryptoOnly]);

  // Handlers
  const handleConnect = useCallback(
    async (row: MarketRow) => {
      try {
        if (row.isCryptoMarket && row.crypto && row.strike && row.expiry) {
          // Crypto market: wire with pricing
          await subscribeDiscoveredMutation.mutateAsync({
            tokenId: row.tokenId,
            crypto: row.crypto,
            strike: row.strike,
            expiry: row.expiry.toISOString().split("T")[0],
            slug: row.slug,
          });
        } else {
          // Non-crypto: just subscribe orderbook
          await subscribeMutation.mutateAsync({ tokenId: row.tokenId });
        }
      } catch (error) {
        console.error("Failed to connect market:", error);
      }
    },
    [subscribeMutation, subscribeDiscoveredMutation],
  );

  const handleDisconnect = useCallback(
    async (tokenId: string) => {
      try {
        await unsubscribeMutation.mutateAsync(tokenId);
      } catch (error) {
        console.error("Failed to disconnect market:", error);
      }
    },
    [unsubscribeMutation],
  );

  const isLoading = wiredLoading || positionsLoading || ordersLoading;

  // Counts for filter badges
  const counts = useMemo(
    () => ({
      all: marketRows.length,
      subscribed: marketRows.filter((r) => r.isSubscribed).length,
      positions: marketRows.filter((r) => r.hasPosition).length,
      orders: marketRows.filter((r) => r.hasOrders).length,
    }),
    [marketRows],
  );

  return (
    <div className="markets-view">
      <div className="markets-header">
        <h2>Markets Overview</h2>
        <div className="filter-tabs">
          <button
            className={`filter-tab ${filter === "all" ? "active" : ""}`}
            onClick={() => setFilter("all")}
          >
            All <span className="badge">{counts.all}</span>
          </button>
          <button
            className={`filter-tab ${filter === "subscribed" ? "active" : ""}`}
            onClick={() => setFilter("subscribed")}
          >
            Connected <span className="badge">{counts.subscribed}</span>
          </button>
          <button
            className={`filter-tab ${filter === "positions" ? "active" : ""}`}
            onClick={() => setFilter("positions")}
          >
            Positions <span className="badge">{counts.positions}</span>
          </button>
          <button
            className={`filter-tab ${filter === "orders" ? "active" : ""}`}
            onClick={() => setFilter("orders")}
          >
            Orders <span className="badge">{counts.orders}</span>
          </button>
        </div>
        <label className="crypto-toggle">
          <input
            type="checkbox"
            checked={showCryptoOnly}
            onChange={(e) => setShowCryptoOnly(e.target.checked)}
          />
          Crypto Only
        </label>
      </div>

      {isLoading ? (
        <div className="markets-loading">
          <div className="spinner" />
          <p>Loading markets...</p>
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="markets-empty">
          <p>No markets found matching current filters.</p>
          <p>Try changing the filter or discover new markets.</p>
        </div>
      ) : (
        <div className="markets-table-wrapper">
          <table className="markets-table">
            <thead>
              <tr>
                <th className="col-market">Market</th>
                <th className="col-price">Bid / Ask</th>
                <th className="col-spread">Spread</th>
                <th className="col-pricing">Fair/Spot</th>
                <th className="col-iv">IV / Greeks</th>
                <th className="col-position">Pos</th>
                <th className="col-action">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((row) => (
                <tr
                  key={row.tokenId}
                  className={`market-row ${selectedMarket === row.tokenId ? "selected" : ""} ${row.isSubscribed ? "connected" : ""}`}
                  onClick={() => {
                    onSelectMarket?.(row.tokenId);
                    if (!row.isSubscribed) {
                      handleConnect(row);
                    }
                  }}
                >
                  <td className="col-market">
                    <div className="market-info">
                      <span className="market-title" title={row.tokenId}>
                        {row.title.length > 35
                          ? `${row.title.slice(0, 35)}...`
                          : row.title}
                      </span>
                      <div className="badges">
                        {row.isCryptoMarket && (
                          <span className="crypto-badge">{row.crypto}</span>
                        )}
                        {row.expiry && (
                          <span className="expiry-badge">
                            {row.expiry.toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                        )}
                        <span
                          className={`outcome-badge ${getOutcomeClass(row.outcome)}`}
                        >
                          {getOutcomeDisplay(row.outcome)}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="col-price">
                    {row.bestBid !== null || row.bestAsk !== null ? (
                      <div className="bid-ask">
                        <span className="bid">
                          {row.bestBid?.toFixed(2) ?? "-"}
                        </span>
                        <span className="separator">/</span>
                        <span className="ask">
                          {row.bestAsk?.toFixed(2) ?? "-"}
                        </span>
                      </div>
                    ) : (
                      <span className="no-data">-</span>
                    )}
                  </td>
                  <td className="col-spread">
                    {row.spread !== null ? (
                      <span className="spread">
                        {formatPrice(row.spread, 1)} bps
                      </span>
                    ) : (
                      <span className="no-data">-</span>
                    )}
                  </td>
                  <td className="col-pricing">
                    {row.isCryptoMarket && row.fairPrice !== null ? (
                      <div className="pricing-cell">
                        <span className="fair-price" title="Fair Price">
                          ${row.fairPrice?.toFixed(3)}
                        </span>
                        {row.spotPrice && (
                          <span className="spot-price" title="Underlying">
                            ${row.spotPrice.toLocaleString()}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="no-data">-</span>
                    )}
                  </td>
                  <td className="col-iv">
                    {row.isCryptoMarket && row.greeks ? (
                      <div className="greeks-mini">
                        <span title="Implied Volatility" className="iv">
                          IV:{" "}
                          {(row.impliedVolatility
                            ? row.impliedVolatility * 100
                            : 0
                          ).toFixed(1)}
                          %
                        </span>
                        <div className="greek-row">
                          <span title="Vega">
                            V:{formatGreek(row.greeks?.vega, 2)}
                          </span>
                          <span title="Gamma">
                            G:{formatGreek(row.greeks?.gamma, 4)}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <span className="no-data">-</span>
                    )}
                  </td>
                  <td className="col-position">
                    {row.hasPosition ? (
                      <span className="position-size">
                        {row.positionSize?.toFixed(2)}
                      </span>
                    ) : (
                      <span className="no-data">-</span>
                    )}
                  </td>
                  <td className="col-action">
                    {row.isSubscribed ? (
                      <button
                        className="btn-disconnect"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDisconnect(row.tokenId);
                        }}
                        disabled={unsubscribeMutation.isPending}
                      >
                        Disconnect
                      </button>
                    ) : (
                      <button
                        className="btn-connect"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleConnect(row);
                        }}
                        disabled={
                          subscribeMutation.isPending ||
                          subscribeDiscoveredMutation.isPending
                        }
                      >
                        Connect
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <style>{`
        .markets-view {
          background: var(--bg-secondary, #1a1a2e);
          border: 1px solid var(--border, #2d2d44);
          border-radius: 8px;
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow: hidden;
        }

        .markets-header {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 16px;
          border-bottom: 1px solid var(--border, #2d2d44);
          flex-wrap: wrap;
        }

        .markets-header h2 {
          margin: 0;
          font-size: 18px;
          color: var(--text-primary, #fff);
        }

        .filter-tabs {
          display: flex;
          gap: 4px;
          background: var(--bg-tertiary, #252538);
          padding: 4px;
          border-radius: 6px;
        }

        .filter-tab {
          padding: 6px 12px;
          background: transparent;
          border: none;
          border-radius: 4px;
          color: var(--text-secondary, #a0a0b0);
          cursor: pointer;
          font-size: 13px;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: all 0.2s;
        }

        .filter-tab:hover {
          color: var(--text-primary, #fff);
        }

        .filter-tab.active {
          background: var(--accent, #6366f1);
          color: #fff;
        }

        .filter-tab .badge {
          background: rgba(255, 255, 255, 0.2);
          padding: 2px 6px;
          border-radius: 10px;
          font-size: 11px;
        }

        .crypto-toggle {
          display: flex;
          align-items: center;
          gap: 6px;
          color: var(--text-secondary, #a0a0b0);
          font-size: 13px;
          cursor: pointer;
          margin-left: auto;
        }

        .crypto-toggle input {
          cursor: pointer;
        }

        .markets-loading, .markets-empty {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 48px;
          color: var(--text-secondary, #a0a0b0);
        }

        .spinner {
          width: 32px;
          height: 32px;
          border: 3px solid var(--border, #2d2d44);
          border-top-color: var(--accent, #6366f1);
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin-bottom: 16px;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .markets-table-wrapper {
          flex: 1;
          overflow-y: auto;
        }

        .markets-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
        }

        .markets-table thead {
          position: sticky;
          top: 0;
          background: var(--bg-tertiary, #252538);
          z-index: 1;
        }

        .markets-table th {
          padding: 12px 8px;
          text-align: left;
          font-weight: 500;
          color: var(--text-secondary, #a0a0b0);
          text-transform: uppercase;
          font-size: 11px;
          border-bottom: 1px solid var(--border, #2d2d44);
        }

        .markets-table td {
          padding: 10px 8px;
          border-bottom: 1px solid var(--border, #2d2d44);
          color: var(--text-primary, #fff);
        }

        .market-row {
          cursor: pointer;
          transition: background 0.2s;
        }

        .market-row:hover {
          background: rgba(255, 255, 255, 0.03);
        }

        .market-row.selected {
          background: rgba(99, 102, 241, 0.15);
        }

        .market-row.connected {
          border-left: 3px solid var(--success, #10b981);
        }

        .market-info {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .market-title {
          font-weight: 500;
        }

        .crypto-badge, .expiry-badge {
          display: inline-block;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 10px;
          font-weight: 600;
        }

        .crypto-badge {
          background: rgba(99, 102, 241, 0.2);
          color: var(--accent, #6366f1);
          margin-right: 4px;
        }

        .expiry-badge {
          background: rgba(255, 255, 255, 0.1);
          color: var(--text-secondary, #a0a0b0);
        }

        .outcome-badge {
          display: inline-flex;
          align-items: center;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 600;
        }

        .outcome-badge.outcome-yes {
          background: rgba(16, 185, 129, 0.2);
          color: var(--success, #10b981);
        }

        .outcome-badge.outcome-no {
          background: rgba(239, 68, 68, 0.2);
          color: var(--danger, #ef4444);
        }

        .outcome-badge.outcome-unknown {
          background: rgba(255, 255, 255, 0.1);
          color: var(--text-secondary, #a0a0b0);
        }

        .status-indicators {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }

        .status-dot.connected {
          background: var(--success, #10b981);
          box-shadow: 0 0 6px var(--success, #10b981);
        }

        .status-dot.disconnected {
          background: var(--text-tertiary, #6b6b80);
        }

        .status-text {
          font-size: 12px;
          color: var(--text-secondary, #a0a0b0);
        }

        .position-size, .order-count {
          font-weight: 600;
        }

        .no-data {
          color: var(--text-tertiary, #6b6b80);
        }

        .no-data.na {
          font-size: 11px;
        }

        .pricing-cell {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .fair-price {
          font-weight: 600;
          color: var(--accent, #6366f1);
        }

        .spot-price {
          font-size: 11px;
          color: var(--text-secondary, #a0a0b0);
        }

        .greeks-mini {
          display: flex;
          gap: 8px;
          font-size: 11px;
          color: var(--text-secondary, #a0a0b0);
        }

        .freshness-indicator {
          font-size: 12px;
        }

        .freshness-indicator.green {
          color: var(--success, #10b981);
        }

        .freshness-indicator.yellow {
          color: var(--warning, #f59e0b);
        }

        .freshness-indicator.red {
          color: var(--danger, #ef4444);
        }

        .freshness-indicator.gray {
          color: var(--text-tertiary, #6b6b80);
        }

        .btn-connect, .btn-disconnect {
          padding: 6px 12px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          transition: all 0.2s;
        }

        .btn-connect {
          background: var(--accent, #6366f1);
          color: #fff;
        }

        .btn-connect:hover:not(:disabled) {
          background: var(--accent-hover, #4f46e5);
        }

        .btn-disconnect {
          background: rgba(239, 68, 68, 0.2);
          color: var(--danger, #ef4444);
          border: 1px solid var(--danger, #ef4444);
        }

        .btn-disconnect:hover:not(:disabled) {
          background: rgba(239, 68, 68, 0.3);
        }

        .btn-connect:disabled, .btn-disconnect:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  );
});
