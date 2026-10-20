const { requireAuth } = require('../auth');
const { pool, ensureSchema } = require('../db');
const { scopeOf } = require('../auth');
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

// Works out everything a quotation stores from what was typed. All amounts are calculated here, never
// trusted from the browser. Prices are typed in the price currency (THB, or JPY for Japan); everything
// is converted through THB with the given rates:
//   total   = sum of selling prices (what the customer is quoted)
//   revenue = sum of (selling price - original price)
// Item prices and the total stay in the price currency; the currency the customer pays in only adds
// the total in that currency, shown under the total. Returns { error } or { values }.
const priceQuote = ({ items, payCurrency, orderPlace }, { thbToJpy, thbToMmk }) => {
  // Prices are typed in yen for Japan and in baht everywhere else; the browser doesn't choose.
  const priceCurrency = orderPlace === 'Japan' ? 'JPY' : 'THB';

  const cleanItems = (Array.isArray(items) ? items : [])
    .map((i) => ({
      name: String(i.name || '').trim(),
      sellingPrice: Number(i.sellingPrice) || 0,
      originalPrice: Number(i.originalPrice) || 0,
    }))
    .filter((i) => i.name);
  if (cleanItems.length === 0) return { error: 'Add at least one item' };

  // Which rates this quotation can't do without.
  const needsJpy = priceCurrency === 'JPY' || payCurrency === 'JPY' || orderPlace === 'Japan';
  if ((needsJpy && !thbToJpy) || (payCurrency === 'MMK' && !thbToMmk)) {
    return { error: 'Set the exchange rates in Settings first.' };
  }

  const toThb = (amount, cur) => (cur === 'JPY' ? amount / thbToJpy : amount);
  const fromThb = (thb, cur) => (cur === 'JPY' ? thb * thbToJpy : cur === 'MMK' ? thb * thbToMmk : thb);

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

  return {
    values: { cleanItems, priceCurrency, totalThb, originalThb, revenueThb, totalMmk, totalJpy, platformFee, totalPay, thbToJpy, thbToMmk },
  };
};

// The fields every save and every edit has to have, checked the same way for both.
const checkFields = (body, scopeLabel) => {
  const { customerName, channel } = body;
  const payCurrency = body.payCurrency || 'THB';
  // A Japan or Thai admin can only quote for their own country, whatever was sent.
  const orderPlace = scopeLabel ?? body.orderPlace;
  if (!customerName || !String(customerName).trim()) return { error: 'customerName is required' };
  if (!CHANNELS.includes(channel)) return { error: 'Invalid channel' };
  if (!PLACES.includes(orderPlace)) return { error: 'Invalid order place' };
  if (!PAY_CURRENCIES.includes(payCurrency)) return { error: 'Invalid customer currency' };
  return { fields: { customerName: String(customerName).trim(), channel, orderPlace, payCurrency } };
};

