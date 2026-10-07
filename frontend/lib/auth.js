const crypto = require('crypto');
require('dotenv').config({path: "./.env.local"});

// Two roles, each with its own password (environment variables):
//   superadmin: ADMIN_PASSWORD, sees everything.
//   japan:      JAPAN_ADMIN_PASSWORD, only Japan orders, quotations and tickets, plus her own QR codes.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const JAPAN_ADMIN_PASSWORD = process.env.JAPAN_ADMIN_PASSWORD;
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

// Returns the role the password belongs to, or null. Both comparisons always run so the time
// taken doesn't hint at which password was close. If both passwords were ever set to the same
// value, superadmin wins.
function verifyPassword(password) {
  const isSuper = Boolean(ADMIN_PASSWORD) && constantTimeEqual(password, ADMIN_PASSWORD);
  const isJapan = Boolean(JAPAN_ADMIN_PASSWORD) && constantTimeEqual(password, JAPAN_ADMIN_PASSWORD);
  if (isSuper) return 'superadmin';
  if (isJapan) return 'japan';
  return null;
}

// Session tokens are `<expiry>|<role>.<hmac>`. Tokens issued before roles existed were just
// `<expiry>.<hmac>` and only ever came from the single admin password, so they count as superadmin.
// Returns { role } for a valid, unexpired token, otherwise null.
function verifySignedToken(token) {
  if (!SESSION_CONFIGURED || !token) return null;
  const lastDot = token.lastIndexOf('.');
  if (lastDot === -1) return null;
  const value = token.slice(0, lastDot);
  if (!constantTimeEqual(sign(value), token)) return null;
  const [expiry, role = 'superadmin'] = value.split('|');
  const expiresAt = Number(expiry);
  if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) return null;
  if (role !== 'superadmin' && role !== 'japan') return null;
  return { role };
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

function createSessionCookie(role) {
  const expiresAt = Date.now() + SESSION_MAX_AGE_MS;
  const token = sign(`${expiresAt}|${role}`);
  return `scg_session=${encodeURIComponent(token)}; HttpOnly; Secure; Max-Age=${SESSION_MAX_AGE_MS / 1000}; SameSite=Lax; Path=/`;
}

function clearSessionCookie() {
  return 'scg_session=; HttpOnly; Secure; Max-Age=0; SameSite=Lax; Path=/';
}

function getSession(req) {
  return verifySignedToken(parseCookies(req).scg_session);
}

// Any signed-in user. Returns the session ({ role }) or null after sending a 401.
function requireAuth(req, res) {
  const session = getSession(req);
  if (session) return session;
  res.status(401).json({ error: 'Not authenticated' });
  return null;
}

// Superadmin only. Returns the session or null after sending a 401 / 403.
function requireSuper(req, res) {
  const session = requireAuth(req, res);
  if (!session) return null;
  if (session.role === 'superadmin') return session;
  res.status(403).json({ error: 'You do not have access to this' });
  return null;
}

module.exports = {
  SESSION_CONFIGURED,
  verifyPassword,
  parseCookies,
  verifySignedToken,
  getSession,
  requireSuper,
  createSessionCookie,
  clearSessionCookie,
  requireAuth,
};
