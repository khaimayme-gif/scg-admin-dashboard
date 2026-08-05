interface SidebarProps {
  active: string;
  onSelect: (id: string) => void;
  onLogout: () => void;
}

const MODULES = [
  { id: 'price-calculator', label: 'Price Calculator', ready: true },
  { id: 'qr', label: 'QR Code Generator', ready: true },
  { id: 'orders', label: 'Orders', ready: false },
  { id: 'customers', label: 'Customer Database', ready: false },
  { id: 'templates', label: 'Template Library', ready: false },
  { id: 'gifts', label: 'Gift Packages', ready: false },
  { id: 'delivery', label: 'Delivery Schedule', ready: false },
  { id: 'expenses', label: 'Expense Tracker', ready: false },
  { id: 'profit', label: 'Monthly Profit', ready: false },
  { id: 'settings', label: 'Settings', ready: true },
];

export default function Sidebar({ active, onSelect, onLogout }: SidebarProps) {
  return (
    <nav className="sidebar">
      <div className="sidebar-brand">
        <span className="sidebar-brand-mark">SCG</span>
        <span className="sidebar-brand-sub">Admin</span>
      </div>
      <ul className="sidebar-list">
        {MODULES.map((mod) => (
          <li key={mod.id}>
            <button
              className={`sidebar-item ${active === mod.id ? 'is-active' : ''} ${!mod.ready ? 'is-disabled' : ''}`}
              onClick={() => mod.ready && onSelect(mod.id)}
              disabled={!mod.ready}
            >
              <span>{mod.label}</span>
              {!mod.ready && <span className="sidebar-badge">soon</span>}
            </button>
          </li>
        ))}
      </ul>
      <button className="sidebar-logout" onClick={onLogout}>
        Log out
      </button>
    </nav>
  );
}