module.exports = async (req, res, [first, second]) => {
  const session = await requireAuth(req, res);
  if (!session) return;
  const scope = scopeOf(session); // 'japan' | 'thailand' | null (super admin)
  const scopeLabel = scope === 'japan' ? 'Japan' : scope === 'thailand' ? 'Thailand' : null;
  await ensureSchema();

  if (!first && req.method === 'GET') {
    const result = await pool.query(
      `SELECT q.id, q.quote_no, q.customer_name, q.channel, to_char(q.quote_date, 'YYYY-MM-DD') AS quote_date,
              q.order_place, q.items_json, q.total_thb, q.original_thb, q.revenue_thb, q.total_mmk, q.total_jpy, q.platform_fee_jpy,
              q.price_currency, q.pay_currency, q.total_pay, q.rate_thb_to_jpy, q.rate_thb_to_mmk,
              o.id AS order_id, o.order_no
       FROM quotations q
       LEFT JOIN orders o ON o.quotation_id = q.id
       ${scope ? `WHERE lower(btrim(q.order_place)) = '${scope}'` : ''}
       ORDER BY q.created_at DESC, q.id DESC`
    );
    return res.status(200).json(result.rows.map(parse));
  }

  if (first === 'save' && req.method === 'POST') {
    const body = req.body || {};
    const checked = checkFields(body, scopeLabel);
    if (checked.error) return res.status(400).json({ error: checked.error });
    const { customerName, channel, orderPlace, payCurrency } = checked.fields;
    const { quoteDate } = body;

    const settings = await pool.query('SELECT * FROM settings WHERE id = 1');
    const s = settings.rows[0] || {};
    const priced = priceQuote(
      { items: body.items, payCurrency, orderPlace },
      { thbToJpy: s.rate_thb_to_jpy || null, thbToMmk: s.rate_thb_to_mmk || null }
    );
    if (priced.error) return res.status(400).json({ error: priced.error });
    const { cleanItems, priceCurrency, totalThb, originalThb, revenueThb, totalMmk, totalJpy, platformFee, totalPay, thbToJpy, thbToMmk } = priced.values;

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
          customerName,
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

  // Edits a saved quotation: everything except its number. The figures are worked out again with the
  // rates stored on the quotation when it was made (so a later change in Settings doesn't move the
  // price the customer was quoted), falling back to the current Settings rates for a currency the
  // quotation never needed before. An order made from it is a separate copy and is not changed.
  if (first === 'update' && req.method === 'POST') {
    const body = req.body || {};
    if (!Number.isInteger(body.id)) return res.status(400).json({ error: 'id must be a number' });
    const found = await pool.query(
      `SELECT * FROM quotations WHERE id = $1 AND ($2::text IS NULL OR lower(btrim(order_place)) = $2)`,
      [body.id, scope]
    );
    if (found.rowCount === 0) return res.status(404).json({ error: 'Quotation not found' });
    const old = found.rows[0];

    // A Japan or Thai admin keeps the quotation in their country.
    const checked = checkFields({ ...body, orderPlace: scopeLabel ?? body.orderPlace ?? old.order_place }, scopeLabel);
    if (checked.error) return res.status(400).json({ error: checked.error });
    const { customerName, channel, orderPlace, payCurrency } = checked.fields;

    const current = (await pool.query('SELECT * FROM settings WHERE id = 1')).rows[0] || {};
    const priced = priceQuote(
      { items: body.items, payCurrency, orderPlace },
      { thbToJpy: old.rate_thb_to_jpy || current.rate_thb_to_jpy || null, thbToMmk: old.rate_thb_to_mmk || current.rate_thb_to_mmk || null }
    );
    if (priced.error) return res.status(400).json({ error: priced.error });
    const v = priced.values;

    const result = await pool.query(
      `UPDATE quotations SET customer_name = $1, channel = $2, quote_date = COALESCE($3::date, quote_date), order_place = $4, items_json = $5,
              total_thb = $6, original_thb = $7, revenue_thb = $8, total_mmk = $9, total_jpy = $10, platform_fee_jpy = $11,
              price_currency = $12, pay_currency = $13, total_pay = $14, rate_thb_to_jpy = $15, rate_thb_to_mmk = $16
       WHERE id = $17
       RETURNING id, quote_no, customer_name, channel, to_char(quote_date, 'YYYY-MM-DD') AS quote_date, order_place,
                 items_json, total_thb, original_thb, revenue_thb, total_mmk, total_jpy, platform_fee_jpy,
                 price_currency, pay_currency, total_pay, rate_thb_to_jpy, rate_thb_to_mmk`,
      [
        customerName, channel, body.quoteDate || null, orderPlace, JSON.stringify(v.cleanItems),
        v.totalThb, v.originalThb, v.revenueThb, v.totalMmk, v.totalJpy, v.platformFee,
        v.priceCurrency, payCurrency, v.totalPay, v.thbToJpy, v.thbToMmk, body.id,
      ]
    );
    const order = await pool.query('SELECT id AS order_id, order_no FROM orders WHERE quotation_id = $1', [body.id]);
    return res.status(200).json(parse({ ...result.rows[0], order_id: order.rows[0]?.order_id ?? null, order_no: order.rows[0]?.order_no ?? null }));
  }

  // Changes the currency the customer pays in (the "≈ … MMK" line under the printed total) on a
  // saved quotation. Prices and the total never change; the amount comes from the rates stored with
  // the quotation, falling back to the current Settings rates for older ones.
  if (first === 'currency' && req.method === 'POST') {
    const { id, payCurrency } = req.body || {};
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id must be a number' });
    if (!PAY_CURRENCIES.includes(payCurrency)) return res.status(400).json({ error: 'Invalid customer currency' });
    const found = await pool.query(
      `SELECT * FROM quotations WHERE id = $1 AND ($2::text IS NULL OR lower(btrim(order_place)) = $2)`,
      [id, scope]
    );
    if (found.rowCount === 0) return res.status(404).json({ error: 'Quotation not found' });
    const q = found.rows[0];

    const current = (await pool.query('SELECT * FROM settings WHERE id = 1')).rows[0] || {};
    const thbToJpy = q.rate_thb_to_jpy || current.rate_thb_to_jpy || null;
    const thbToMmk = q.rate_thb_to_mmk || current.rate_thb_to_mmk || null;
    const entry = q.price_currency || 'THB';
    const totalEntry = entry === 'JPY' ? q.total_jpy : q.total_thb;

    let totalPay = null;
    if (payCurrency === entry) totalPay = totalEntry;
    else if (payCurrency === 'THB') totalPay = Math.round(q.total_thb);
    else if (payCurrency === 'JPY') totalPay = q.total_jpy ?? (thbToJpy ? Math.round(q.total_thb * thbToJpy) : null);
    else totalPay = q.total_mmk ?? (thbToMmk ? Math.round(q.total_thb * thbToMmk) : null);
    if (totalPay === null || totalPay === undefined) {
      return res.status(400).json({ error: 'Set the exchange rates in Settings first.' });
    }

    await pool.query('UPDATE quotations SET pay_currency = $1, total_pay = $2 WHERE id = $3', [payCurrency, totalPay, id]);
    return res.status(200).json({ id, payCurrency, totalPay });
  }

  if (first === 'delete' && second && req.method === 'DELETE') {
    if (!/^\d+$/.test(second)) return res.status(400).json({ error: 'id must be a number' });
    const result = await pool.query(
      `DELETE FROM quotations WHERE id = $1 AND ($2::text IS NULL OR lower(btrim(order_place)) = $2)`,
      [second, scope]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Quotation not found' });
    return res.status(200).json({ deleted: true });
  }

  return res.status(404).json({ error: 'Not found' });
};
