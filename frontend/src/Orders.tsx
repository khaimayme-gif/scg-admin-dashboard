import { useState, useEffect } from 'react';
import { apiFetch } from './api';

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

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  paid: 'Paid',
  in_progress: 'In progress',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

const fmt = (n: number) => Math.round(n).toLocaleString();

export default function Orders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

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
  }, []);

  const handleDelete = async (order: Order) => {
    if (!window.confirm(`Delete the order for ${order.customer_name}?`)) return;
    try {
      await apiFetch(`/orders/delete/${order.id}`, { method: 'DELETE' });
    } catch {
      return;
    }
    loadAll();
  };

  const itemsSummary = (items: OrderItem[]) =>
    items.length === 0 ? '—' : items.map((i) => `${i.quantity}x ${i.name}`).join(', ');

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