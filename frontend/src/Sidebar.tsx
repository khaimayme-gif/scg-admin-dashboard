import logo from './assets/sochic-logo-pink.png';
import { ROLE_PAGES, ROLE_LABELS } from './role';
import type { Role } from './role';

interface SidebarProps {
  active: string;
  onSelect: (id: string) => void;
  onLogout: () => void;
  open: boolean;
  onClose: () => void;
  role: Role;
}

const MODULES = [
  { id: 'dashboard', label: 'Dashboard', ready: true },
  { id: 'board', label: 'So Chic Board', ready: true },
  { id: 'quotation', label: 'Quotation', ready: true },
  { id: 'items-thailand', label: 'Thailand Items', ready: true },
  { id: 'items-japan', label: 'Japan Items', ready: true },
  { id: 'qr', label: 'QR Code Generator', ready: true },
  { id: 'orders', label: 'Orders', ready: true },
  { id: 'templates', label: 'Template Library', ready: false },
  { id: 'expenses', label: 'Expense Tracker', ready: true },
  { id: 'settings', label: 'Settings', ready: true },
];

export default function Sidebar({ active, onSelect, onLogout, open, onClose, role }: SidebarProps) {
  return (
    <>
    <div className={`sidebar-backdrop ${open ? 'is-open' : ''}`} onClick={onClose} aria-hidden="true" />
    <nav className={`sidebar ${open ? 'is-open' : ''}`} aria-label="Main menu">
      <div className="sidebar-brand">
        <img className="sidebar-logo" src={logo} alt="So Chic Gifts" />
        <span className="sidebar-brand-mark">So Chic Gifts</span>
        <span className="sidebar-brand-sub">{role === 'superadmin' ? 'Admin' : ROLE_LABELS[role]}</span>
      </div>
      <ul className="sidebar-list">
        {MODULES.filter((mod) => ROLE_PAGES[role].includes(mod.id)).map((mod) => (
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
    </>
  );
}