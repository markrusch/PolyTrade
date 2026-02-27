export function OrderBookSkeleton() {
  return (
    <div className="panel orderbook-panel">
      <div className="panel-header">
        <h3>Order Book</h3>
        <div className="skeleton-shimmer" style={{ width: '60px', height: '20px' }} />
      </div>
      <div className="panel-body">
        <div className="skeleton-orderbook">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="skeleton-row">
              <div className="skeleton-shimmer" style={{ width: '60px', height: '16px' }} />
              <div className="skeleton-shimmer" style={{ width: '80px', height: '16px' }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function TimeSeriesSkeleton() {
  return (
    <div className="panel timeseries-panel">
      <div className="panel-header">
        <h3>Order Book Time Series</h3>
      </div>
      <div className="panel-body" style={{ height: '380px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="skeleton-chart">
          <div className="skeleton-shimmer" style={{ width: '100%', height: '300px' }} />
        </div>
      </div>
    </div>
  );
}

export function GreeksSkeleton() {
  return (
    <div className="panel greeks-panel">
      <div className="panel-header">
        <h3>Pricing & Greeks</h3>
      </div>
      <div className="panel-body">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="skeleton-row">
            <div className="skeleton-shimmer" style={{ width: '80px', height: '16px' }} />
            <div className="skeleton-shimmer" style={{ width: '60px', height: '16px' }} />
          </div>
        ))}
      </div>
    </div>
  );
}
