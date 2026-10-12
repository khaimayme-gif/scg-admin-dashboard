// Survey answers for the admin (Feedback page). Customers send them through the public form
// (lib/routes/public.js). The super admin sees everything; a Thai or Japan admin only sees the
// answers that came in through their own country's link.
const { requireAuth, requireSuper, scopeOf } = require('../auth');
const { pool, ensureSchema } = require('../db');

module.exports = async (req, res, [first, second]) => {
  const session = await requireAuth(req, res);
  if (!session) return;
  await ensureSchema();
  const scope = scopeOf(session); // 'thailand' | 'japan' | null (super admin)

  if (!first && req.method === 'GET') {
    const result = await pool.query(
      `SELECT id, name, country, delivery, rating, feedback, created_at
       FROM survey_responses
       WHERE ($1::text IS NULL OR country = $1)
       ORDER BY created_at DESC, id DESC
       LIMIT 1000`,
      [scope]
    );
    return res.status(200).json(result.rows);
  }

  // Super admin only from here on.
  if (first === 'country' && req.method === 'POST') {
    if (!(await requireSuper(req, res))) return;
    const { id, country } = req.body || {};
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id must be a number' });
    if (country !== null && country !== 'thailand' && country !== 'japan') return res.status(400).json({ error: 'Invalid country' });
    const result = await pool.query('UPDATE survey_responses SET country = $1 WHERE id = $2 RETURNING id', [country, id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Response not found' });
    return res.status(200).json({ id, country });
  }

  if (first === 'delete' && second && req.method === 'DELETE') {
    if (!(await requireSuper(req, res))) return;
    if (!/^\d+$/.test(second)) return res.status(400).json({ error: 'id must be a number' });
    await pool.query('DELETE FROM survey_responses WHERE id = $1', [second]);
    return res.status(200).json({ deleted: true });
  }

  return res.status(404).json({ error: 'Not found' });
};
