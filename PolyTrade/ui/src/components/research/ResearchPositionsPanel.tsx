import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { ResearchPosition } from '../../lib/api';

export function ResearchPositionsPanel() {
  const queryClient = useQueryClient();
  const [showClosed, setShowClosed] = useState(false);
  const [closingPositionId, setClosingPositionId] = useState<string | null>(null);
  const [exitPrice, setExitPrice] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['research-positions', showClosed ? undefined : 'OPEN'],
    queryFn: () => api.getResearchPositions(showClosed ? undefined : 'OPEN'),
    refetchInterval: 30000,
  });

  const closeMutation = useMutation({
    mutationFn: ({ id, price }: { id: string; price: number }) =>
      api.closeResearchPosition(id, price),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['research-positions'] });
      setClosingPositionId(null);
      setExitPrice('');
    },
  });

  if (isLoading) {
    return (
      <div className="panel research-positions-panel">
        <div className="panel-header">
          <h2>Research Positions</h2>
        </div>
        <div className="panel-body loading-state">
          <div className="spinner" />
          <span>Loading positions...</span>
        </div>
      </div>
    );
  }

  if (error || !data?.success) {
    return (
      <div className="panel research-positions-panel">
        <div className="panel-header">
          <h2>Research Positions</h2>
        </div>
        <div className="panel-body error-state">
          <span>Error loading positions</span>
        </div>
      </div>
    );
  }

  const positions = data.data || [];
  const openPositions = positions.filter(p => p.status === 'OPEN');
  const closedPositions = positions.filter(p => p.status === 'CLOSED');

  return (
    <div className="panel research-positions-panel">
      <div className="panel-header">
        <h2>Research Positions</h2>
        <div className="position-summary">
          <span className="summary-item">
            Open: <strong>{data.openCount}</strong>
          </span>
          <span className="summary-item">
            Total P&L: <strong className={data.totalPnL >= 0 ? 'positive' : 'negative'}>
              ${data.totalPnL.toFixed(2)}
            </strong>
          </span>
        </div>
      </div>

      <div className="positions-filter">
        <label>
          <input
            type="checkbox"
            checked={showClosed}
            onChange={(e) => setShowClosed(e.target.checked)}
          />
          Show Closed Positions
        </label>
      </div>

      <div className="panel-body">
        {positions.length === 0 ? (
          <div className="empty-state">
            <p>No research positions yet.</p>
            <small>Create positions from mispricing opportunities.</small>
          </div>
        ) : (
          <div className="positions-list">
            {openPositions.map((position) => (
              <PositionCard
                key={position.id}
                position={position}
                isClosing={closingPositionId === position.id}
                exitPrice={closingPositionId === position.id ? exitPrice : ''}
                onStartClose={() => setClosingPositionId(position.id)}
                onCancelClose={() => {
                  setClosingPositionId(null);
                  setExitPrice('');
                }}
                onExitPriceChange={setExitPrice}
                onConfirmClose={() => {
                  if (exitPrice) {
                    closeMutation.mutate({
                      id: position.id,
                      price: Number(exitPrice),
                    });
                  }
                }}
                closePending={closeMutation.isPending}
              />
            ))}
            {showClosed && closedPositions.map((position) => (
              <PositionCard
                key={position.id}
                position={position}
                isClosed
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PositionCard({
  position,
  isClosing,
  exitPrice,
  onStartClose,
  onCancelClose,
  onExitPriceChange,
  onConfirmClose,
  closePending,
  isClosed,
}: {
  position: ResearchPosition;
  isClosing?: boolean;
  exitPrice?: string;
  onStartClose?: () => void;
  onCancelClose?: () => void;
  onExitPriceChange?: (value: string) => void;
  onConfirmClose?: () => void;
  closePending?: boolean;
  isClosed?: boolean;
}) {
  const directionColor = position.direction === 'YES' ? 'var(--success, #10b981)' : 'var(--danger, #ef4444)';

  return (
    <div className={`position-card ${isClosed ? 'closed' : ''}`}>
      <div className="pos-header">
        <span
          className="direction-badge"
          style={{ backgroundColor: directionColor }}
        >
          {position.direction}
        </span>
        <span className="status-badge" data-status={position.status}>
          {position.status}
        </span>
      </div>

      <div className="pos-question" title={position.marketQuestion}>
        {position.marketQuestion.length > 80
          ? position.marketQuestion.slice(0, 80) + '...'
          : position.marketQuestion}
      </div>

      <div className="pos-details">
        <div className="detail-item">
          <span className="detail-label">Entry Price</span>
          <span className="detail-value">{(position.entryPrice * 100).toFixed(1)}¢</span>
        </div>
        <div className="detail-item">
          <span className="detail-label">Size</span>
          <span className="detail-value">{position.size.toFixed(2)}</span>
        </div>
        <div className="detail-item">
          <span className="detail-label">Entry Date</span>
          <span className="detail-value">
            {new Date(position.entryDate).toLocaleDateString()}
          </span>
        </div>
        {position.exitPrice !== null && (
          <div className="detail-item">
            <span className="detail-label">Exit Price</span>
            <span className="detail-value">{(position.exitPrice * 100).toFixed(1)}¢</span>
          </div>
        )}
        {position.pnl !== null && (
          <div className="detail-item">
            <span className="detail-label">P&L</span>
            <span className={`detail-value ${position.pnl >= 0 ? 'positive' : 'negative'}`}>
              ${position.pnl.toFixed(2)}
            </span>
          </div>
        )}
      </div>

      {position.thesis && (
        <div className="pos-thesis">
          <strong>Thesis:</strong> {position.thesis}
        </div>
      )}

      {!isClosed && !isClosing && (
        <div className="pos-actions">
          <button className="close-btn" onClick={onStartClose}>
            Close Position
          </button>
        </div>
      )}

      {isClosing && (
        <div className="close-form">
          <input
            type="number"
            placeholder="Exit price (0-1)"
            value={exitPrice}
            onChange={(e) => onExitPriceChange?.(e.target.value)}
            min={0}
            max={1}
            step={0.01}
          />
          <div className="close-actions">
            <button
              className="confirm-btn"
              onClick={onConfirmClose}
              disabled={closePending || !exitPrice}
            >
              Confirm
            </button>
            <button className="cancel-btn" onClick={onCancelClose}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
