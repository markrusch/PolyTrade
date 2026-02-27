import { memo } from 'react';
import { useMarkets } from '../lib/hooks';
import type { Market } from '../lib/api';

interface MarketsTableProps {
  onSelectMarket: (marketId: string) => void;
  selectedMarket: string | null;
}

export const MarketsPanel = memo(function MarketsPanel({ onSelectMarket, selectedMarket }: MarketsTableProps) {
  const { data: markets, isLoading } = useMarkets();

  if (isLoading) return <div className="panel loading">Loading markets...</div>;

  return (
    <div className="panel">
      <div className="panel-header">
        <h3>Markets</h3>
        <span className="count">{markets?.length || 0}</span>
      </div>
      <div className="panel-body">
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Question</th>
                <th>Price</th>
                <th>Volume</th>
                <th>Ends</th>
              </tr>
            </thead>
            <tbody>
              {markets?.map((market: Market) => (
                <tr
                  key={market.id}
                  className={selectedMarket === market.id ? 'selected' : ''}
                  onClick={() => onSelectMarket(market.id)}
                >
                  <td className="question">{market.question}</td>
                  <td className="price">${market.lastPrice}</td>
                  <td className="volume">${market.volume24h}</td>
                  <td className="date">{market.endDate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
});
