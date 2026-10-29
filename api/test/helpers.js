import { PGlite } from '@electric-sql/pglite';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { fromPglite, migrate } from '../src/db.js';
import { randomPassword } from '../src/passwords.js';
import { setUser } from '../src/users.js';

export const SITE = 'https://fishbill88.github.io';

// Test passwords are made fresh on every run: none is written in the code, so none can leak or be reused.
export const PASS = { admin: randomPassword(), ameer: randomPassword(), other: () => randomPassword() };

// A fresh in-memory Postgres with the real migrations, two accounts and the app on top.
export async function makeTestApp() {
  const db = fromPglite(new PGlite());
  await migrate(db);
  const config = { ...loadConfig({}), allowedOrigins: [SITE] };
  await setUser(db, { username: 'admin', password: PASS.admin, displayName: 'Admin', role: 'admin' });
  await setUser(db, { username: 'ameer', password: PASS.ameer, displayName: 'Ameer Test' });
  const app = buildApp({ db, config });
  await app.ready();

  const call = async (method, url, { token, body, ip, headers } = {}) => {
    const res = await app.inject({
      method, url, payload: body, remoteAddress: ip || '10.0.0.1',
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    });
    return { status: res.statusCode, body: res.body ? res.json() : null, headers: res.headers };
  };
  const login = async (username = 'ameer', password = PASS.ameer, ip) => (await call('POST', '/api/auth/login', { body: { username, password }, ip })).body.token;
  const close = async () => { await app.close(); await db.close(); };
  return { app, db, call, login, close };
}
