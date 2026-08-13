const { requireAuth } = require('../../lib/auth');
const { pool, ensureSchema } = require('../../lib/db');

module.exports = async (req, res) => {
  const raw = req.query.action || [];
  const segments = Array.isArray(raw) ? raw : [raw];
  const [first] = segments;

  if ((!first || first === '_root') && req.method === 'GET') {
    if (!requireAuth(req, res)) return;
    await ensureSchema();
    const result = await pool.query('SELECT * FROM settings WHERE id = 1');
    const row = result.rows[0] || {};
    return res.status(200).json({
      rateThbToJpy: row.rate_thb_to_jpy ?? null,
      rateThbToMmk: row.rate_thb_to_mmk ?? null,
      rateMmkToJpy: row.rate_mmk_to_jpy ?? null,
    });
  }

  if (first === 'save' && req.method === 'POST') {
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
    return res.status(200).json({ ok: true });
  }

  return res.status(404).json({ error: 'Not found' });
};