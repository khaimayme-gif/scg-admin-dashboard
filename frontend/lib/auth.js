const crypto = require('crypto');
require('dotenv').config({path: "./.env.local"});

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

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

function createSessionCookie() {
  const expiresAt = Date.now() + SESSION_MAX_AGE_MS;
  const token = sign(String(expiresAt));
  return `scg_session=${encodeURIComponent(token)}; HttpOnly; Max-Age=${SESSION_MAX_AGE_MS / 1000}; SameSite=Lax; Path=/`;
}

function clearSessionCookie() {
  return 'scg_session=; HttpOnly; Max-Age=0; SameSite=Lax; Path=/';
}

function requireAuth(req, res) {
  const cookies = parseCookies(req);
  if (verifySignedToken(cookies.scg_session)) return true;
  res.status(401).json({ error: 'Not authenticated' });
  return false;
}

module.exports = {
  ADMIN_PASSWORD,
  parseCookies,
  verifySignedToken,
  createSessionCookie,
  clearSessionCookie,
  requireAuth,
};