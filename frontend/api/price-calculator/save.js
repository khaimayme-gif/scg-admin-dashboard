const { requireAuth } = require('../../lib/auth');
const { pool, ensureSchema } = require('../../lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAuth(req, res)) return;

  await ensureSchema();

  const { items, markupPercent, deliveryFee, total } = req.body;

  const result = await pool.query(
    `INSERT INTO price_quotes (items_json, markup_percent, delivery_fee, total)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [JSON.stringify(items), markupPercent, deliveryFee, total]
  );

  res.status(200).json({ id: result.rows[0].id });
};