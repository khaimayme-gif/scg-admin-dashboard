const crypto = require('crypto');
require('dotenv').config({path: "./.env.local"});

// Users sign in with a username and password (accounts live in the users table, managed in
// Settings). ADMIN_PASSWORD stays as an emergency super admin login, so a forgotten password or a
// mistake with the last super admin can never lock everyone out.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ROLES = ['superadmin', 'thai', 'japan'];
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

// Emergency login: the old super admin password from Vercel, with any username.
function isEmergencyPassword(password) {
  return Boolean(ADMIN_PASSWORD) && constantTimeEqual(password, ADMIN_PASSWORD);
}

// Session tokens are `<expiry>|<role>|<user id>.<hmac>`; the emergency login uses id "e".
// Tokens from before accounts existed have no user id and are no longer accepted: everyone signs
// in once with their username. Returns { role, userId } from the token alone, or null.
function verifySignedToken(token) {
  if (!SESSION_CONFIGURED || !token) return null;
  const lastDot = token.lastIndexOf('.');
  if (lastDot === -1) return null;
  const value = token.slice(0, lastDot);
  if (!constantTimeEqual(sign(value), token)) return null;
  const [expiry, role, uid] = value.split('|');
  const expiresAt = Number(expiry);
  if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) return null;
  if (!ROLES.includes(role) || !uid) return null;
  if (uid === 'e') return role === 'superadmin' ? { role, userId: null } : null;
  return /^\d+$/.test(uid) ? { role, userId: Number(uid) } : null;
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

function createSessionCookie(role, userId) {
  const expiresAt = Date.now() + SESSION_MAX_AGE_MS;
  const token = sign(`${expiresAt}|${role}|${userId === null || userId === undefined ? 'e' : userId}`);
  return `scg_session=${encodeURIComponent(token)}; HttpOnly; Secure; Max-Age=${SESSION_MAX_AGE_MS / 1000}; SameSite=Lax; Path=/`;
}

function clearSessionCookie() {
  return 'scg_session=; HttpOnly; Secure; Max-Age=0; SameSite=Lax; Path=/';
}

// The role in the cookie is only a hint: the account is looked up (cached for 30 seconds) so a
// deleted user or a changed role takes effect almost immediately instead of when the cookie expires.
const USER_CACHE_MS = 30 * 1000;
const userCache = new Map(); // id -> { user: { id, username, role } | null, at }

function forgetUser(id) {
  userCache.delete(Number(id));
}

async function lookupUser(id) {
  const hit = userCache.get(id);
  if (hit && Date.now() - hit.at < USER_CACHE_MS) return hit.user;
  const { pool, ensureSchema } = require('./db');
  await ensureSchema();
  const result = await pool.query('SELECT id, username, role FROM users WHERE id = $1', [id]);
  const user = result.rows[0] || null;
  userCache.set(id, { user, at: Date.now() });
  return user;
}

// Returns { role, userId, username } for a signed-in user, otherwise null.
async function getSession(req) {
  const token = verifySignedToken(parseCookies(req).scg_session);
  if (!token) return null;
  if (token.userId === null) return { role: 'superadmin', userId: null, username: 'emergency login' };
  const user = await lookupUser(token.userId);
  return user ? { role: user.role, userId: user.id, username: user.username } : null;
}

// Which country's data a role is held to: 'japan', 'thailand', or null (no limit, the super admin).
function scopeOf(session) {
  return session.role === 'japan' ? 'japan' : session.role === 'thai' ? 'thailand' : null;
}

// Any signed-in user. Returns the session or null after sending a 401.
async function requireAuth(req, res) {
  const session = await getSession(req);
  if (session) return session;
  res.status(401).json({ error: 'Not authenticated' });
  return null;
}

// Superadmin only. Returns the session or null after sending a 401 / 403.
async function requireSuper(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return null;
  if (session.role === 'superadmin') return session;
  res.status(403).json({ error: 'You do not have access to this' });
  return null;
}

module.exports = {
  SESSION_CONFIGURED,
  ROLES,
  isEmergencyPassword,
  parseCookies,
  verifySignedToken,
  getSession,
  scopeOf,
  forgetUser,
  requireAuth,
  requireSuper,
  createSessionCookie,
  clearSessionCookie,
};
