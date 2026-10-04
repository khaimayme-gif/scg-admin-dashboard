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

const API_BASE = '/api';

export default function App() {
  const [active, setActive] = useState('quotation'); 
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  // "Make Order" on a quotation hands it to the Orders page, which opens the prefilled form.
  const [orderIntent, setOrderIntent] = useState<OrderIntent | null>(null);

  const handleMakeOrder = (quotation: QuotationForOrder) => {
    setOrderIntent({ kind: 'fromQuotation', quotation });
    setActive('orders');
  };

  useEffect(() => {
    fetch(`${API_BASE}/auth/check`, { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => setAuthenticated(!!data.authenticated))
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
  };

  if (!authChecked) {
    return null;
  }

  if (!authenticated) {
    return <Login onSuccess={() => setAuthenticated(true)} />;
  }

  return (
    <div className="app-shell">
      <Sidebar active={active} onSelect={setActive} onLogout={handleLogout} />
      <main className="app-content">
        {active === 'quotation' && <Quotation onMakeOrder={handleMakeOrder} />} 
        {active === 'qr' && <QRCodeGenerator />}
        {active === 'settings' && <Settings />}
        {active === 'items' && <Items />}
        {active === 'orders' && (
          <Orders intent={orderIntent} onIntentHandled={() => setOrderIntent(null)} />
        )}
        {active === 'expenses' && <ExpenseTracker />}
      </main>
    </div>
  );
}