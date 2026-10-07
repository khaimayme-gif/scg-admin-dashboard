import { useState } from 'react';
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

interface Module {
  id: string;
  label: string;
  ready: boolean;
  children?: { id: string; label: string }[]; // sub-menus: the parent only opens and closes them
}

const MODULES: Module[] = [
  { id: 'dashboard', label: 'Dashboard', ready: true },
  { id: 'board', label: 'So Chic Board', ready: true },
  { id: 'quotation', label: 'Quotation', ready: true },
  {
    id: 'items',
    label: 'Items',
    ready: true,
    children: [
      { id: 'items-thailand', label: 'Thailand' },
      { id: 'items-japan', label: 'Japan' },
    ],
  },
  { id: 'qr', label: 'QR Code Generator', ready: true },
  { id: 'orders', label: 'Orders', ready: true },
  { id: 'templates', label: 'Template Library', ready: false },
  { id: 'expenses', label: 'Expense Tracker', ready: true },
  { id: 'settings', label: 'Settings', ready: true },
];

export default function Sidebar({ active, onSelect, onLogout, open, onClose, role }: SidebarProps) {
  // A group starts open when the page you are on is inside it, and you can open/close it yourself.
  const [openGroups, setOpenGroups] = useState<Set<string>>(
    () => new Set(MODULES.filter((m) => m.children?.some((c) => c.id === active)).map((m) => m.id))
  );
  const toggleGroup = (id: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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
        {MODULES.map((mod) => {
          if (mod.children) {
            const children = mod.children.filter((c) => ROLE_PAGES[role].includes(c.id));
            if (children.length === 0) return null;
            const isOpen = openGroups.has(mod.id) || children.some((c) => c.id === active);
            const hasActive = children.some((c) => c.id === active);
            return (
              <li key={mod.id}>
                <button
                  className={`sidebar-item sidebar-group ${hasActive ? 'has-active' : ''}`}
                  onClick={() => toggleGroup(mod.id)}
                  aria-expanded={isOpen}
                >
                  <span>{mod.label}</span>
                  <span className={`sidebar-caret ${isOpen ? 'is-open' : ''}`} aria-hidden="true">▾</span>
                </button>
                {isOpen && (
                  <ul className="sidebar-sublist">
                    {children.map((c) => (
                      <li key={c.id}>
                        <button
                          className={`sidebar-item sidebar-subitem ${active === c.id ? 'is-active' : ''}`}
                          onClick={() => onSelect(c.id)}
                        >
                          <span>{c.label}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          }
          if (!ROLE_PAGES[role].includes(mod.id)) return null;
          return (
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
          );
        })}
      </ul>
      <button className="sidebar-logout" onClick={onLogout}>
        Log out
      </button>
    </nav>
    </>
  );
}