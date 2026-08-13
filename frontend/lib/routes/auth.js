const { SESSION_CONFIGURED, verifyPassword, createSessionCookie, clearSessionCookie, parseCookies, verifySignedToken } = require('../auth');
const { clientIp, isLockedOut, recordFailure, clearFailures } = require('../rate-limit');

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

      const { password } = req.body || {};
      if (!verifyPassword(password)) {
        await recordFailure(ip);
        return res.status(401).json({ error: 'Incorrect password' });
      }

      await clearFailures(ip);
      res.setHeader('Set-Cookie', createSessionCookie());
      return res.status(200).json({ ok: true });
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
    const cookies = parseCookies(req);
    return res.status(200).json({ authenticated: verifySignedToken(cookies.scg_session) });
  }

  return res.status(404).json({ error: 'Not found' });
};
