import { useState, useEffect, Fragment } from 'react';
import { apiFetch, jsonBody } from './api';
import { renderOrderPng } from './orderImage';
import { downloadBlob } from './quotationImage';

interface OrderItem {
  name: string;
  quantity: number;
  price?: number; // cost price per unit
  sellingPrice?: number; // customer-facing price per unit
  details?: string;
}

interface Order {
  id: number;
  order_no: string | null;
  quotation_id: number | null;
  customer_name: string;
  country: string;
  channel: string | null;
  order_date: string;
  status: string;
  currency: string;
  selling_price: number;
  cost: number;
  revenue: number;
  items: OrderItem[];
  notes: string | null;
  recipient: string | null;
  recipient_phone: string | null;
  delivery_date: string | null;
  delivery_address: string | null;
  delivery_note: string | null;
}

// What the Quotation page hands over when the admin clicks "Make Order".
export interface QuotationForOrder {
  id: number;
  quote_no: string;
  customer_name: string;
  channel: string;
  order_place: string;
  total_thb: number;
  items: { name: string; sellingPrice: number; originalPrice: number }[];
}

export type OrderIntent =
  | { kind: 'fromQuotation'; quotation: QuotationForOrder }
  | { kind: 'edit'; orderId: number }
  | { kind: 'new' };

interface Totals {
  orderCount: number;
  sellingThb: number;
  costThb: number;
  revenueThb: number;
}

interface MonthStats extends Totals {
  month: string; // YYYY-MM
  cancelledCount: number;
}

interface Stats extends Totals {
  cancelledCount: number;
  monthly: MonthStats[];
  unconverted: number;
}

interface CatalogItem {
  id: number;
  name: string;
  menu_price: number;
  original_cost: number | null;
}

interface FormItem {
  name: string;
  quantity: string;
  price: string; // cost
  sellingPrice: string;
  details: string;
}

interface FormState {
  id: number | null;
  orderNo: string | null;
  quotationId: number | null;
  quoteNo: string | null;
  customerName: string;
  country: string;
  channel: string;
  orderDate: string;
  status: string;
  currency: string;
  sellingPrice: string;
  items: FormItem[];
  notes: string;
  recipient: string;
  recipientPhone: string;
  deliveryDate: string;
  deliveryAddress: string;
  deliveryNote: string;
}

// Payment status only. Where an order is in its delivery journey lives on So Chic Board.
// 'cancelled' is kept for orders cancelled before the board existed; it can't be picked anymore.
const STATUS_LABELS: Record<string, string> = {
  pending: 'Unpaid',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

const CURRENCIES = ['THB', 'JPY', 'MMK'];
const CHANNELS: Record<string, string> = { tiktok: 'TikTok', facebook: 'Facebook' };
const COMMON_COUNTRIES = ['Japan', 'Thailand', 'Myanmar'];

const fmt = (n: number) => Math.round(n).toLocaleString();

// The confirmation image shows a payment line. Orders are only confirmed after payment, so
// everything past "pending" counts as paid.
const paymentFor = (status: string): { label: string; tone: 'paid' | 'pending' | 'cancelled' } => {
  if (status === 'pending') return { label: 'awaiting payment', tone: 'pending' };
  if (status === 'partially_paid') return { label: 'partially paid', tone: 'pending' };
  if (status === 'cancelled') return { label: 'cancelled', tone: 'cancelled' };
  return { label: 'fully paid', tone: 'paid' };
};

const emptyItem = (): FormItem => ({ name: '', quantity: '1', price: '', sellingPrice: '', details: '' });

// en-CA formats as YYYY-MM-DD in the local timezone, which avoids the off-by-one-day
// that toISOString() causes early in the morning in Thailand (UTC+7).
const todayLocal = () => new Date().toLocaleDateString('en-CA');

const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
};

