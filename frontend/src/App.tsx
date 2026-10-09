import { useState, useEffect } from 'react';
import { setUnauthorizedHandler } from './api';
import Sidebar from './Sidebar';
import Quotation from './Quotation'; 
import QRCodeGenerator from './QRCodeGenerator';
import Login from './Login';
import './App.css';
import Settings from './Settings';
import Items from './Items';
import Orders from './Orders';
import type { OrderIntent, QuotationForOrder } from './Orders';
import ExpenseTracker from './ExpenseTracker';
import Templates from './Templates';
import Dashboard from './Dashboard';
import { RoleContext, ROLE_PAGES, ROLE_HOME } from './role';
import type { Role } from './role';
import SochicBoard from './SochicBoard';

const API_BASE = '/api';

export default function App() {
  const [active, setActive] = useState('dashboard'); 
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [role, setRole] = useState<Role>('superadmin');
  // "Make Order" on a quotation hands it to the Orders page, which opens the prefilled form.
  const [menuOpen, setMenuOpen] = useState(false);
  const [orderIntent, setOrderIntent] = useState<OrderIntent | null>(null);

  const handleMakeOrder = (quotation: QuotationForOrder) => {
    setOrderIntent({ kind: 'fromQuotation', quotation });
    setActive('orders');
  };

  const handleOpenOrder = (orderId: number) => {
    setOrderIntent({ kind: 'edit', orderId });
    setActive('orders');
  };

  const handleSelect = (id: string) => {
    setActive(id);
    setMenuOpen(false);
  };

  useEffect(() => {
    fetch(`${API_BASE}/auth/check`, { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        setAuthenticated(!!data.authenticated);
        if (data.role === 'japan') {
          setRole('japan');
          setActive(ROLE_HOME.japan);
        }
      })
      .catch(() => setAuthenticated(false))
      .finally(() => setAuthChecked(true));
  }, []);

  // Any request that comes back 401 means the session lapsed, so drop straight back to login
  // instead of leaving the shell up with empty panels.
  useEffect(() => {
    setUnauthorizedHandler(() => setAuthenticated(false));
    return () => setUnauthorizedHandler(null);
  }, []);

  const handleLogout = async () => {
    await fetch(`${API_BASE}/auth/logout`, { method: 'POST', credentials: 'include' });
    setAuthenticated(false);
    setRole('superadmin');
    setActive(ROLE_HOME.superadmin);
  };

  if (!authChecked) {
    return null;
  }

  if (!authenticated) {
    return (
      <Login
        onSuccess={(r) => {
          setRole(r);
          setActive(ROLE_HOME[r]);
          setAuthenticated(true);
        }}
      />
    );
  }

  // Only render pages this role may open, whatever `active` says.
  const page = ROLE_PAGES[role].includes(active) ? active : ROLE_HOME[role];

  return (
    <RoleContext.Provider value={role}>
    <div className="app-shell">
      <header className="mobile-topbar">
        <button
          className="menu-toggle"
          onClick={() => setMenuOpen(true)}
          aria-label="Open menu"
          aria-expanded={menuOpen}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <span className="mobile-topbar-title">So Chic Gifts</span>
      </header>
      <Sidebar active={page} role={role} onSelect={handleSelect} onLogout={handleLogout} open={menuOpen} onClose={() => setMenuOpen(false)} />
      <main className="app-content">
        {page === 'dashboard' && <Dashboard onOpenOrder={handleOpenOrder} />}
        {page === 'board' && (
          <SochicBoard
            onOpenOrder={handleOpenOrder}
            onNewOrder={() => { setOrderIntent({ kind: 'new' }); setActive('orders'); }}
          />
        )}
        {page === 'quotation' && <Quotation onMakeOrder={handleMakeOrder} />} 
        {page === 'qr' && <QRCodeGenerator />}
        {page === 'settings' && <Settings />}
        {page === 'items-thailand' && <Items key="thailand" country="thailand" />}
        {page === 'items-japan' && <Items key="japan" country="japan" />}
        {page === 'orders' && (
          <Orders intent={orderIntent} onIntentHandled={() => setOrderIntent(null)} />
        )}
        {page === 'expenses' && <ExpenseTracker />}
        {page === 'templates' && <Templates />}
      </main>
    </div>
    </RoleContext.Provider>
  );
}