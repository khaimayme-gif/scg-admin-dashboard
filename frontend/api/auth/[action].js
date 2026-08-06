const { ADMIN_PASSWORD, createSessionCookie, clearSessionCookie, parseCookies, verifySignedToken } = require('../../lib/auth');

module.exports = (req, res) => {
  const { action } = req.query;

  if (action === 'login') {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const { password } = req.body;
    if (!ADMIN_PASSWORD || password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Incorrect password' });
    }
    res.setHeader('Set-Cookie', createSessionCookie());
    return res.status(200).json({ ok: true });
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