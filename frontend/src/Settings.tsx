import { useState, useEffect } from 'react';

const API_BASE = '/api';

export default function Settings() {
  const [rateThbToJpy, setRateThbToJpy] = useState('');
  const [rateThbToMmk, setRateThbToMmk] = useState('');
  const [rateMmkToJpy, setRateMmkToJpy] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'saving' | 'saved' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    fetch(`${API_BASE}/settings`, { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        if (data.rateThbToJpy !== null) setRateThbToJpy(String(data.rateThbToJpy));
        if (data.rateThbToMmk !== null) setRateThbToMmk(String(data.rateThbToMmk));
        if (data.rateMmkToJpy !== null) setRateMmkToJpy(String(data.rateMmkToJpy));
        setStatus('idle');
      })
      .catch(() => {
        setErrorMsg('Could not load current rates.');
        setStatus('error');
      });
  }, []);

  const handleSave = async () => {
    setStatus('saving');
    setErrorMsg('');
    try {
      const res = await fetch(`${API_BASE}/settings/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          rateThbToJpy: Number(rateThbToJpy) || 0,
          rateThbToMmk: Number(rateThbToMmk) || 0,
          rateMmkToJpy: Number(rateMmkToJpy) || 0,
        }),
      });
      if (!res.ok) throw new Error();
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2000);
    } catch {
      setErrorMsg('Could not save the rates.');
      setStatus('error');
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <h1>Settings</h1>
        <p className="page-subtitle">Exchange rates used to show quotes in all three currencies.</p>
      </header>

      <div className="calc-panel" style={{ maxWidth: 420 }}>
        <h2 className="panel-label">Exchange rates</h2>

        <div className="delivery-row">
          <label htmlFor="rate-thb-jpy">1 THB =</label>
          <div className="item-input-cost-wrap">
            <input
              id="rate-thb-jpy"
              type="number"
              step="0.01"
              placeholder="0"
              value={rateThbToJpy}
              onChange={(e) => setRateThbToJpy(e.target.value)}
              className="item-input item-input-cost"
              min="0"
            />
            <span className="currency-prefix">JPY</span>
          </div>
        </div>

        <div className="delivery-row">
          <label htmlFor="rate-thb-mmk">1 THB =</label>
          <div className="item-input-cost-wrap">
            <input
              id="rate-thb-mmk"
              type="number"
              step="0.01"
              placeholder="0"
              value={rateThbToMmk}
              onChange={(e) => setRateThbToMmk(e.target.value)}
              className="item-input item-input-cost"
              min="0"
            />
            <span className="currency-prefix">MMK</span>
          </div>
        </div>

        <div className="delivery-row">
          <label htmlFor="rate-mmk-jpy">1 MMK =</label>
          <div className="item-input-cost-wrap">
            <input
              id="rate-mmk-jpy"
              type="number"
              step="0.01"
              placeholder="0"
              value={rateMmkToJpy}
              onChange={(e) => setRateMmkToJpy(e.target.value)}
              className="item-input item-input-cost"
              min="0"
            />
            <span className="currency-prefix">JPY</span>
          </div>
        </div>

        <button
          className="calculate-btn"
          onClick={handleSave}
          disabled={status === 'loading' || status === 'saving'}
        >
          {status === 'saved' ? 'Saved ✓' : status === 'saving' ? 'Saving…' : 'Save rates'}
        </button>

        {status === 'error' && <p className="error-text">{errorMsg}</p>}
      </div>
    </div>
  );
}