const { requireAuth } = require('../../../lib/auth');
const { pool, ensureSchema } = require('../../../lib/db');

module.exports = async (req, res) => {
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });
  if (!requireAuth(req, res)) return;

  await ensureSchema();

  const { id } = req.query;
  await pool.query('DELETE FROM items WHERE id = $1', [id]);
  res.status(200).json({ deleted: true });
};