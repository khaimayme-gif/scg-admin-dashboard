// So Chic Board: orders as tickets in To do / In progress / Done / Closed, with comments.
const { requireAuth } = require('../auth');
const { pool, ensureSchema } = require('../db');

const STAGES = ['todo', 'in_progress', 'done', 'closed'];

module.exports = async (req, res, [first, second]) => {
  const session = requireAuth(req, res);
  if (!session) return;
  const japan = session.role === 'japan';
  await ensureSchema();

  // The Japan admin only sees and touches Japan tickets.
  const canTouch = async (orderId) => {
    const r = await pool.query(
      `SELECT 1 FROM orders WHERE id = $1 AND ($2::boolean = false OR lower(btrim(country)) = 'japan')`,
      [orderId, japan]
    );
    return r.rowCount > 0;
  };

  // All tickets, lightweight: no comments, just how many there are.
  if (!first && req.method === 'GET') {
    const result = await pool.query(
      `SELECT o.id, o.order_no, o.customer_name, o.recipient, o.country, o.status, o.currency,
              o.selling_price, o.items_json, o.delivery_address, o.notes,
              to_char(o.delivery_date, 'YYYY-MM-DD') AS delivery_date,
              to_char(o.order_date, 'YYYY-MM-DD') AS order_date,
              o.board_stage, o.board_position, o.board_checks,
              (SELECT COUNT(*)::int FROM board_comments c WHERE c.order_id = o.id) AS comment_count
       FROM orders o
       ${japan ? "WHERE lower(btrim(o.country)) = 'japan'" : ''}
       ORDER BY o.board_position`
    );
    return res.status(200).json(
      result.rows.map(({ items_json, ...row }) => ({ ...row, items: JSON.parse(items_json) }))
    );
  }

  if (first === 'move' && req.method === 'POST') {
    const { orderId, stage, position } = req.body || {};
    if (!STAGES.includes(stage)) return res.status(400).json({ error: 'Invalid stage' });
    if (!Number.isInteger(orderId)) return res.status(400).json({ error: 'orderId must be a number' });
    const pos = Number.isFinite(Number(position)) ? Number(position) : Date.now();
    const result = await pool.query(
      `UPDATE orders SET board_stage = $1, board_position = $2, updated_at = NOW()
       WHERE id = $3 AND ($4::boolean = false OR lower(btrim(country)) = 'japan') RETURNING id`,
      [stage, pos, orderId, japan]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Order not found' });
    return res.status(200).json({ id: orderId, stage, position: pos });
  }

  // Ticks an item on a ticket's checklist on or off.
  if (first === 'check' && req.method === 'POST') {
    const { orderId, key, checked } = req.body || {};
    if (!Number.isInteger(orderId)) return res.status(400).json({ error: 'orderId must be a number' });
    if (typeof key !== 'string' || !key || key.length > 300) return res.status(400).json({ error: 'Invalid item' });
    if (!(await canTouch(orderId))) return res.status(404).json({ error: 'Order not found' });
    // Remove first so ticking twice never duplicates, then add back when checked.
    await pool.query(
      `UPDATE orders SET board_checks = CASE WHEN $2::boolean
           THEN (board_checks - $3::text) || to_jsonb($3::text)
           ELSE board_checks - $3::text END
       WHERE id = $1`,
      [orderId, Boolean(checked), key]
    );
    return res.status(200).json({ orderId, key, checked: Boolean(checked) });
  }

  if (first === 'comments' && second && req.method === 'GET') {
    if (!/^\d+$/.test(second)) return res.status(400).json({ error: 'id must be a number' });
    if (!(await canTouch(second))) return res.status(404).json({ error: 'Order not found' });
    const result = await pool.query(
      'SELECT id, body, created_at FROM board_comments WHERE order_id = $1 ORDER BY created_at, id',
      [second]
    );
    return res.status(200).json(result.rows);
  }

  if (first === 'comment' && req.method === 'POST') {
    const { orderId } = req.body || {};
    const body = String((req.body || {}).body || '').trim();
    if (!Number.isInteger(orderId)) return res.status(400).json({ error: 'orderId must be a number' });
    if (!body) return res.status(400).json({ error: 'Write something first' });
    if (body.length > 2000) return res.status(400).json({ error: 'Comment is too long (2000 characters max)' });
    if (!(await canTouch(orderId))) return res.status(404).json({ error: 'Order not found' });
    const result = await pool.query(
      'INSERT INTO board_comments (order_id, body) VALUES ($1, $2) RETURNING id, body, created_at',
      [orderId, body]
    );
    return res.status(200).json(result.rows[0]);
  }

  if (first === 'comment' && second && req.method === 'DELETE') {
    if (!/^\d+$/.test(second)) return res.status(400).json({ error: 'id must be a number' });
    await pool.query(
      `DELETE FROM board_comments c USING orders o
       WHERE c.id = $1 AND o.id = c.order_id AND ($2::boolean = false OR lower(btrim(o.country)) = 'japan')`,
      [second, japan]
    );
    return res.status(200).json({ deleted: true });
  }

  return res.status(404).json({ error: 'Not found' });
};
