import { useState, useEffect } from 'react';
import { apiFetch, jsonBody } from './api';
import { renderQuotationPng, downloadBlob } from './quotationImage';
import type { QuotationForOrder } from './Orders';

interface QuoteItem {
  name: string;
  sellingPrice: number;
  originalPrice: number;
}

interface Quotation {
  id: number;
  quote_no: string;
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
  order_id: number | null; // set once "Make Order" has turned this quotation into an order
  order_no: string | null;
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

interface QuotationProps {
  // Switches to the Orders page with the order form filled from this quotation
  // (or, if it already became an order, opens that order).
  onMakeOrder?: (q: QuotationForOrder) => void;
}

export default function Quotation({ onMakeOrder }: QuotationProps) {
  const [customerName, setCustomerName] = useState('');
  const [channel, setChannel] = useState('tiktok');
  const [quoteDate, setQuoteDate] = useState(todayLocal());
  const [orderPlace, setOrderPlace] = useState('Thailand');
  const [items, setItems] = useState<FormItem[]>([emptyItem()]);

  const [rates, setRates] = useState<Rates | null>(null);
  const [history, setHistory] = useState<Quotation[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  // The newest saved quotation, shown as a card. history is sorted newest-first by the server.
  const lastQuotation = history[0] ?? null;

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
      await res.json();
      setShowForm(false);
      loadHistory();
    } catch {
      // a 401 has already sent us back to login
    } finally {
      setSaving(false);
    }
  };

  const startNew = () => {
    setShowForm(true);
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
    loadHistory();
  };

  const handleDownload = async (q: Quotation) => {
    setDownloadingId(q.id);
    try {
      const blob = await renderQuotationPng({
        quoteNo: q.quote_no,
        quoteDate: q.quote_date,
        items: q.items.map((it) => ({ name: it.name, sellingPrice: it.sellingPrice })),
        totalMmk: q.total_mmk,
      });
      downloadBlob(blob, `SCG-Quotation-${q.quote_no}.png`);
    } catch {
      setError('Could not create the quotation image.');
    } finally {
      setDownloadingId(null);
    }
  };

  const makeOrderButton = (q: Quotation) =>
    onMakeOrder && (
      <button
        className={`make-order-btn ${q.order_id ? 'is-ordered' : ''}`}
        onClick={() => onMakeOrder(q)}
        title={q.order_id ? `Already order ${q.order_no}. Click to open it.` : 'Customer paid: turn this quotation into an order'}
      >
        {q.order_id ? `Order ${q.order_no ?? ''} ✓` : 'Make Order'}
      </button>
    );

  const amountLine = (mmk: number | null, jpy: number | null) =>
    mmk === null || jpy === null ? 'Set exchange rates in Settings' : `${fmt(mmk)} MMK and ${fmt(jpy)} Yen`;

  return (
    <div className="page">
      <header className="page-header page-header-row">
        <div>
          <h1>Quotation</h1>
          <p className="page-subtitle">Get a quotation for a customer, then turn it into an order.</p>
        </div>
        <button className="new-order-btn" onClick={startNew}>New Quotation</button>
      </header>

      {lastQuotation && (
        <div className="calc-panel quote-latest">
          <h2 className="panel-label">Latest quotation</h2>
          <div className="quote-summary">
            <p><strong>{lastQuotation.customer_name}</strong></p>
            <p>Quotation ID: {lastQuotation.quote_no}</p>
            <p>Channel: {CHANNELS[lastQuotation.channel] ?? lastQuotation.channel}</p>
            <p>Date: {lastQuotation.quote_date}</p>
            <p>Order place: {lastQuotation.order_place}</p>
            <ol className="quote-lines">
              {lastQuotation.items.map((it, i) => (
                <li key={i}>{it.name}: {fmt(it.sellingPrice)} THB</li>
              ))}
            </ol>
            <p className="quote-total">
              Quotation is {fmt(lastQuotation.total_thb)} THB in total.
              <br />
              ({amountLine(lastQuotation.total_mmk, lastQuotation.total_jpy)})
            </p>
          </div>
          <p className="stat-sub">
            Revenue {fmt(lastQuotation.revenue_thb)} THB, for you only, never shown to the customer.
          </p>
          <div className="order-form-actions">
            <button
              className="save-btn"
              onClick={() => handleDownload(lastQuotation)}
              disabled={downloadingId === lastQuotation.id}
            >
              {downloadingId === lastQuotation.id ? 'Preparing…' : 'Download quotation'}
            </button>
            {onMakeOrder && (
              <button className="save-btn save-btn-secondary" onClick={() => onMakeOrder(lastQuotation)}>
                {lastQuotation.order_id ? `Open order ${lastQuotation.order_no ?? ''}` : 'Make Order'}
              </button>
            )}
          </div>
        </div>
      )}

      {showForm && (
        <div className="modal-backdrop">
        <div className="modal-card">
          <div className="modal-header">
            <h2 className="panel-label">New quotation</h2>
            <button className="item-remove" onClick={() => setShowForm(false)} aria-label="Close">×</button>
          </div>

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
              {saving ? 'Saving…' : 'Create quotation'}
            </button>
            <button className="add-item-btn" onClick={() => setShowForm(false)} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
        </div>
      )}

      <div className="calc-panel">
        <h2 className="panel-label">All quotations</h2>
        {history.length === 0 ? (
          <p className="empty-state">No quotations yet.</p>
        ) : (
          <div className="orders-table-wrap">
            <table className="items-table">
              <thead>
                <tr>
                  <th>Quotation ID</th>
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
                    <td>{q.quote_no}</td>
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
                    <td className="quote-row-actions">
                      {makeOrderButton(q)}
                      <button
                        className="item-remove"
                        onClick={() => handleDownload(q)}
                        disabled={downloadingId === q.id}
                        aria-label="Download quotation"
                        title="Download quotation"
                      >
                        {downloadingId === q.id ? '…' : '⬇'}
                      </button>
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
