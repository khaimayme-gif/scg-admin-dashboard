const { requireAuth } = require('../../lib/auth');
const { pool, ensureSchema } = require('../../lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAuth(req, res)) return;

  await ensureSchema();

  const result = await pool.query('SELECT * FROM price_quotes ORDER BY created_at DESC');
  res.status(200).json(result.rows.map(row => ({ ...row, items_json: JSON.parse(row.items_json) })));
};