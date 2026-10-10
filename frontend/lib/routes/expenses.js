const { requireSuper } = require('../auth');
const { pool, ensureSchema } = require('../db');

const RECURRENCES = ['one_time', 'monthly', 'yearly'];
const CURRENCIES = ['THB', 'JPY', 'MMK'];

const EXPENSE_COLUMNS = `id, name, to_char(expense_date, 'YYYY-MM-DD') AS expense_date,
  cost, unit, currency, details, recurrence, created_at`;

const cleanText = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

module.exports = async (req, res, [first, second]) => {
  if (!await requireSuper(req, res)) return;
  await ensureSchema();

  if (!first && req.method === 'GET') {
    const result = await pool.query(
      `SELECT ${EXPENSE_COLUMNS} FROM expenses ORDER BY expense_date DESC, id DESC`
    );
    return res.status(200).json(result.rows);
  }

  // A quick glance at spend: what's gone out one-time this month, and the monthly-equivalent
  // "run rate" of everything recurring (yearly costs divided by 12), regardless of month.
  if (first === 'stats' && req.method === 'GET') {
    const result = await pool.query(
      "SELECT cost, currency, recurrence, to_char(expense_date, 'YYYY-MM') AS month FROM expenses"
    );
    const thisMonth = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit' })
      .format(new Date());

    let oneTimeThisMonthThb = 0;
    let monthlyRunRateThb = 0;
    let unconverted = 0;

    for (const row of result.rows) {
      if (row.currency !== 'THB') {
        // Keeping this simple: only THB rolls into the totals below, same spirit as the rest
        // of the app not guessing at a rate that isn't set anywhere for expenses.
        unconverted += 1;
        continue;
      }
      const cost = Number(row.cost) || 0;
      if (row.recurrence === 'monthly') monthlyRunRateThb += cost;
      else if (row.recurrence === 'yearly') monthlyRunRateThb += cost / 12;
      else if (row.month === thisMonth) oneTimeThisMonthThb += cost;
    }

    return res.status(200).json({
      oneTimeThisMonthThb: Math.round(oneTimeThisMonthThb),
      monthlyRunRateThb: Math.round(monthlyRunRateThb),
      unconverted, // expenses in JPY/MMK, not counted above
    });
  }

  if (first === 'save' && req.method === 'POST') {
    const { id, name, expenseDate, cost, unit, currency, details, recurrence } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (cost === undefined || cost === null || Number.isNaN(Number(cost))) {
      return res.status(400).json({ error: 'cost is required' });
    }
    const rec = RECURRENCES.includes(recurrence) ? recurrence : 'one_time';
    const cur = CURRENCIES.includes(currency) ? currency : 'THB';

    const values = [
      String(name).trim(),
      expenseDate || new Date().toISOString().slice(0, 10),
      Number(cost),
      cleanText(unit),
      cur,
      cleanText(details),
      rec,
    ];

    if (id) {
      const result = await pool.query(
        `UPDATE expenses SET name = $1, expense_date = $2, cost = $3, unit = $4, currency = $5,
           details = $6, recurrence = $7, updated_at = NOW()
         WHERE id = $8
         RETURNING ${EXPENSE_COLUMNS}`,
        [...values, id]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'Expense not found' });
      return res.status(200).json(result.rows[0]);
    }

    const result = await pool.query(
      `INSERT INTO expenses (name, expense_date, cost, unit, currency, details, recurrence)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${EXPENSE_COLUMNS}`,
      values
    );
    return res.status(200).json(result.rows[0]);
  }

  if (first === 'delete' && second && req.method === 'DELETE') {
    if (!/^\d+$/.test(second)) return res.status(400).json({ error: 'id must be a number' });
    await pool.query('DELETE FROM expenses WHERE id = $1', [second]);
    return res.status(200).json({ deleted: true });
  }

  return res.status(404).json({ error: 'Not found' });
};
