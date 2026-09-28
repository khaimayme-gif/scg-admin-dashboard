import { useState, useEffect } from 'react';
import { apiFetch, jsonBody } from './api';

interface OrderItem {
  name: string;
  quantity: number;
  price?: number;
}

interface Order {
  id: number;
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
}

interface Stats {
  orderCount: number;
  cancelledCount: number;
  sellingThb: number;
  costThb: number;
  revenueThb: number;
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
  price: string;
}

interface FormState {
  id: number | null;
  customerName: string;
  country: string;
  channel: string;
  orderDate: string;
  status: string;
  currency: string;
  sellingPrice: string;
  items: FormItem[];
  notes: string;
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  paid: 'Paid',
  in_progress: 'In progress',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

const CURRENCIES = ['THB', 'JPY', 'MMK'];
const CHANNELS: Record<string, string> = { tiktok: 'TikTok', facebook: 'Facebook' };
const COMMON_COUNTRIES = ['Japan', 'Thailand', 'Myanmar'];

const fmt = (n: number) => Math.round(n).toLocaleString();

// en-CA formats as YYYY-MM-DD in the local timezone, which avoids the off-by-one-day
// that toISOString() causes early in the morning in Thailand (UTC+7).
const todayLocal = () => new Date().toLocaleDateString('en-CA');

const emptyForm = (): FormState => ({
  id: null,
  customerName: '',
  country: '',
  channel: 'tiktok',
  orderDate: todayLocal(),
  status: 'pending',
  currency: 'THB',
  sellingPrice: '',
  items: [{ name: '', quantity: '1', price: '' }],
  notes: '',
});

export default function Orders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [showForm, setShowForm] = useState(false);

  const loadAll = () => {
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
  };

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

