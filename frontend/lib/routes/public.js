// Read-only endpoints for the So Chic Gifts landing page. No login: everything here is meant
// to be public, so it only ever returns published items and never exposes cost or profit.
//
//   GET /api/public/menu        -> { categories: [{ category, items: [...] }] }
//   GET /api/public/photo/:id   -> the item's image
//   GET /api/public/templates   -> { templates: [...] } published digital gift templates, in order
const crypto = require('crypto');
const { pool, ensureSchema } = require('../db');
const { LANDING_URL, getTemplateHtml } = require('../site-templates');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  // The password page on the website posts JSON from another address, which makes the browser ask first.
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// The page shown instead of a gift when it is missing, not open yet, over, or can't be loaded.
function statusPage(kind, date) {
  const day = date ? new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const text = {
    missing: ['ဤစာမျက်နှာကို ရှာမတွေ့ပါ။', 'We could not find this gift page.'],
    soon: [`ဤစာမျက်နှာကို ${day} မှ စ၍ ဖွင့်နိုင်ပါမည်။`, `This gift opens on ${day}.`],
    ended: ['ဤစာမျက်နှာ၏ သက်တမ်း ကုန်ဆုံးသွားပါပြီ။', 'This gift page is no longer available.'],
    error: ['ယခု ဖွင့်၍ မရပါ။ ခဏနေမှ ပြန်ကြိုးစားပါ။', 'We could not open this page just now. Please try again in a moment.'],
  }[kind];
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>So Chic Gifts</title>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Myanmar:wght@400;600&family=Inter:wght@400;600&display=swap" rel="stylesheet">
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:radial-gradient(700px 420px at 50% 0%,#FFEEF3,#fff 70%);font-family:'Noto Sans Myanmar','Inter',sans-serif;color:#161616;text-align:center}
.c{max-width:380px;background:#fff;border:1px solid #F0E6E9;border-radius:22px;padding:34px 26px}img{width:76px;height:76px;border-radius:50%;margin-bottom:14px}
p{margin:0 0 6px;line-height:1.9;font-size:15px}.en{font-family:'Inter',sans-serif;color:#8F7880;font-size:14px}.f{margin-top:18px;font-family:'Inter',sans-serif;font-size:12px;color:#9A9A95}</style></head>
<body><div class="c"><img src="${LANDING_URL}/images/main/main-logo.png" alt="So Chic Gifts"><p>${text[0]}</p><p class="en">${text[1]}</p><div class="f">made with love by sochicgifts</div></div></body></html>`;
}

module.exports = async (req, res, [first, second, third]) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  // The password page behind the QR on a printed card. POST /api/public/open { password }
  //   200 { url }                      the password is right and the page is available: go there
  //   404 { error: 'wrong' }           no note has that password
  //   403 { error: 'not_yet', from }   it exists but is not available yet
  //   403 { error: 'ended', until }    it was available but the end date has passed
  //   429 { error: 'locked' }          too many wrong tries from this device for now
  if (first === 'open' && req.method === 'POST') {
    const password = String((req.body || {}).password || '').trim().toLowerCase().slice(0, 100);
    if (!password) return res.status(400).json({ error: 'wrong' });

    await ensureSchema();
    const forwarded = req.headers['x-forwarded-for'];
    const ip = (typeof forwarded === 'string' && forwarded.split(',')[0].trim()) || (req.socket && req.socket.remoteAddress) || 'unknown';
    const ipHash = crypto.createHash('sha256').update(`${process.env.SESSION_SECRET || ''}|${ip}`).digest('hex');

    // After 8 wrong passwords in 15 minutes a device has to wait, so passwords can't be guessed in bulk.
    const since = new Date(Date.now() - 15 * 60 * 1000);
    const failures = await pool.query(
      'SELECT COUNT(*)::int AS n FROM qr_note_attempts WHERE ip_hash = $1 AND attempted_at > $2',
      [ipHash, since]
    );
    if (failures.rows[0].n >= 8) return res.status(429).json({ error: 'locked' });

    const found = await pool.query(
      'SELECT id, destination_url, available_from, available_until FROM qr_notes WHERE password = $1',
      [password]
    );
    const note = found.rows[0];
    if (!note) {
      await pool.query('INSERT INTO qr_note_attempts (ip_hash) VALUES ($1)', [ipHash]);
      await pool.query('DELETE FROM qr_note_attempts WHERE attempted_at < $1', [since]);
      return res.status(404).json({ error: 'wrong' });
    }
    const now = Date.now();
    if (note.available_from && new Date(note.available_from).getTime() > now) {
      return res.status(403).json({ error: 'not_yet', from: note.available_from });
    }
    if (note.available_until && new Date(note.available_until).getTime() < now) {
      return res.status(403).json({ error: 'ended', until: note.available_until });
    }
    await pool.query('UPDATE qr_notes SET opens = opens + 1, last_opened_at = NOW() WHERE id = $1', [note.id]);
    return res.status(200).json({ url: note.destination_url });
  }

  // A customer sending the survey (no login). POST /api/public/survey
  //   { name, delivery: perfect|minor|problem, rating: 1-5, feedback?, country?: thailand|japan }
  if (first === 'survey' && req.method === 'POST') {
    const body = req.body || {};
    // Hidden field only bots fill in: pretend it worked and save nothing.
    if (body.website) return res.status(200).json({ ok: true });

    const name = String(body.name || '').trim();
    const feedback = String(body.feedback || '').trim();
    const rating = Number(body.rating);
    if (!name || name.length > 80) return res.status(400).json({ error: 'name' });
    if (!['perfect', 'minor', 'problem'].includes(body.delivery)) return res.status(400).json({ error: 'delivery' });
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return res.status(400).json({ error: 'rating' });
    if (feedback.length > 1000) return res.status(400).json({ error: 'feedback' });
    const country = body.country === 'thailand' || body.country === 'japan' ? body.country : null;

    await ensureSchema();
    // At most 5 answers per device (by hashed IP) per hour, so the form can't be used to flood the inbox.
    const forwarded = req.headers['x-forwarded-for'];
    const ip = (typeof forwarded === 'string' && forwarded.split(',')[0].trim()) || (req.socket && req.socket.remoteAddress) || 'unknown';
    const ipHash = crypto.createHash('sha256').update(`${process.env.SESSION_SECRET || ''}|${ip}`).digest('hex');
    const recent = await pool.query(
      'SELECT COUNT(*)::int AS n FROM survey_responses WHERE ip_hash = $1 AND created_at > $2',
      [ipHash, new Date(Date.now() - 60 * 60 * 1000)]
    );
    if (recent.rows[0].n >= 5) return res.status(429).json({ error: 'too_many' });

    await pool.query(
      'INSERT INTO survey_responses (name, country, delivery, rating, feedback, ip_hash) VALUES ($1, $2, $3, $4, $5, $6)',
      [name, country, body.delivery, rating, feedback || null, ipHash]
    );
    return res.status(200).json({ ok: true });
  }

  // The gift-website request form (public, one private link per order: /request/<token> in the admin app).
  //   GET  /api/public/request/:token             -> { status: waiting | submitted | closed }
  //   POST /api/public/request/:token/upload-url  -> a signed upload for one photo { uploadUrl, publicUrl }
  //   POST /api/public/request/:token             -> saves the customer's answers
  // The token is the only key, so a wrong one answers 404 and the number of uploads and answers per
  // link is capped.
  if (first === 'request' && second) {
    const token = String(second);
    if (!/^[A-Za-z0-9_-]{10,60}$/.test(token)) return res.status(404).json({ error: 'not_found' });
    await ensureSchema();
    const found = await pool.query('SELECT id, status, submissions FROM site_requests WHERE token = $1', [token]);
    const row = found.rows[0];
    if (!row) return res.status(404).json({ error: 'not_found' });

    if (req.method === 'GET' && !third) {
      return res.status(200).json({ status: row.status === 'site_made' ? 'closed' : row.status });
    }
    if (req.method === 'POST' && row.status === 'site_made') return res.status(409).json({ error: 'closed' });

    if (req.method === 'POST' && third === 'upload-url') {
      const { SUPABASE_URL, BUCKET, signUpload } = require('../storage');
      if (!SUPABASE_URL) return res.status(503).json({ error: 'uploads_unavailable' });
      const { fileName, contentType, size } = req.body || {};
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) return res.status(400).json({ error: 'type' });
      if (!Number.isFinite(size) || size <= 0 || size > 12 * 1024 * 1024) return res.status(400).json({ error: 'size' });
      // 20 photos per link is plenty for 3 memories, 2 letter photos and a couple of retries.
      const slot = await pool.query('UPDATE site_requests SET uploads = uploads + 1 WHERE id = $1 AND uploads < 20 RETURNING uploads', [row.id]);
      if (slot.rowCount === 0) return res.status(429).json({ error: 'too_many' });
      const signed = await signUpload(`requests/${token.slice(0, 12)}`, fileName, contentType);
      if (!signed) return res.status(502).json({ error: 'upload_failed' });
      return res.status(200).json(signed);
    }

    if (req.method === 'POST' && !third) {
      const body = req.body || {};
      if (body.website) return res.status(200).json({ ok: true }); // hidden field only bots fill in
      if (row.submissions >= 30) return res.status(429).json({ error: 'too_many' });
      const { cleanAnswers } = require('../site-request');
      const checked = cleanAnswers(body);
      if (checked.error) return res.status(400).json({ error: checked.error });
      await pool.query(
        `UPDATE site_requests SET answers_json = $1, status = 'submitted', submitted_at = NOW(), submissions = submissions + 1 WHERE id = $2`,
        [JSON.stringify(checked.answers), row.id]
      );
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // A customer's gift website: GET /api/public/site/:slug (shown on the website as /g/:slug).
  // Only published sites inside their available dates are shown; otherwise a friendly page.
  if (first === 'site' && second) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    const slug = String(second).toLowerCase();
    await ensureSchema();
    const found = /^[a-z0-9][a-z0-9-]{1,60}$/.test(slug)
      ? await pool.query('SELECT id, template, values_json, published, available_from, available_until FROM gift_sites WHERE slug = $1', [slug])
      : { rows: [] };
    const site = found.rows[0];
    if (!site || !site.published) return res.status(404).send(statusPage('missing'));
    const now = Date.now();
    if (site.available_from && new Date(site.available_from).getTime() > now) return res.status(200).send(statusPage('soon', site.available_from));
    if (site.available_until && new Date(site.available_until).getTime() < now) return res.status(200).send(statusPage('ended'));

    let html;
    try {
      html = await getTemplateHtml(site.template);
    } catch (err) {
      console.error('Could not load a template for a gift website', site.template, err);
    }
    if (!html) return res.status(502).send(statusPage('error'));
    await pool.query('UPDATE gift_sites SET views = views + 1, last_viewed_at = NOW() WHERE id = $1', [site.id]);
    return res.status(200).send(require('../site-engine').render(html, JSON.parse(site.values_json), { baseUrl: `${LANDING_URL}/` }));
  }

  if (first === 'menu') {
    await ensureSchema();
    // ?country=japan for the Japan menu; Thailand is the default.
    const country = new URL(req.url, 'http://localhost').searchParams.get('country') === 'japan' ? 'japan' : 'thailand';
    const result = await pool.query(
      // Categories in their item type's display order (unordered types last, by name).
      `SELECT i.id, i.category, i.item_code, i.name, i.description, i.item_group, i.menu_price,
         (i.photo_data IS NOT NULL) AS has_photo, EXTRACT(EPOCH FROM i.updated_at)::bigint AS v
       FROM items i LEFT JOIN item_types t ON t.name = i.category
       WHERE i.published AND i.country = $1
       ORDER BY t.sort_order NULLS LAST, i.category, i.item_code NULLS LAST, i.name`,
      [country]
    );
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const origin = `${proto}://${req.headers.host}`;
    const byCategory = new Map();
    for (const row of result.rows) {
      if (!byCategory.has(row.category)) byCategory.set(row.category, []);
      byCategory.get(row.category).push({
        item_id: row.item_code,
        name: row.name,
        description: row.description,
        group: row.item_group,
        price: row.menu_price,
        photo_url: row.has_photo ? `${origin}/api/public/photo/${row.id}?v=${row.v}` : null,
      });
    }
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({
      country,
      currency: country === 'japan' ? 'JPY' : 'THB',
      categories: [...byCategory].map(([category, items]) => ({ category, items })),
    });
  }

  if (first === 'templates') {
    await ensureSchema();
    const result = await pool.query(
      `SELECT id, name, occasion, categories, price, description, video_url
       FROM templates WHERE published ORDER BY sort_order, id`
    );
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ templates: result.rows });
  }

  if (first === 'photo' && second) {
    if (!/^\d+$/.test(second)) return res.status(400).json({ error: 'id must be a number' });
    await ensureSchema();
    const result = await pool.query(
      'SELECT photo_data, photo_mime FROM items WHERE id = $1 AND published AND photo_data IS NOT NULL',
      [second]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'No photo' });
    const { photo_data, photo_mime } = result.rows[0];
    res.setHeader('Content-Type', photo_mime);
    // The ?v= on the URL changes whenever the item is saved, so the image can be cached hard.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.status(200).send(Buffer.from(photo_data, 'base64'));
  }

  return res.status(404).json({ error: 'Not found' });
};
