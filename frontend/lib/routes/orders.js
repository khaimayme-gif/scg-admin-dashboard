const { requireAuth } = require('../auth');
const { pool, ensureSchema } = require('../db');

const STATUSES = ['pending', 'paid', 'in_progress', 'delivered', 'cancelled'];
const CURRENCIES = ['THB', 'JPY', 'MMK'];
const CHANNELS = ['tiktok', 'facebook'];

const ORDER_COLUMNS = `id, order_no, quotation_id, customer_name, country, channel,
  to_char(order_date, 'YYYY-MM-DD') AS order_date, status, currency, selling_price, cost, revenue,
  items_json, notes, recipient, to_char(delivery_date, 'YYYY-MM-DD') AS delivery_date,
  delivery_address, delivery_note`;

const parse = (row) => ({ ...row, items: JSON.parse(row.items_json) });

const isIsoDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const cleanText = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

// YYYYMMDD for "today" in Bangkok, regardless of the server's own timezone.
const todayPrefix = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date())
    .replace(/-/g, '');

// "SCG-20260929-001", "SCG-20260929-002", ... Same scheme as quotation numbers: an advisory
// lock on the day's prefix stops two simultaneous saves from taking the same number.
const nextOrderNo = async (client) => {
  const prefix = `SCG-${todayPrefix()}`;
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [prefix]);
  const { rows } = await client.query(
    `SELECT order_no FROM orders WHERE order_no LIKE $1 ORDER BY order_no DESC LIMIT 1`,
    [`${prefix}-%`]
  );
  const last = rows[0] ? Number(rows[0].order_no.split('-')[2]) : 0;
  return `${prefix}-${String(last + 1).padStart(3, '0')}`;
};

// Settings store: 1 THB = rateThbToJpy JPY, and 1 THB = rateThbToMmk MMK.
function toThb(amount, currency, rates) {
  if (currency === 'THB') return amount;
  if (currency === 'JPY') return rates.thbToJpy ? amount / rates.thbToJpy : null;
  if (currency === 'MMK') return rates.thbToMmk ? amount / rates.thbToMmk : null;
  return null;
}

