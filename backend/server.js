require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { pool, initSchema } = require('./db');

const app = express();
const PORT = 4000;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

if (!ADMIN_PASSWORD || !SESSION_SECRET) {
  console.warn('WARNING: ADMIN_PASSWORD and/or SESSION_SECRET not set in .env - the dashboard is unprotected.');
}

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// --- Minimal signed-session auth (no extra cookie/session libraries needed) ---

function sign(value) {
  const hmac = crypto.createHmac('sha256', SESSION_SECRET || 'dev-secret').update(value).digest('hex');
  return `${value}.${hmac}`;
}

function verifySignedToken(token) {
  if (!token) return false;
  const lastDot = token.lastIndexOf('.');
  if (lastDot === -1) return false;
  const value = token.slice(0, lastDot);
  const expected = sign(value);
  if (expected !== token) return false;
  const expiresAt = Number(value);
  return Number.isFinite(expiresAt) && Date.now() < expiresAt;
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  return Object.fromEntries(
    header.split(';').map((pair) => {
      const [k, ...v] = pair.trim().split('=');
      return [k, decodeURIComponent(v.join('='))];
    })
  );
}

function requireAuth(req, res, next) {
  const cookies = parseCookies(req);
  if (verifySignedToken(cookies.scg_session)) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

app.post('/api/auth/login', (req, res) => {
  const { password } = req.body;
  if (!ADMIN_PASSWORD || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  const expiresAt = Date.now() + SESSION_MAX_AGE_MS;
  const token = sign(String(expiresAt));
  res.cookie('scg_session', token, { httpOnly: true, maxAge: SESSION_MAX_AGE_MS, sameSite: 'lax' });
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'scg_session=; HttpOnly; Max-Age=0; SameSite=Lax; Path=/');
  res.json({ ok: true });
});

app.get('/api/auth/check', (req, res) => {
  const cookies = parseCookies(req);
  res.json({ authenticated: verifySignedToken(cookies.scg_session) });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Everything below this line requires a valid session
app.use(requireAuth);

// Calculate a price quote: items (array of {name, cost}), delivery fee, fixed 20% markup
app.post('/api/price-calculator/calculate', (req, res) => {
  const { items, deliveryFee } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items must be a non-empty array' });
  }

  const MARKUP_PERCENT = 40;
  const itemsCost = items.reduce((sum, item) => sum + Number(item.cost || 0), 0);
  const markedUpItemsCost = itemsCost * (1 + MARKUP_PERCENT / 100);
  const delivery = Number(deliveryFee || 0);
  const total = markedUpItemsCost + delivery;

  res.json({
    itemsCost,
    markupPercent: MARKUP_PERCENT,
    markedUpItemsCost: Math.round(markedUpItemsCost * 100) / 100,
    deliveryFee: delivery,
    total: Math.round(total * 100) / 100,
  });
});

app.post('/api/price-calculator/save', async (req, res) => {
  const { items, markupPercent, deliveryFee, total } = req.body;
  const result = await pool.query(
    `INSERT INTO price_quotes (items_json, markup_percent, delivery_fee, total)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [JSON.stringify(items), markupPercent, deliveryFee, total]
  );
  res.json({ id: result.rows[0].id });
});

app.get('/api/price-calculator/quotes', async (req, res) => {
  const result = await pool.query('SELECT * FROM price_quotes ORDER BY created_at DESC');
  res.json(result.rows.map(row => ({ ...row, items_json: JSON.parse(row.items_json) })));
});

app.post('/api/qr/save', async (req, res) => {
  const { url, label, theme } = req.body;
  if (!url || !url.trim()) {
    return res.status(400).json({ error: 'url is required' });
  }
  const result = await pool.query(
    'INSERT INTO qr_codes (url, label, theme) VALUES ($1, $2, $3) RETURNING id',
    [url, label || null, theme || null]
  );
  res.json({ id: result.rows[0].id });
});

app.get('/api/qr/history', async (req, res) => {
  const result = await pool.query('SELECT * FROM qr_codes ORDER BY created_at DESC');
  res.json(result.rows);
});

app.delete('/api/qr/history/:id', async (req, res) => {
  await pool.query('DELETE FROM qr_codes WHERE id = $1', [req.params.id]);
  res.json({ deleted: true });
});

app.post('/api/japan-quotes/save', async (req, res) => {
  const { giftCost, japanFee, thailandFee, total } = req.body;
  if (giftCost === undefined || total === undefined) {
    return res.status(400).json({ error: 'giftCost and total are required' });
  }
  const result = await pool.query(
    `INSERT INTO japan_quotes (gift_cost, japan_fee, thailand_fee, total)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [Number(giftCost), Number(japanFee || 0), Number(thailandFee || 0), Number(total)]
  );
  res.json({ id: result.rows[0].id });
});

app.get('/api/japan-quotes', async (req, res) => {
  const result = await pool.query('SELECT * FROM japan_quotes ORDER BY created_at DESC');
  res.json(result.rows);
});

initSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`SCG backend running at http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database schema:', err);
    process.exit(1);
  });
