const { requireAuth } = require('../auth');
const { pool, ensureSchema } = require('../db');

const CODE_PATTERN = /^[A-Z0-9]{1,4}$/;

// Next free Item ID for a type: the prefix plus one more than the highest number already used
// with that prefix (CK01, CK02 -> CK03), at least two digits.
function nextCode(prefix, itemCodes) {
  const pattern = new RegExp(`^${prefix}(\\d+)$`);
  let max = 0;
  for (const code of itemCodes) {
    const match = pattern.exec(code);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}${String(max + 1).padStart(2, '0')}`;
}

module.exports = async (req, res, [first, second]) => {
  if (!requireAuth(req, res)) return;
  await ensureSchema();

  if (!first && req.method === 'GET') {
    const [types, codes, counts] = await Promise.all([
      pool.query('SELECT id, name, code FROM item_types ORDER BY id'),
      pool.query('SELECT item_code FROM items WHERE item_code IS NOT NULL'),
      pool.query('SELECT category, COUNT(*)::int AS n FROM items GROUP BY category'),
    ]);
    const itemCodes = codes.rows.map((r) => r.item_code);
    const countByName = new Map(counts.rows.map((r) => [r.category, r.n]));
    return res.status(200).json(
      types.rows.map((t) => ({
        ...t,
        next_code: nextCode(t.code, itemCodes),
        item_count: countByName.get(t.name) || 0,
      }))
    );
  }

  if (first === 'save' && req.method === 'POST') {
    const { id } = req.body || {};
    const name = String((req.body || {}).name || '').trim();
    const code = String((req.body || {}).code || '').trim().toUpperCase();
    if (!name) return res.status(400).json({ error: 'Type name is required' });
    if (!CODE_PATTERN.test(code)) {
      return res.status(400).json({ error: 'Code must be 1 to 4 letters or numbers, e.g. CK' });
    }
    try {
      if (id) {
        const old = await pool.query('SELECT name FROM item_types WHERE id = $1', [id]);
        if (old.rowCount === 0) return res.status(404).json({ error: 'Type not found' });
        await pool.query('UPDATE item_types SET name = $1, code = $2 WHERE id = $3', [name, code, id]);
        // Items store their type by name, so a rename has to carry over to them.
        if (old.rows[0].name !== name) {
          await pool.query('UPDATE items SET category = $1 WHERE category = $2', [name, old.rows[0].name]);
        }
        return res.status(200).json({ id });
      }
      const result = await pool.query('INSERT INTO item_types (name, code) VALUES ($1, $2) RETURNING id', [name, code]);
      return res.status(200).json({ id: result.rows[0].id });
    } catch (err) {
      if (err && err.code === '23505') {
        return res.status(409).json({ error: 'A type with that name or code already exists' });
      }
      throw err;
    }
  }

  if (first === 'delete' && second && req.method === 'DELETE') {
    if (!/^\d+$/.test(second)) return res.status(400).json({ error: 'id must be a number' });
    const type = await pool.query('SELECT name FROM item_types WHERE id = $1', [second]);
    if (type.rowCount === 0) return res.status(404).json({ error: 'Type not found' });
    const used = await pool.query('SELECT COUNT(*)::int AS n FROM items WHERE category = $1', [type.rows[0].name]);
    if (used.rows[0].n > 0) {
      return res.status(409).json({ error: `${used.rows[0].n} item(s) still use this type. Move or delete them first.` });
    }
    await pool.query('DELETE FROM item_types WHERE id = $1', [second]);
    return res.status(200).json({ deleted: true });
  }

  return res.status(404).json({ error: 'Not found' });
};
