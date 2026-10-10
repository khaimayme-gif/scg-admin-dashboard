// Password hashing for user accounts: scrypt from Node's own crypto, so there is nothing to install.
// A stored hash looks like "scrypt$N$r$p$salt$key" (salt and key in base64).
const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

// Always does the same amount of work, even for a malformed hash, so timing reveals nothing.
async function verifyPassword(password, stored) {
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    await scrypt(String(password), Buffer.alloc(16), KEY_LENGTH, { N, r: R, p: P });
    return false;
  }
  const [, n, r, p, salt, key] = parts;
  const expected = Buffer.from(key, 'base64');
  const actual = await scrypt(String(password), Buffer.from(salt, 'base64'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p),
  });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// A hash nobody has the password for, used to burn the same time when a username doesn't exist.
const DUMMY_HASH = `scrypt$${N}$${R}$${P}$${Buffer.alloc(16).toString('base64')}$${Buffer.alloc(KEY_LENGTH).toString('base64')}`;

module.exports = { hashPassword, verifyPassword, DUMMY_HASH };
