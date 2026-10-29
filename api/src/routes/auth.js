import { dummyVerify, hashToken, newToken, verifyPassword } from '../passwords.js';
import { publicUser } from '../users.js';

// Sign-in, sign-out and the session check every other /api route uses. Registered on the root
// instance (not as an encapsulated plugin) so the session hook covers every route.
export default function authRoutes(app, { db, config }) {
  app.decorateRequest('user', null);

  // Every /api route except sign-in needs a valid session: Authorization: Bearer <token>.
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/') || req.method === 'OPTIONS') return;
    if (req.routeOptions?.config?.public) return;
    const token = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '')?.[1];
    if (!token) return reply.code(401).send({ error: 'signed-out', message: 'Sign in to continue.' });
    const row = (await db.query(
      `SELECT s.id AS session_id, s.last_seen_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now() AND NOT u.disabled`, [hashToken(token)])).rows[0];
    if (!row) return reply.code(401).send({ error: 'signed-out', message: 'Your session has ended. Sign in again.' });
    req.user = row;
    if (Date.now() - new Date(row.last_seen_at).getTime() > 5 * 60_000) {
      await db.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [row.session_id]);
    }
  });

  app.post('/api/auth/login', {
    config: { public: true },
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['username', 'password'],
        properties: { username: { type: 'string', minLength: 1, maxLength: 80 }, password: { type: 'string', minLength: 1, maxLength: 200 } },
      },
    },
  }, async (req, reply) => {
    const username = req.body.username.trim().toLowerCase();
    const ip = req.ip;

    const lock = (await db.query(
      `SELECT ceil(extract(epoch FROM locked_until - now()) / 60)::int AS minutes FROM login_failures
       WHERE ip = $1 AND username = $2 AND locked_until > now()`, [ip, username])).rows[0];
    if (lock) {
      reply.header('Retry-After', String(lock.minutes * 60));
      return reply.code(429).send({ error: 'locked', message: `Too many wrong passwords. Try again in ${lock.minutes} minute${lock.minutes === 1 ? '' : 's'}.` });
    }

    const user = (await db.query('SELECT * FROM users WHERE lower(username) = $1', [username])).rows[0];
    const ok = user ? await verifyPassword(req.body.password, user.password_hash) : await dummyVerify(req.body.password);
    if (!ok) {
      const row = (await db.query(
        `INSERT INTO login_failures (ip, username, failures, updated_at) VALUES ($1, $2, 1, now())
         ON CONFLICT (ip, username) DO UPDATE SET
           failures = CASE WHEN login_failures.locked_until IS NOT NULL THEN 1 ELSE login_failures.failures + 1 END,
           locked_until = NULL, updated_at = now()
         RETURNING failures`, [ip, username])).rows[0];
      if (row.failures >= config.maxFailures) {
        await db.query(`UPDATE login_failures SET locked_until = now() + make_interval(mins => $3) WHERE ip = $1 AND username = $2`, [ip, username, config.lockMinutes]);
        return reply.code(429).send({ error: 'locked', message: `Too many wrong passwords. Try again in ${config.lockMinutes} minutes.` });
      }
      return reply.code(401).send({ error: 'wrong-credentials', message: 'That username and password don’t match. Check both and try again.' });
    }
    if (user.disabled) return reply.code(403).send({ error: 'disabled', message: 'This account is turned off. Ask the admin to turn it back on.' });

    await db.query('DELETE FROM login_failures WHERE ip = $1 AND username = $2', [ip, username]);
    const token = newToken();
    const session = (await db.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at, ip, user_agent)
       VALUES ($1, $2, now() + make_interval(hours => $3), $4, $5) RETURNING expires_at`,
      [user.id, hashToken(token), config.sessionHours, ip, String(req.headers['user-agent'] || '').slice(0, 300)])).rows[0];
    return { token, expiresAt: session.expires_at, user: publicUser(user) };
  });

  app.post('/api/auth/logout', async (req) => {
    await db.query('DELETE FROM sessions WHERE id = $1', [req.user.session_id]);
    return { ok: true };
  });

  app.get('/api/me', async (req) => ({ user: publicUser(req.user) }));
}
