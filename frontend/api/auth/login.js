const { ADMIN_PASSWORD, createSessionCookie } = require('../../lib/auth');

module.exports = (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password } = req.body;
  console.log('DEBUG - received:', JSON.stringify(password), 'expected:', JSON.stringify(ADMIN_PASSWORD));
  if (!ADMIN_PASSWORD || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  res.setHeader('Set-Cookie', createSessionCookie());
  res.status(200).json({ ok: true });
};