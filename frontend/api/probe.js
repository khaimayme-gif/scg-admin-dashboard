// TEMPORARY diagnostic. Reports exactly what Vercel hands a function so the routing mechanism
// can be chosen from evidence rather than assumption. Delete once the API layout is settled.
//
// Reached three ways, all pointing here (see vercel.json):
//   /api/probe            direct filesystem hit, no rewrite
//   /api/probe/a/b/c      rewrite with a path-to-regexp capture  (?captured=:rest*)
//   /api/probe2/a/b/c     rewrite with a regex capture           (?regexCaptured=$1)

module.exports = (req, res) => {
  const interesting = Object.fromEntries(
    Object.entries(req.headers).filter(([k]) => /original|rewrit|path|matched|route|invoke/i.test(k))
  );

  res.status(200).json({
    method: req.method,
    url: req.url,
    query: req.query,
    interestingHeaders: interesting,
    allHeaderNames: Object.keys(req.headers).sort(),
  });
};
