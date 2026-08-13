const { requireAuth } = require('../auth');
const { pool, ensureSchema } = require('../db');

const MARKUP_PERCENT = 40;

module.exports = async (req, res, [action]) => {
  if (action === 'calculate') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!requireAuth(req, res)) return;

    const { items, deliveryFee } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items must be a non-empty array' });
    }

    const itemsCost = items.reduce((sum, item) => sum + Number(item.cost || 0), 0);
    const markedUpItemsCost = itemsCost * (1 + MARKUP_PERCENT / 100);
    const delivery = Number(deliveryFee || 0);
    const total = markedUpItemsCost + delivery;

    return res.status(200).json({
      itemsCost,
      markupPercent: MARKUP_PERCENT,
      markedUpItemsCost: Math.round(markedUpItemsCost * 100) / 100,
      deliveryFee: delivery,
      total: Math.round(total * 100) / 100,
    });
  }

  if (action === 'save') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!requireAuth(req, res)) return;

    await ensureSchema();
    const { items, markupPercent, deliveryFee, total } = req.body || {};
    const result = await pool.query(
      `INSERT INTO price_quotes (items_json, markup_percent, delivery_fee, total)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [JSON.stringify(items), markupPercent, deliveryFee, total]
    );
    return res.status(200).json({ id: result.rows[0].id });
  }

  if (action === 'quotes') {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    if (!requireAuth(req, res)) return;

    await ensureSchema();
    const result = await pool.query('SELECT * FROM price_quotes ORDER BY created_at DESC');
    return res.status(200).json(result.rows.map((row) => ({ ...row, items_json: JSON.parse(row.items_json) })));
  }

  return res.status(404).json({ error: 'Not found' });
};
