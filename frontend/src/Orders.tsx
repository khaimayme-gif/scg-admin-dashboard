import { useState, useEffect, useRef } from 'react';
import { apiFetch, jsonBody } from './api';

interface OrderItem {
  name: string;
  quantity: number;
}

interface Order {
  id: number;
  customer_name: string;
  country: string;
  order_date: string;
  status: string;
  currency: string;
  revenue: number;
  cost: number;
  items: OrderItem[];
  notes: string | null;
}

interface Stats {
  orderCount: number;
  cancelledCount: number;
  revenueThb: number;
  costThb: number;
  profitThb: number;
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
}

interface FormState {
  id: number | null;
  customerName: string;
  country: string;
  orderDate: string;
  status: string;
  currency: string;
  revenue: string;
  cost: string;
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
const COMMON_COUNTRIES = ['Japan', 'Thailand', 'Myanmar'];

const fmt = (n: number) => Math.round(n).toLocaleString();

// en-CA formats as YYYY-MM-DD in the local timezone, which avoids the off-by-one-day
// that toISOString() causes early in the morning in Thailand (UTC+7).
const todayLocal = () => new Date().toLocaleDateString('en-CA');

const emptyForm = (): FormState => ({
  id: null,
  customerName: '',
  country: '',
  orderDate: todayLocal(),
  status: 'pending',
  currency: 'THB',
  revenue: '',
  cost: '',
  items: [{ name: '', quantity: '1' }],
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
  const formRef = useRef<HTMLDivElement>(null);

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
    setForm((prev) => ({ ...prev, items: [...prev.items, { name: '', quantity: '1' }] }));
  };

  const removeItemLine = (index: number) => {
    setForm((prev) => ({
      ...prev,
      items: prev.items.length === 1 ? prev.items : prev.items.filter((_, i) => i !== index),
    }));
  };

  // Adds up menu price and original cost from the Items catalog for every line that matches a
  // catalog name. Catalog prices are in THB, so this switches the order currency to THB.
  const suggestFromCatalog = () => {
    let revenue = 0;
    let cost = 0;
    let matched = 0;
    for (const line of form.items) {
      const found = catalog.find((c) => c.name.toLowerCase() === line.name.trim().toLowerCase());
      if (!found) continue;
      const qty = Number(line.quantity) || 1;
      matched += 1;
      revenue += found.menu_price * qty;
      cost += (found.original_cost ?? 0) * qty;
    }
    if (matched === 0) {
      setFormError('No item names matched your Items catalog, so there is nothing to add up.');
      return;
    }
    setFormError('');
    setForm((prev) => ({
      ...prev,
      currency: 'THB',
      revenue: String(Math.round(revenue)),
      cost: String(Math.round(cost)),
    }));
  };

  const startEdit = (order: Order) => {
    setFormError('');
    setForm({
      id: order.id,
      customerName: order.customer_name,
      country: order.country,
      orderDate: order.order_date,
      status: order.status,
      currency: order.currency,
      revenue: String(order.revenue),
      cost: String(order.cost),
      items:
        order.items.length > 0
          ? order.items.map((i) => ({ name: i.name, quantity: String(i.quantity) }))
          : [{ name: '', quantity: '1' }],
      notes: order.notes ?? '',
    });
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const cancelEdit = () => {
    setFormError('');
    setForm(emptyForm());
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
        orderDate: form.orderDate,
        status: form.status,
        currency: form.currency,
        revenue: Number(form.revenue || 0),
        cost: Number(form.cost || 0),
        items: form.items
          .filter((it) => it.name.trim())
          .map((it) => ({ name: it.name.trim(), quantity: Number(it.quantity) || 1 })),
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
    loadAll();
  };

  const handleDelete = async (order: Order) => {
    if (!window.confirm(`Delete the order for ${order.customer_name}?`)) return;
    try {
      await apiFetch(`/orders/delete/${order.id}`, { method: 'DELETE' });
    } catch {
      return;
    }
    if (form.id === order.id) setForm(emptyForm());
    loadAll();
  };

  const itemsSummary = (items: OrderItem[]) =>
    items.length === 0 ? '—' : items.map((i) => `${i.quantity}x ${i.name}`).join(', ');

  const formProfit = Number(form.revenue || 0) - Number(form.cost || 0);

  return (
    <div className="page">
      <header className="page-header">
        <h1>Orders</h1>
        <p className="page-subtitle">Every order So Chic Gifts has done, with revenue and cost.</p>
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
                  <span className="stat-label">Revenue</span>
                  <span className="stat-value">{fmt(stats.revenueThb)} THB</span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">Cost</span>
                  <span className="stat-value">{fmt(stats.costThb)} THB</span>
                </div>
                <div className="stat-card">
                  <span className="stat-label">Profit</span>
                  <span className={`stat-value ${stats.profitThb < 0 ? 'profit-negative' : ''}`}>
                    {fmt(stats.profitThb)} THB
                  </span>
                </div>
              </div>
              {stats.unconverted > 0 && (
                <p className="error-text">
                  {stats.unconverted} order(s) are left out of the totals because an exchange rate is missing in Settings.
                </p>
              )}
            </>
          )}

          <div className="calc-panel" ref={formRef}>
            <h2 className="panel-label">{form.id ? `Edit order #${form.id}` : 'Add new order'}</h2>

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
                    placeholder="Item name (pick from catalog or type your own)"
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
              <button className="add-item-btn" onClick={suggestFromCatalog}>Fill revenue and cost from catalog (THB)</button>
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
                <label>Revenue (what the customer paid)</label>
                <input
                  type="number"
                  className="item-input"
                  min="0"
                  value={form.revenue}
                  onChange={(e) => update('revenue', e.target.value)}
                />
              </div>
              <div className="order-field">
                <label>Cost (what it cost you)</label>
                <input
                  type="number"
                  className="item-input"
                  min="0"
                  value={form.cost}
                  onChange={(e) => update('cost', e.target.value)}
                />
              </div>
              <div className="order-field">
                <label>Profit</label>
                <div className={`order-profit ${formProfit < 0 ? 'profit-negative' : ''}`}>
                  {fmt(formProfit)} {form.currency}
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
              {form.id && (
                <button className="add-item-btn" onClick={cancelEdit}>Cancel edit</button>
              )}
            </div>
          </div>

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
                      <th>Items</th>
                      <th>Status</th>
                      <th>Revenue</th>
                      <th>Cost</th>
                      <th>Profit</th>
                      <th></th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => {
                      const profit = o.revenue - o.cost;
                      return (
                        <tr key={o.id}>
                          <td>{o.order_date}</td>
                          <td>{o.customer_name}</td>
                          <td>{o.country}</td>
                          <td>{itemsSummary(o.items)}</td>
                          <td>
                            <span className={`status-pill status-${o.status}`}>
                              {STATUS_LABELS[o.status] ?? o.status}
                            </span>
                          </td>
                          <td className="items-price-cell">{fmt(o.revenue)} {o.currency}</td>
                          <td className="items-price-cell">{fmt(o.cost)} {o.currency}</td>
                          <td className={`items-price-cell ${profit < 0 ? 'profit-negative' : ''}`}>
                            {fmt(profit)} {o.currency}
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