  const updateItem = (index: number, key: keyof FormItem, value: string) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.map((it, i) => (i === index ? { ...it, [key]: value } : it)),
    }));
  };

  const addItemLine = () => {
    setForm((prev) => ({ ...prev, items: [...prev.items, { name: '', quantity: '1', price: '' }] }));
  };

  const removeItemLine = (index: number) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.length === 1 ? prev.items : prev.items.filter((_, i) => i !== index),
    }));
  };

  // Fills the price of every line that matches a catalog name with that item's original cost.
  // Catalog costs are in THB, so this switches the order currency to THB.
  const fillCostsFromCatalog = () => {
    let matched = 0;
    const nextItems = form.items.map((line) => {
      const found = catalog.find((c) => c.name.toLowerCase() === line.name.trim().toLowerCase());
      if (!found || found.original_cost === null) return line;
      matched += 1;
      return { ...line, price: String(found.original_cost) };
    });
    if (matched === 0) {
      setFormError('No item names matched a catalog item that has an original cost.');
      return;
    }
    setFormError('');
    setForm((prev) => ({ ...prev, currency: 'THB', items: nextItems }));
  };

  const startEdit = (order: Order) => {
    setFormError('');
    setForm({
      id: order.id,
      customerName: order.customer_name,
      country: order.country,
      channel: order.channel ?? 'tiktok',
      orderDate: order.order_date,
      status: order.status,
      currency: order.currency,
      sellingPrice: String(order.selling_price ?? 0),
      items:
        order.items.length > 0
          ? order.items.map((i) => ({ name: i.name, quantity: String(i.quantity), price: String(i.price ?? 0) }))
          : [{ name: '', quantity: '1', price: '' }],
      notes: order.notes ?? '',
    });
    setShowForm(true);
  };

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

  const handleSubmit = async () => {
    if (!form.customerName.trim() || !form.country.trim()) {
      setFormError('Customer name and country are required.');
      return;
    }
    setFormError('');
    setSaving(true);
    try {
      const res = await apiFetch('/orders/save', jsonBody({
        id: form.id ?? undefined,
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
          })),
        notes: form.notes.trim(),
      }));
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setFormError(data.error || 'Could not save the order.');
        return;
      }
    } catch {
      return;
    } finally {
      setSaving(false);
    }
    setForm(emptyForm());
    setShowForm(false);
    loadAll();
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

  return (
    <div className="page">
      <header className="page-header page-header-row">
        <div>
          <h1>Orders</h1>
          <p className="page-subtitle">Every order So Chic Gifts has done, with selling price, cost and revenue.</p>
        </div>
        <button className="new-order-btn" onClick={openNew}>+ New Order</button>
      </header>

      {loading ? (
        <p className="empty-state">Loading…</p>
      ) : (
        <>
          {stats && (
            <>
              <div className="stat-grid">
                <div className="stat-card">
                  <span className="stat-label">Total orders</span>
                  <span className="stat-value">{stats.orderCount}</span>
                  {stats.cancelledCount > 0 && (
                    <span className="stat-sub">{stats.cancelledCount} cancelled, not counted</span>
                  )}
                </div>
                <div className="stat-card">
                  <span className="stat-label">Collected</span>
                  <span className="stat-value">{fmt(stats.sellingThb)} THB</span>
                  <span className="stat-sub">Selling price total</span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">Cost</span>
                  <span className="stat-value">{fmt(stats.costThb)} THB</span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">Revenue</span>
                  <span className={`stat-value ${stats.revenueThb < 0 ? 'profit-negative' : ''}`}>
                    {fmt(stats.revenueThb)} THB
                  </span>
                  <span className="stat-sub">Collected minus cost</span>
                </div>
              </div>
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
              <h2 className="panel-label">{form.id ? `Edit order #${form.id}` : 'New order'}</h2>
              <button className="item-remove" onClick={closeForm} aria-label="Close">×</button>
            </div>

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
                <label>Status</label>
                <select
                  className="item-input"
                  value={form.status}
                  onChange={(e) => update('status', e.target.value)}
                >
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            </div>

            <h3 className="order-subheading">Items</h3>
            <datalist id="order-catalog-items">
              {catalog.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
            <div className="order-item-lines">
              {form.items.map((line, index) => (
                <div className="item-row" key={index}>
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
                    value={line.quantity}
                    onChange={(e) => updateItem(index, 'quantity', e.target.value)}
                    aria-label="Quantity"
                  />
                  <input
                    type="number"
                    className="item-input order-item-price"
                    min="0"
                    placeholder={`Price (${form.currency})`}
                    value={line.price}
                    onChange={(e) => updateItem(index, 'price', e.target.value)}
                    aria-label="Item price"
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
              ))}
            </div>
            <div className="order-form-actions">
              <button className="add-item-btn" onClick={addItemLine}>+ Add item</button>
              <button className="add-item-btn" onClick={fillCostsFromCatalog}>Fill item prices from catalog costs (THB)</button>
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
              <label>Notes (optional)</label>
              <input
                type="text"
                className="item-input"
                value={form.notes}
                onChange={(e) => update('notes', e.target.value)}
              />
            </div>

            {formError && <p className="error-text">{formError}</p>}

            <div className="order-form-actions">
              <button className="save-btn" onClick={handleSubmit} disabled={saving}>
                {saving ? 'Saving…' : form.id ? 'Update order' : 'Save order'}
              </button>
              <button className="add-item-btn" onClick={closeForm}>Cancel</button>
            </div>
          </div>
          </div>
          )}

          <div className="calc-panel">
            <h2 className="panel-label">All orders</h2>
            {orders.length === 0 ? (
              <p className="empty-state">No orders yet.</p>
            ) : (
              <div className="orders-table-wrap">
                <table className="items-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Customer</th>
                      <th>Country</th>
                      <th>Channel</th>
                      <th>Items</th>
                      <th>Status</th>
                      <th>Selling price</th>
                      <th>Cost</th>
                      <th>Revenue</th>
                      <th></th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => {
                      return (
                        <tr key={o.id}>
                          <td>{o.order_date}</td>
                          <td>{o.customer_name}</td>
                          <td>{o.country}</td>
                          <td>{o.channel ? (CHANNELS[o.channel] ?? o.channel) : '—'}</td>
                          <td>{itemsSummary(o.items)}</td>
                          <td>
                            <span className={`status-pill status-${o.status}`}>
                              {STATUS_LABELS[o.status] ?? o.status}
                            </span>
                          </td>
                          <td className="items-price-cell">{fmt(o.selling_price)} {o.currency}</td>
                          <td className="items-price-cell">{fmt(o.cost)} {o.currency}</td>
                          <td className={`items-price-cell ${o.revenue < 0 ? 'profit-negative' : ''}`}>
                            {fmt(o.revenue)} {o.currency}
                          </td>
                          <td>
                            <button className="order-edit-btn" onClick={() => startEdit(o)}>Edit</button>
                          </td>
                          <td>
                            <button className="item-remove" onClick={() => handleDelete(o)} aria-label="Delete order">×</button>
                          </td>
                        </tr>
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
