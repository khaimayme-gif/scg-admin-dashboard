const {
  SESSION_CONFIGURED, ROLES, isEmergencyPassword, createSessionCookie, clearSessionCookie, getSession,
} = require('../auth');
const { clientIp, isLockedOut, recordFailure, clearFailures } = require('../rate-limit');
const { pool, ensureSchema } = require('../db');
const { verifyPassword, DUMMY_HASH } = require('../passwords');

module.exports = async (req, res, [action]) => {
  if (action === 'login') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!SESSION_CONFIGURED) {
      console.error('Sign-in attempted but SESSION_SECRET is not configured.');
      return res.status(500).json({ error: 'Server is not configured for sign-in' });
    }

    const ip = clientIp(req);
    try {
      if (await isLockedOut(ip)) {
        return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
      }

      const body = req.body || {};
      const username = String(body.username || '').trim().toLowerCase();
      const password = typeof body.password === 'string' ? body.password : '';

      await ensureSchema();
      const found = username ? await pool.query('SELECT id, role, password_hash FROM users WHERE username = $1', [username]) : { rows: [] };
      const user = found.rows[0] || null;
      // Always verify against some hash, so a wrong username takes as long as a wrong password.
      const passwordOk = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH);

      if (user && passwordOk && ROLES.includes(user.role)) {
        await clearFailures(ip);
        res.setHeader('Set-Cookie', createSessionCookie(user.role, user.id));
        return res.status(200).json({ ok: true, role: user.role, username });
      }

      // Emergency way in: the super admin password from Vercel, whatever username was typed.
      if (isEmergencyPassword(password)) {
        await clearFailures(ip);
        res.setHeader('Set-Cookie', createSessionCookie('superadmin', null));
        return res.status(200).json({ ok: true, role: 'superadmin', username: 'emergency login' });
      }

      await recordFailure(ip);
      return res.status(401).json({ error: 'Incorrect username or password' });
    } catch (err) {
      console.error('Sign-in failed', err);
      return res.status(500).json({ error: 'Sign-in is temporarily unavailable' });
    }
  }

  if (action === 'logout') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    res.setHeader('Set-Cookie', clearSessionCookie());
    return res.status(200).json({ ok: true });
  }

  if (action === 'check') {
    try {
      const session = await getSession(req);
      return res.status(200).json({
        authenticated: Boolean(session),
        role: session ? session.role : null,
        username: session ? session.username : null,
        canChangePassword: Boolean(session && session.userId !== null),
      });
    } catch (err) {
      console.error('Session check failed', err);
      return res.status(200).json({ authenticated: false, role: null });
    }
  }

  return res.status(404).json({ error: 'Not found' });
};
