// Gift websites in the admin (Websites page). A website is a copy of a template with the customer's
// words, photos and dates filled in; the template itself is never touched. The public page lives at
// /api/public/site/:slug (see public.js), shown on the website as /g/:slug.
// Super admin sees every website; a Thai or Japan admin only sees their own country's.
const crypto = require('crypto');
const { requireAuth, scopeOf } = require('../auth');
const { pool, ensureSchema } = require('../db');
const { LANDING_URL, getManifest, getTemplateHtml } = require('../site-templates');
const engine = require('../site-engine');

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,40}$/;
const MAX_VALUES_BYTES = 300 * 1024;

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BUCKET = process.env.SUPABASE_TEMPLATE_BUCKET || 'template-videos';
const PUBLIC_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/`;
const UPLOAD_TYPES = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/wav': 'wav', 'audio/ogg': 'ogg',
};
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const COLUMNS = `id, slug, template, customer_name, order_id, order_no, country, published,
  available_from, available_until, note, views, last_viewed_at, created_by, created_at, updated_at`;

const slugBase = (name) =>
  String(name || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'gift';

async function freeSlug(name) {
  for (let i = 0; i < 8; i++) {
    const slug = `${slugBase(name)}-${crypto.randomBytes(2).toString('hex')}`;
    const taken = await pool.query('SELECT 1 FROM gift_sites WHERE slug = $1', [slug]);
    if (taken.rowCount === 0) return slug;
  }
  return `${slugBase(name)}-${crypto.randomBytes(4).toString('hex')}`;
}

const asDate = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

// Only plain text, numbers and booleans are accepted as field values.
function cleanValues(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) return {};
  const out = {};
  for (const [k, v] of Object.entries(values)) {
    if (k.length > 200) continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  }
  return out;
}

module.exports = async (req, res, [first, second]) => {
  const session = await requireAuth(req, res);
  if (!session) return;
  await ensureSchema();
  const scope = scopeOf(session); // 'thailand' | 'japan' | null (super admin)

  // The templates that can be copied, with how many websites each one has sold.
  if (first === 'templates' && req.method === 'GET') {
    let manifest;
    try {
      manifest = await getManifest();
    } catch (err) {
      console.error('Could not read the template list', err);
      return res.status(502).json({ error: 'Could not load the template list from the website.' });
    }
    const counts = await pool.query(
      `SELECT template, COUNT(*)::int AS sites,
              COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '30 days')::int AS recent,
              COALESCE(SUM(views), 0)::int AS views
       FROM gift_sites WHERE ($1::text IS NULL OR country = $1) GROUP BY template`,
      [scope]
    );
    const byFile = new Map(counts.rows.map((r) => [r.template, r]));
    return res.status(200).json(
      manifest.map((t) => {
        const c = byFile.get(t.file);
        return { ...t, sites: c ? c.sites : 0, recent: c ? c.recent : 0, views: c ? c.views : 0, previewUrl: `${LANDING_URL}/templates/${t.file}.html` };
      })
    );
  }

  // The editable fields of one template.
  if (first === 'fields' && req.method === 'GET') {
    const file = new URL(req.url, 'http://localhost').searchParams.get('template') || '';
    const html = await getTemplateHtml(file).catch(() => null);
    if (!html) return res.status(404).json({ error: 'Template not found' });
    const { fields, mode } = engine.extract(html);
    return res.status(200).json({ mode, fields });
  }

  // The finished page for the live preview, without saving anything.
  if (first === 'render' && req.method === 'POST') {
    const { template, values } = req.body || {};
    const html = await getTemplateHtml(String(template || '')).catch(() => null);
    if (!html) return res.status(404).json({ error: 'Template not found' });
    return res.status(200).json({ html: engine.render(html, cleanValues(values), { baseUrl: `${LANDING_URL}/` }) });
  }

  // A signed upload for a customer's photo or song, straight from the browser to Supabase Storage.
  if (first === 'upload-url' && req.method === 'POST') {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return res.status(503).json({ error: 'Uploads are not set up yet (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are missing in Vercel). You can paste an address instead.' });
    }
    const { fileName, contentType, size } = req.body || {};
    const ext = UPLOAD_TYPES[contentType];
    if (!ext) return res.status(400).json({ error: 'Use a JPG, PNG, WebP or GIF picture, or an MP3, M4A, WAV or OGG song' });
    if (!Number.isFinite(size) || size <= 0 || size > MAX_UPLOAD_BYTES) return res.status(400).json({ error: 'The file must be under 20 MB' });
    const base = String(fileName || 'file').replace(/\.[^.]*$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'file';
    const path = `sites/${new Date().toISOString().slice(0, 7)}/${Date.now()}-${crypto.randomBytes(3).toString('hex')}-${base}.${ext}`;
    const signed = await fetch(`${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${SUPABASE_KEY}`, apikey: SUPABASE_KEY },
    });
    if (!signed.ok) {
      console.error('Supabase signed upload failed', signed.status, await signed.text().catch(() => ''));
      return res.status(502).json({ error: `Could not start the upload. Check that the "${BUCKET}" storage bucket exists in Supabase.` });
    }
    const { url } = await signed.json();
    return res.status(200).json({ uploadUrl: `${SUPABASE_URL}/storage/v1${url}`, publicUrl: PUBLIC_PREFIX + path });
  }

  if (!first && req.method === 'GET') {
    const result = await pool.query(
      `SELECT ${COLUMNS} FROM gift_sites WHERE ($1::text IS NULL OR country = $1) ORDER BY created_at DESC, id DESC LIMIT 2000`,
      [scope]
    );
    return res.status(200).json(result.rows);
  }

  if (first === 'get' && second && req.method === 'GET') {
    if (!/^\d+$/.test(second)) return res.status(400).json({ error: 'id must be a number' });
    const result = await pool.query(
      `SELECT ${COLUMNS}, values_json FROM gift_sites WHERE id = $1 AND ($2::text IS NULL OR country = $2)`,
      [second, scope]
    );
    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: 'Website not found' });
    const { values_json, ...rest } = row;
    return res.status(200).json({ ...rest, values: JSON.parse(values_json) });
  }

  if (first === 'save' && req.method === 'POST') {
    const body = req.body || {};
    const customerName = String(body.customerName || '').trim();
    const from = asDate(body.availableFrom);
    const until = asDate(body.availableUntil);
    const values = cleanValues(body.values);
    const valuesJson = JSON.stringify(values);

    if (!customerName || customerName.length > 80) return res.status(400).json({ error: 'Enter the customer name' });
    if (from === undefined || until === undefined) return res.status(400).json({ error: 'That date is not valid' });
    if (from && until && until <= from) return res.status(400).json({ error: 'The end must be after the start' });
    if (Buffer.byteLength(valuesJson) > MAX_VALUES_BYTES) return res.status(400).json({ error: 'There is too much text in this website' });

    const manifest = await getManifest().catch(() => []);
    if (!manifest.some((t) => t.file === body.template)) return res.status(400).json({ error: 'Choose a template' });

    // Linking to an order: a Thai or Japan admin can only link their own country's orders.
    let order = null;
    if (body.orderId !== undefined && body.orderId !== null && body.orderId !== '') {
      const found = await pool.query(
        `SELECT id, order_no, lower(btrim(country)) AS country FROM orders WHERE id = $1 AND ($2::text IS NULL OR lower(btrim(country)) = $2)`,
        [Number(body.orderId), scope]
      );
      if (found.rowCount === 0) return res.status(404).json({ error: 'Order not found' });
      order = found.rows[0];
    }
    const country = scope || (order && (order.country === 'thailand' || order.country === 'japan') ? order.country
      : body.country === 'thailand' || body.country === 'japan' ? body.country : null);
    const published = Boolean(body.published);
    const note = String(body.note || '').trim().slice(0, 500) || null;

    if (body.id) {
      let slugSql = '';
      const params = [body.template, customerName, order ? order.id : null, order ? order.order_no : null, country, valuesJson, published, from, until, note, body.id, scope];
      if (body.slug) {
        const slug = String(body.slug).trim().toLowerCase();
        if (!SLUG_PATTERN.test(slug)) return res.status(400).json({ error: 'The address can only have letters, numbers and dashes (3 to 41 characters)' });
        params.push(slug);
        slugSql = ', slug = $13';
      }
      try {
        const result = await pool.query(
          `UPDATE gift_sites SET template = $1, customer_name = $2, order_id = $3, order_no = $4, country = $5, values_json = $6,
             published = $7, available_from = $8, available_until = $9, note = $10, updated_at = NOW()${slugSql}
           WHERE id = $11 AND ($12::text IS NULL OR country = $12) RETURNING id, slug`,
          params
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Website not found' });
        return res.status(200).json(result.rows[0]);
      } catch (err) {
        if (err && err.code === '23505') return res.status(409).json({ error: 'Another website already uses that address' });
        throw err;
      }
    }
    const slug = await freeSlug(customerName);
    const result = await pool.query(
      `INSERT INTO gift_sites (slug, template, customer_name, order_id, order_no, country, values_json, published, available_from, available_until, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id, slug`,
      [slug, body.template, customerName, order ? order.id : null, order ? order.order_no : null, country, valuesJson, published, from, until, note, session.role]
    );
    return res.status(200).json(result.rows[0]);
  }

  if (first === 'delete' && second && req.method === 'DELETE') {
    if (!/^\d+$/.test(second)) return res.status(400).json({ error: 'id must be a number' });
    const result = await pool.query('DELETE FROM gift_sites WHERE id = $1 AND ($2::text IS NULL OR country = $2)', [second, scope]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Website not found' });
    return res.status(200).json({ deleted: true });
  }

  return res.status(404).json({ error: 'Not found' });
};
