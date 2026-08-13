const { pool, ensureSchema } = require('./db');

// Failed sign-ins are counted per client IP in Postgres rather than in memory, because each
// warm function instance has its own memory and Vercel runs however many it likes.
const WINDOW_SECONDS = 15 * 60;
const MAX_FAILURES = 10;

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

async function isLockedOut(ip) {
  await ensureSchema();
  const result = await pool.query(
    `SELECT COUNT(*)::int AS failures FROM login_attempts
     WHERE ip = $1 AND attempted_at > NOW() - make_interval(secs => $2)`,
    [ip, WINDOW_SECONDS]
  );
  return result.rows[0].failures >= MAX_FAILURES;
}

async function recordFailure(ip) {
  await ensureSchema();
  await pool.query('INSERT INTO login_attempts (ip) VALUES ($1)', [ip]);
  await pool.query(
    'DELETE FROM login_attempts WHERE attempted_at < NOW() - make_interval(secs => $1)',
    [WINDOW_SECONDS]
  );
}

async function clearFailures(ip) {
  await ensureSchema();
  await pool.query('DELETE FROM login_attempts WHERE ip = $1', [ip]);
}

module.exports = { WINDOW_SECONDS, MAX_FAILURES, clientIp, isLockedOut, recordFailure, clearFailures };
