const { requireAuth } = require('../auth');
const { pool, ensureSchema } = require('../db');

module.exports = async (req, res, [first]) => {
  if (!first && req.method === 'GET') {
    if (!requireAuth(req, res)) return;
    await ensureSchema();
    const result = await pool.query('SELECT * FROM japan_quotes ORDER BY created_at DESC');
    return res.status(200).json(result.rows);
  }

  if (first === 'save' && req.method === 'POST') {
    if (!requireAuth(req, res)) return;
    await ensureSchema();
    const { giftCost, japanFee, thailandFee, total } = req.body || {};
    if (giftCost === undefined || total === undefined) {
      return res.status(400).json({ error: 'giftCost and total are required' });
    }
    const result = await pool.query(
      `INSERT INTO japan_quotes (gift_cost, japan_fee, thailand_fee, total)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [Number(giftCost), Number(japanFee || 0), Number(thailandFee || 0), Number(total)]
    );
    return res.status(200).json({ id: result.rows[0].id });
  }

  return res.status(404).json({ error: 'Not found' });
};
