const { parseCookies, verifySignedToken } = require('../../lib/auth');

module.exports = (req, res) => {
  const cookies = parseCookies(req);
  res.status(200).json({ authenticated: verifySignedToken(cookies.scg_session) });
};