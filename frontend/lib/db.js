const { Pool } = require('pg');

function cleanConnectionString(raw) {
  if (!raw) return raw;
  try {
    const url = new URL(raw);
    url.searchParams.delete('sslmode');
    url.searchParams.delete('supa');
    return url.toString();
  } catch {
    return raw;
  }
}

const pool = new Pool({
  connectionString: cleanConnectionString(process.env.POSTGRES_URL),
  ssl: process.env.POSTGRES_URL && process.env.POSTGRES_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
  // Every warm function instance holds its own pool and Vercel scales instances out freely,
  // so keep each one small to avoid exhausting Postgres connections.
  max: 3,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
});

let schemaReady = null;

function ensureSchema() {
  if (!schemaReady) {
    schemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS price_quotes (
        id SERIAL PRIMARY KEY,
        items_json TEXT NOT NULL,
        markup_percent REAL NOT NULL,
        delivery_fee REAL NOT NULL,
        total REAL NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `).then(() => pool.query(`
      CREATE TABLE IF NOT EXISTS qr_codes (
        id SERIAL PRIMARY KEY,
        url TEXT NOT NULL,
        label TEXT,
        theme TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `))
    .then(() => pool.query(`
      ALTER TABLE qr_codes
        ADD COLUMN IF NOT EXISTS card_theme TEXT,
        ADD COLUMN IF NOT EXISTS dot_color TEXT,
        ADD COLUMN IF NOT EXISTS show_handle BOOLEAN NOT NULL DEFAULT false
    `))
    .then(() => pool.query(`
      CREATE TABLE IF NOT EXISTS japan_quotes (
        id SERIAL PRIMARY KEY,
        gift_cost REAL NOT NULL,
        japan_fee REAL NOT NULL,
        thailand_fee REAL NOT NULL,
        total REAL NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)).then(() => pool.query(`
      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY DEFAULT 1,
        rate_thb_to_jpy REAL,
        rate_thb_to_mmk REAL,
        rate_mmk_to_jpy REAL,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT settings_single_row CHECK (id = 1)
      )
    `)).then(() => pool.query(`
      CREATE TABLE IF NOT EXISTS items (
        id SERIAL PRIMARY KEY,
        category TEXT NOT NULL,
        name TEXT NOT NULL,
        menu_price REAL NOT NULL,
        original_cost REAL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`))
    // Catalog fields that feed the public landing page menu (see routes/public.js).
    .then(() => pool.query(`
      ALTER TABLE items
        ADD COLUMN IF NOT EXISTS item_code TEXT,
        ADD COLUMN IF NOT EXISTS description TEXT,
        ADD COLUMN IF NOT EXISTS photo_data TEXT,
        ADD COLUMN IF NOT EXISTS photo_mime TEXT,
        ADD COLUMN IF NOT EXISTS published BOOLEAN NOT NULL DEFAULT TRUE
    `))
    .then(() => pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS items_item_code_unique
        ON items (item_code) WHERE item_code IS NOT NULL
    `))
    .then(() => pool.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        customer_name TEXT NOT NULL,
        country TEXT NOT NULL,
        order_date DATE NOT NULL DEFAULT CURRENT_DATE,
        status TEXT NOT NULL DEFAULT 'pending',
        currency TEXT NOT NULL DEFAULT 'THB',
        revenue REAL NOT NULL DEFAULT 0,
        cost REAL NOT NULL DEFAULT 0,
        items_json TEXT NOT NULL DEFAULT '[]',
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)).then(() => pool.query(`
      CREATE INDEX IF NOT EXISTS orders_order_date ON orders (order_date DESC)
    `))
    .then(() => pool.query(`
      ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS channel TEXT,
        ADD COLUMN IF NOT EXISTS selling_price REAL
    `)).then(() => pool.query(`
      UPDATE orders SET selling_price = revenue, revenue = revenue - cost
      WHERE selling_price IS NULL
    `)).then(() => pool.query(`
      ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS order_no TEXT,
        ADD COLUMN IF NOT EXISTS quotation_id INTEGER,
        ADD COLUMN IF NOT EXISTS recipient TEXT,
        ADD COLUMN IF NOT EXISTS recipient_phone TEXT,
        ADD COLUMN IF NOT EXISTS delivery_date DATE,
        ADD COLUMN IF NOT EXISTS delivery_address TEXT,
        ADD COLUMN IF NOT EXISTS delivery_note TEXT
    `)).then(() => pool.query(`
      -- Give orders made before order numbers existed an "SCG-YYYYMMDD-NNN" number, numbered
      -- by creation day in Bangkok. Deterministic, so two cold starts running it at once agree.
      UPDATE orders o SET order_no = n.no
      FROM (
        SELECT id,
               'SCG-' || to_char(COALESCE(created_at, NOW()) AT TIME ZONE 'Asia/Bangkok', 'YYYYMMDD') || '-' ||
               lpad(row_number() OVER (
                 PARTITION BY to_char(COALESCE(created_at, NOW()) AT TIME ZONE 'Asia/Bangkok', 'YYYYMMDD')
                 ORDER BY id
               )::text, 3, '0') AS no
        FROM orders WHERE order_no IS NULL
      ) n
      WHERE o.id = n.id
    `)).then(() => pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS orders_order_no ON orders (order_no) WHERE order_no IS NOT NULL
    `)).then(() => pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS orders_quotation_id ON orders (quotation_id) WHERE quotation_id IS NOT NULL
    `))
    .then(() => pool.query(`
      CREATE TABLE IF NOT EXISTS quotations (
        id SERIAL PRIMARY KEY,
        quote_no TEXT,
        customer_name TEXT NOT NULL,
        channel TEXT NOT NULL,
        quote_date DATE NOT NULL DEFAULT CURRENT_DATE,
        order_place TEXT NOT NULL,
        items_json TEXT NOT NULL DEFAULT '[]',
        total_thb REAL NOT NULL DEFAULT 0,
        original_thb REAL NOT NULL DEFAULT 0,
        revenue_thb REAL NOT NULL DEFAULT 0,
        total_mmk REAL,
        total_jpy REAL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)).then(() => pool.query(`
      CREATE INDEX IF NOT EXISTS quotations_created_at ON quotations (created_at DESC)
    `)).then(() => pool.query(`
      ALTER TABLE quotations ADD COLUMN IF NOT EXISTS quote_no TEXT
    `)).then(() => pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS quotations_quote_no ON quotations (quote_no)
      WHERE quote_no IS NOT NULL
    `))
    .then(() => pool.query(`
      CREATE TABLE IF NOT EXISTS expenses (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
        cost REAL NOT NULL DEFAULT 0,
        unit TEXT,
        currency TEXT NOT NULL DEFAULT 'THB',
        details TEXT,
        recurrence TEXT NOT NULL DEFAULT 'one_time',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)).then(() => pool.query(`
      CREATE INDEX IF NOT EXISTS expenses_expense_date ON expenses (expense_date DESC)
    `))
    .then(() => pool.query(`
      CREATE TABLE IF NOT EXISTS login_attempts (
        id SERIAL PRIMARY KEY,
        ip TEXT NOT NULL,
        attempted_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)).then(() => pool.query(`
      CREATE INDEX IF NOT EXISTS login_attempts_ip_time
        ON login_attempts (ip, attempted_at)
    `));
  }
  return schemaReady;
}

module.exports = { pool, ensureSchema };