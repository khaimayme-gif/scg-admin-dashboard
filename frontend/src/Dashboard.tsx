import { useState, useEffect } from 'react';
import { apiFetch } from './api';

interface OrderItem {
  name: string;
  quantity: number;
}

interface Order {
  id: number;
  order_no: string | null;
  customer_name: string;
  recipient: string | null;
  status: string;
  board_stage: string;
  currency: string;
  selling_price: number;
  order_date: string;
  delivery_date: string | null;
  delivery_address: string | null;
  items: OrderItem[];
}

interface MonthStats {
  month: string; // YYYY-MM
  orderCount: number;
  sellingThb: number;
  costThb: number;
  revenueThb: number;
}

interface Stats {
  monthly: MonthStats[];
}

interface ExpenseStats {
  oneTimeThisMonthThb: number;
  monthlyRunRateThb: number;
}

const PAYMENT_LABELS: Record<string, string> = {
  pending: 'Unpaid',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

const STAGE_LABELS: Record<string, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
  closed: 'Closed',
};

const fmt = (n: number) => Math.round(n).toLocaleString();

// en-CA formats as YYYY-MM-DD in the local timezone.
const todayLocal = () => new Date().toLocaleDateString('en-CA');

const shiftMonth = (ym: string, delta: number) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const monthShort = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short' });
};

const monthLong = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
};

// Whole days from today to the given YYYY-MM-DD date (negative = in the past).
const daysFromToday = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  const [ty, tm, td] = todayLocal().split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86_400_000);
};

const dayLabel = (iso: string) => {
  const diff = daysFromToday(iso);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
};

const itemsSummary = (items: OrderItem[]) =>
  items.map((it) => (it.quantity > 1 ? `${it.quantity}× ${it.name}` : it.name)).join(', ');

const compact = (n: number) => (Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(Math.round(n)));

interface DashboardProps {
  onOpenOrder?: (orderId: number) => void;
}

