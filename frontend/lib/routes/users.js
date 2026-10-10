// User accounts: who can sign in and with which role. Managed by the super admin in Settings;
// everyone can change their own password.
const { requireAuth, requireSuper, forgetUser, ROLES } = require('../auth');
const { pool, ensureSchema } = require('../db');
const { hashPassword, verifyPassword } = require('../passwords');

const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 100;

const passwordError = (pw) =>
  typeof pw !== 'string' || pw.length < MIN_PASSWORD || pw.length > MAX_PASSWORD
    ? `Password must be ${MIN_PASSWORD} to ${MAX_PASSWORD} characters`
    : null;

const otherSuperadmins = async (exceptId) =>
  (await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE role = 'superadmin' AND id <> $1", [exceptId])).rows[0].n;

module.exports = async (req, res, [first, second]) => {
  // Change my own password (any signed-in account, not the emergency login).
  if (first === 'password' && req.method === 'POST') {
    const session = await requireAuth(req, res);
    if (!session) return;
    if (session.userId === null) return res.status(400).json({ error: 'The emergency login has no password to change here' });
    await ensureSchema();
    const { currentPassword, newPassword } = req.body || {};
    const problem = passwordError(newPassword);
    if (problem) return res.status(400).json({ error: problem });
    const row = (await pool.query('SELECT password_hash FROM users WHERE id = $1', [session.userId])).rows[0];
    if (!row || !(await verifyPassword(String(currentPassword || ''), row.password_hash))) {
      return res.status(400).json({ error: 'Your current password is not right' });
    }
    await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [await hashPassword(newPassword), session.userId]);
    return res.status(200).json({ ok: true });
  }

  const session = await requireSuper(req, res);
  if (!session) return;
  await ensureSchema();

  if (!first && req.method === 'GET') {
    const result = await pool.query('SELECT id, username, role, created_at FROM users ORDER BY id');
    return res.status(200).json(result.rows.map((u) => ({ ...u, is_me: u.id === session.userId })));
  }

  if (first === 'save' && req.method === 'POST') {
    const { id, role, password } = req.body || {};
    const username = String((req.body || {}).username || '').trim().toLowerCase();
    if (!USERNAME_PATTERN.test(username)) {
      return res.status(400).json({ error: 'Username must be 3 to 32 letters, numbers, dots, dashes or underscores' });
    }
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Choose a role' });

    try {
      if (id) {
        const current = (await pool.query('SELECT id, role FROM users WHERE id = $1', [id])).rows[0];
        if (!current) return res.status(404).json({ error: 'User not found' });
        if (current.id === session.userId && role !== current.role) {
          return res.status(400).json({ error: "You can't change your own role" });
        }
        if (current.role === 'superadmin' && role !== 'superadmin' && (await otherSuperadmins(current.id)) === 0) {
          return res.status(400).json({ error: 'There must be at least one super admin' });
        }
        if (password) {
          const problem = passwordError(password);
          if (problem) return res.status(400).json({ error: problem });
          await pool.query(
            'UPDATE users SET username = $1, role = $2, password_hash = $3, updated_at = NOW() WHERE id = $4',
            [username, role, await hashPassword(password), id]
          );
        } else {
          await pool.query('UPDATE users SET username = $1, role = $2, updated_at = NOW() WHERE id = $3', [username, role, id]);
        }
        forgetUser(id);
        return res.status(200).json({ id });
      }
      const problem = passwordError(password);
      if (problem) return res.status(400).json({ error: problem });
      const result = await pool.query(
        'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id',
        [username, await hashPassword(password), role]
      );
      return res.status(200).json({ id: result.rows[0].id });
    } catch (err) {
      if (err && err.code === '23505') return res.status(409).json({ error: `The username "${username}" is already taken` });
      throw err;
    }
  }

  if (first === 'delete' && second && req.method === 'DELETE') {
    if (!/^\d+$/.test(second)) return res.status(400).json({ error: 'id must be a number' });
    const id = Number(second);
    if (id === session.userId) return res.status(400).json({ error: "You can't delete your own account" });
    const target = (await pool.query('SELECT role FROM users WHERE id = $1', [id])).rows[0];
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.role === 'superadmin' && (await otherSuperadmins(id)) === 0) {
      return res.status(400).json({ error: 'There must be at least one super admin' });
    }
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
    forgetUser(id);
    return res.status(200).json({ deleted: true });
  }

  return res.status(404).json({ error: 'Not found' });
};
