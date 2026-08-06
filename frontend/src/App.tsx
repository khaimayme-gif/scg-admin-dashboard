import { useState, useEffect } from 'react';
import Sidebar from './Sidebar';
import PriceCalculator from './PriceCalculator';
import QRCodeGenerator from './QRCodeGenerator';
import Login from './Login';
import './App.css';
import Settings from './Settings';
import Items from './Items';

const API_BASE = '/api';

export default function App() {
  const [active, setActive] = useState('price-calculator');
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/auth/check`, { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => setAuthenticated(!!data.authenticated))
      .catch(() => setAuthenticated(false))
      .finally(() => setAuthChecked(true));
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
        {active === 'price-calculator' && <PriceCalculator />}
        {active === 'qr' && <QRCodeGenerator />}
        {active === 'settings' && <Settings />}
        {active === 'items' && <Items />}
      </main>
    </div>
  );
}