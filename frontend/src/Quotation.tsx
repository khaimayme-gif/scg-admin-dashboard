import { useState, useEffect, Fragment } from 'react';
import { apiFetch, jsonBody } from './api';
import { renderQuotationPng, downloadBlob } from './quotationImage';
import type { QuotationForOrder } from './Orders';
import { useRole } from './role';
import { platformFeeJpy } from './platformFee';

type PriceCurrency = 'THB' | 'JPY';
type PayCurrency = 'THB' | 'JPY' | 'MMK';

interface QuoteItem {
  name: string;
  sellingPrice: number; // in the quotation's price currency
  originalPrice: number;
  payPrice?: number; // in the currency the customer pays in
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
  platform_fee_jpy: number | null; // Japan quotations only
  price_currency: PriceCurrency; // what the prices were typed in
  pay_currency: PayCurrency; // what the customer is quoted and pays in
  total_pay: number | null; // total in pay_currency, as quoted
  rate_thb_to_jpy: number | null;
  rate_thb_to_mmk: number | null;
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
const PLACES = ['Thailand', 'Japan'];

const fmt = (n: number) => Math.round(n).toLocaleString();
const money = (n: number, cur: string) => `${fmt(n)} ${cur}`;

// Quotations made before currencies existed were in baht from start to finish.
const payCur = (q: Quotation): PayCurrency => q.pay_currency ?? 'THB';
const payTotal = (q: Quotation) => q.total_pay ?? q.total_thb;
const payLine = (_q: Quotation, it: QuoteItem) => it.payPrice ?? it.sellingPrice;

const PRICE_CURRENCIES: PriceCurrency[] = ['THB', 'JPY'];
const PAY_CURRENCIES: PayCurrency[] = ['THB', 'JPY', 'MMK'];
// Sensible defaults: Japan works in yen, everything else in baht.
const defaultsFor = (place: string): { price: PriceCurrency; pay: PayCurrency } =>
  place === 'Japan' ? { price: 'JPY', pay: 'JPY' } : { price: 'THB', pay: 'THB' };

// en-CA formats as YYYY-MM-DD in the local timezone.
const todayLocal = () => new Date().toLocaleDateString('en-CA');

const emptyItem = (): FormItem => ({ name: '', sellingPrice: '', originalPrice: '' });

interface QuotationProps {
  // Switches to the Orders page with the order form filled from this quotation
  // (or, if it already became an order, opens that order).
  onMakeOrder?: (q: QuotationForOrder) => void;
}

export default function Quotation({ onMakeOrder }: QuotationProps) {
  // The Japan admin can only quote for Japan; the server enforces it too.
  const isJapan = useRole() === 'japan';
  const places = isJapan ? ['Japan'] : PLACES;
  const [customerName, setCustomerName] = useState('');
  const [channel, setChannel] = useState('tiktok');
  const [quoteDate, setQuoteDate] = useState(todayLocal());
  const [orderPlace, setOrderPlace] = useState('Thailand');
  const [priceCurrency, setPriceCurrency] = useState<PriceCurrency>(isJapan ? 'JPY' : 'THB');
  const [payCurrency, setPayCurrency] = useState<PayCurrency>(isJapan ? 'JPY' : 'THB');
  const [items, setItems] = useState<FormItem[]>([emptyItem()]);

  const [rates, setRates] = useState<Rates | null>(null);
  const [history, setHistory] = useState<Quotation[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const toggleExpanded = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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
  const totalEntry = namedItems.reduce((sum, it) => sum + (Number(it.sellingPrice) || 0), 0);
  const originalEntry = namedItems.reduce((sum, it) => sum + (Number(it.originalPrice) || 0), 0);
  const revenueEntry = totalEntry - originalEntry;
  const feePlace = isJapan ? 'Japan' : orderPlace;

  // Everything goes through THB with the Settings rates, like the server does.
  const needsRates = priceCurrency === 'JPY' || payCurrency !== 'THB' || feePlace === 'Japan';
  const ready = !needsRates || Boolean(rates);
  const toThb = (amount: number, cur: PriceCurrency) => (cur === 'JPY' && rates ? amount / rates.thbToJpy : amount);
  const fromThb = (thb: number, cur: PayCurrency) =>
    !rates ? thb : cur === 'JPY' ? thb * rates.thbToJpy : cur === 'MMK' ? thb * rates.thbToMmk : thb;
  const linePay = (selling: number) =>
    priceCurrency === payCurrency ? selling : Math.round(fromThb(toThb(selling, priceCurrency), payCurrency));
  const totalPay = namedItems.reduce((sum, it) => sum + linePay(Number(it.sellingPrice) || 0), 0);
  const totalThb = toThb(totalEntry, priceCurrency);
  // Japan quotations get the SochicGifts platform fee, worked out from the yen total.
  const totalJpy = priceCurrency === 'JPY' ? totalEntry : rates ? Math.round(totalThb * rates.thbToJpy) : null;
  const platformFee = feePlace === 'Japan' && totalJpy !== null ? platformFeeJpy(totalJpy) : null;

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
        orderPlace: isJapan ? 'Japan' : orderPlace,
        priceCurrency,
        payCurrency,
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
    setOrderPlace(isJapan ? 'Japan' : 'Thailand');
    setPriceCurrency(isJapan ? 'JPY' : 'THB');
    setPayCurrency(isJapan ? 'JPY' : 'THB');
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
        currency: payCur(q),
        items: q.items.map((it) => ({ name: it.name, sellingPrice: payLine(q, it) })),
      });
      downloadBlob(blob, `SCG-Quotation-${q.quote_no}.png`);
    } catch {
      setError('Could not create the quotation image.');
    } finally {
      setDownloadingId(null);
    }
  };


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
                <li key={i}>{it.name}: {money(payLine(lastQuotation, it), payCur(lastQuotation))}</li>
              ))}
            </ol>
            <p className="quote-total">
              Quotation is {money(payTotal(lastQuotation), payCur(lastQuotation))} in total.
            </p>
          </div>
          <p className="stat-sub">
            Revenue {fmt(lastQuotation.revenue_thb)} THB
            {lastQuotation.platform_fee_jpy !== null && ` · Platform fee ${fmt(lastQuotation.platform_fee_jpy)} Yen`}
            , for you only, never shown to the customer.
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
              <select className="item-input" value={isJapan ? 'Japan' : orderPlace} disabled={isJapan} onChange={(e) => {
                const place = e.target.value;
                setOrderPlace(place);
                setPriceCurrency(defaultsFor(place).price);
                setPayCurrency(defaultsFor(place).pay);
              }}>
                {places.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="order-form-grid">
            <div className="order-field">
              <label>Prices entered in</label>
              <div className="toggle-group">
                {PRICE_CURRENCIES.map((c) => (
                  <button key={c} type="button" className={`toggle-btn ${priceCurrency === c ? 'is-active' : ''}`} onClick={() => setPriceCurrency(c)}>{c}</button>
                ))}
              </div>
            </div>
            <div className="order-field">
              <label>Customer pays in (printed)</label>
              <div className="toggle-group">
                {PAY_CURRENCIES.map((c) => (
                  <button key={c} type="button" className={`toggle-btn ${payCurrency === c ? 'is-active' : ''}`} onClick={() => setPayCurrency(c)}>{c}</button>
                ))}
              </div>
            </div>
          </div>
          {!ready && <p className="warn-text">Set the exchange rates in Settings to use this currency.</p>}

          <h3 className="order-subheading">Items (prices in {priceCurrency})</h3>
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
              <div className={`order-profit ${revenueEntry < 0 ? 'profit-negative' : ''}`}>{money(revenueEntry, priceCurrency)}</div>
            </div>
            <div className="order-field">
              <label>Total in {priceCurrency}</label>
              <div className="order-profit">{money(totalEntry, priceCurrency)}</div>
            </div>
            <div className="order-field">
              <label>Customer pays ({payCurrency})</label>
              <div className="order-profit">{ready ? money(totalPay, payCurrency) : 'Set rates in Settings'}</div>
            </div>
            {feePlace === 'Japan' && (
              <div className="order-field">
                <label>Platform fee (auto)</label>
                <div className="order-profit">{platformFee === null ? 'Set rates in Settings' : `${fmt(platformFee)} Yen`}</div>
              </div>
            )}
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
            <table className="items-table orders-compact quotations-compact">
              <thead>
                <tr>
                  <th>Quotation</th>
                  <th>Customer</th>
                  <th>Status</th>
                  <th className="num-col">Customer pays</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {history.map((q) => {
                  const isOpen = expanded.has(q.id);
                  return (
                    <Fragment key={q.id}>
                      <tr className={isOpen ? 'is-open' : ''}>
                        <td>
                          <span className="cell-main">{q.quote_no}</span>
                          <span className="cell-sub">{q.quote_date}</span>
                        </td>
                        <td>
                          <span className="cell-main">{q.customer_name}</span>
                          <span className="cell-sub">{q.items.map((i) => i.name).join(', ')}</span>
                        </td>
                        <td>
                          <span className={`status-pill ${q.order_id ? 'status-paid' : ''}`}>
                            {q.order_id ? 'Ordered' : 'Quoted'}
                          </span>
                        </td>
                        <td className="items-price-cell num-col">{money(payTotal(q), payCur(q))}</td>
                        <td className="row-action-cell">
                          <button
                            className={`details-btn ${isOpen ? 'is-open' : ''}`}
                            onClick={() => toggleExpanded(q.id)}
                            aria-expanded={isOpen}
                          >
                            Details
                            <span className="details-caret" aria-hidden="true">▾</span>
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="detail-row">
                          <td colSpan={5}>
                            <div className="order-detail">
                              <dl className="detail-grid">
                                <div><dt>Order place</dt><dd>{q.order_place}</dd></div>
                                <div><dt>Channel</dt><dd>{CHANNELS[q.channel] ?? q.channel}</dd></div>
                                <div><dt>Prices entered in</dt><dd>{q.price_currency ?? 'THB'}</dd></div>
                                <div><dt>In MMK</dt><dd className="items-price-cell">{q.total_mmk === null ? '—' : `${fmt(q.total_mmk)} MMK`}</dd></div>
                                <div><dt>In Yen</dt><dd className="items-price-cell">{q.total_jpy === null ? '—' : `${fmt(q.total_jpy)} Yen`}</dd></div>
                                {q.platform_fee_jpy !== null && (
                                  <div><dt>Platform fee</dt><dd className="items-price-cell">{fmt(q.platform_fee_jpy)} Yen</dd></div>
                                )}
                                <div><dt>Original cost</dt><dd className="items-price-cell">{fmt(q.original_thb)} THB</dd></div>
                                <div>
                                  <dt>Revenue</dt>
                                  <dd className={`items-price-cell ${q.revenue_thb < 0 ? 'profit-negative' : ''}`}>{fmt(q.revenue_thb)} THB</dd>
                                </div>
                              </dl>
                              <div className="detail-items">
                                <span className="detail-label">Items</span>
                                <ul>
                                  {q.items.map((it, i) => (
                                    <li key={i}><span>{it.name}: {money(payLine(q, it), payCur(q))}</span></li>
                                  ))}
                                </ul>
                              </div>
                              <div className="detail-actions">
                                {onMakeOrder && (
                                  <button className="save-btn" onClick={() => onMakeOrder(q)}>
                                    {q.order_id ? `Open order ${q.order_no ?? ''}` : 'Make Order'}
                                  </button>
                                )}
                                <button
                                  className="add-item-btn"
                                  onClick={() => handleDownload(q)}
                                  disabled={downloadingId === q.id}
                                >
                                  {downloadingId === q.id ? 'Preparing…' : 'Download'}
                                </button>
                                <button className="order-edit-btn danger-link" onClick={() => handleDelete(q)}>Delete</button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
