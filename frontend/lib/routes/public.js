// Read-only endpoints for the So Chic Gifts landing page. No login: everything here is meant
// to be public, so it only ever returns published items and never exposes cost or profit.
//
//   GET /api/public/menu        -> { categories: [{ category, items: [...] }] }
//   GET /api/public/photo/:id   -> the item's image
const { pool, ensureSchema } = require('../db');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
}

module.exports = async (req, res, [first, second]) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (first === 'menu') {
    await ensureSchema();
    // ?country=japan for the Japan menu; Thailand is the default.
    const country = new URL(req.url, 'http://localhost').searchParams.get('country') === 'japan' ? 'japan' : 'thailand';
    const result = await pool.query(
      `SELECT id, category, item_code, name, description, item_group, menu_price,
         (photo_data IS NOT NULL) AS has_photo, EXTRACT(EPOCH FROM updated_at)::bigint AS v
       FROM items WHERE published AND country = $1 ORDER BY category, item_code NULLS LAST, name`,
      [country]
    );
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const origin = `${proto}://${req.headers.host}`;
    const byCategory = new Map();
    for (const row of result.rows) {
      if (!byCategory.has(row.category)) byCategory.set(row.category, []);
      byCategory.get(row.category).push({
        item_id: row.item_code,
        name: row.name,
        description: row.description,
        group: row.item_group,
        price: row.menu_price,
        photo_url: row.has_photo ? `${origin}/api/public/photo/${row.id}?v=${row.v}` : null,
      });
    }
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({
      country,
      currency: country === 'japan' ? 'JPY' : 'THB',
      categories: [...byCategory].map(([category, items]) => ({ category, items })),
    });
  }

  if (first === 'photo' && second) {
    if (!/^\d+$/.test(second)) return res.status(400).json({ error: 'id must be a number' });
    await ensureSchema();
    const result = await pool.query(
      'SELECT photo_data, photo_mime FROM items WHERE id = $1 AND published AND photo_data IS NOT NULL',
      [second]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'No photo' });
    const { photo_data, photo_mime } = result.rows[0];
    res.setHeader('Content-Type', photo_mime);
    // The ?v= on the URL changes whenever the item is saved, so the image can be cached hard.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.status(200).send(Buffer.from(photo_data, 'base64'));
  }

  return res.status(404).json({ error: 'Not found' });
};