export default function Dashboard({ onOpenOrder }: DashboardProps) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [expenses, setExpenses] = useState<ExpenseStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [months, setMonths] = useState<6 | 12>(6);

  useEffect(() => {
    Promise.all([
      apiFetch('/orders').then((r) => r.json()),
      apiFetch('/orders/stats').then((r) => r.json()),
      apiFetch('/expenses/stats').then((r) => r.json()).catch(() => null),
    ])
      .then(([orderRows, statsData, expenseStats]) => {
        setOrders(Array.isArray(orderRows) ? orderRows : []);
        setStats(statsData && Array.isArray(statsData.monthly) ? statsData : { monthly: [] });
        setExpenses(expenseStats);
      })
      .catch(() => {
        // a 401 has already sent us back to login
      })
      .finally(() => setLoading(false));
  }, []);

  const thisMonth = todayLocal().slice(0, 7);
  const byMonth = new Map((stats?.monthly ?? []).map((m) => [m.month, m]));
  const current = byMonth.get(thisMonth);
  const previous = byMonth.get(shiftMonth(thisMonth, -1));

  const revenueNow = current?.revenueThb ?? 0;
  const revenuePrev = previous?.revenueThb ?? 0;
  const delta = revenuePrev > 0 ? Math.round(((revenueNow - revenuePrev) / revenuePrev) * 100) : null;
  const expensesNow = expenses ? expenses.oneTimeThisMonthThb + expenses.monthlyRunRateThb : 0;

  // Orders still to deliver: on So Chic Board in To do or In progress. Overdue ones (date
  // already passed) are pulled out so they don't get lost.
  const open = orders.filter(
    (o) => o.status !== 'cancelled' && (o.board_stage === 'todo' || o.board_stage === 'in_progress')
  );
  const scheduled = open.filter((o) => o.delivery_date);
  const overdue = scheduled
    .filter((o) => daysFromToday(o.delivery_date as string) < 0)
    .sort((a, b) => (a.delivery_date as string).localeCompare(b.delivery_date as string));
  const upcoming = scheduled
    .filter((o) => daysFromToday(o.delivery_date as string) >= 0)
    .sort((a, b) => (a.delivery_date as string).localeCompare(b.delivery_date as string));
  const unscheduled = open.filter((o) => !o.delivery_date);
  const next7 = upcoming.filter((o) => daysFromToday(o.delivery_date as string) <= 7).length;
  const awaitingPayment = open.filter((o) => o.status === 'pending' || o.status === 'partially_paid').length;

  const series = Array.from({ length: months }, (_, i) => {
    const month = shiftMonth(thisMonth, i - (months - 1));
    return { month, revenue: byMonth.get(month)?.revenueThb ?? 0, orders: byMonth.get(month)?.orderCount ?? 0 };
  });
  const maxRevenue = Math.max(1, ...series.map((s) => s.revenue));
  const total = series.reduce((sum, s) => sum + s.revenue, 0);

  const orderRow = (o: Order, flag?: 'overdue') => (
    <li key={o.id}>
      <button className={`dash-order ${flag === 'overdue' ? 'is-overdue' : ''}`} onClick={() => onOpenOrder?.(o.id)}>
        <span className="dash-order-date">
          <strong>{o.delivery_date ? dayLabel(o.delivery_date) : 'No date'}</strong>
          {o.order_no && <small>{o.order_no}</small>}
        </span>
        <span className="dash-order-main">
          <span className="dash-order-who">
            {o.customer_name}
            {o.recipient && o.recipient !== o.customer_name ? ` → ${o.recipient}` : ''}
          </span>
          <span className="dash-order-items">{itemsSummary(o.items) || 'No items'}</span>
          {o.delivery_address && <span className="dash-order-where">{o.delivery_address}</span>}
        </span>
        <span className="dash-order-side">
          <span className="status-pill">{STAGE_LABELS[o.board_stage] ?? o.board_stage}</span>
          <span className={`status-pill status-${o.status}`}>{PAYMENT_LABELS[o.status] ?? o.status}</span>
          <span className="dash-order-amount">{fmt(o.selling_price)} {o.currency}</span>
        </span>
      </button>
    </li>
  );

  return (
    <div className="page">
      <header className="page-header">
        <h1>Dashboard</h1>
        <p className="page-subtitle">How So Chic Gifts is doing, and what needs to go out next.</p>
      </header>

      {loading ? (
        <p className="empty-state">Loading…</p>
      ) : (
        <>
          <div className="stat-grid">
            <div className="stat-card">
              <span className="stat-label">Revenue · {monthLong(thisMonth)}</span>
              <span className={`stat-value ${revenueNow < 0 ? 'profit-negative' : ''}`}>{fmt(revenueNow)} THB</span>
              <span className="stat-sub">
                {delta === null ? 'No revenue last month to compare' : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}% vs last month`}
              </span>
            </div>
            <div className="stat-card">
              <span className="stat-label">Orders this month</span>
              <span className="stat-value">{current?.orderCount ?? 0}</span>
              <span className="stat-sub">{fmt(current?.sellingThb ?? 0)} THB collected</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">To deliver, next 7 days</span>
              <span className="stat-value">{next7}</span>
              <span className="stat-sub">
                {overdue.length > 0 ? `${overdue.length} overdue` : `${awaitingPayment} awaiting payment`}
              </span>
            </div>
            <div className="stat-card">
              <span className="stat-label">After expenses</span>
              <span className={`stat-value ${revenueNow - expensesNow < 0 ? 'profit-negative' : ''}`}>
                {expenses ? `${fmt(revenueNow - expensesNow)} THB` : '—'}
              </span>
              <span className="stat-sub">{expenses ? `Expenses ${fmt(expensesNow)} THB this month` : 'Expenses unavailable'}</span>
            </div>
          </div>

          <section className="calc-panel dash-panel">
            <div className="dash-panel-head">
              <h2 className="panel-label">Monthly revenue</h2>
              <div className="view-toggle">
                <button className={`view-toggle-btn ${months === 6 ? 'is-active' : ''}`} onClick={() => setMonths(6)}>6 months</button>
                <button className={`view-toggle-btn ${months === 12 ? 'is-active' : ''}`} onClick={() => setMonths(12)}>12 months</button>
              </div>
            </div>
            {total === 0 ? (
              <p className="empty-state">No revenue recorded in this period yet.</p>
            ) : (
              <div className="bar-chart" role="img" aria-label={`Revenue for the last ${months} months`}>
                {series.map((s) => (
                  <div className={`bar-col ${s.month === thisMonth ? 'is-current' : ''}`} key={s.month}
                    title={`${monthLong(s.month)}: ${fmt(s.revenue)} THB from ${s.orders} order${s.orders === 1 ? '' : 's'}`}>
                    <span className="bar-value">{s.revenue === 0 ? '' : compact(s.revenue)}</span>
                    <span className="bar-track">
                      <span className="bar-fill" style={{ height: `${Math.max(s.revenue > 0 ? 3 : 0, (Math.max(0, s.revenue) / maxRevenue) * 100)}%` }} />
                    </span>
                    <span className="bar-label">{monthShort(s.month)}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="stat-sub dash-foot">Revenue = what customers paid minus your cost, in THB. Total for the period: {fmt(total)} THB.</p>
          </section>

          <section className="calc-panel dash-panel">
            <div className="dash-panel-head">
              <h2 className="panel-label">Coming up</h2>
              <span className="items-count">{upcoming.length} scheduled</span>
            </div>

            {overdue.length > 0 && (
              <>
                <h3 className="dash-group dash-group-alert">Overdue ({overdue.length})</h3>
                <ul className="dash-orders">{overdue.map((o) => orderRow(o, 'overdue'))}</ul>
              </>
            )}

            {upcoming.length === 0 && overdue.length === 0 ? (
              <p className="empty-state">Nothing scheduled. Orders with a delivery date show up here.</p>
            ) : (
              <ul className="dash-orders">{upcoming.slice(0, 12).map((o) => orderRow(o))}</ul>
            )}
            {upcoming.length > 12 && <p className="stat-sub dash-foot">+ {upcoming.length - 12} more in Orders.</p>}

            {unscheduled.length > 0 && (
              <>
                <h3 className="dash-group">No delivery date yet ({unscheduled.length})</h3>
                <ul className="dash-orders">{unscheduled.slice(0, 5).map((o) => orderRow(o))}</ul>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
