const { requireAuth, scopeOf } = require('../auth');
const { pool, ensureSchema } = require('../db');

// The list never carries photo_data: it can be hundreds of KB per row. The photo is fetched
// separately from /api/public/photo/:id, so `photo_version` is only there to bust the cache.
const LIST_COLUMNS = `id, category, name, menu_price, original_cost, item_code, description, item_group, published,
  (photo_data IS NOT NULL) AS has_photo, photo_name, EXTRACT(EPOCH FROM updated_at)::bigint AS photo_version`;

const COUNTRIES = ['thailand', 'japan'];

// Which catalog a request works on. A Japan or Thai admin is always held to their own country's
// catalog; the super admin picks one (default Thailand).
const countryFor = (session, requested) =>
  scopeOf(session) || (COUNTRIES.includes(requested) ? requested : 'thailand');
const countryParam = (req) => new URL(req.url, 'http://localhost').searchParams.get('country');
// null = no restriction (super admin acting on any item by id).
const fence = (session) => scopeOf(session);

// Photos arrive as data URLs already shrunk by the browser. Cap the size so a bad client
// can't fill the database.
const MAX_PHOTO_CHARS = 1_500_000;
const PHOTO_PATTERN = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

module.exports = async (req, res, [first, second]) => {
  if (!first && req.method === 'GET') {
    const session = await requireAuth(req, res);
    if (!session) return;
    await ensureSchema();
    const result = await pool.query(
      `SELECT ${LIST_COLUMNS} FROM items WHERE country = $1 ORDER BY category, item_code NULLS LAST, name`,
      [countryFor(session, countryParam(req))]
    );
    return res.status(200).json(result.rows);
  }

  // Admin-side photo (works for unpublished items too, unlike /api/public/photo).
  if (first === 'photo' && second && req.method === 'GET') {
    const session = await requireAuth(req, res);
    if (!session) return;
    if (!/^\d+$/.test(second)) return res.status(400).json({ error: 'id must be a number' });
    await ensureSchema();
    const result = await pool.query(
      'SELECT photo_data, photo_mime FROM items WHERE id = $1 AND photo_data IS NOT NULL AND ($2::text IS NULL OR country = $2)',
      [second, fence(session)]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'No photo' });
    res.setHeader('Content-Type', result.rows[0].photo_mime);
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    return res.status(200).send(Buffer.from(result.rows[0].photo_data, 'base64'));
  }

  // Bulk import from the Excel template. All or nothing: any bad row rejects the whole file, and
  // Item IDs are handed out per type in row order (CK01, CK02, ...), continuing after the highest
  // number already used.
  if (first === 'import' && req.method === 'POST') {
    const session = await requireAuth(req, res);
    if (!session) return;
    await ensureSchema();
    const country = countryFor(session, (req.body || {}).country);
    const rows = (req.body || {}).rows;
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'No rows to import' });
    if (rows.length > 500) return res.status(400).json({ error: 'Import up to 500 items at a time' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('items-import'))");
      const types = (await client.query('SELECT name, code FROM item_types')).rows;
      const typeByName = new Map(types.map((t) => [t.name.trim().toLowerCase(), t]));
      const used = (await client.query('SELECT item_code FROM items WHERE item_code IS NOT NULL AND country = $1', [country])).rows.map((r) => r.item_code);
      const nextByCode = new Map();
      const nextFor = (code) => {
        if (!nextByCode.has(code)) {
          const pattern = new RegExp(`^${code}(\\d+)$`);
          let max = 0;
          for (const u of used) {
            const m = pattern.exec(u);
            if (m) max = Math.max(max, Number(m[1]));
          }
          nextByCode.set(code, max);
        }
        nextByCode.set(code, nextByCode.get(code) + 1);
        return `${code}${String(nextByCode.get(code)).padStart(2, '0')}`;
      };

      const errors = [];
      const clean = [];
      rows.forEach((r, index) => {
        const rowNo = index + 1;
        const type = typeByName.get(String(r.type || '').trim().toLowerCase());
        const name = String(r.name || '').trim();
        const price = Number(r.price);
        const cost = r.cost === null || r.cost === undefined || r.cost === '' ? null : Number(r.cost);
        if (!type) errors.push({ row: rowNo, error: `Unknown item type "${r.type ?? ''}"` });
        else if (!name) errors.push({ row: rowNo, error: 'Item name is missing' });
        else if (!Number.isFinite(price) || price < 0) errors.push({ row: rowNo, error: 'Selling price is missing or not a number' });
        else if (cost !== null && (!Number.isFinite(cost) || cost < 0)) errors.push({ row: rowNo, error: 'Cost is not a number' });
        else clean.push({ type, name, price, cost, row: r });
      });
      if (errors.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Some rows need fixing. Nothing was imported.', errors });
      }

      const created = [];
      for (const c of clean) {
        const code = nextFor(c.type.code);
        const group = String(c.row.group || '').trim() || null;
        const detail = String(c.row.detail || '').trim() || null;
        const photoName = String(c.row.photoName || '').trim() || null;
        const published = c.row.show === false || /^no$/i.test(String(c.row.show || '').trim()) ? false : true;
        await client.query(
          `INSERT INTO items (category, name, menu_price, original_cost, item_code, description, item_group, published, photo_name, country)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [c.type.name, c.name, c.price, c.cost, code, detail, group, published, photoName, country]
        );
        created.push(code);
      }
      await client.query('COMMIT');
      return res.status(200).json({ created: created.length, first: created[0], last: created[created.length - 1] });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  if (first === 'save' && req.method === 'POST') {
    const session = await requireAuth(req, res);
    if (!session) return;
    await ensureSchema();
    const { id, category, name, menuPrice, originalCost, itemCode, description, itemGroup, published, photo } = req.body || {};
    const country = countryFor(session, (req.body || {}).country);
    if (!category || !name || menuPrice === undefined) {
      return res.status(400).json({ error: 'category, name, and menuPrice are required' });
    }
    const cost = originalCost === undefined || originalCost === null || originalCost === '' ? null : Number(originalCost);
    const code = typeof itemCode === 'string' && itemCode.trim() ? itemCode.trim().toUpperCase() : null;
    const desc = typeof description === 'string' && description.trim() ? description.trim() : null;
    const group = typeof itemGroup === 'string' && itemGroup.trim() ? itemGroup.trim() : null;
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
             item_code = $5, description = $6, published = $7, item_group = $8,
             photo_data = CASE WHEN $9 THEN $10 ELSE photo_data END,
             photo_mime = CASE WHEN $9 THEN $11 ELSE photo_mime END,
             updated_at = NOW()
           WHERE id = $12 AND ($13::text IS NULL OR country = $13) RETURNING id`,
          [category, name, Number(menuPrice), cost, code, desc, isPublished, group, touchPhoto, photoData, photoMime, id, fence(session)]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Item not found' });
        return res.status(200).json({ id });
      }
      const result = await pool.query(
        `INSERT INTO items (category, name, menu_price, original_cost, item_code, description, published, item_group, photo_data, photo_mime, country)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [category, name, Number(menuPrice), cost, code, desc, isPublished, group, photoData, photoMime, country]
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
    const session = await requireAuth(req, res);
    if (!session) return;
    if (!/^\d+$/.test(second)) return res.status(400).json({ error: 'id must be a number' });
    await ensureSchema();
    await pool.query('DELETE FROM items WHERE id = $1 AND ($2::text IS NULL OR country = $2)', [second, fence(session)]);
    return res.status(200).json({ deleted: true });
  }

  return res.status(404).json({ error: 'Not found' });
};
