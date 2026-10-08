const { requireAuth } = require('../auth');
const { pool, ensureSchema } = require('../db');
const { platformFeeJpy } = require('../platform-fee');

const CHANNELS = ['tiktok', 'facebook'];
const PLACES = ['Thailand', 'Japan', 'Myanmar'];
const PAY_CURRENCIES = ['THB', 'JPY', 'MMK']; // what the customer is quoted and pays in

const parse = (row) => ({ ...row, items: JSON.parse(row.items_json) });

// YYYYMMDD for "today" in Bangkok, regardless of the server's own timezone.
const todayPrefix = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date())
    .replace(/-/g, '');

// "20260928-001", "20260928-002", ... An advisory lock keyed on the prefix keeps two
// simultaneous saves on the same day from picking the same number.
const nextQuoteNo = async (client) => {
  const prefix = todayPrefix();
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [prefix]);
  const { rows } = await client.query(
    `SELECT quote_no FROM quotations WHERE quote_no LIKE $1 ORDER BY quote_no DESC LIMIT 1`,
    [`${prefix}-%`]
  );
  const last = rows[0] ? Number(rows[0].quote_no.split('-')[1]) : 0;
  return `${prefix}-${String(last + 1).padStart(3, '0')}`;
};

module.exports = async (req, res, [first, second]) => {
  const session = requireAuth(req, res);
  if (!session) return;
  const japan = session.role === 'japan';
  await ensureSchema();

  if (!first && req.method === 'GET') {
    const result = await pool.query(
      `SELECT q.id, q.quote_no, q.customer_name, q.channel, to_char(q.quote_date, 'YYYY-MM-DD') AS quote_date,
              q.order_place, q.items_json, q.total_thb, q.original_thb, q.revenue_thb, q.total_mmk, q.total_jpy, q.platform_fee_jpy,
              q.price_currency, q.pay_currency, q.total_pay, q.rate_thb_to_jpy, q.rate_thb_to_mmk,
              o.id AS order_id, o.order_no
       FROM quotations q
       LEFT JOIN orders o ON o.quotation_id = q.id
       ${japan ? "WHERE lower(btrim(q.order_place)) = 'japan'" : ''}
       ORDER BY q.created_at DESC, q.id DESC`
    );
    return res.status(200).json(result.rows.map(parse));
  }

  if (first === 'save' && req.method === 'POST') {
    const { customerName, channel, quoteDate, items } = req.body || {};
    const payCurrency = (req.body || {}).payCurrency || 'THB';
    // The Japan admin can only quote for Japan, whatever was sent.
    const orderPlace = japan ? 'Japan' : (req.body || {}).orderPlace;
    if (!customerName || !customerName.trim()) {
      return res.status(400).json({ error: 'customerName is required' });
    }
    if (!CHANNELS.includes(channel)) return res.status(400).json({ error: 'Invalid channel' });
    if (!PLACES.includes(orderPlace)) return res.status(400).json({ error: 'Invalid order place' });
    // Prices are typed in yen for Japan and in baht everywhere else; the browser doesn't choose.
    const priceCurrency = orderPlace === 'Japan' ? 'JPY' : 'THB';
    if (!PAY_CURRENCIES.includes(payCurrency)) return res.status(400).json({ error: 'Invalid customer currency' });

    const cleanItems = (Array.isArray(items) ? items : [])
      .map((i) => ({
        name: String(i.name || '').trim(),
        sellingPrice: Number(i.sellingPrice) || 0,
        originalPrice: Number(i.originalPrice) || 0,
      }))
      .filter((i) => i.name);
    if (cleanItems.length === 0) return res.status(400).json({ error: 'Add at least one item' });

    // All amounts are calculated here, never trusted from the browser. Prices are typed in
    // priceCurrency (THB or JPY); everything is converted through THB with the Settings rates:
    //   total   = sum of selling prices (what the customer is quoted)
    //   revenue = sum of (selling price - original price)
    const settings = await pool.query('SELECT * FROM settings WHERE id = 1');
    const s = settings.rows[0] || {};
    const thbToJpy = s.rate_thb_to_jpy || null;
    const thbToMmk = s.rate_thb_to_mmk || null;

    // Which rates this quotation can't do without.
    const needsJpy = priceCurrency === 'JPY' || payCurrency === 'JPY' || orderPlace === 'Japan';
    if ((needsJpy && !thbToJpy) || (payCurrency === 'MMK' && !thbToMmk)) {
      return res.status(400).json({ error: 'Set the exchange rates in Settings first.' });
    }

    const toThb = (amount, cur) => (cur === 'JPY' ? amount / thbToJpy : amount);
    const fromThb = (thb, cur) => (cur === 'JPY' ? thb * thbToJpy : cur === 'MMK' ? thb * thbToMmk : thb);

    // Item prices and the total stay in the price currency (THB for Thailand, JPY for Japan). The
    // currency the customer pays in only adds the total in that currency, shown under the total.
    const totalEntry = cleanItems.reduce((sum, i) => sum + i.sellingPrice, 0);
    const originalEntry = cleanItems.reduce((sum, i) => sum + i.originalPrice, 0);

    const totalThb = toThb(totalEntry, priceCurrency);
    const totalPay = priceCurrency === payCurrency ? totalEntry : Math.round(fromThb(totalThb, payCurrency));
    const originalThb = toThb(originalEntry, priceCurrency);
    const revenueThb = totalThb - originalThb;
    const totalMmk = thbToMmk ? Math.round(totalThb * thbToMmk) : null;
    const totalJpy = priceCurrency === 'JPY' ? totalEntry : thbToJpy ? Math.round(totalThb * thbToJpy) : null;
    // Japan quotations carry the SochicGifts platform fee, worked out from the yen total.
    const platformFee = orderPlace === 'Japan' && totalJpy !== null ? platformFeeJpy(totalJpy) : null;

    const client = await pool.connect();
    let row;
    try {
      await client.query('BEGIN');
      const quoteNo = await nextQuoteNo(client);
      const result = await client.query(
        `INSERT INTO quotations (quote_no, customer_name, channel, quote_date, order_place, items_json,
                                 total_thb, original_thb, revenue_thb, total_mmk, total_jpy, platform_fee_jpy,
                                 price_currency, pay_currency, total_pay, rate_thb_to_jpy, rate_thb_to_mmk)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         RETURNING id, quote_no, customer_name, channel, to_char(quote_date, 'YYYY-MM-DD') AS quote_date, order_place,
                   items_json, total_thb, original_thb, revenue_thb, total_mmk, total_jpy, platform_fee_jpy,
                   price_currency, pay_currency, total_pay, rate_thb_to_jpy, rate_thb_to_mmk,
                   NULL::integer AS order_id, NULL::text AS order_no`,
        [
          quoteNo,
          customerName.trim(),
          channel,
          quoteDate || new Date().toISOString().slice(0, 10),
          orderPlace,
          JSON.stringify(cleanItems),
          totalThb,
          originalThb,
          revenueThb,
          totalMmk,
          totalJpy,
          platformFee,
          priceCurrency,
          payCurrency,
          totalPay,
          thbToJpy,
          thbToMmk,
        ]
      );
      await client.query('COMMIT');
      row = result.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return res.status(200).json(parse(row));
  }

  if (first === 'delete' && second && req.method === 'DELETE') {
    if (!/^\d+$/.test(second)) return res.status(400).json({ error: 'id must be a number' });
    const result = await pool.query(
      `DELETE FROM quotations WHERE id = $1 AND ($2::boolean = false OR lower(btrim(order_place)) = 'japan')`,
      [second, japan]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Quotation not found' });
    return res.status(200).json({ deleted: true });
  }

  return res.status(404).json({ error: 'Not found' });
};
