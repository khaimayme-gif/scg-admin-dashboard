import { useState, useEffect } from 'react';
import { apiFetch } from './api';
import { useRole, lockedCountryOf } from './role';

interface OrderItem {
  name: string;
  quantity: number;
}

interface Order {
  id: number;
  order_no: string | null;
  customer_name: string;
  recipient: string | null;
  country: string;
  status: string;
  board_stage: string;
  currency: string;
  selling_price: number;
  delivery_date: string | null;
  delivery_address: string | null;
  items: OrderItem[];
}

interface MonthRow {
  month: string; // YYYY-MM
  orderCount: number;
  sellingThb: number;
  costThb: number;
  revenueThb: number; // selling price minus cost
  platformFeeThb: number; // SochicGifts platform fee (Japan orders)
}

type CountryKey = 'thailand' | 'japan' | 'other';
type View = 'all' | CountryKey;

interface DashboardData {
  rates: { thbToJpy: number | null; thbToMmk: number | null };
  countries: Record<CountryKey, MonthRow[]>;
  expenses: { oneTimeThisMonthThb: number; monthlyRunRateThb: number } | null;
  unconverted: number;
}

interface Totals {
  orders: number;
  selling: number;
  cost: number;
  revenue: number;
  fee: number;
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

const COUNTRY_LABELS: Record<CountryKey, string> = { thailand: 'Thailand', japan: 'Japan', other: 'Other' };
const ALL_KEYS: CountryKey[] = ['thailand', 'japan', 'other'];

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

const compact = (n: number) => (Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(Math.abs(n) >= 10000 ? 0 : 1)}k` : String(Math.round(n)));

const keyOf = (country: string): CountryKey => {
  const c = country.trim().toLowerCase();
  return c === 'thailand' || c === 'japan' ? c : 'other';
};

const emptyTotals = (): Totals => ({ orders: 0, selling: 0, cost: 0, revenue: 0, fee: 0 });

interface DashboardProps {
  onOpenOrder?: (orderId: number) => void;
}

export default function Dashboard({ onOpenOrder }: DashboardProps) {
  // Thai and Japan admins only get their own country's numbers (the server enforces it too).
  const lockedCountry = lockedCountryOf(useRole());
  const isLocked = lockedCountry !== null;
  const [orders, setOrders] = useState<Order[]>([]);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>(lockedCountry ? (lockedCountry.toLowerCase() as View) : 'all');
  const [months, setMonths] = useState<6 | 12>(6);
  const thisMonth = todayLocal().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);

  useEffect(() => {
    Promise.all([apiFetch('/orders').then((r) => r.json()), apiFetch('/dashboard').then((r) => r.json())])
      .then(([orderRows, dash]) => {
        setOrders(Array.isArray(orderRows) ? orderRows : []);
        if (dash && dash.countries) setData(dash);
      })
      .catch(() => {
        // a 401 has already sent us back to login
      })
      .finally(() => setLoading(false));
  }, []);

  const keys: CountryKey[] = view === 'all' ? ALL_KEYS : [view];
  const rows = (key: CountryKey) => data?.countries[key] ?? [];

  const totalsFor = (list: CountryKey[], ym: string): Totals =>
    list.reduce((t, key) => {
      const r = rows(key).find((x) => x.month === ym);
      if (!r) return t;
      return {
        orders: t.orders + r.orderCount,
        selling: t.selling + r.sellingThb,
        cost: t.cost + r.costThb,
        revenue: t.revenue + r.revenueThb,
        fee: t.fee + r.platformFeeThb,
      };
    }, emptyTotals());

  // What SochicGifts itself earns: Thai (and other) order revenue plus the platform fees on
  // Japan orders. The revenue on Japan orders belongs to the Japan admin.
  const scgProfit = (key: CountryKey, t: Totals) => (key === 'japan' ? t.fee : t.revenue);
  const scgProfitFor = (list: CountryKey[], ym: string) =>
    list.reduce((sum, key) => sum + scgProfit(key, totalsFor([key], ym)), 0);

  // The chart plots one number per month for the current view.
  const seriesValue = (ym: string) => {
    if (view === 'all') return scgProfitFor(ALL_KEYS, ym);
    return totalsFor([view], ym).revenue;
  };

  // Japan views are shown in yen, everything else in baht, both from the Settings rate.
  const yen = view === 'japan' && data?.rates.thbToJpy ? data.rates.thbToJpy : null;
  const money = (thb: number) => (yen ? `${fmt(thb * yen)} Yen` : `${fmt(thb)} THB`);
  const moneyShort = (thb: number) => compact(yen ? thb * yen : thb);

  const monthOptions = Array.from(
    new Set([thisMonth, ...ALL_KEYS.flatMap((k) => rows(k).map((r) => r.month))])
  ).sort((a, b) => b.localeCompare(a));

  const cur = totalsFor(keys, month);
  const prevProfit = view === 'all' ? scgProfitFor(ALL_KEYS, shiftMonth(month, -1)) : totalsFor(keys, shiftMonth(month, -1)).revenue;
  const curProfit = view === 'all' ? scgProfitFor(ALL_KEYS, month) : cur.revenue;
  const delta = prevProfit > 0 ? Math.round(((curProfit - prevProfit) / prevProfit) * 100) : null;
  const deltaText = delta === null ? 'No profit last month to compare' : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)}% vs last month`;

