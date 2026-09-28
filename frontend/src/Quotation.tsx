import { useState, useEffect } from 'react';
import { apiFetch, jsonBody } from './api';

interface QuoteItem {
  name: string;
  sellingPrice: number;
  originalPrice: number;
}

interface Quotation {
  id: number;
  customer_name: string;
  channel: string;
  quote_date: string;
  order_place: string;
  items: QuoteItem[];
  total_thb: number;
  original_thb: number;
  revenue_thb: number;
  total_mmk: number | null;
  total_jpy: number | null;
}

interface FormItem {
  name: string;
  sellingPrice: string;
  originalPrice: string;
}

interface Rates {
  thbToMmk: number;
  thbToJpy: number;
}

const CHANNELS: Record<string, string> = { tiktok: 'TikTok', facebook: 'Facebook' };
const PLACES = ['Thailand', 'Japan', 'Myanmar'];

const fmt = (n: number) => Math.round(n).toLocaleString();

// en-CA formats as YYYY-MM-DD in the local timezone.
const todayLocal = () => new Date().toLocaleDateString('en-CA');

const emptyItem = (): FormItem => ({ name: '', sellingPrice: '', originalPrice: '' });

export default function Quotation() {
  const [customerName, setCustomerName] = useState('');
  const [channel, setChannel] = useState('tiktok');
  const [quoteDate, setQuoteDate] = useState(todayLocal());
  const [orderPlace, setOrderPlace] = useState('Thailand');
  const [items, setItems] = useState<FormItem[]>([emptyItem()]);

  const [rates, setRates] = useState<Rates | null>(null);
  const [history, setHistory] = useState<Quotation[]>([]);
  const [saved, setSaved] = useState<Quotation | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadHistory = () => {
    apiFetch('/quotations')
      .then((res) => res.json())
      .then(setHistory)
      .catch(() => {});
  };

  useEffect(() => {
    loadHistory();
    apiFetch('/settings')
      .then((res) => res.json())
      .then((data) => {
        if (data.rateThbToMmk && data.rateThbToJpy) {
          setRates({ thbToMmk: data.rateThbToMmk, thbToJpy: data.rateThbToJpy });
        }
      })
      .catch(() => {});
  }, []);

  const updateItem = (index: number, key: keyof FormItem, value: string) => {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, [key]: value } : it)));
  };

  const addItem = () => setItems((prev) => [...prev, emptyItem()]);

  const removeItem = (index: number) => {
    setItems((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  // Live numbers for the form. The server recalculates the same figures when the quotation is saved.
  const namedItems = items.filter((it) => it.name.trim());
  const totalThb = namedItems.reduce((sum, it) => sum + (Number(it.sellingPrice) || 0), 0);
  const originalThb = namedItems.reduce((sum, it) => sum + (Number(it.originalPrice) || 0), 0);
  const revenueThb = totalThb - originalThb;

  const handleSubmit = async () => {
    if (!customerName.trim()) {
      setError('Enter the customer name.');
      return;
    }
    if (namedItems.length === 0) {
      setError('Add at least one item with a name.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      const res = await apiFetch('/quotations/save', jsonBody({
        customerName,
        channel,
        quoteDate,
        orderPlace,
        items: namedItems.map((it) => ({
          name: it.name.trim(),
          sellingPrice: Number(it.sellingPrice) || 0,
          originalPrice: Number(it.originalPrice) || 0,
        })),
      }));
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Could not save the quotation.');
        return;
      }
      setSaved(await res.json());
      loadHistory();
    } catch {
      // a 401 has already sent us back to login
    } finally {
      setSaving(false);
    }
  };

  const startNew = () => {
    setSaved(null);
    setCustomerName('');
    setChannel('tiktok');
    setQuoteDate(todayLocal());
    setOrderPlace('Thailand');
    setItems([emptyItem()]);
    setError('');
  };

  const handleDelete = async (q: Quotation) => {
    if (!window.confirm(`Delete the quotation for ${q.customer_name}?`)) return;
    try {
      await apiFetch(`/quotations/delete/${q.id}`, { method: 'DELETE' });
    } catch {
      return;
    }
    if (saved?.id === q.id) setSaved(null);
    loadHistory();
  };

  const amountLine = (mmk: number | null, jpy: number | null) =>
    mmk === null || jpy === null ? 'Set exchange rates in Settings' : `${fmt(mmk)} MMK and ${fmt(jpy)} Yen`;

  return (
    <div className="page">
      <header className="page-header">
        <h1>Quotation</h1>
        <p className="page-subtitle">Get a quotation for a customer, then turn it into an order.</p>
      </header>

      {saved ? (
        <div className="calc-panel">
          <h2 className="panel-label">Quotation ready</h2>
          <div className="quote-summary">
            <p><strong>{saved.customer_name}</strong></p>
            <p>Channel: {CHANNELS[saved.channel] ?? saved.channel}</p>
            <p>Date: {saved.quote_date}</p>
            <p>Order place: {saved.order_place}</p>
            <ol className="quote-lines">
              {saved.items.map((it, i) => (
                <li key={i}>{it.name}: {fmt(it.sellingPrice)} THB</li>
              ))}
            </ol>
            <p className="quote-total">
              Quotation is {fmt(saved.total_thb)} THB in total.
              <br />
              ({amountLine(saved.total_mmk, saved.total_jpy)})
            </p>
          </div>
          <p className="stat-sub">
            Revenue {fmt(saved.revenue_thb)} THB, for you only, never shown to the customer.
          </p>
          <div className="order-form-actions">
            <button className="add-item-btn" onClick={startNew}>New quotation</button>
          </div>
        </div>
      ) : (
        <div className="calc-panel">
          <h2 className="panel-label">Get Quotation</h2>

          <div className="order-form-grid">
            <div className="order-field">
              <label>Customer name</label>
              <input
                type="text"
                className="item-input"
                placeholder="Customer name"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
            </div>
            <div className="order-field">
              <label>Channel</label>
              <select className="item-input" value={channel} onChange={(e) => setChannel(e.target.value)}>
                {Object.entries(CHANNELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className="order-field">
              <label>Date</label>
              <input
                type="date"
                className="item-input"
                value={quoteDate}
                onChange={(e) => setQuoteDate(e.target.value)}
              />
            </div>
            <div className="order-field">
              <label>Order place</label>
              <select className="item-input" value={orderPlace} onChange={(e) => setOrderPlace(e.target.value)}>
                {PLACES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
          </div>

          <h3 className="order-subheading">Items (prices in THB)</h3>
          <div className="order-item-lines">
            {items.map((it, index) => (
              <div className="item-row" key={index}>
                <input
                  type="text"
                  className="item-input"
                  style={{ flex: 1 }}
                  placeholder={`Item ${index + 1} name`}
                  value={it.name}
                  onChange={(e) => updateItem(index, 'name', e.target.value)}
                />
                <input
                  type="number"
                  className="item-input order-item-price"
                  min="0"
                  placeholder="Selling price"
                  value={it.sellingPrice}
                  onChange={(e) => updateItem(index, 'sellingPrice', e.target.value)}
                  aria-label="Selling price"
                />
                <input
                  type="number"
                  className="item-input order-item-price"
                  min="0"
                  placeholder="Original price"
                  value={it.originalPrice}
                  onChange={(e) => updateItem(index, 'originalPrice', e.target.value)}
                  aria-label="Original price"
                />
                <button
                  className="item-remove"
                  onClick={() => removeItem(index)}
                  disabled={items.length === 1}
                  aria-label="Remove item"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="order-form-actions">
            <button className="add-item-btn" onClick={addItem}>+ Add item</button>
          </div>

          <div className="order-form-grid" style={{ marginTop: 16 }}>
            <div className="order-field">
              <label>Revenue (selling minus original, auto)</label>
              <div className={`order-profit ${revenueThb < 0 ? 'profit-negative' : ''}`}>{fmt(revenueThb)} THB</div>
            </div>
            <div className="order-field">
              <label>Quotation total</label>
              <div className="order-profit">{fmt(totalThb)} THB</div>
            </div>
            <div className="order-field">
              <label>In MMK</label>
              <div className="order-profit">{rates ? `${fmt(totalThb * rates.thbToMmk)} MMK` : 'Set rates in Settings'}</div>
            </div>
            <div className="order-field">
              <label>In Yen</label>
              <div className="order-profit">{rates ? `${fmt(totalThb * rates.thbToJpy)} Yen` : 'Set rates in Settings'}</div>
            </div>
          </div>

          {error && <p className="error-text">{error}</p>}

          <div className="order-form-actions">
            <button className="save-btn" onClick={handleSubmit} disabled={saving}>
              {saving ? 'Saving…' : 'Get quotation'}
            </button>
          </div>
        </div>
      )}

      <div className="calc-panel">
        <h2 className="panel-label">Previous quotations</h2>
        {history.length === 0 ? (
          <p className="empty-state">No quotations yet.</p>
        ) : (
          <div className="orders-table-wrap">
            <table className="items-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Place</th>
                  <th>Channel</th>
                  <th>Items</th>
                  <th>Total</th>
                  <th>MMK</th>
                  <th>Yen</th>
                  <th>Revenue</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {history.map((q) => (
                  <tr key={q.id}>
                    <td>{q.quote_date}</td>
                    <td>{q.customer_name}</td>
                    <td>{q.order_place}</td>
                    <td>{CHANNELS[q.channel] ?? q.channel}</td>
                    <td>{q.items.map((i) => i.name).join(', ')}</td>
                    <td className="items-price-cell">{fmt(q.total_thb)} THB</td>
                    <td className="items-price-cell">{q.total_mmk === null ? '—' : fmt(q.total_mmk)}</td>
                    <td className="items-price-cell">{q.total_jpy === null ? '—' : fmt(q.total_jpy)}</td>
                    <td className={`items-price-cell ${q.revenue_thb < 0 ? 'profit-negative' : ''}`}>
                      {fmt(q.revenue_thb)} THB
                    </td>
                    <td>
                      <button className="item-remove" onClick={() => handleDelete(q)} aria-label="Delete quotation">×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
