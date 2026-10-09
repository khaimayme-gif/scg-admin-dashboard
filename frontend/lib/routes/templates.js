// Template Library: the digital gift templates shown on the landing page's templates.html.
// Super admin only. The landing page reads published templates from /api/public/templates.
//
//   GET    /api/templates                 -> all templates, in display order
//   POST   /api/templates/save            -> insert, or update when `id` is present
//   DELETE /api/templates/delete/:id
//   POST   /api/templates/reorder         -> { ids: [3, 1, 2, ...] } sets the display order
//   POST   /api/templates/upload-url      -> signed Supabase Storage upload for a preview video
//   POST   /api/templates/import          -> fills an EMPTY library from lib/template-seed.js
//
// Videos are too big for this function (Vercel caps request bodies at ~4.5 MB), so the browser
// uploads them straight to Supabase Storage with a signed URL from /upload-url, then saves the
// template with the resulting public URL.
const { requireSuper } = require('../auth');
const { pool, ensureSchema } = require('../db');
const SEED = require('../template-seed');

const CATEGORIES = ['love', 'birthday', 'family', 'friendship', 'celebration', 'appreciation'];
const VIDEO_TYPES = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // Supabase's per-file limit on the free plan

const COLUMNS = `id, name, occasion, categories, price, description, video_url, published, sort_order`;

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BUCKET = process.env.SUPABASE_TEMPLATE_BUCKET || 'template-videos';
const PUBLIC_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`;

const storage = (path, init = {}) =>
  fetch(`${SUPABASE_URL}/storage/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY, ...(init.headers || {}) },
  });

