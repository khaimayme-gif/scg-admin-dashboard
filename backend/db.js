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
});

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS price_quotes (
      id SERIAL PRIMARY KEY,
      items_json TEXT NOT NULL,
      markup_percent REAL NOT NULL,
      delivery_fee REAL NOT NULL,
      total REAL NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS qr_codes (
      id SERIAL PRIMARY KEY,
      url TEXT NOT NULL,
      label TEXT,
      theme TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS japan_quotes (
      id SERIAL PRIMARY KEY,
      gift_cost REAL NOT NULL,
      japan_fee REAL NOT NULL,
      thailand_fee REAL NOT NULL,
      total REAL NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

module.exports = { pool, initSchema };