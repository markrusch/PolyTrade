import { memo, useState, useEffect } from 'react';
import { usePricing } from '../lib/hooks';

interface LiveData {
  spotETH: number | null;
  spotBTC: number | null;
  iv: number | null;
  ivSymbol: string;
}

export const LivePricing = memo(function LivePricing() {
  const pricing = usePricing();
  const [selectedCrypto, setSelectedCrypto] = useState<'ETH' | 'BTC'>('ETH');
  const [liveData, setLiveData] = useState<LiveData>({
    spotETH: null,
    spotBTC: null,
    iv: null,
    ivSymbol: 'ETH',
  });
  const [params, setParams] = useState({
    strike: '3000',
    tte: '0.083',
    autoUpdate: true,
  });

  // Fetch live pricing data when auto-update is enabled
  useEffect(() => {
    if (!params.autoUpdate) return;

    const calculate = async () => {
      try {
        await pricing.mutateAsync({
          strike: parseFloat(params.strike),
          tte: parseFloat(params.tte),
          crypto: selectedCrypto,
        });
      } catch (err) {
        console.error('Pricing error:', err);
      }
    };

    // Initial calculation
    calculate();

    // Update every 2 seconds when auto-update is on
    const interval = setInterval(calculate, 2000);
    return () => clearInterval(interval);
  }, [params.autoUpdate, params.strike, params.tte, pricing, selectedCrypto]);

  // Extract live spot and IV from pricing response
  useEffect(() => {
    if (pricing.data) {
      // Parse the response data
      const spotValue = pricing.data.spot ? parseFloat(pricing.data.spot) : null;
      const ivValue = pricing.data.iv ? parseFloat(pricing.data.iv.replace('%', '')) : null;
      const crypto = pricing.data.crypto || 'ETH';
      
      setLiveData(prev => ({
        ...prev,
        [crypto === 'BTC' ? 'spotBTC' : 'spotETH']: spotValue,
        iv: ivValue,
        ivSymbol: 'ETH', // IV is only for ETH from Deribit
      }));
    }
  }, [pricing.data]);

  const handleCalculate = async () => {
    await pricing.mutateAsync({
      strike: parseFloat(params.strike),
      tte: parseFloat(params.tte),
    });
  };

  return (
    <>
      <div className="panel-header">
        <h3>Live Pricing Engine</h3>
        <div className="live-indicators">
          <div className="live-indicator">
            <span className="label">Spot (ETH, Binance):</span>
            <span className="value spot">${liveData.spotETH?.toFixed(2) || '—'}</span>
          </div>
          <div className="live-indicator">
            <span className="label">Spot (BTC, Binance):</span>
            <span className="value spot">${liveData.spotBTC?.toFixed(2) || '—'}</span>
          </div>
          <div className="live-indicator">
            <span className="label">IV ({liveData.ivSymbol}, Deribit):</span>
            <span className="value iv">{liveData.iv ? `${liveData.iv.toFixed(2)}%` : '—'}</span>
          </div>
          <label className="auto-update-toggle">
            <input
              type="checkbox"
              checked={params.autoUpdate}
              onChange={(e) => setParams({ ...params, autoUpdate: e.target.checked })}
            />
            <span>Auto-update</span>
          </label>
        </div>
      </div>
      <div className="panel-body pricing-body">
        <div className="pricing-controls">
          <div className="control-group">
            <label>
              <span>Crypto</span>
              <select value={selectedCrypto} onChange={(e) => setSelectedCrypto(e.target.value as 'ETH' | 'BTC')}>
                <option value="ETH">Ethereum (ETH)</option>
                <option value="BTC">Bitcoin (BTC)</option>
              </select>
            </label>
            <label>
              <span>Strike Price</span>
              <input
                type="number"
                value={params.strike}
                onChange={(e) => setParams({ ...params, strike: e.target.value })}
                step="100"
              />
            </label>
            <label>
              <span>Time to Expiry (years)</span>
              <input
                type="number"
                value={params.tte}
                onChange={(e) => setParams({ ...params, tte: e.target.value })}
                step="0.01"
              />
            </label>
            <button 
              className="btn-calculate" 
              onClick={handleCalculate}
              disabled={params.autoUpdate}
            >
              {pricing.isPending ? 'Calculating...' : 'Calculate Now'}
            </button>
          </div>
        </div>

        {pricing.data && (
          <div className="pricing-results">
            <div className="result-grid">
              <div className="result-card highlight">
                <div className="result-label">Fair Value (Prob Above)</div>
                <div className="result-value large">{pricing.data.fair}</div>
              </div>
              <div className="result-card">
                <div className="result-label">Call Price</div>
                <div className="result-value">${pricing.data.callPrice || '—'}</div>
              </div>
              <div className="result-card">
                <div className="result-label">Put Price</div>
                <div className="result-value">${pricing.data.putPrice || '—'}</div>
              </div>
              <div className="result-card">
                <div className="result-label">Spread</div>
                <div className="result-value">{pricing.data.spread}</div>
              </div>
            </div>

            <div className="greeks-section">
              <h4>Greeks</h4>
              <div className="greeks-grid">
                <div className="greek-item">
                  <span className="greek-label">Delta</span>
                  <span className="greek-value">{pricing.data.greeks.delta}</span>
                </div>
                <div className="greek-item">
                  <span className="greek-label">Gamma</span>
                  <span className="greek-value">{pricing.data.greeks.gamma}</span>
                </div>
                <div className="greek-item">
                  <span className="greek-label">Theta</span>
                  <span className="greek-value">{pricing.data.greeks.theta}</span>
                </div>
                <div className="greek-item">
                  <span className="greek-label">Vega</span>
                  <span className="greek-value">{pricing.data.greeks.vega}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
});
