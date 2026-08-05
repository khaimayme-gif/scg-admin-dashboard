const { requireAuth } = require('../lib/auth');
const { pool, ensureSchema } = require('../lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAuth(req, res)) return;

  await ensureSchema();

  const result = await pool.query('SELECT * FROM settings WHERE id = 1');
  const row = result.rows[0] || {};

  res.status(200).json({
    rateThbToJpy: row.rate_thb_to_jpy ?? null,
    rateThbToMmk: row.rate_thb_to_mmk ?? null,
    rateMmkToJpy: row.rate_mmk_to_jpy ?? null,
  });
};