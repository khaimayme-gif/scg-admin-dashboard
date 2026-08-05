const { requireAuth } = require('../../lib/auth');
const { pool, ensureSchema } = require('../../lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAuth(req, res)) return;

  await ensureSchema();

  const { rateThbToJpy, rateThbToMmk, rateMmkToJpy } = req.body;

  await pool.query(
    `INSERT INTO settings (id, rate_thb_to_jpy, rate_thb_to_mmk, rate_mmk_to_jpy, updated_at)
     VALUES (1, $1, $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE SET
       rate_thb_to_jpy = $1,
       rate_thb_to_mmk = $2,
       rate_mmk_to_jpy = $3,
       updated_at = NOW()`,
    [Number(rateThbToJpy), Number(rateThbToMmk), Number(rateMmkToJpy)]
  );

  res.status(200).json({ ok: true });
};