const crypto = require('crypto');
require('dotenv').config({path: "./.env.local"});

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// Session tokens are `<expiry>.<hmac>`. Without a real secret the hmac is forgeable by
// anyone who can read this file, so we fail closed instead of falling back to a default.
const SESSION_CONFIGURED = Boolean(SESSION_SECRET);
if (!SESSION_CONFIGURED) {
  console.error('SESSION_SECRET is not set. Sign-in is disabled until it is configured.');
}

// Compares via fixed-length digests so neither the contents nor the length leak through timing.
function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const digestA = crypto.createHash('sha256').update(a).digest();
  const digestB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(digestA, digestB);
}

function sign(value) {
  if (!SESSION_CONFIGURED) throw new Error('SESSION_SECRET is not configured');
  const hmac = crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
  return `${value}.${hmac}`;
}

function verifyPassword(password) {
  if (!ADMIN_PASSWORD) return false;
  return constantTimeEqual(password, ADMIN_PASSWORD);
}

function verifySignedToken(token) {
  if (!SESSION_CONFIGURED || !token) return false;
  const lastDot = token.lastIndexOf('.');
  if (lastDot === -1) return false;
  const value = token.slice(0, lastDot);
  if (!constantTimeEqual(sign(value), token)) return false;
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
  return `scg_session=${encodeURIComponent(token)}; HttpOnly; Secure; Max-Age=${SESSION_MAX_AGE_MS / 1000}; SameSite=Lax; Path=/`;
}

function clearSessionCookie() {
  return 'scg_session=; HttpOnly; Secure; Max-Age=0; SameSite=Lax; Path=/';
}

function requireAuth(req, res) {
  const cookies = parseCookies(req);
  if (verifySignedToken(cookies.scg_session)) return true;
  res.status(401).json({ error: 'Not authenticated' });
  return false;
}

module.exports = {
  SESSION_CONFIGURED,
  verifyPassword,
  parseCookies,
  verifySignedToken,
  createSessionCookie,
  clearSessionCookie,
  requireAuth,
};
