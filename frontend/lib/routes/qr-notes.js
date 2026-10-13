// QR love notes in the admin (QR Love Notes page). The public password page is in
// lib/routes/public.js (POST /api/public/open). The super admin sees every note; a Thai or Japan
// admin only sees and edits the notes of their own country.
const { requireAuth, scopeOf } = require('../auth');
const { pool, ensureSchema } = require('../db');

const OCCASIONS = ['birthday', 'anniversary', 'love', 'thank_you', 'apology', 'graduation', 'other'];
const PASSWORD_PATTERN = /^[a-z0-9._-]{6,40}$/;

const asDate = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

const cleanUrl = (v) => {
  try {
    const u = new URL(String(v || '').trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
};

const COLUMNS = `id, customer_name, occasion, password, destination_url, country, order_ref, note,
  available_from, available_until, opens, last_opened_at, created_by, created_at`;

module.exports = async (req, res, [first, second]) => {
  const session = await requireAuth(req, res);
  if (!session) return;
  await ensureSchema();
  const scope = scopeOf(session); // 'thailand' | 'japan' | null (super admin)

  if (!first && req.method === 'GET') {
    const result = await pool.query(
      `SELECT ${COLUMNS} FROM qr_notes WHERE ($1::text IS NULL OR country = $1) ORDER BY created_at DESC, id DESC LIMIT 2000`,
      [scope]
    );
    return res.status(200).json(result.rows);
  }

  if (first === 'save' && req.method === 'POST') {
    const body = req.body || {};
    const customerName = String(body.customerName || '').trim();
    const password = String(body.password || '').trim().toLowerCase();
    const destination = cleanUrl(body.destinationUrl);
    const from = asDate(body.availableFrom);
    const until = asDate(body.availableUntil);
    const occasion = OCCASIONS.includes(body.occasion) ? body.occasion : 'other';
    // A Thai or Japan admin's notes belong to their own country; the super admin picks.
    const country = scope || (body.country === 'thailand' || body.country === 'japan' ? body.country : null);

    if (!customerName || customerName.length > 80) return res.status(400).json({ error: 'Enter the customer name' });
    if (!PASSWORD_PATTERN.test(password)) {
      return res.status(400).json({ error: 'Password must be 6 to 40 letters or numbers (dots, dashes and underscores allowed, no spaces)' });
    }
    if (!destination) return res.status(400).json({ error: 'Enter the customer page address, starting with https://' });
    if (from === undefined || until === undefined) return res.status(400).json({ error: 'That date is not valid' });
    if (from && until && until <= from) return res.status(400).json({ error: 'The end must be after the start' });

    const values = [
      customerName, occasion, password, destination, country,
      String(body.orderRef || '').trim().slice(0, 60) || null,
      String(body.note || '').trim().slice(0, 500) || null,
      from, until,
    ];
    try {
      if (body.id) {
        const result = await pool.query(
          `UPDATE qr_notes SET customer_name = $1, occasion = $2, password = $3, destination_url = $4, country = $5,
             order_ref = $6, note = $7, available_from = $8, available_until = $9, updated_at = NOW()
           WHERE id = $10 AND ($11::text IS NULL OR country = $11) RETURNING id`,
          [...values, body.id, scope]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Note not found' });
        return res.status(200).json({ id: body.id });
      }
      const result = await pool.query(
        `INSERT INTO qr_notes (customer_name, occasion, password, destination_url, country, order_ref, note,
                               available_from, available_until, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [...values, session.role]
      );
      return res.status(200).json({ id: result.rows[0].id });
    } catch (err) {
      if (err && err.code === '23505') {
        return res.status(409).json({ error: 'Another note already uses that password. Choose a different one.' });
      }
      throw err;
    }
  }

  if (first === 'delete' && second && req.method === 'DELETE') {
    if (!/^\d+$/.test(second)) return res.status(400).json({ error: 'id must be a number' });
    const result = await pool.query('DELETE FROM qr_notes WHERE id = $1 AND ($2::text IS NULL OR country = $2)', [second, scope]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Note not found' });
    return res.status(200).json({ deleted: true });
  }

  return res.status(404).json({ error: 'Not found' });
};
