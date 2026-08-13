// The single Vercel Function for the whole API.
//
// Vercel's Hobby plan allows 12 functions per deployment and, without a framework, every file
// under api/ becomes one. Routing everything through this dispatcher keeps that count at 1, so
// new endpoints cost a branch instead of a slot. It also means a bare collection path such as
// /api/items arrives as a normal segment, so the old `_root` rewrites are no longer needed.
//
// To add a resource: create lib/routes/<name>.js exporting (req, res, rest) and list it below.

const ROUTES = {
  auth: require('../lib/routes/auth'),
  items: require('../lib/routes/items'),
  settings: require('../lib/routes/settings'),
  qr: require('../lib/routes/qr'),
  'price-calculator': require('../lib/routes/price-calculator'),
  'japan-quotes': require('../lib/routes/japan-quotes'),
};

module.exports = async (req, res) => {
  const raw = req.query.path || [];
  const segments = (Array.isArray(raw) ? raw : [raw]).filter(Boolean);
  const [group, ...rest] = segments;

  // Liveness probe. Deliberately touches nothing else, so it stays useful when the database
  // or the environment variables are the problem.
  if (group === 'health' && rest.length === 0) {
    return res.status(200).json({ status: 'ok' });
  }

  const route = ROUTES[group];
  if (!route) return res.status(404).json({ error: 'Not found' });

  try {
    return await route(req, res, rest);
  } catch (err) {
    // Without this, a database error becomes an unhandled rejection and the platform returns a
    // bare 500 with no explanation in the logs.
    console.error(`Unhandled error in ${req.method} /api/${segments.join('/')}`, err);
    if (res.headersSent) return;
    return res.status(500).json({ error: 'Something went wrong on the server' });
  }
};
