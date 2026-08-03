const { requireAuth } = require('../../lib/auth');
const { pool, ensureSchema } = require('../../lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAuth(req, res)) return;

  await ensureSchema();

  const { url, label, theme } = req.body;
  if (!url || !url.trim()) {
    return res.status(400).json({ error: 'url is required' });
  }

  const result = await pool.query(
    'INSERT INTO qr_codes (url, label, theme) VALUES ($1, $2, $3) RETURNING id',
    [url, label || null, theme || null]
  );

  res.status(200).json({ id: result.rows[0].id });
};