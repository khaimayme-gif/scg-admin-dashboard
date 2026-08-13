const { requireAuth } = require('../../lib/auth');
const { pool, ensureSchema } = require('../../lib/db');

module.exports = async (req, res) => {
  const raw = req.query.segments || [];
  const segments = Array.isArray(raw) ? raw : [raw];
  const [first, second] = segments;

  if (first === 'save' && req.method === 'POST') {
    if (!requireAuth(req, res)) return;
    await ensureSchema();
    const { url, label, theme } = req.body;
    if (!url || !url.trim()) return res.status(400).json({ error: 'url is required' });
    const result = await pool.query(
      'INSERT INTO qr_codes (url, label, theme) VALUES ($1, $2, $3) RETURNING id',
      [url, label || null, theme || null]
    );
    return res.status(200).json({ id: result.rows[0].id });
  }

  if (first === 'history' && !second && req.method === 'GET') {
    if (!requireAuth(req, res)) return;
    await ensureSchema();
    const result = await pool.query('SELECT * FROM qr_codes ORDER BY created_at DESC');
    return res.status(200).json(result.rows);
  }

  if (first === 'history' && second && req.method === 'DELETE') {
    if (!requireAuth(req, res)) return;
    await ensureSchema();
    await pool.query('DELETE FROM qr_codes WHERE id = $1', [second]);
    return res.status(200).json({ deleted: true });
  }

  return res.status(404).json({ error: 'Not found' });
};