  const expenses = data?.expenses ?? null;
  const expensesNow = expenses ? expenses.oneTimeThisMonthThb + expenses.monthlyRunRateThb : 0;

  // Orders still to deliver: on So Chic Board in To do or In progress.
  const inView = (o: Order) => view === 'all' || keyOf(o.country) === view;
  const open = orders.filter(
    (o) => inView(o) && o.status !== 'cancelled' && (o.board_stage === 'todo' || o.board_stage === 'in_progress')
  );
  const scheduled = open.filter((o) => o.delivery_date);
  const byDate = (a: Order, b: Order) => (a.delivery_date as string).localeCompare(b.delivery_date as string);
  const overdue = scheduled.filter((o) => daysFromToday(o.delivery_date as string) < 0).sort(byDate);
  const upcoming = scheduled.filter((o) => daysFromToday(o.delivery_date as string) >= 0).sort(byDate);
  const unscheduled = open.filter((o) => !o.delivery_date);
  const next7 = upcoming.filter((o) => daysFromToday(o.delivery_date as string) <= 7).length;

  const series = Array.from({ length: months }, (_, i) => {
    const m = shiftMonth(thisMonth, i - (months - 1));
    return { month: m, value: seriesValue(m), orders: totalsFor(keys, m).orders };
  });
  const maxValue = Math.max(1, ...series.map((s) => s.value));
  const total = series.reduce((sum, s) => sum + s.value, 0);

  const chartTitle = view === 'all' ? 'SochicGifts profit by month' : view === 'japan' ? (isLocked ? 'Your profit by month' : 'Japan admin profit by month') : isLocked ? 'Your profit by month' : 'Profit by month';
  const chartNote =
    view === 'all'
      ? 'Profit = revenue on Thailand orders + SochicGifts platform fees on Japan orders, in THB at the Settings rates, before expenses.'
      : view === 'japan'
        ? 'Profit = selling price minus cost on Japan orders. The platform fee is shown separately.'
        : 'Profit = selling price minus cost, in THB at the Settings rates.';

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

