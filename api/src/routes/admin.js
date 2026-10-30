import { HttpError, notFound } from '../errors.js';
import { hashPassword, randomPassword, verifyPassword } from '../passwords.js';
import { publicUser, setUser } from '../users.js';

// The People page: admins add accounts, rename them, change roles, turn them off and on, and reset passwords.
// A reset makes a fresh password here and returns it once; no route ever reads a password back.
// The account named "admin" keeps its password on the box (rotate-admin-password.bat), so neither a reset
// nor "change my password" touches it: the box's copy would go stale.

const uuid = { type: 'string', format: 'uuid' };
const idParams = { type: 'object', required: ['id'], properties: { id: uuid } };
const displayName = { type: 'string', minLength: 1, maxLength: 60 };
const ROTATED = 'admin';
const rotated = (u) => u.username.toLowerCase() === ROTATED;
const ROTATED_MESSAGE = 'The admin password rotates on the server. Run rotate-admin-password.bat on the PC to get a new one.';

const personOut = (r) => ({
  ...publicUser(r), disabled: r.disabled, createdAt: r.created_at, lastSeenAt: r.last_seen_at ?? null, sessions: r.sessions ?? 0,
});
const PEOPLE = `SELECT u.*, max(s.last_seen_at) AS last_seen_at, count(s.id) FILTER (WHERE s.expires_at > now())::int AS sessions
  FROM users u LEFT JOIN sessions s ON s.user_id = u.id`;
const person = async (db, id) => {
  const r = (await db.query(`${PEOPLE} WHERE u.id = $1 GROUP BY u.id`, [id])).rows[0];
  if (!r) throw notFound('person');
  return r;
};

export default function adminRoutes(app, { db }) {
  const adminOnly = async (req) => {
    if (req.user?.role !== 'admin') throw new HttpError(403, 'not-admin', 'Only an admin can manage people.');
  };

  app.get('/api/admin/users', { preHandler: adminOnly }, async () => ({
    users: (await db.query(`${PEOPLE} GROUP BY u.id ORDER BY u.disabled, lower(u.display_name)`)).rows.map(personOut),
  }));

  app.post('/api/admin/users', {
    preHandler: adminOnly,
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['username', 'displayName'],
        properties: { username: { type: 'string', pattern: '^[A-Za-z0-9._-]{2,40}$' }, displayName, role: { type: 'string', enum: ['admin', 'member'] } },
      },
    },
  }, async (req, reply) => {
    const b = req.body;
    if ((await db.query('SELECT 1 FROM users WHERE lower(username) = lower($1)', [b.username])).rows[0]) {
      throw new HttpError(409, 'username-taken', `There's already someone called ${b.username}. Pick another username.`);
    }
    const password = randomPassword(16);
    const { user } = await setUser(db, { username: b.username, password, displayName: b.displayName.trim(), role: b.role ?? 'member' });
    return reply.code(201).send({ user: personOut(await person(db, user.id)), password });
  });

  app.patch('/api/admin/users/:id', {
    preHandler: adminOnly,
    schema: {
      params: idParams,
      body: {
        type: 'object', additionalProperties: false, minProperties: 1,
        properties: { displayName, role: { type: 'string', enum: ['admin', 'member'] }, disabled: { type: 'boolean' } },
      },
    },
  }, async (req) => {
    const u = await person(db, req.params.id);
    const b = req.body;
    const self = u.id === req.user.id;
    if ((b.role === 'member' || b.disabled === true) && (self || rotated(u))) {
      throw new HttpError(409, 'keep-admin', self
        ? 'You can’t turn off your own account or take away your own admin role. Ask another admin.'
        : 'The admin account stays an admin and stays on: it’s the one whose password rotates on the server.');
    }
    await db.tx(async (t) => {
      await t.query(`UPDATE users SET display_name = COALESCE($2, display_name), role = COALESCE($3, role), disabled = COALESCE($4, disabled), updated_at = now() WHERE id = $1`,
        [u.id, b.displayName?.trim() ?? null, b.role ?? null, b.disabled ?? null]);
      if (b.disabled) await t.query('DELETE FROM sessions WHERE user_id = $1', [u.id]);
    });
    return { user: personOut(await person(db, u.id)) };
  });

  // A fresh password, shown once; every session of that person ends.
  app.post('/api/admin/users/:id/password', { preHandler: adminOnly, schema: { params: idParams } }, async (req) => {
    const u = await person(db, req.params.id);
    if (rotated(u)) throw new HttpError(409, 'rotated', ROTATED_MESSAGE);
    if (u.id === req.user.id) throw new HttpError(409, 'own-password', 'To change your own password, use Change password under your name.');
    const password = randomPassword(16);
    await setUser(db, { username: u.username, password });
    return { user: personOut(await person(db, u.id)), password };
  });

  // Anyone may change their own password, knowing the current one. Their other sessions end; this one stays.
  app.post('/api/me/password', {
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['current', 'next'],
        properties: { current: { type: 'string', minLength: 1, maxLength: 200 }, next: { type: 'string', minLength: 1, maxLength: 200 } },
      },
    },
  }, async (req) => {
    if (rotated(req.user)) throw new HttpError(409, 'rotated', ROTATED_MESSAGE);
    const { current, next } = req.body;
    if (!(await verifyPassword(current, req.user.password_hash))) {
      throw new HttpError(400, 'wrong-password', 'Your current password isn’t right. Check it and try again.');
    }
    if (next.length < 10) throw new HttpError(400, 'too-short', 'Make the new password at least 10 characters long.');
    if (next === current) throw new HttpError(400, 'same-password', 'The new password is the same as the current one.');
    const hash = await hashPassword(next);
    await db.tx(async (t) => {
      await t.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [req.user.id, hash]);
      await t.query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [req.user.id, req.user.session_id]);
    });
    return { ok: true };
  });
}
