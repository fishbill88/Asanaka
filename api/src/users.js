import { hashPassword } from './passwords.js';

export const publicUser = (u) => u && ({ id: u.id, username: u.username, displayName: u.display_name, role: u.role, avatarHue: u.avatar_hue });

const hueFor = (username) => [...username].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

// Creates the user or changes their password (and, when given, display name and role).
// Changing a password signs that user out everywhere.
export async function setUser(db, { username, password, displayName, role }) {
  const name = String(username || '').trim();
  if (!/^[A-Za-z0-9._-]{2,40}$/.test(name)) throw new Error('A username is 2 to 40 letters, digits, dots, dashes or underscores.');
  if (typeof password !== 'string' || password.length < 6) throw new Error('A password needs at least 6 characters.');
  if (role && !['admin', 'member'].includes(role)) throw new Error('Role is admin or member.');
  const hash = await hashPassword(password);
  return db.tx(async (t) => {
    const found = (await t.query('SELECT * FROM users WHERE lower(username) = lower($1)', [name])).rows[0];
    if (found) {
      const row = (await t.query(
        `UPDATE users SET password_hash = $2, display_name = COALESCE($3, display_name), role = COALESCE($4, role), updated_at = now()
         WHERE id = $1 RETURNING *`, [found.id, hash, displayName || null, role || null])).rows[0];
      await t.query('DELETE FROM sessions WHERE user_id = $1', [found.id]);
      return { user: row, created: false };
    }
    const row = (await t.query(
      `INSERT INTO users (username, display_name, password_hash, role, avatar_hue) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, displayName || name, hash, role || 'member', hueFor(name.toLowerCase())])).rows[0];
    return { user: row, created: true };
  });
}