  const card = (label: string, value: string, sub?: string, negative = false) => (
    <div className="stat-card">
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${negative ? 'profit-negative' : ''}`}>{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );

  const deliverCard = card('To deliver, next 7 days', String(next7), overdue.length > 0 ? `${overdue.length} overdue` : 'None overdue');

  return (
    <div className="page">
      <header className="page-header">
        <h1>Dashboard</h1>
        <p className="page-subtitle">
          {lockedCountry ? `How your ${lockedCountry} orders are doing, and what needs to go out next.` : 'How So Chic Gifts is doing, and what needs to go out next.'}
        </p>
      </header>

      {loading ? (
        <p className="empty-state">Loading…</p>
      ) : (
        <>
          <div className="dash-filters">
            {!isLocked && (
              <div className="view-toggle" role="tablist" aria-label="Country">
                {(['all', 'thailand', 'japan'] as View[]).map((v) => (
                  <button key={v} role="tab" aria-selected={view === v}
                    className={`view-toggle-btn ${view === v ? 'is-active' : ''}`} onClick={() => setView(v)}>
                    {v === 'all' ? 'All countries' : COUNTRY_LABELS[v]}
                  </button>
                ))}
              </div>
            )}
            <select className="item-input month-select" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
              {monthOptions.map((m) => <option key={m} value={m}>{monthLong(m)}</option>)}
            </select>
          </div>

          {view === 'japan' && !yen && (
            <p className="warn-text">Set the THB to yen rate in Settings to see Japan figures in yen. Showing baht for now.</p>
          )}

          <div className="stat-grid">
            {view === 'all' && (
              <>
                {card(`SochicGifts profit · ${monthLong(month)}`, money(curProfit), `${deltaText}, before expenses`, curProfit < 0)}
                {month === thisMonth
                  ? card('After expenses', money(curProfit - expensesNow), `Expenses ${money(expensesNow)} this month`, curProfit - expensesNow < 0)
                  : card('After expenses', '—', 'Expenses are tracked for the current month')}
                {card('Platform fees', money(totalsFor(['japan'], month).fee), 'From Japan orders, part of the profit above')}
                {card('Orders', String(cur.orders), `${totalsFor(['thailand'], month).orders} Thailand · ${totalsFor(['japan'], month).orders} Japan`)}
                {deliverCard}
              </>
            )}
            {view === 'thailand' && (
              <>
                {card('Orders', String(cur.orders), monthLong(month))}
                {card('Collected', money(cur.selling), 'Selling price total')}
                {card('Cost', money(cur.cost))}
                {card('Profit', money(cur.revenue), deltaText, cur.revenue < 0)}
                {deliverCard}
              </>
            )}
            {view === 'japan' && (
              <>
                {card('Orders', String(cur.orders), monthLong(month))}
                {card('Collected', money(cur.selling), 'Selling price total')}
                {card('Cost', money(cur.cost))}
                {card(isLocked ? 'Your profit' : 'Japan admin profit', money(cur.revenue), `${deltaText}, selling price minus cost`, cur.revenue < 0)}
                {card('SochicGifts platform fees', money(cur.fee), 'All platform fees from Japan orders')}
                {deliverCard}
              </>
            )}
          </div>

          {view === 'all' && (
            <section className="calc-panel dash-panel">
              <div className="dash-panel-head">
                <h2 className="panel-label">By country · {monthLong(month)}</h2>
              </div>
              <div className="orders-table-wrap">
                <table className="items-table dash-table">
                  <thead>
                    <tr>
                      <th>Country</th>
                      <th className="num-col">Orders</th>
                      <th className="num-col">Collected</th>
                      <th className="num-col">Cost</th>
                      <th className="num-col">Revenue</th>
                      <th className="num-col">Platform fees</th>
                      <th className="num-col">SochicGifts profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ALL_KEYS.filter((k) => k !== 'other' || totalsFor(['other'], month).orders > 0).map((k) => {
                      const t = totalsFor([k], month);
                      return (
                        <tr key={k}>
                          <td><span className="cell-main">{COUNTRY_LABELS[k]}</span></td>
                          <td className="num-col">{t.orders}</td>
                          <td className="items-price-cell num-col">{fmt(t.selling)} THB</td>
                          <td className="items-price-cell num-col">{fmt(t.cost)} THB</td>
                          <td className="items-price-cell num-col">
                            {fmt(t.revenue)} THB
                          </td>
                          <td className="items-price-cell num-col">{t.fee ? `${fmt(t.fee)} THB` : '—'}</td>
                          <td className="items-price-cell num-col"><strong>{fmt(scgProfit(k, t))} THB</strong></td>
                        </tr>
                      );
                    })}
                    <tr className="total-row">
                      <td><span className="cell-main">Total</span></td>
                      <td className="num-col">{cur.orders}</td>
                      <td className="items-price-cell num-col">{fmt(cur.selling)} THB</td>
                      <td className="items-price-cell num-col">{fmt(cur.cost)} THB</td>
                      <td className="items-price-cell num-col">{fmt(cur.revenue)} THB</td>
                      <td className="items-price-cell num-col">{fmt(cur.fee)} THB</td>
                      <td className="items-price-cell num-col"><strong>{fmt(curProfit)} THB</strong></td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="stat-sub dash-foot">The revenue on Japan orders is the Japan admin's. SochicGifts' profit from Japan is the platform fee.</p>
            </section>
          )}

          <section className="calc-panel dash-panel">
            <div className="dash-panel-head">
              <h2 className="panel-label">{chartTitle}</h2>
              <div className="view-toggle">
                <button className={`view-toggle-btn ${months === 6 ? 'is-active' : ''}`} onClick={() => setMonths(6)}>6 months</button>
                <button className={`view-toggle-btn ${months === 12 ? 'is-active' : ''}`} onClick={() => setMonths(12)}>12 months</button>
              </div>
            </div>
            {total === 0 ? (
              <p className="empty-state">No profit recorded in this period yet.</p>
            ) : (
              <div className="bar-chart" role="img" aria-label={`${chartTitle}, last ${months} months`}>
                {series.map((s) => (
                  <div className={`bar-col ${s.month === month ? 'is-current' : ''}`} key={s.month}
                    title={`${monthLong(s.month)}: ${money(s.value)} from ${s.orders} order${s.orders === 1 ? '' : 's'}`}>
                    <span className="bar-value">{s.value === 0 ? '' : moneyShort(s.value)}</span>
                    <span className="bar-track">
                      <span className="bar-fill" style={{ height: `${Math.max(s.value > 0 ? 3 : 0, (Math.max(0, s.value) / maxValue) * 100)}%` }} />
                    </span>
                    <span className="bar-label">{monthShort(s.month)}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="stat-sub dash-foot">{chartNote}</p>
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

          {data && data.unconverted > 0 && (
            <p className="error-text">{data.unconverted} order(s) are left out because an exchange rate is missing in Settings.</p>
          )}
        </>
      )}
    </div>
  );
}