function StatCards({ totals, cancelledCount }: { totals: Totals; cancelledCount: number }) {
  return (
    <div className="stat-grid">
      <div className="stat-card">
        <span className="stat-label">Total orders</span>
        <span className="stat-value">{totals.orderCount}</span>
        {cancelledCount > 0 && <span className="stat-sub">{cancelledCount} cancelled, not counted</span>}
      </div>
      <div className="stat-card">
        <span className="stat-label">Collected</span>
        <span className="stat-value">{fmt(totals.sellingThb)} THB</span>
        <span className="stat-sub">Selling price total</span>
      </div>
      <div className="stat-card">
        <span className="stat-label">Cost</span>
        <span className="stat-value">{fmt(totals.costThb)} THB</span>
      </div>
      <div className="stat-card">
        <span className="stat-label">Revenue</span>
        <span className={`stat-value ${totals.revenueThb < 0 ? 'profit-negative' : ''}`}>
          {fmt(totals.revenueThb)} THB
        </span>
        <span className="stat-sub">Collected minus cost</span>
      </div>
    </div>
  );
}

const emptyForm = (): FormState => ({
  id: null,
  orderNo: null,
  quotationId: null,
  quoteNo: null,
  customerName: '',
  country: '',
  channel: 'tiktok',
  orderDate: todayLocal(),
  status: 'pending',
  currency: 'THB',
  sellingPrice: '',
  items: [emptyItem()],
  notes: '',
  recipient: '',
  recipientPhone: '',
  deliveryDate: '',
  deliveryAddress: '',
  deliveryNote: '',
});

const formFromOrder = (order: Order): FormState => ({
  id: order.id,
  orderNo: order.order_no,
  quotationId: order.quotation_id,
  quoteNo: null,
  customerName: order.customer_name,
  country: order.country,
  channel: order.channel ?? 'tiktok',
  orderDate: order.order_date,
  status: order.status,
  currency: order.currency,
  sellingPrice: String(order.selling_price ?? 0),
  items:
    order.items.length > 0
      ? order.items.map((i) => ({
          name: i.name,
          quantity: String(i.quantity),
          price: String(i.price ?? 0),
          sellingPrice: i.sellingPrice ? String(i.sellingPrice) : '',
          details: i.details ?? '',
        }))
      : [emptyItem()],
  notes: order.notes ?? '',
  recipient: order.recipient ?? '',
  recipientPhone: order.recipient_phone ?? '',
  deliveryDate: order.delivery_date ?? '',
  deliveryAddress: order.delivery_address ?? '',
  deliveryNote: order.delivery_note ?? '',
});

// Turns a quotation into a new, unsaved order. The customer has paid by the time this runs,
// so the status starts at "Paid". Cost comes from each item's original price and the selling
// price from what was quoted.
const formFromQuotation = (q: QuotationForOrder): FormState => ({
  ...emptyForm(),
  quotationId: q.id,
  quoteNo: q.quote_no,
  customerName: q.customer_name,
  country: q.order_place,
  channel: CHANNELS[q.channel] ? q.channel : 'tiktok',
  status: 'paid',
  currency: 'THB',
  sellingPrice: String(q.total_thb ?? 0),
  items:
    q.items.length > 0
      ? q.items.map((it) => ({
          ...emptyItem(),
          name: it.name,
          price: String(it.originalPrice ?? 0),
          sellingPrice: String(it.sellingPrice ?? 0),
        }))
      : [emptyItem()],
});

// Everything the confirmation image needs, and nothing it must not show (no cost, no revenue).
const imageDataFor = (o: Order) => {
  const payment = paymentFor(o.status);
  const channel = o.channel ? (CHANNELS[o.channel] ?? o.channel) : '';
  return {
    orderNo: o.order_no ?? `#${o.id}`,
    orderDate: o.order_date,
    customer: channel ? `${o.customer_name} / ${channel}` : o.customer_name,
    recipient: o.recipient ?? '',
    recipientPhone: o.recipient_phone ?? '',
    deliveryDate: o.delivery_date ?? '',
    deliveryAddress: o.delivery_address ?? '',
    deliveryNote: o.delivery_note ?? '',
    items: o.items.map((i) => ({
      name: i.name,
      quantity: i.quantity || 1,
      sellingPrice: i.sellingPrice ?? 0,
      details: i.details ?? '',
    })),
    total: Number(o.selling_price ?? 0),
    currency: o.currency,
    paymentLabel: payment.label,
    paymentTone: payment.tone,
  };
};

