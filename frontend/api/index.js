// The single Vercel Function for the whole API.
//
// Why one function with a static filename, rather than a catch-all file:
//
// Vercel's zero-config api/ directory does NOT support `[...param]` catch-all filenames. The
// segment name is taken literally, so `req.query.param` comes back undefined and any path with
// an extra segment never reaches the function at all. An earlier layout used those and seven
// endpoints 404'd in production for weeks. Plain `[param]` works; `[...param]` does not.
//
// So every /api/* request is sent here by a single rewrite in vercel.json, and this file picks
// the route apart itself. Verified against the deployed platform, not assumed.
//
// It also keeps the function count at 1. Vercel's Hobby plan allows 12 per deployment and
// without a framework every file under api/ becomes one, so new endpoints now cost a branch
// rather than a slot.
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

// The rewrite preserves the original path in req.url and also passes it as ?apiPath=. Prefer
// req.url, since a client cannot forge it; fall back to the capture if it ever stops carrying
// the original path.
function pathSegments(req) {
  let raw = '';
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname.startsWith('/api/') && pathname !== '/api/index') {
      raw = pathname.slice('/api/'.length);
    }
  } catch {
    // fall through to the captured value
  }
  if (!raw) {
    const captured = req.query && req.query.apiPath;
    raw = Array.isArray(captured) ? captured.join('/') : captured || '';
  }
  return raw.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
}

module.exports = async (req, res) => {
  const segments = pathSegments(req);
  const [group, ...rest] = segments;

  // Liveness probe. Deliberately touches nothing else, so it stays useful when the database or
  // the environment variables are what's broken.
  if (group === 'health' && rest.length === 0) {
    return res.status(200).json({ status: 'ok' });
  }

  const route = ROUTES[group];
  if (!route) return res.status(404).json({ error: 'Not found' });

  try {
    return await route(req, res, rest);
  } catch (err) {
    // Without this a database error becomes an unhandled rejection and the platform returns a
    // bare 500 with nothing useful in the logs.
    console.error(`Unhandled error in ${req.method} /api/${segments.join('/')}`, err);
    if (res.headersSent) return;
    return res.status(500).json({ error: 'Something went wrong on the server' });
  }
};
