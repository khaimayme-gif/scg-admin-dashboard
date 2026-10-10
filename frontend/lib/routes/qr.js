const { requireAuth } = require('../auth');
const { pool, ensureSchema } = require('../db');

module.exports = async (req, res, [first, second]) => {
  if (first === 'save' && req.method === 'POST') {
    const session = await requireAuth(req, res);
    if (!session) return;
    await ensureSchema();
    const { url, label, cardTheme, dotColor, showHandle } = req.body || {};
    if (!url || !url.trim()) return res.status(400).json({ error: 'url is required' });
    const result = await pool.query(
      `INSERT INTO qr_codes (url, label, card_theme, dot_color, show_handle, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [url, label || null, cardTheme || null, dotColor || null, !!showHandle, session.role]
    );
    return res.status(200).json({ id: result.rows[0].id });
  }

  if (first === 'history' && !second && req.method === 'GET') {
    const session = await requireAuth(req, res);
    if (!session) return;
    await ensureSchema();
    // Japan and Thai admins only see the QR codes made by their own role.
    const result = await pool.query(
      `SELECT * FROM qr_codes WHERE ($1::text IS NULL OR created_by = $1) ORDER BY created_at DESC`,
      [session.role === 'superadmin' ? null : session.role]
    );
    return res.status(200).json(result.rows);
  }

  if (first === 'history' && second && req.method === 'DELETE') {
    const session = await requireAuth(req, res);
    if (!session) return;
    if (!/^\d+$/.test(second)) return res.status(400).json({ error: 'id must be a number' });
    await ensureSchema();
    await pool.query(
      `DELETE FROM qr_codes WHERE id = $1 AND ($2::text IS NULL OR created_by = $2)`,
      [second, session.role === 'superadmin' ? null : session.role]
    );
    return res.status(200).json({ deleted: true });
  }

  return res.status(404).json({ error: 'Not found' });
};