interface OrdersProps {
  intent?: OrderIntent | null;
  onIntentHandled?: () => void;
}

export default function Orders({ intent = null, onIntentHandled }: OrdersProps) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(todayLocal().slice(0, 7));
  const [view, setView] = useState<'monthly' | 'all'>('monthly');
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const toggleExpanded = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [pageError, setPageError] = useState('');

  const loadAll = () =>
    Promise.all([
      apiFetch('/orders').then((res) => res.json()),
      apiFetch('/orders/stats').then((res) => res.json()),
    ])
      .then(([orderRows, statsData]) => {
        setOrders(orderRows);
        setStats(statsData);
      })
      .catch(() => {
        // a 401 has already sent us back to login
      })
      .finally(() => setLoading(false));

  useEffect(() => {
    loadAll();
    apiFetch('/items')
      .then((res) => res.json())
      .then(setCatalog)
      .catch(() => {});
  }, []);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  // Sum of each item's selling price x quantity. The overall "Selling price" field auto-fills
  // to this whenever the items change, but stays a normal editable input otherwise, so an admin
  // can still hand-type a different total (a discount, say) without it being overwritten until
  // they touch an item again.
  const sellingSumOf = (items: FormItem[]) =>
    items.reduce((sum, it) => (it.name.trim() ? sum + (Number(it.sellingPrice) || 0) * (Number(it.quantity) || 1) : sum), 0);

  const updateItem = (index: number, key: keyof FormItem, value: string) => {
    setForm((prev) => {
      const items = prev.items.map((it, i) => (i === index ? { ...it, [key]: value } : it));
      const resync = key === 'sellingPrice' || key === 'quantity';
      return { ...prev, items, sellingPrice: resync ? String(sellingSumOf(items)) : prev.sellingPrice };
    });
  };

  const addItemLine = () => {
    setForm((prev) => {
      const items = [...prev.items, emptyItem()];
      return { ...prev, items, sellingPrice: String(sellingSumOf(items)) };
    });
  };

  const removeItemLine = (index: number) => {
    setForm((prev) => {
      if (prev.items.length === 1) return prev;
      const items = prev.items.filter((_, i) => i !== index);
      return { ...prev, items, sellingPrice: String(sellingSumOf(items)) };
    });
  };

  // Love Note: a handwritten note, always complimentary to the customer; 10 THB is what it
  // costs us to include, which still rolls into the order's cost and revenue.
  const addLoveNote = () => {
    setForm((prev) => {
      const items = [...prev.items, { name: 'Love Note', quantity: '1', price: '10', sellingPrice: '0', details: '' }];
      return { ...prev, items, sellingPrice: String(sellingSumOf(items)) };
    });
  };

  // QR Love Note: a digital note behind a QR code. Price varies by what's involved, so cost and
  // selling start blank; rename the line itself to note which template/design was used.
  const addQrLoveNote = () => {
    setForm((prev) => {
      const items = [...prev.items, { name: 'QR Love Note', quantity: '1', price: '', sellingPrice: '', details: '' }];
      return { ...prev, items, sellingPrice: String(sellingSumOf(items)) };
    });
  };

  const startEdit = (order: Order) => {
    setFormError('');
    setForm(formFromOrder(order));
    setShowForm(true);
  };

  // "Make Order" on the Quotation page, or "Open order" on a quotation that already has one.
  // Waits for the orders to load so an edit intent can find its order.
  useEffect(() => {
    if (!intent || loading) return;
    if (intent.kind === 'fromQuotation') {
      const existing = orders.find((o) => o.quotation_id === intent.quotation.id);
      setFormError('');
      setForm(existing ? formFromOrder(existing) : formFromQuotation(intent.quotation));
      setShowForm(true);
    } else if (intent.kind === 'new') {
      setFormError('');
      setForm(emptyForm());
      setShowForm(true);
    } else {
      const order = orders.find((o) => o.id === intent.orderId);
      if (order) {
        setFormError('');
        setForm(formFromOrder(order));
        setShowForm(true);
      }
    }
    onIntentHandled?.();
  }, [intent, loading, orders, onIntentHandled]);

  const openNew = () => {
    setFormError('');
    setForm(emptyForm());
    setShowForm(true);
  };

  const closeForm = () => {
    setFormError('');
    setForm(emptyForm());
    setShowForm(false);
  };

  const downloadOrder = async (order: Order) => {
    setDownloadingId(order.id);
    setPageError('');
    try {
      const blob = await renderOrderPng(imageDataFor(order));
      downloadBlob(blob, `${order.order_no ?? `SCG-Order-${order.id}`}-Order-Details.png`);
    } catch {
      setPageError('Could not create the order details image.');
    } finally {
      setDownloadingId(null);
    }
  };

  // Saves the order. With andDownload, also produces the confirmation image from what the
  // server saved, so the image always matches the stored order and carries its order number.
  const handleSubmit = async (andDownload = false) => {
    if (!form.customerName.trim() || !form.country.trim()) {
      setFormError('Customer name and country are required.');
      return;
    }
    setFormError('');
    setSaving(true);
    let saved: Order;
    try {
      const res = await apiFetch('/orders/save', jsonBody({
        id: form.id ?? undefined,
        quotationId: form.id ? undefined : form.quotationId ?? undefined,
        customerName: form.customerName,
        country: form.country,
        channel: form.channel,
        orderDate: form.orderDate,
        status: form.status,
        currency: form.currency,
        sellingPrice: Number(form.sellingPrice || 0),
        items: form.items
          .filter((it) => it.name.trim())
          .map((it) => ({
            name: it.name.trim(),
            quantity: Number(it.quantity) || 1,
            price: Number(it.price) || 0,
            sellingPrice: Number(it.sellingPrice) || 0,
            details: it.details.trim(),
          })),
        notes: form.notes.trim(),
        recipient: form.recipient,
        recipientPhone: form.recipientPhone,
        deliveryDate: form.deliveryDate || null,
        deliveryAddress: form.deliveryAddress,
        deliveryNote: form.deliveryNote,
      }));
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFormError(data.error || 'Could not save the order.');
        return;
      }
      saved = data as Order;
    } catch {
      return;
    } finally {
      setSaving(false);
    }
    setForm(emptyForm());
    setShowForm(false);
    loadAll();
    if (andDownload) await downloadOrder(saved);
  };

  const handleDelete = async (order: Order) => {
    if (!window.confirm(`Delete the order for ${order.customer_name}?`)) return;
    try {
      await apiFetch(`/orders/delete/${order.id}`, { method: 'DELETE' });
    } catch {
      return;
    }
    if (form.id === order.id) closeForm();
    loadAll();
  };

  const itemsSummary = (items: OrderItem[]) =>
    items.length === 0 ? '—' : items.map((i) => `${i.quantity}x ${i.name}${i.price ? ` (${fmt(i.price)})` : ''}`).join(', ');

  // Cost is the sum of the item prices. Revenue is what the customer paid minus that cost.
  const formCost = form.items.reduce(
    (sum, it) => (it.name.trim() ? sum + (Number(it.price) || 0) * (Number(it.quantity) || 1) : sum),
    0
  );
  const formRevenue = Number(form.sellingPrice || 0) - formCost;

  // Every month that has orders, plus the current month so it is always selectable.
  const monthOptions = Array.from(
    new Set([todayLocal().slice(0, 7), selectedMonth, ...(stats?.monthly ?? []).map((m) => m.month)])
  ).sort((a, b) => b.localeCompare(a));
  const monthTotals: MonthStats = stats?.monthly.find((m) => m.month === selectedMonth) ?? {
    month: selectedMonth, orderCount: 0, cancelledCount: 0, sellingThb: 0, costThb: 0, revenueThb: 0,
  };

  return (
    <div className="page">
      <header className="page-header page-header-row">
        <div>
          <h1>Orders</h1>
          <p className="page-subtitle">Every order So Chic Gifts has done, with selling price, cost and revenue.</p>
        </div>
        <button className="new-order-btn" onClick={openNew}>New Order</button>
      </header>

      {loading ? (
        <p className="empty-state">Loading…</p>
      ) : (
        <>
          {stats && (
            <>
              <div className="section-title-row">
                <div className="view-toggle">
                  <button
                    className={`view-toggle-btn ${view === 'monthly' ? 'is-active' : ''}`}
                    onClick={() => setView('monthly')}
                  >
                    Monthly
                  </button>
                  <button
                    className={`view-toggle-btn ${view === 'all' ? 'is-active' : ''}`}
                    onClick={() => setView('all')}
                  >
                    All
                  </button>
                </div>
                {view === 'monthly' && (
                  <select
                    className="item-input month-select"
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                  >
                    {monthOptions.map((ym) => (
                      <option key={ym} value={ym}>{monthLabel(ym)}</option>
                    ))}
                  </select>
                )}
              </div>
              {view === 'monthly' ? (
                <StatCards totals={monthTotals} cancelledCount={monthTotals.cancelledCount} />
              ) : (
                <StatCards totals={stats} cancelledCount={stats.cancelledCount} />
              )}
              {stats.unconverted > 0 && (
                <p className="error-text">
                  {stats.unconverted} order(s) are left out of the totals because an exchange rate is missing in Settings.
                </p>
              )}
            </>
          )}

          {showForm && (
          <div className="modal-backdrop">
          <div className="modal-card">
            <div className="modal-header">
              <h2 className="panel-label">
                {form.id ? `Edit order ${form.orderNo ?? `#${form.id}`}` : 'New order'}
              </h2>
              <button className="item-remove" onClick={closeForm} aria-label="Close">×</button>
            </div>
            {form.quoteNo && !form.id && (
              <p className="stat-sub order-origin">From quotation {form.quoteNo}. Fill in the delivery details, then save.</p>
            )}

            <div className="order-form-grid">
              <div className="order-field">
                <label>Customer</label>
                <input
                  type="text"
                  className="item-input"
                  placeholder="Customer name"
                  value={form.customerName}
                  onChange={(e) => update('customerName', e.target.value)}
                />
              </div>
              <div className="order-field">
                <label>Country</label>
                <input
                  type="text"
                  className="item-input"
                  list="order-countries"
                  placeholder="e.g. Japan"
                  value={form.country}
                  onChange={(e) => update('country', e.target.value)}
                />
                <datalist id="order-countries">
                  {COMMON_COUNTRIES.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
              <div className="order-field">
                <label>Channel</label>
                <select
                  className="item-input"
                  value={form.channel}
                  onChange={(e) => update('channel', e.target.value)}
                >
                  {Object.entries(CHANNELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="order-field">
                <label>Order date</label>
                <input
                  type="date"
                  className="item-input"
                  value={form.orderDate}
                  onChange={(e) => update('orderDate', e.target.value)}
                />
              </div>
              <div className="order-field">
                <label>Payment</label>
                <select
                  className="item-input"
                  value={form.status}
                  onChange={(e) => update('status', e.target.value)}
                >
                  {Object.entries(STATUS_LABELS).filter(([value]) => value !== 'cancelled' || form.status === 'cancelled').map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            </div>

            <h3 className="order-subheading">Delivery</h3>
            <div className="order-form-grid">
              <div className="order-field">
                <label>Recipient</label>
                <input
                  type="text"
                  className="item-input"
                  placeholder="Recipient's name"
                  value={form.recipient}
                  onChange={(e) => update('recipient', e.target.value)}
                />
              </div>
              <div className="order-field">
                <label>Recipient phone (optional)</label>
                <input
                  type="tel"
                  className="item-input"
                  placeholder="e.g. 081 234 5678"
                  value={form.recipientPhone}
                  onChange={(e) => update('recipientPhone', e.target.value)}
                />
              </div>
              <div className="order-field">
                <label>Delivery date</label>
                <input
                  type="date"
                  className="item-input"
                  value={form.deliveryDate}
                  onChange={(e) => update('deliveryDate', e.target.value)}
                />
              </div>
              <div className="order-field">
                <label>Delivery address</label>
                <input
                  type="text"
                  className="item-input"
                  placeholder="City / Area"
                  value={form.deliveryAddress}
                  onChange={(e) => update('deliveryAddress', e.target.value)}
                />
              </div>
              <div className="order-field">
                <label>Delivery note</label>
                <input
                  type="text"
                  className="item-input"
                  placeholder="e.g. to deliver at 10AM"
                  value={form.deliveryNote}
                  onChange={(e) => update('deliveryNote', e.target.value)}
                />
              </div>
            </div>

            <h3 className="order-subheading">Items</h3>
            <p className="stat-sub order-hint">
              Cost is what you pay. Selling is the price the customer sees on the order details. Details
              are the lines under each item, one per line (design, text on cake, size, colour, message…).
            </p>
            <datalist id="order-catalog-items">
              {catalog.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
            <div className="order-item-lines">
              <div className="order-item-head" aria-hidden="true">
                <span style={{ flex: 1 }}>Item</span>
                <span className="order-item-qty">Qty</span>
                <span className="order-item-price">Cost / unit</span>
                <span className="order-item-price">Selling / unit</span>
                <span className="order-item-head-spacer" />
              </div>
              {form.items.map((line, index) => (
                <div className="order-item-block" key={index}>
                  <div className="item-row">
                    <input
                      type="text"
                      className="item-input"
                      style={{ flex: 1 }}
                      list="order-catalog-items"
                      placeholder="Item name (from catalog or your own)"
                      value={line.name}
                      onChange={(e) => updateItem(index, 'name', e.target.value)}
                    />
                    <input
                      type="number"
                      className="item-input order-item-qty"
                      min="1"
                      placeholder="Qty"
                      value={line.quantity}
                      onChange={(e) => updateItem(index, 'quantity', e.target.value)}
                      aria-label="Quantity"
                    />
                    <input
                      type="number"
                      className="item-input order-item-price"
                      min="0"
                      placeholder={`Cost (${form.currency})`}
                      value={line.price}
                      onChange={(e) => updateItem(index, 'price', e.target.value)}
                      aria-label="Cost price per unit"
                      title="Cost price per unit"
                    />
                    <input
                      type="number"
                      className="item-input order-item-price"
                      min="0"
                      placeholder={`Selling (${form.currency})`}
                      value={line.sellingPrice}
                      onChange={(e) => updateItem(index, 'sellingPrice', e.target.value)}
                      aria-label="Selling price per unit"
                      title="Selling price per unit, shown to the customer. Leave empty for Complimentary."
                    />
                    <button
                      className="item-remove"
                      onClick={() => removeItemLine(index)}
                      disabled={form.items.length === 1}
                      aria-label="Remove item line"
                    >
                      ×
                    </button>
                  </div>
                  <textarea
                    className="item-input order-item-details"
                    rows={2}
                    placeholder={index === 0 ? 'Details, one per line, e.g. Text on cake: "Happy Birthday John"' : 'Details (optional), one per line'}
                    value={line.details}
                    onChange={(e) => updateItem(index, 'details', e.target.value)}
                    aria-label="Item details"
                  />
                </div>
              ))}
            </div>
            <div className="order-form-actions">
              <button className="add-item-btn" onClick={addItemLine}>+ Add item</button>
              <button className="add-item-btn" onClick={addLoveNote}>+ Add Love Note</button>
              <button className="add-item-btn" onClick={addQrLoveNote}>+ QR Love Note</button>
            </div>

            <h3 className="order-subheading">Money</h3>
            <div className="order-form-grid">
              <div className="order-field">
                <label>Currency</label>
                <select
                  className="item-input"
                  value={form.currency}
                  onChange={(e) => update('currency', e.target.value)}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="order-field">
                <label>Selling price (what the customer paid)</label>
                <input
                  type="number"
                  className="item-input"
                  min="0"
                  value={form.sellingPrice}
                  onChange={(e) => update('sellingPrice', e.target.value)}
                />
              </div>
              <div className="order-field">
                <label>Cost (sum of item prices)</label>
                <div className="order-profit">{fmt(formCost)} {form.currency}</div>
              </div>
              <div className="order-field">
                <label>Revenue (selling price minus cost)</label>
                <div className={`order-profit ${formRevenue < 0 ? 'profit-negative' : ''}`}>
                  {fmt(formRevenue)} {form.currency}
                </div>
              </div>
            </div>

            <div className="order-field">
              <label>Notes (optional, never shown to the customer)</label>
              <input
                type="text"
                className="item-input"
                value={form.notes}
                onChange={(e) => update('notes', e.target.value)}
              />
            </div>

            {formError && <p className="error-text">{formError}</p>}

            <div className="order-form-actions">
              <button className="save-btn" onClick={() => handleSubmit(false)} disabled={saving}>
                {saving ? 'Saving…' : form.id ? 'Update order' : 'Save order'}
              </button>
              <button className="save-btn save-btn-secondary" onClick={() => handleSubmit(true)} disabled={saving}>
                {form.id ? 'Update & download order details' : 'Save & download order details'}
              </button>
              <button className="add-item-btn" onClick={closeForm}>Cancel</button>
            </div>
          </div>
          </div>
          )}

          {pageError && <p className="error-text">{pageError}</p>}

          <div className="calc-panel">
            <h2 className="panel-label">All orders</h2>
            {orders.length === 0 ? (
              <p className="empty-state">No orders yet.</p>
            ) : (
              <div className="orders-table-wrap">
                <table className="items-table orders-compact">
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Customer</th>
                      <th>Payment</th>
                      <th className="num-col">Selling price</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => {
                      const isOpen = expanded.has(o.id);
                      return (
                        <Fragment key={o.id}>
                          <tr className={isOpen ? 'is-open' : ''}>
                            <td>
                              <span className="cell-main">{o.order_no ?? `#${o.id}`}</span>
                              <span className="cell-sub">{o.order_date}</span>
                            </td>
                            <td>
                              <span className="cell-main">{o.customer_name}</span>
                              <span className="cell-sub">{itemsSummary(o.items)}</span>
                            </td>
                            <td>
                              <span className={`status-pill status-${o.status}`}>
                                {STATUS_LABELS[o.status] ?? o.status}
                              </span>
                            </td>
                            <td className="items-price-cell num-col">{fmt(o.selling_price)} {o.currency}</td>
                            <td className="row-action-cell">
                              <button
                                className={`details-btn ${isOpen ? 'is-open' : ''}`}
                                onClick={() => toggleExpanded(o.id)}
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
                                    <div><dt>Country</dt><dd>{o.country || '—'}</dd></div>
                                    <div><dt>Channel</dt><dd>{o.channel ? (CHANNELS[o.channel] ?? o.channel) : '—'}</dd></div>
                                    <div><dt>Cost</dt><dd className="items-price-cell">{fmt(o.cost)} {o.currency}</dd></div>
                                    <div>
                                      <dt>Revenue</dt>
                                      <dd className={`items-price-cell ${o.revenue < 0 ? 'profit-negative' : ''}`}>{fmt(o.revenue)} {o.currency}</dd>
                                    </div>
                                    <div><dt>Recipient</dt><dd>{o.recipient || '—'}{o.recipient_phone ? ` · ${o.recipient_phone}` : ''}</dd></div>
                                    <div><dt>Delivery date</dt><dd>{o.delivery_date || '—'}</dd></div>
                                    <div className="detail-wide"><dt>Delivery address</dt><dd>{o.delivery_address || '—'}</dd></div>
                                    {o.delivery_note && <div className="detail-wide"><dt>Delivery note</dt><dd>{o.delivery_note}</dd></div>}
                                    {o.notes && <div className="detail-wide"><dt>Notes</dt><dd>{o.notes}</dd></div>}
                                  </dl>
                                  <div className="detail-items">
                                    <span className="detail-label">Items</span>
                                    <ul>
                                      {o.items.map((it, i) => (
                                        <li key={i}>
                                          <span>{it.quantity > 1 ? `${it.quantity}× ` : ''}{it.name}</span>
                                          {it.details && <small>{it.details}</small>}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                  <div className="detail-actions">
                                    <button className="save-btn" onClick={() => startEdit(o)}>Edit order</button>
                                    <button
                                      className="add-item-btn"
                                      onClick={() => downloadOrder(o)}
                                      disabled={downloadingId === o.id}
                                    >
                                      {downloadingId === o.id ? 'Preparing…' : 'Download'}
                                    </button>
                                    <button className="order-edit-btn danger-link" onClick={() => handleDelete(o)}>Delete</button>
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
        </>
      )}
    </div>
  );
}
