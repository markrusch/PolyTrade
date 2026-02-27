import { memo } from 'react';

interface SidebarProps {
  activeView: string;
  onViewChange: (view: string) => void;
}

export const Sidebar = memo(function Sidebar({ activeView, onViewChange }: SidebarProps) {
  const views = [
    { id: 'markets', label: 'Markets', icon: '📊' },
    { id: 'orderbook', label: 'Order Book', icon: '📖' },
    { id: 'orders', label: 'Orders', icon: '📝' },
    { id: 'positions', label: 'Positions', icon: '💼' },
    { id: 'pricing', label: 'Pricing', icon: '🔢' },
  ];

  return (
    <aside className="sidebar">
      <nav>
        {views.map((view) => (
          <button
            key={view.id}
            className={`nav-item ${activeView === view.id ? 'active' : ''}`}
            onClick={() => onViewChange(view.id)}
          >
            <span className="icon">{view.icon}</span>
            <span className="label">{view.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
});