module.exports = async (req, res, [first, second]) => {
  if (!requireAuth(req, res)) return;
  await ensureSchema();

  if (!first && req.method === 'GET') {
    const result = await pool.query(
      `SELECT ${ORDER_COLUMNS} FROM orders ORDER BY order_date DESC, id DESC`
    );
    return res.status(200).json(result.rows.map(parse));
  }

  if (first === 'stats' && req.method === 'GET') {
    const [ordersResult, settingsResult] = await Promise.all([
      pool.query(
        `SELECT status, currency, selling_price, cost, revenue,
                to_char(order_date, 'YYYY-MM') AS month
         FROM orders`
      ),
      pool.query('SELECT * FROM settings WHERE id = 1'),
    ]);
    const s = settingsResult.rows[0] || {};
    const rates = { thbToJpy: s.rate_thb_to_jpy, thbToMmk: s.rate_thb_to_mmk };

    let sellingThb = 0;
    let costThb = 0;
    let revenueThb = 0;
    let orderCount = 0;
    let cancelledCount = 0;
    let unconverted = 0;
    const byMonth = {}; // 'YYYY-MM' -> totals for that month, in THB

    for (const row of ordersResult.rows) {
      const m = (byMonth[row.month] = byMonth[row.month] || {
        month: row.month, orderCount: 0, cancelledCount: 0, sellingThb: 0, costThb: 0, revenueThb: 0,
      });
      if (row.status === 'cancelled') {
        cancelledCount += 1;
        m.cancelledCount += 1;
        continue;
      }
      orderCount += 1;
      m.orderCount += 1;
      const sell = toThb(Number(row.selling_price), row.currency, rates);
      const cst = toThb(Number(row.cost), row.currency, rates);
      const rev = toThb(Number(row.revenue), row.currency, rates);
      if (sell === null || cst === null || rev === null) {
        unconverted += 1;
        continue;
      }
      sellingThb += sell;
      costThb += cst;
      revenueThb += rev;
      m.sellingThb += sell;
      m.costThb += cst;
      m.revenueThb += rev;
    }

    const monthly = Object.values(byMonth)
      .sort((a, b) => b.month.localeCompare(a.month))
      .map((m) => ({
        ...m,
        sellingThb: Math.round(m.sellingThb),
        costThb: Math.round(m.costThb),
        revenueThb: Math.round(m.revenueThb),
      }));

    return res.status(200).json({
      orderCount,
      cancelledCount,
      sellingThb: Math.round(sellingThb),
      costThb: Math.round(costThb),
      revenueThb: Math.round(revenueThb),
      monthly, // one entry per month that has orders, newest first
      unconverted, // orders skipped because the exchange rate is missing in Settings
    });
  }

  if (first === 'save' && req.method === 'POST') {
    const {
      id, customerName, country, channel, orderDate, status, currency, sellingPrice, items, notes,
      recipient, deliveryDate, deliveryAddress, deliveryNote, quotationId,
    } = req.body || {};
    if (!customerName || !country) {
      return res.status(400).json({ error: 'customerName and country are required' });
    }
    if (!CHANNELS.includes(channel)) return res.status(400).json({ error: 'Invalid channel' });
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    if (!CURRENCIES.includes(currency)) return res.status(400).json({ error: 'Invalid currency' });
    if (deliveryDate && !isIsoDate(deliveryDate)) {
      return res.status(400).json({ error: 'deliveryDate must be YYYY-MM-DD' });
    }

    // Cost and revenue are always calculated here, never trusted from the browser:
    //   cost    = sum of (item cost price x quantity)
    //   revenue = selling price (what the customer paid) - cost
    // Each item also carries its customer-facing selling price and free-text details (design,
    // wording on the cake, size...). Those only feed the order confirmation image.
    const cleanItems = (Array.isArray(items) ? items : [])
      .map((i) => ({
        name: String(i.name || '').trim(),
        quantity: Number(i.quantity) || 1,
        price: Number(i.price) || 0,
        sellingPrice: Number(i.sellingPrice) || 0,
        details: String(i.details || '').trim(),
      }))
      .filter((i) => i.name);
    const cost = cleanItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
    const selling = Number(sellingPrice || 0);
    const revenue = selling - cost;

    const values = [
      customerName.trim(),
      country.trim(),
      channel,
      orderDate || new Date().toISOString().slice(0, 10),
      status,
      currency,
      selling,
      cost,
      revenue,
      JSON.stringify(cleanItems),
      notes || null,
      cleanText(recipient),
      deliveryDate || null,
      cleanText(deliveryAddress),
      cleanText(deliveryNote),
    ];

    if (id) {
      // order_no and quotation_id are fixed when the order is created and never change.
      const result = await pool.query(
        `UPDATE orders SET customer_name = $1, country = $2, channel = $3, order_date = $4, status = $5,
           currency = $6, selling_price = $7, cost = $8, revenue = $9, items_json = $10, notes = $11,
           recipient = $12, delivery_date = $13, delivery_address = $14, delivery_note = $15,
           updated_at = NOW()
         WHERE id = $16
         RETURNING ${ORDER_COLUMNS}`,
        [...values, id]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'Order not found' });
      return res.status(200).json(parse(result.rows[0]));
    }

    let linkedQuotation = null;
    if (quotationId !== undefined && quotationId !== null) {
      linkedQuotation = Number(quotationId);
      if (!Number.isInteger(linkedQuotation)) {
        return res.status(400).json({ error: 'quotationId must be a number' });
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (linkedQuotation !== null) {
        // One quotation becomes at most one order, so clicking "Make Order" twice cannot
        // double-count the sale. The unique index backs this up.
        const existing = await client.query(
          'SELECT id, order_no FROM orders WHERE quotation_id = $1', [linkedQuotation]
        );
        if (existing.rows.length > 0) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            error: `This quotation is already order ${existing.rows[0].order_no}.`,
            orderId: existing.rows[0].id,
          });
        }
      }
      const orderNo = await nextOrderNo(client);
      const result = await client.query(
        `INSERT INTO orders (customer_name, country, channel, order_date, status, currency,
                             selling_price, cost, revenue, items_json, notes,
                             recipient, delivery_date, delivery_address, delivery_note,
                             order_no, quotation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         RETURNING ${ORDER_COLUMNS}`,
        [...values, orderNo, linkedQuotation]
      );
      await client.query('COMMIT');
      return res.status(200).json(parse(result.rows[0]));
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  if (first === 'delete' && second && req.method === 'DELETE') {
    if (!/^\d+$/.test(second)) return res.status(400).json({ error: 'id must be a number' });
    await pool.query('DELETE FROM orders WHERE id = $1', [second]);
    return res.status(200).json({ deleted: true });
  }

  return res.status(404).json({ error: 'Not found' });
};
