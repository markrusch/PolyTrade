import { memo, useState } from 'react';
import { usePricing } from '../lib/hooks';

export const PricingPanel = memo(function PricingPanel() {
  const pricing = usePricing();
  const [params, setParams] = useState({
    spot: '',
    strike: '3000',
    tte: '0.083',
    iv: '',
  });

  const handleCalculate = async () => {
    await pricing.mutateAsync({
      spot: params.spot ? parseFloat(params.spot) : undefined,
      strike: parseFloat(params.strike),
      tte: parseFloat(params.tte),
      iv: params.iv ? parseFloat(params.iv) : undefined,
    });
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <h3>Black-Scholes Pricing</h3>
      </div>
      <div className="panel-body">
        <div className="pricing-form">
          <div className="form-row">
            <label>
              Spot Price
              <input
                type="number"
                placeholder="Auto (live Binance)"
                value={params.spot}
                onChange={(e) => setParams({ ...params, spot: e.target.value })}
              />
            </label>
            <label>
              Strike Price
              <input
                type="number"
                value={params.strike}
                onChange={(e) => setParams({ ...params, strike: e.target.value })}
                required
              />
            </label>
          </div>
          <div className="form-row">
            <label>
              Time to Expiry (years)
              <input
                type="number"
                step="0.001"
                value={params.tte}
                onChange={(e) => setParams({ ...params, tte: e.target.value })}
                required
              />
            </label>
            <label>
              Implied Volatility
              <input
                type="number"
                placeholder="Auto (live Deribit)"
                step="0.01"
                value={params.iv}
                onChange={(e) => setParams({ ...params, iv: e.target.value })}
              />
            </label>
          </div>
          <button className="btn-primary" onClick={handleCalculate} disabled={pricing.isPending}>
            {pricing.isPending ? 'Calculating...' : 'Calculate'}
          </button>
        </div>

        {pricing.data && (
          <div className="pricing-results">
            <div className="result-row highlight">
              <span className="label">Fair Value (Prob Above):</span>
              <span className="value large">{pricing.data.fair}</span>
            </div>
            <div className="result-row">
              <span className="label">Spot Price:</span>
              <span className="value">${pricing.data.spot}</span>
            </div>
            <div className="result-row">
              <span className="label">Strike:</span>
              <span className="value">${pricing.data.strike}</span>
            </div>
            <div className="result-row">
              <span className="label">Time to Expiry:</span>
              <span className="value">{pricing.data.tte} years</span>
            </div>
            <div className="result-row">
              <span className="label">IV:</span>
              <span className="value">{pricing.data.iv}</span>
            </div>
            <div className="result-row">
              <span className="label">Spread:</span>
              <span className="value">{pricing.data.spread}</span>
            </div>
            
            <div className="greeks">
              <h4>Greeks</h4>
              <div className="greeks-grid">
                <div className="greek">
                  <span className="greek-label">Delta</span>
                  <span className="greek-value">{pricing.data.greeks.delta}</span>
                </div>
                <div className="greek">
                  <span className="greek-label">Gamma</span>
                  <span className="greek-value">{pricing.data.greeks.gamma}</span>
                </div>
                <div className="greek">
                  <span className="greek-label">Theta</span>
                  <span className="greek-value">{pricing.data.greeks.theta}</span>
                </div>
                <div className="greek">
                  <span className="greek-label">Vega</span>
                  <span className="greek-value">{pricing.data.greeks.vega}</span>
                </div>
              </div>
            </div>

            {pricing.data.callPrice && (
              <div className="option-prices">
                <div className="result-row">
                  <span className="label">Call Price:</span>
                  <span className="value">${pricing.data.callPrice}</span>
                </div>
                <div className="result-row">
                  <span className="label">Put Price:</span>
                  <span className="value">${pricing.data.putPrice}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
