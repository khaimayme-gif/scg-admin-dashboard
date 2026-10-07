const { requireAuth } = require('../auth');
const { pool, ensureSchema } = require('../db');

// The list never carries photo_data: it can be hundreds of KB per row. The photo is fetched
// separately from /api/public/photo/:id, so `photo_version` is only there to bust the cache.
const LIST_COLUMNS = `id, category, name, menu_price, original_cost, item_code, description, published,
  (photo_data IS NOT NULL) AS has_photo, EXTRACT(EPOCH FROM updated_at)::bigint AS photo_version`;

// Photos arrive as data URLs already shrunk by the browser. Cap the size so a bad client
// can't fill the database.
const MAX_PHOTO_CHARS = 1_500_000;
const PHOTO_PATTERN = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

module.exports = async (req, res, [first, second]) => {
  if (!first && req.method === 'GET') {
    if (!requireAuth(req, res)) return;
    await ensureSchema();
    const result = await pool.query(`SELECT ${LIST_COLUMNS} FROM items ORDER BY category, item_code NULLS LAST, name`);
    return res.status(200).json(result.rows);
  }

  // Admin-side photo (works for unpublished items too, unlike /api/public/photo).
  if (first === 'photo' && second && req.method === 'GET') {
    if (!requireAuth(req, res)) return;
    if (!/^\d+$/.test(second)) return res.status(400).json({ error: 'id must be a number' });
    await ensureSchema();
    const result = await pool.query('SELECT photo_data, photo_mime FROM items WHERE id = $1 AND photo_data IS NOT NULL', [second]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'No photo' });
    res.setHeader('Content-Type', result.rows[0].photo_mime);
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    return res.status(200).send(Buffer.from(result.rows[0].photo_data, 'base64'));
  }

  if (first === 'save' && req.method === 'POST') {
    if (!requireAuth(req, res)) return;
    await ensureSchema();
    const { id, category, name, menuPrice, originalCost, itemCode, description, published, photo } = req.body || {};
    if (!category || !name || menuPrice === undefined) {
      return res.status(400).json({ error: 'category, name, and menuPrice are required' });
    }
    const cost = originalCost === undefined || originalCost === null || originalCost === '' ? null : Number(originalCost);
    const code = typeof itemCode === 'string' && itemCode.trim() ? itemCode.trim().toUpperCase() : null;
    const desc = typeof description === 'string' && description.trim() ? description.trim() : null;
    const isPublished = published === undefined ? true : Boolean(published);

    // photo: undefined = leave as is, null = remove, data URL = replace.
    let photoMime = null;
    let photoData = null;
    if (typeof photo === 'string') {
      const match = PHOTO_PATTERN.exec(photo);
      if (!match || photo.length > MAX_PHOTO_CHARS) {
        return res.status(400).json({ error: 'Photo must be a JPEG, PNG or WebP under about 1 MB' });
      }
      [, photoMime, photoData] = match;
    }
    const touchPhoto = photo !== undefined;

    try {
      if (id) {
        const result = await pool.query(
          `UPDATE items SET category = $1, name = $2, menu_price = $3, original_cost = $4,
             item_code = $5, description = $6, published = $7,
             photo_data = CASE WHEN $8 THEN $9 ELSE photo_data END,
             photo_mime = CASE WHEN $8 THEN $10 ELSE photo_mime END,
             updated_at = NOW()
           WHERE id = $11 RETURNING id`,
          [category, name, Number(menuPrice), cost, code, desc, isPublished, touchPhoto, photoData, photoMime, id]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Item not found' });
        return res.status(200).json({ id });
      }
      const result = await pool.query(
        `INSERT INTO items (category, name, menu_price, original_cost, item_code, description, published, photo_data, photo_mime)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [category, name, Number(menuPrice), cost, code, desc, isPublished, photoData, photoMime]
      );
      return res.status(200).json({ id: result.rows[0].id });
    } catch (err) {
      if (err && err.code === '23505') {
        return res.status(409).json({ error: `Item ID ${code} is already used by another item` });
      }
      throw err;
    }
  }

  if (first === 'delete' && second && req.method === 'DELETE') {
    if (!requireAuth(req, res)) return;
    if (!/^\d+$/.test(second)) return res.status(400).json({ error: 'id must be a number' });
    await ensureSchema();
    await pool.query('DELETE FROM items WHERE id = $1', [second]);
    return res.status(200).json({ deleted: true });
  }

  return res.status(404).json({ error: 'Not found' });
};
