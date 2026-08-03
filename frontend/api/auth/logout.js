const { clearSessionCookie } = require('../../lib/auth');

module.exports = (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  res.setHeader('Set-Cookie', clearSessionCookie());
  res.status(200).json({ ok: true });
};