// Numbers for the Dashboard page, split by country and month.
//
//   GET /api/dashboard
//
// Everything is converted to THB with the exchange rates in Settings (the page converts to yen
// for the Japan views). The Japan admin only ever gets Japan data and no expenses.
//
// Cancelled orders are left out. Country is matched case/space-insensitively; anything that is
// not Thailand or Japan is grouped as "other".
const { requireAuth } = require('../auth');
const { pool, ensureSchema } = require('../db');

function toThb(amount, currency, rates) {
  if (currency === 'THB') return amount;
  if (currency === 'JPY') return rates.thbToJpy ? amount / rates.thbToJpy : null;
  if (currency === 'MMK') return rates.thbToMmk ? amount / rates.thbToMmk : null;
  return null;
}

const countryKey = (country) => {
  const c = String(country || '').trim().toLowerCase();
  return c === 'thailand' || c === 'japan' ? c : 'other';
};

module.exports = async (req, res, [first]) => {
  const session = requireAuth(req, res);
  if (!session) return;
  if (first || req.method !== 'GET') return res.status(404).json({ error: 'Not found' });
  const japanOnly = session.role === 'japan';
  await ensureSchema();

  const [ordersResult, settingsResult] = await Promise.all([
    pool.query(
      `SELECT status, country, currency, selling_price, cost, revenue, platform_fee_jpy,
              to_char(order_date, 'YYYY-MM') AS month
       FROM orders
       ${japanOnly ? "WHERE lower(btrim(country)) = 'japan'" : ''}`
    ),
    pool.query('SELECT * FROM settings WHERE id = 1'),
  ]);
  const s = settingsResult.rows[0] || {};
  const rates = { thbToJpy: s.rate_thb_to_jpy || null, thbToMmk: s.rate_thb_to_mmk || null };

  const countries = { thailand: {}, japan: {}, other: {} }; // key -> month -> totals
  let unconverted = 0;

  for (const row of ordersResult.rows) {
    if (row.status === 'cancelled') continue;
    const sell = toThb(Number(row.selling_price), row.currency, rates);
    const cost = toThb(Number(row.cost), row.currency, rates);
    const revenue = toThb(Number(row.revenue), row.currency, rates);
    if (sell === null || cost === null || revenue === null) {
      unconverted += 1;
      continue;
    }
    // SochicGifts' platform fee on Japan orders is stored in yen.
    const fee = row.platform_fee_jpy && rates.thbToJpy ? row.platform_fee_jpy / rates.thbToJpy : 0;
    const bucket = countries[countryKey(row.country)];
    const m = (bucket[row.month] = bucket[row.month] || {
      month: row.month, orderCount: 0, sellingThb: 0, costThb: 0, revenueThb: 0, platformFeeThb: 0,
    });
    m.orderCount += 1;
    m.sellingThb += sell;
    m.costThb += cost;
    m.revenueThb += revenue;
    m.platformFeeThb += fee;
  }

  const round = (m) => ({
    ...m,
    sellingThb: Math.round(m.sellingThb),
    costThb: Math.round(m.costThb),
    revenueThb: Math.round(m.revenueThb),
    platformFeeThb: Math.round(m.platformFeeThb),
  });
  const out = {};
  for (const [key, byMonth] of Object.entries(countries)) {
    out[key] = Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month)).map(round);
  }

  let expenses = null;
  if (!japanOnly) {
    const thisMonth = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit' })
      .format(new Date());
    const result = await pool.query('SELECT cost, currency, recurrence, expense_date FROM expenses');
    let oneTimeThisMonthThb = 0;
    let monthlyRunRateThb = 0;
    for (const row of result.rows) {
      const cost = toThb(Number(row.cost) || 0, row.currency, rates);
      if (cost === null) continue;
      if (row.recurrence === 'monthly') monthlyRunRateThb += cost;
      else if (row.recurrence === 'yearly') monthlyRunRateThb += cost / 12;
      else if (row.expense_date && String(row.expense_date).slice(0, 7) === thisMonth) oneTimeThisMonthThb += cost;
    }
    expenses = {
      oneTimeThisMonthThb: Math.round(oneTimeThisMonthThb),
      monthlyRunRateThb: Math.round(monthlyRunRateThb),
    };
  }

  return res.status(200).json({ rates, countries: out, expenses, unconverted });
};
