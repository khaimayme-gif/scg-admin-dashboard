const { requireAuth } = require('../../lib/auth');
const { pool, ensureSchema } = require('../../lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAuth(req, res)) return;

  await ensureSchema();

  const { giftCost, japanFee, thailandFee, total } = req.body;
  if (giftCost === undefined || total === undefined) {
    return res.status(400).json({ error: 'giftCost and total are required' });
  }

  const result = await pool.query(
    `INSERT INTO japan_quotes (gift_cost, japan_fee, thailand_fee, total)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [Number(giftCost), Number(japanFee || 0), Number(thailandFee || 0), Number(total)]
  );

  res.status(200).json({ id: result.rows[0].id });
};