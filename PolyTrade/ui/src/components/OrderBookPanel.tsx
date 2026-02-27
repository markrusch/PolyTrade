import { memo, useCallback, useMemo, useRef, useEffect, useState } from 'react';
import { useOrderBook } from '../lib/hooks';
import { useWsChannel } from '../lib/useWsConnection';
import { useQueryClient } from '@tanstack/react-query';
import type { OrderBook } from '../lib/api';
import { throttle } from '../lib/utils/throttle';
import { formatPrice } from '../lib/formatters';

interface OrderBookPanelProps {
  marketId: string | null;
  levelDepth?: number;
  showMidPrice?: boolean;
}


export const OrderBookPanel = memo(function OrderBookPanel({
  marketId,
  levelDepth = 5,
  showMidPrice = true,
}: OrderBookPanelProps) {
  const queryClient = useQueryClient();
  const { data: orderbook, isLoading, isFetching } = useOrderBook(marketId);
  const prevOrderbook = useRef<OrderBook | null>(null);
  const [flashPrices, setFlashPrices] = useState<Set<string>>(new Set());

  // Track price changes for flash effect
  useEffect(() => {
    if (!orderbook || !prevOrderbook.current) {
      prevOrderbook.current = orderbook || null;
      return;
    }

    const changedPrices = new Set<string>();

    // Check for new or changed bid prices
    orderbook.bids.forEach((level) => {
      const prevLevel = prevOrderbook.current?.bids.find(
        (p) => p.price === level.price
      );
      if (!prevLevel || prevLevel.size !== level.size) {
        changedPrices.add(`bid-${level.price}`);
      }
    });

    // Check for new or changed ask prices
    orderbook.asks.forEach((level) => {
      const prevLevel = prevOrderbook.current?.asks.find(
        (p) => p.price === level.price
      );
      if (!prevLevel || prevLevel.size !== level.size) {
        changedPrices.add(`ask-${level.price}`);
      }
    });

    if (changedPrices.size > 0) {
      setFlashPrices(changedPrices);
      const timer = setTimeout(() => setFlashPrices(new Set()), 300);
      prevOrderbook.current = orderbook;
      return () => clearTimeout(timer);
    }

    prevOrderbook.current = orderbook;
  }, [orderbook]);

  // Throttle WebSocket updates to prevent flickering (max 2 updates/second)
  const throttledUpdate = useMemo(
    () => throttle((data: OrderBook) => {
      queryClient.setQueryData(['orderbook', marketId], data);
    }, 500), // 500ms = max 2 updates per second
    [marketId, queryClient]
  );

  // WebSocket updates - merge with existing data for smoother transitions
  const handleWsUpdate = useCallback(
    (data: OrderBook & { tokenId?: string }) => {
      if (!marketId) return;
      if (data?.tokenId && data.tokenId !== marketId) return;

      // Only update if we have valid data
      if (data && Array.isArray(data.bids) && Array.isArray(data.asks)) {
        throttledUpdate(data);
      }
    },
    [marketId, throttledUpdate]
  );

  useWsChannel<OrderBook>('orderbook', handleWsUpdate);

  // Memoize processed levels to prevent unnecessary re-renders
  const { processedBids, processedAsks, spread, midPrice, maxSize } = useMemo(() => {
    if (!orderbook) {
      return {
        processedBids: [],
        processedAsks: [],
        spread: null,
        midPrice: null,
        maxSize: 0,
      };
    }

    const bids = orderbook.bids.slice(0, levelDepth);
    const asks = orderbook.asks.slice(0, levelDepth);

    // Calculate max size for depth visualization
    const allSizes = [...bids, ...asks].map((l) => parseFloat(l.size) || 0);
    const max = Math.max(...allSizes, 1);

    // Calculate spread and mid price
    const bestBid = bids.length > 0 ? parseFloat(bids[0].price) : null;
    const bestAsk = asks.length > 0 ? parseFloat(asks[0].price) : null;
    const spreadValue = bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;
    const mid = bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null;

    return {
      processedBids: bids,
      processedAsks: asks.slice().reverse(), // Reverse for display (best ask at bottom)
      spread: spreadValue,
      midPrice: mid,
      maxSize: max,
    };
  }, [orderbook, levelDepth]);

  // Format price - parse string to number for the imported formatter
  const formatPriceStr = useCallback((price: string) => {
    const num = parseFloat(price);
    return formatPrice(num, 3);
  }, []);

  // Format size with K/M suffixes
  const formatSize = useCallback((size: string) => {
    const num = parseFloat(size);
    if (isNaN(num)) return '-';
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toFixed(0);
  }, []);

  // Calculate depth bar width
  const getDepthWidth = useCallback(
    (size: string) => {
      const num = parseFloat(size) || 0;
      return `${Math.min((num / maxSize) * 100, 100)}%`;
    },
    [maxSize]
  );

  if (!marketId) {
    return (
      <div className="orderbook-panel empty">
        <div className="panel-header">
          <h3>Order Book</h3>
        </div>
        <div className="panel-body">
          <p className="empty-message">Select a market to view order book</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="orderbook-panel loading">
        <div className="panel-header">
          <h3>Order Book</h3>
        </div>
        <div className="panel-body">
          <div className="loading-indicator">
            <div className="spinner" />
            <span>Loading...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`orderbook-panel ${isFetching ? 'fetching' : ''}`}>
      <div className="panel-header">
        <h3>Order Book</h3>
        {isFetching && <span className="sync-indicator" title="Syncing..." />}
      </div>
      <div className="panel-body">
        <div className="orderbook-grid">
          {/* Header */}
          <div className="orderbook-header">
            <span className="col-price">Price</span>
            <span className="col-size">Size</span>
            <span className="col-total">Total</span>
          </div>

          {/* Asks (sells) - reversed so best ask is at bottom */}
          <div className="orderbook-side asks">
            {processedAsks.map((level) => {
              const isFlashing = flashPrices.has(`ask-${level.price}`);
              return (
                <div
                  key={`ask-${level.price}`}
                  className={`orderbook-level ask ${isFlashing ? 'flash' : ''}`}
                >
                  <div
                    className="depth-bar"
                    style={{ width: getDepthWidth(level.size) }}
                  />
                  <span className="col-price">{formatPriceStr(level.price)}</span>
                  <span className="col-size">{formatSize(level.size)}</span>
                  <span className="col-total">{formatSize(level.size)}</span>
                </div>
              );
            })}
          </div>

          {/* Spread & Mid Price */}
          <div className="orderbook-center">
            {showMidPrice && midPrice !== null && (
              <div className="mid-price">
                <span className="label">Mid</span>
                <span className="value">{formatPrice(midPrice, 4)}</span>
              </div>
            )}
            {spread !== null && (
              <div className="spread">
                <span className="label">Spread</span>
                <span className="value">
                  {formatPrice(spread, 4)} ({formatPrice((spread / (midPrice || 1)) * 100)}%)
                </span>
              </div>
            )}
          </div>

          {/* Bids (buys) */}
          <div className="orderbook-side bids">
            {processedBids.map((level) => {
              const isFlashing = flashPrices.has(`bid-${level.price}`);
              return (
                <div
                  key={`bid-${level.price}`}
                  className={`orderbook-level bid ${isFlashing ? 'flash' : ''}`}
                >
                  <div
                    className="depth-bar"
                    style={{ width: getDepthWidth(level.size) }}
                  />
                  <span className="col-price">{formatPriceStr(level.price)}</span>
                  <span className="col-size">{formatSize(level.size)}</span>
                  <span className="col-total">{formatSize(level.size)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <style>{`
        .orderbook-panel {
          background: var(--bg-secondary, #1a1a2e);
          border: 1px solid var(--border, #2d2d44);
          border-radius: 8px;
          display: flex;
          flex-direction: column;
          height: 100%;
        }

        .orderbook-panel.fetching {
          opacity: 0.9;
        }

        .orderbook-panel .panel-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          border-bottom: 1px solid var(--border, #2d2d44);
        }

        .orderbook-panel .panel-header h3 {
          margin: 0;
          font-size: 14px;
          color: var(--text-primary, #fff);
        }

        .sync-indicator {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--accent, #6366f1);
          animation: pulse 1s infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }

        .orderbook-panel .panel-body {
          flex: 1;
          overflow-y: auto;
          overflow-x: hidden;
          padding: 8px;
          min-height: 0; /* Required for flex child scrolling */
        }

        .orderbook-panel.empty .panel-body,
        .orderbook-panel.loading .panel-body {
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .empty-message {
          color: var(--text-secondary, #a0a0b0);
          font-size: 13px;
        }

        .loading-indicator {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
          color: var(--text-secondary, #a0a0b0);
        }

        .spinner {
          width: 20px;
          height: 20px;
          border: 2px solid var(--border, #2d2d44);
          border-top-color: var(--accent, #6366f1);
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .orderbook-grid {
          display: flex;
          flex-direction: column;
          height: 100%;
          min-height: 200px;
          max-height: 100%;
        }

        .orderbook-header {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          padding: 4px 8px;
          font-size: 10px;
          text-transform: uppercase;
          color: var(--text-tertiary, #6b6b80);
          border-bottom: 1px solid var(--border, #2d2d44);
        }

        .orderbook-side {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow-y: auto;
          min-height: 0; /* Required for flex child scrolling */
        }

        .orderbook-side.asks {
          justify-content: flex-end;
        }

        .orderbook-level {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          padding: 4px 8px;
          font-size: 12px;
          position: relative;
          transition: background 0.15s;
        }

        .orderbook-level .depth-bar {
          position: absolute;
          top: 0;
          right: 0;
          bottom: 0;
          opacity: 0.15;
          transition: width 0.3s ease;
        }

        .orderbook-level.ask .depth-bar {
          background: var(--danger, #ef4444);
        }

        .orderbook-level.bid .depth-bar {
          background: var(--success, #10b981);
        }

        .orderbook-level.flash {
          animation: flash 0.3s ease;
        }

        @keyframes flash {
          0%, 100% { background: transparent; }
          50% { background: rgba(255, 255, 255, 0.1); }
        }

        .orderbook-level.ask .col-price {
          color: var(--danger, #ef4444);
        }

        .orderbook-level.bid .col-price {
          color: var(--success, #10b981);
        }

        .col-price {
          font-family: 'SF Mono', Monaco, monospace;
          font-weight: 600;
        }

        .col-size, .col-total {
          color: var(--text-secondary, #a0a0b0);
          font-family: 'SF Mono', Monaco, monospace;
          text-align: right;
        }

        .orderbook-center {
          display: flex;
          justify-content: center;
          gap: 24px;
          padding: 8px;
          background: var(--bg-tertiary, #252538);
          border-radius: 4px;
          margin: 4px 0;
        }

        .mid-price, .spread {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
        }

        .mid-price .label, .spread .label {
          font-size: 9px;
          text-transform: uppercase;
          color: var(--text-tertiary, #6b6b80);
        }

        .mid-price .value {
          font-size: 14px;
          font-weight: 700;
          color: var(--accent, #6366f1);
          font-family: 'SF Mono', Monaco, monospace;
        }

        .spread .value {
          font-size: 12px;
          color: var(--text-secondary, #a0a0b0);
          font-family: 'SF Mono', Monaco, monospace;
        }
      `}</style>
    </div>
  );
});
