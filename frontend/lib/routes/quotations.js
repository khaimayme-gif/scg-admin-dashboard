const { requireAuth } = require('../auth');
const { pool, ensureSchema } = require('../db');

const CHANNELS = ['tiktok', 'facebook'];
const PLACES = ['Thailand', 'Japan', 'Myanmar'];

const parse = (row) => ({ ...row, items: JSON.parse(row.items_json) });

module.exports = async (req, res, [first, second]) => {
  if (!requireAuth(req, res)) return;
  await ensureSchema();

  if (!first && req.method === 'GET') {
    const result = await pool.query(
      `SELECT id, customer_name, channel, to_char(quote_date, 'YYYY-MM-DD') AS quote_date, order_place,
              items_json, total_thb, original_thb, revenue_thb, total_mmk, total_jpy
       FROM quotations ORDER BY created_at DESC, id DESC`
    );
    return res.status(200).json(result.rows.map(parse));
  }

  if (first === 'save' && req.method === 'POST') {
    const { customerName, channel, quoteDate, orderPlace, items } = req.body || {};
    if (!customerName || !customerName.trim()) {
      return res.status(400).json({ error: 'customerName is required' });
    }
    if (!CHANNELS.includes(channel)) return res.status(400).json({ error: 'Invalid channel' });
    if (!PLACES.includes(orderPlace)) return res.status(400).json({ error: 'Invalid order place' });

    const cleanItems = (Array.isArray(items) ? items : [])
      .map((i) => ({
        name: String(i.name || '').trim(),
        sellingPrice: Number(i.sellingPrice) || 0,
        originalPrice: Number(i.originalPrice) || 0,
      }))
      .filter((i) => i.name);
    if (cleanItems.length === 0) return res.status(400).json({ error: 'Add at least one item' });

    // All amounts are calculated here, never trusted from the browser:
    //   total   = sum of selling prices (what the customer is quoted)
    //   revenue = sum of (selling price - original price)
    const totalThb = cleanItems.reduce((sum, i) => sum + i.sellingPrice, 0);
    const originalThb = cleanItems.reduce((sum, i) => sum + i.originalPrice, 0);
    const revenueThb = totalThb - originalThb;

    // The MMK and yen amounts the customer was quoted are stored, so they stay the same
    // even if the exchange rates in Settings change later.
    const settings = await pool.query('SELECT * FROM settings WHERE id = 1');
    const s = settings.rows[0] || {};
    const totalMmk = s.rate_thb_to_mmk ? Math.round(totalThb * s.rate_thb_to_mmk) : null;
    const totalJpy = s.rate_thb_to_jpy ? Math.round(totalThb * s.rate_thb_to_jpy) : null;

    const result = await pool.query(
      `INSERT INTO quotations (customer_name, channel, quote_date, order_place, items_json,
                               total_thb, original_thb, revenue_thb, total_mmk, total_jpy)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, customer_name, channel, to_char(quote_date, 'YYYY-MM-DD') AS quote_date, order_place,
                 items_json, total_thb, original_thb, revenue_thb, total_mmk, total_jpy`,
      [
        customerName.trim(),
        channel,
        quoteDate || new Date().toISOString().slice(0, 10),
        orderPlace,
        JSON.stringify(cleanItems),
        totalThb,
        originalThb,
        revenueThb,
        totalMmk,
        totalJpy,
      ]
    );
    return res.status(200).json(parse(result.rows[0]));
  }

  if (first === 'delete' && second && req.method === 'DELETE') {
    if (!/^\d+$/.test(second)) return res.status(400).json({ error: 'id must be a number' });
    await pool.query('DELETE FROM quotations WHERE id = $1', [second]);
    return res.status(200).json({ deleted: true });
  }

  return res.status(404).json({ error: 'Not found' });
};
