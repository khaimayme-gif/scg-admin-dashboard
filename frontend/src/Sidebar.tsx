import { useState } from 'react';
import { apiFetch, jsonBody } from './api';
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
  username: string;
  canChangePassword: boolean;
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
  { id: 'orders', label: 'Orders', ready: true },
  { id: 'qr', label: 'QR Code Generator', ready: true },
  {
    id: 'items',
    label: 'Items',
    ready: true,
    children: [
      { id: 'items-thailand', label: 'Thailand' },
      { id: 'items-japan', label: 'Japan' },
    ],
  },
  { id: 'expenses', label: 'Expense Tracker', ready: true },
  { id: 'templates', label: 'Template Library', ready: true },
  { id: 'settings', label: 'Settings', ready: true },
];

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const save = async () => {
    if (next !== again) {
      setError('The two new passwords are not the same.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await apiFetch('/users/password', jsonBody({ currentPassword: current, newPassword: next }));
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not change the password.');
        return;
      }
      setDone(true);
    } catch {
      // a 401 has already sent us back to login
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-card types-card">
        <div className="modal-header">
          <h2 className="panel-label">Change my password</h2>
          <button className="item-remove" onClick={onClose} aria-label="Close">×</button>
        </div>
        {done ? (
          <>
            <p className="order-profit">Your password was changed.</p>
            <div className="order-form-actions"><button className="save-btn" onClick={onClose}>Done</button></div>
          </>
        ) : (
          <>
            <div className="order-field" style={{ marginBottom: 12 }}>
              <label>Current password</label>
              <input type="password" className="item-input" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" autoFocus />
            </div>
            <div className="order-field" style={{ marginBottom: 12 }}>
              <label>New password (at least 8 characters)</label>
              <input type="password" className="item-input" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
            </div>
            <div className="order-field" style={{ marginBottom: 12 }}>
              <label>New password again</label>
              <input type="password" className="item-input" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" />
            </div>
            {error && <p className="error-text">{error}</p>}
            <div className="order-form-actions">
              <button className="save-btn" onClick={save} disabled={saving || !current || !next}>{saving ? 'Saving…' : 'Change password'}</button>
              <button className="add-item-btn" onClick={onClose} disabled={saving}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function Sidebar({ active, onSelect, onLogout, open, onClose, role, username, canChangePassword }: SidebarProps) {
  const [showPassword, setShowPassword] = useState(false);
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
      <div className="sidebar-account">
        {username && <span className="sidebar-user">Signed in as <strong>{username}</strong></span>}
        {canChangePassword && (
          <button className="sidebar-link" onClick={() => setShowPassword(true)}>Change password</button>
        )}
      </div>
      <button className="sidebar-logout" onClick={onLogout}>
        Log out
      </button>
      {showPassword && <ChangePasswordModal onClose={() => setShowPassword(false)} />}
    </nav>
    </>
  );
}