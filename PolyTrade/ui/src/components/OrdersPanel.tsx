import { memo, useCallback, useState, useMemo } from 'react';
import { useOrders, useCancelOrder, useCancelAllOrders } from '../lib/hooks';
import { useWsChannel } from '../lib/useWsConnection';
import { useQueryClient } from '@tanstack/react-query';
import type { Order } from '../lib/api';

export const OrdersPanel = memo(function OrdersPanel() {
  const queryClient = useQueryClient();
  const { data: orders, isLoading, refetch } = useOrders();
  const cancelOrder = useCancelOrder();
  const cancelAll = useCancelAllOrders();
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const handleWsUpdate = useCallback((data: Order[]) => {
    queryClient.setQueryData(['orders'], data);
  }, [queryClient]);

  useWsChannel<Order[]>('orders', handleWsUpdate);

  const handleCancelOrder = useCallback(async (orderId: string) => {
    setCancellingId(orderId);
    try {
      await cancelOrder.mutateAsync(orderId);
    } finally {
      setCancellingId(null);
    }
  }, [cancelOrder]);

  const handleCancelAll = () => {
    if (confirm(`⚠️ Cancel ALL ${orders?.length || 0} open orders? This cannot be undone.`)) {
      cancelAll.mutate();
    }
  };

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  // Memoize summary stats to prevent unnecessary recalculations
  const { totalValue, buyOrders, sellOrders } = useMemo(() => {
    const total = orders?.reduce((sum: number, o: Order) => {
      const price = parseFloat(o.price) || 0;
      const size = parseFloat(o.size) || 0;
      return sum + (price * size);
    }, 0) || 0;

    const buys = orders?.filter((o: Order) => o.side === 'BUY') || [];
    const sells = orders?.filter((o: Order) => o.side === 'SELL') || [];

    return { totalValue: total, buyOrders: buys, sellOrders: sells };
  }, [orders]);

  if (isLoading) return <div className="panel loading">Loading orders...</div>;

  return (
    <div className="panel">
      <div className="panel-header">
        <h3>Order Management</h3>
        <div className="header-actions">
          <button
            className="btn-refresh"
            onClick={handleRefresh}
            title="Refresh orders"
          >
            ↻
          </button>
          <span className="count">{orders?.length || 0} open</span>
          <span className="order-summary">
            <span className="buy-count">{buyOrders.length} buy</span>
            <span className="separator">|</span>
            <span className="sell-count">{sellOrders.length} sell</span>
          </span>
          <button
            className="btn-cancel-all"
            onClick={handleCancelAll}
            disabled={cancelAll.isPending || !orders?.length}
            title="Cancel all open orders"
          >
            {cancelAll.isPending ? 'Cancelling...' : 'Cancel All'}
          </button>
        </div>
      </div>
      <div className="panel-body">
        {totalValue > 0 && (
          <div className="orders-summary-bar">
            <span>Total Order Value: ${totalValue.toFixed(2)}</span>
          </div>
        )}
        {!orders || orders.length === 0 ? (
          <div className="empty-state">No open orders</div>
        ) : (
          <div className="table-wrapper scrollable">
            <table>
              <thead>
                <tr>
                  <th>Market / Event</th>
                  <th>Side</th>
                  <th>Price</th>
                  <th>Size</th>
                  <th>Filled</th>
                  <th>Value</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order: Order) => {
                  const orderValue = (parseFloat(order.price) || 0) * (parseFloat(order.size) || 0);
                  const filledPct = parseFloat(order.size) > 0 
                    ? ((parseFloat(order.filled) / parseFloat(order.size)) * 100).toFixed(0) 
                    : '0';
                  
                  return (
                    <tr key={order.id} className={cancellingId === order.id ? 'cancelling' : ''}>
                      <td className="market-title">
                        <div className="market-label">{order.title || order.market}</div>
                        <div className="market-id">({order.market.slice(0, 8)}...)</div>
                      </td>
                      <td className={`side ${order.side.toLowerCase()}`}>{order.side}</td>
                      <td className="price">${order.price}</td>
                      <td className="size">{order.size}</td>
                      <td className="filled">
                        {order.filled}
                        <span className="filled-pct">({filledPct}%)</span>
                      </td>
                      <td className="value">${orderValue.toFixed(2)}</td>
                      <td className="status">{order.status}</td>
                      <td>
                        <button
                          className="btn-cancel-order"
                          onClick={() => handleCancelOrder(order.id)}
                          disabled={cancelOrder.isPending || cancellingId === order.id}
                          title="Cancel this order"
                        >
                          {cancellingId === order.id ? '...' : '✕'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
});
