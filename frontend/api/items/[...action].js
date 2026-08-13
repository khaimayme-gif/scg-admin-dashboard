const { requireAuth } = require('../../lib/auth');
const { pool, ensureSchema } = require('../../lib/db');

module.exports = async (req, res) => {
  const raw = req.query.action || [];
  const segments = Array.isArray(raw) ? raw : [raw];
  const [first, second] = segments;

  if ((!first || first === '_root') && req.method === 'GET') {
    if (!requireAuth(req, res)) return;
    await ensureSchema();
    const result = await pool.query('SELECT * FROM items ORDER BY category, name');
    return res.status(200).json(result.rows);
  }

  if (first === 'save' && req.method === 'POST') {
    if (!requireAuth(req, res)) return;
    await ensureSchema();
    const { id, category, name, menuPrice, originalCost } = req.body;
    if (!category || !name || menuPrice === undefined) {
      return res.status(400).json({ error: 'category, name, and menuPrice are required' });
    }
    if (id) {
      await pool.query(
        `UPDATE items SET category = $1, name = $2, menu_price = $3, original_cost = $4, updated_at = NOW()
         WHERE id = $5`,
        [category, name, Number(menuPrice), originalCost === undefined || originalCost === null ? null : Number(originalCost), id]
      );
      return res.status(200).json({ id });
    }
    const result = await pool.query(
      `INSERT INTO items (category, name, menu_price, original_cost)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [category, name, Number(menuPrice), originalCost === undefined || originalCost === null ? null : Number(originalCost)]
    );
    return res.status(200).json({ id: result.rows[0].id });
  }

  if (first === 'delete' && second && req.method === 'DELETE') {
    if (!requireAuth(req, res)) return;
    await ensureSchema();
    await pool.query('DELETE FROM items WHERE id = $1', [second]);
    return res.status(200).json({ deleted: true });
  }

  return res.status(404).json({ error: 'Not found' });
};