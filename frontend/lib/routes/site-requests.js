// Website requests in the admin (Digital Gifts → Website Requests). The admin makes a private link for
// an order and sends it to the customer; the customer's answers (lib/routes/public.js, /request/...)
// land here, and "Make website" turns them into a draft gift website. The super admin sees every
// request; a Thai or Japan admin only their own country's.
const crypto = require('crypto');
const { requireAuth, scopeOf } = require('../auth');
const { pool, ensureSchema } = require('../db');
const { getTemplateHtml } = require('../site-templates');
const { TEMPLATE, buildSiteValues } = require('../site-request');

const COLUMNS = `id, token, order_id, order_no, customer_name, country, status, answers_json, uploads,
  site_id, created_by, created_at, submitted_at`;

const parse = (row) => ({ ...row, answers: row.answers_json ? JSON.parse(row.answers_json) : null, answers_json: undefined });

const slugBase = (name) =>
  String(name || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'gift';

async function freeSlug(name) {
  for (let i = 0; i < 8; i++) {
    const slug = `${slugBase(name)}-${crypto.randomBytes(2).toString('hex')}`;
    if ((await pool.query('SELECT 1 FROM gift_sites WHERE slug = $1', [slug])).rowCount === 0) return slug;
  }
  return `${slugBase(name)}-${crypto.randomBytes(4).toString('hex')}`;
}

module.exports = async (req, res, [first, second]) => {
  const session = await requireAuth(req, res);
  if (!session) return;
  await ensureSchema();
  const scope = scopeOf(session); // 'thailand' | 'japan' | null (super admin)

  if (!first && req.method === 'GET') {
    const result = await pool.query(
      `SELECT ${COLUMNS} FROM site_requests WHERE ($1::text IS NULL OR country = $1) ORDER BY created_at DESC, id DESC LIMIT 1000`,
      [scope]
    );
    return res.status(200).json(result.rows.map(parse));
  }

  // A new private link, for an order (or just a name).
  if (first === 'create' && req.method === 'POST') {
    const body = req.body || {};
    let order = null;
    if (body.orderId !== undefined && body.orderId !== null && body.orderId !== '') {
      const found = await pool.query(
        `SELECT id, order_no, customer_name, lower(btrim(country)) AS country FROM orders
         WHERE id = $1 AND ($2::text IS NULL OR lower(btrim(country)) = $2)`,
        [Number(body.orderId), scope]
      );
      if (found.rowCount === 0) return res.status(404).json({ error: 'Order not found' });
      order = found.rows[0];
    }
    const customerName = String(body.customerName || (order && order.customer_name) || '').trim().slice(0, 80);
    if (!customerName) return res.status(400).json({ error: 'Enter the customer name' });
    const country = scope || (order && (order.country === 'thailand' || order.country === 'japan') ? order.country
      : body.country === 'thailand' || body.country === 'japan' ? body.country : null);
    const token = crypto.randomBytes(18).toString('base64url');
    const result = await pool.query(
      `INSERT INTO site_requests (token, order_id, order_no, customer_name, country, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNS}`,
      [token, order ? order.id : null, order ? order.order_no : null, customerName, country, session.role]
    );
    return res.status(200).json(parse(result.rows[0]));
  }

  // Turns a received request into a draft website (not published, so nothing goes live by itself).
  if (first === 'make-site' && req.method === 'POST') {
    const { id } = req.body || {};
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id must be a number' });
    const found = await pool.query(`SELECT ${COLUMNS} FROM site_requests WHERE id = $1 AND ($2::text IS NULL OR country = $2)`, [id, scope]);
    if (found.rowCount === 0) return res.status(404).json({ error: 'Request not found' });
    const request = parse(found.rows[0]);
    if (request.site_id) return res.status(200).json({ siteId: request.site_id, existing: true });
    if (!request.answers) return res.status(400).json({ error: 'The customer has not sent their answers yet' });

    const html = await getTemplateHtml(TEMPLATE).catch(() => null);
    if (!html) return res.status(502).json({ error: 'The "Especially For Him" template is not on the website yet.' });
    const { fields } = require('../site-engine').extract(html);
    const a = request.answers;
    const values = buildSiteValues(a, fields);

    const from = new Date(`${a.eventDate}T00:00:00+07:00`);
    const note = [`Request from ${request.customer_name}`, a.contact ? `Contact: ${a.contact}` : '', a.password ? `QR password they chose: ${a.password}` : 'No QR password chosen',
      a.writeForMe ? 'Asked us to write the love message' : ''].filter(Boolean).join('\n');
    const slug = await freeSlug(a.receiverName);
    const site = await pool.query(
      `INSERT INTO gift_sites (slug, template, customer_name, order_id, order_no, country, values_json, published, available_from, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, $8, $9, $10) RETURNING id, slug`,
      [slug, TEMPLATE, a.senderName, request.order_id, request.order_no, request.country, JSON.stringify(values),
        Number.isNaN(from.getTime()) ? null : from, note, session.role]
    );
    await pool.query("UPDATE site_requests SET site_id = $1, status = 'site_made' WHERE id = $2", [site.rows[0].id, id]);
    return res.status(200).json({ siteId: site.rows[0].id, slug: site.rows[0].slug });
  }

  if (first === 'delete' && second && req.method === 'DELETE') {
    if (!/^\d+$/.test(second)) return res.status(400).json({ error: 'id must be a number' });
    const result = await pool.query('DELETE FROM site_requests WHERE id = $1 AND ($2::text IS NULL OR country = $2)', [second, scope]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Request not found' });
    return res.status(200).json({ deleted: true });
  }

  return res.status(404).json({ error: 'Not found' });
};
