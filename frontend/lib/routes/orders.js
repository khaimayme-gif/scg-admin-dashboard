const { requireAuth } = require('../auth');
const { pool, ensureSchema } = require('../db');

const STATUSES = ['pending', 'paid', 'in_progress', 'delivered', 'cancelled'];
const CURRENCIES = ['THB', 'JPY', 'MMK'];

// Settings store: 1 THB = rateThbToJpy JPY, and 1 THB = rateThbToMmk MMK.
function toThb(amount, currency, rates) {
  if (currency === 'THB') return amount;
  if (currency === 'JPY') return rates.thbToJpy ? amount / rates.thbToJpy : null;
  if (currency === 'MMK') return rates.thbToMmk ? amount / rates.thbToMmk : null;
  return null;
}

module.exports = async (req, res, [first, second]) => {
  if (!requireAuth(req, res)) return;
  await ensureSchema();

  if (!first && req.method === 'GET') {
    const result = await pool.query(
      `SELECT id, customer_name, country, to_char(order_date, 'YYYY-MM-DD') AS order_date,
              status, currency, revenue, cost, items_json, notes
       FROM orders ORDER BY order_date DESC, id DESC`
    );
    return res.status(200).json(
      result.rows.map((row) => ({ ...row, items: JSON.parse(row.items_json) }))
    );
  }

  if (first === 'stats' && req.method === 'GET') {
    const [ordersResult, settingsResult] = await Promise.all([
      pool.query('SELECT status, currency, revenue, cost FROM orders'),
      pool.query('SELECT * FROM settings WHERE id = 1'),
    ]);
    const s = settingsResult.rows[0] || {};
    const rates = { thbToJpy: s.rate_thb_to_jpy, thbToMmk: s.rate_thb_to_mmk };

    let revenueThb = 0;
    let costThb = 0;
    let orderCount = 0;
    let cancelledCount = 0;
    let unconverted = 0;

    for (const row of ordersResult.rows) {
      if (row.status === 'cancelled') {
        cancelledCount += 1;
        continue;
      }
      orderCount += 1;
      const rev = toThb(row.revenue, row.currency, rates);
      const cst = toThb(row.cost, row.currency, rates);
      if (rev === null || cst === null) {
        unconverted += 1;
        continue;
      }
      revenueThb += rev;
      costThb += cst;
    }

    return res.status(200).json({
      orderCount,
      cancelledCount,
      revenueThb: Math.round(revenueThb),
      costThb: Math.round(costThb),
      profitThb: Math.round(revenueThb - costThb),
      unconverted, // orders skipped because the exchange rate is missing in Settings
    });
  }

  if (first === 'save' && req.method === 'POST') {
    const { id, customerName, country, orderDate, status, currency, revenue, cost, items, notes } = req.body || {};
    if (!customerName || !country) {
      return res.status(400).json({ error: 'customerName and country are required' });
    }
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    if (!CURRENCIES.includes(currency)) return res.status(400).json({ error: 'Invalid currency' });

    const values = [
      customerName.trim(),
      country.trim(),
      orderDate || new Date().toISOString().slice(0, 10),
      status,
      currency,
      Number(revenue || 0),
      Number(cost || 0),
      JSON.stringify(Array.isArray(items) ? items : []),
      notes || null,
    ];

    if (id) {
      await pool.query(
        `UPDATE orders SET customer_name = $1, country = $2, order_date = $3, status = $4,
           currency = $5, revenue = $6, cost = $7, items_json = $8, notes = $9, updated_at = NOW()
         WHERE id = $10`,
        [...values, id]
      );
      return res.status(200).json({ id });
    }
    const result = await pool.query(
      `INSERT INTO orders (customer_name, country, order_date, status, currency, revenue, cost, items_json, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      values
    );
    return res.status(200).json({ id: result.rows[0].id });
  }

  if (first === 'delete' && second && req.method === 'DELETE') {
    if (!/^\d+$/.test(second)) return res.status(400).json({ error: 'id must be a number' });
    await pool.query('DELETE FROM orders WHERE id = $1', [second]);
    return res.status(200).json({ deleted: true });
  }

  return res.status(404).json({ error: 'Not found' });
};