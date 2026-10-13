const { requireAuth, requireSuper, scopeOf } = require('../auth');
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

  // The Thailand menu book (lib/menu-book-seed.js). GET says whether it has been imported;
  // POST replaces the whole Thailand catalog with it (the super admin confirms first in the UI).
  if (first === 'menu-book' && req.method === 'GET') {
    if (!await requireSuper(req, res)) return;
    await ensureSchema();
    const [flag, count] = await Promise.all([
      pool.query("SELECT 1 FROM schema_flags WHERE name = 'menu_book_thailand_imported'"),
      pool.query("SELECT COUNT(*)::int AS n FROM items WHERE country = 'thailand'"),
    ]);
    const seed = require('../menu-book-seed');
    return res.status(200).json({ imported: flag.rowCount > 0, thailandItems: count.rows[0].n, bookItems: seed.items.length });
  }

  if (first === 'menu-book' && req.method === 'POST') {
    if (!await requireSuper(req, res)) return;
    await ensureSchema();
    const seed = require('../menu-book-seed'); // big (photos), so only loaded here
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Item types: reuse a type with the same code (keeping its name, which other catalogs may
      // use), else create it; then number them in the book's order.
      const typeName = {};
      for (const [i, t] of seed.types.entries()) {
        let row = await client.query('SELECT name FROM item_types WHERE code = $1', [t.code]);
        if (!row.rowCount) {
          await client.query('INSERT INTO item_types (name, code) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING', [t.name, t.code]);
          row = await client.query('SELECT name FROM item_types WHERE code = $1 OR name = $2 ORDER BY (code = $1) DESC LIMIT 1', [t.code, t.name]);
        }
        typeName[t.code] = row.rows[0].name;
        await client.query('UPDATE item_types SET sort_order = $1 WHERE name = $2', [i + 1, typeName[t.code]]);
      }
      const removed = await client.query("DELETE FROM items WHERE country = 'thailand'");
      // One INSERT for every item: a round trip per item adds up when the database is far away.
      const cols = { category: [], name: [], price: [], code: [], desc: [], group: [], data: [], mime: [] };
      for (const it of seed.items) {
        const m = it.photo && /^data:(image\/jpeg);base64,(.+)$/.exec(it.photo);
        cols.category.push(typeName[it.type]); cols.name.push(it.name); cols.price.push(it.price);
        cols.code.push(it.code); cols.desc.push(it.description); cols.group.push(it.group);
        cols.data.push(m ? m[2] : null); cols.mime.push(m ? m[1] : null);
      }
      await client.query(
        `INSERT INTO items (category, name, menu_price, item_code, description, item_group, photo_data, photo_mime, published, country)
         SELECT c, n, p, code, d, g, pd, pm, TRUE, 'thailand'
         FROM unnest($1::text[], $2::text[], $3::real[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[])
           AS x(c, n, p, code, d, g, pd, pm)`,
        [cols.category, cols.name, cols.price, cols.code, cols.desc, cols.group, cols.data, cols.mime]
      );
      await client.query("INSERT INTO schema_flags (name) VALUES ('menu_book_thailand_imported') ON CONFLICT DO NOTHING");
      await client.query('COMMIT');
      return res.status(200).json({ removed: removed.rowCount, imported: seed.items.length });
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
    if (!category || !name) {
      return res.status(400).json({ error: 'category and name are required' });
    }
    // No price is allowed: e.g. a design that is priced by the size you choose.
    const price = menuPrice === undefined || menuPrice === null || menuPrice === '' ? null : Number(menuPrice);
    if (price !== null && (!Number.isFinite(price) || price < 0)) {
      return res.status(400).json({ error: 'Selling price must be a number' });
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
          [category, name, price, cost, code, desc, isPublished, group, touchPhoto, photoData, photoMime, id, fence(session)]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Item not found' });
        return res.status(200).json({ id });
      }
      const result = await pool.query(
        `INSERT INTO items (category, name, menu_price, original_cost, item_code, description, published, item_group, photo_data, photo_mime, country)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [category, name, price, cost, code, desc, isPublished, group, photoData, photoMime, country]
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