// Removes a video we uploaded earlier. Best effort: a leftover file only costs storage, so a
// failure here never blocks saving or deleting the template.
async function removeStoredVideo(url) {
  if (!SUPABASE_URL || !SUPABASE_KEY || typeof url !== 'string' || !url.startsWith(PUBLIC_PREFIX)) return;
  try {
    await storage(`/object/${BUCKET}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: [decodeURIComponent(url.slice(PUBLIC_PREFIX.length))] }),
    });
  } catch (err) {
    console.error('Could not remove old template video', url, err);
  }
}

function clean(body) {
  const { name, occasion, categories, price, description, videoUrl, published } = body || {};
  const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  if (!text(name)) return { error: 'Give the template a name' };
  const cats = Array.isArray(categories) ? [...new Set(categories.filter((c) => CATEGORIES.includes(c)))] : [];
  let priceValue = null;
  if (price !== undefined && price !== null && price !== '') {
    priceValue = Number(price);
    if (!Number.isInteger(priceValue) || priceValue < 0) return { error: 'Price must be a whole number of baht' };
  }
  const video = text(videoUrl);
  if (video && !/^https:\/\/\S+$/.test(video)) return { error: 'The video link must start with https://' };
  return {
    values: [text(name), text(occasion), cats, priceValue, text(description), video, published === undefined ? true : Boolean(published)],
  };
}

module.exports = async (req, res, [first, second]) => {
  if (!first && req.method === 'GET') {
    if (!requireSuper(req, res)) return;
    await ensureSchema();
    const result = await pool.query(`SELECT ${COLUMNS} FROM templates ORDER BY sort_order, id`);
    return res.status(200).json(result.rows);
  }

  if (first === 'save' && req.method === 'POST') {
    if (!requireSuper(req, res)) return;
    await ensureSchema();
    const { id } = req.body || {};
    const { error, values } = clean(req.body);
    if (error) return res.status(400).json({ error });

    if (id) {
      if (!/^\d+$/.test(String(id))) return res.status(400).json({ error: 'id must be a number' });
      const before = await pool.query('SELECT video_url FROM templates WHERE id = $1', [id]);
      if (before.rowCount === 0) return res.status(404).json({ error: 'Template not found' });
      await pool.query(
        `UPDATE templates SET name = $1, occasion = $2, categories = $3, price = $4, description = $5,
           video_url = $6, published = $7, updated_at = NOW()
         WHERE id = $8`,
        [...values, id]
      );
      if (before.rows[0].video_url !== values[5]) await removeStoredVideo(before.rows[0].video_url);
      return res.status(200).json({ id: Number(id) });
    }
    // New templates go to the end of the list.
    const result = await pool.query(
      `INSERT INTO templates (name, occasion, categories, price, description, video_url, published, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM templates))
       RETURNING id`,
      values
    );
    return res.status(200).json({ id: result.rows[0].id });
  }

  if (first === 'delete' && second && req.method === 'DELETE') {
    if (!requireSuper(req, res)) return;
    if (!/^\d+$/.test(second)) return res.status(400).json({ error: 'id must be a number' });
    await ensureSchema();
    const result = await pool.query('DELETE FROM templates WHERE id = $1 RETURNING video_url', [second]);
    if (result.rowCount) await removeStoredVideo(result.rows[0].video_url);
    return res.status(200).json({ deleted: true });
  }

  if (first === 'reorder' && req.method === 'POST') {
    if (!requireSuper(req, res)) return;
    const ids = (req.body || {}).ids;
    if (!Array.isArray(ids) || !ids.every((n) => Number.isInteger(n))) {
      return res.status(400).json({ error: 'ids must be a list of template ids' });
    }
    await ensureSchema();
    // One statement: each id gets its position in the list.
    await pool.query(
      `UPDATE templates t SET sort_order = o.pos
       FROM unnest($1::int[]) WITH ORDINALITY AS o(id, pos)
       WHERE t.id = o.id`,
      [ids]
    );
    return res.status(200).json({ ok: true });
  }

  if (first === 'upload-url' && req.method === 'POST') {
    if (!requireSuper(req, res)) return;
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return res.status(503).json({ error: 'Video uploads are not set up yet: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are missing in Vercel' });
    }
    const { fileName, contentType, size } = req.body || {};
    const ext = VIDEO_TYPES[contentType];
    if (!ext) return res.status(400).json({ error: 'The video must be an MP4, WebM or MOV file' });
    if (!Number.isFinite(size) || size <= 0 || size > MAX_VIDEO_BYTES) {
      return res.status(400).json({ error: 'The video must be under 50 MB' });
    }
    const base = String(fileName || 'video').replace(/\.[^.]*$/, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'video';
    const path = `${Date.now()}-${base}.${ext}`;
    const signed = await storage(`/object/upload/sign/${BUCKET}/${path}`, { method: 'POST' });
    if (!signed.ok) {
      console.error('Supabase signed upload failed', signed.status, await signed.text().catch(() => ''));
      return res.status(502).json({ error: `Could not start the upload. Check that the "${BUCKET}" storage bucket exists in Supabase.` });
    }
    const { url } = await signed.json();
    return res.status(200).json({ uploadUrl: `${SUPABASE_URL}/storage/v1${url}`, publicUrl: PUBLIC_PREFIX + path });
  }

  if (first === 'import' && req.method === 'POST') {
    if (!requireSuper(req, res)) return;
    await ensureSchema();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Lock so two clicks can't both import into an empty table.
      await client.query('LOCK TABLE templates IN EXCLUSIVE MODE');
      const existing = await client.query('SELECT 1 FROM templates LIMIT 1');
      if (existing.rowCount) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'The library already has templates, so nothing was imported' });
      }
      for (const [i, t] of SEED.entries()) {
        await client.query(
          `INSERT INTO templates (name, occasion, categories, price, description, video_url, published, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7)`,
          [t.name, t.occasion, t.categories, t.price, t.description, t.videoUrl, i + 1]
        );
      }
      await client.query('COMMIT');
      return res.status(200).json({ imported: SEED.length });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  return res.status(404).json({ error: 'Not found' });
};
