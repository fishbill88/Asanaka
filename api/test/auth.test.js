import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestApp, PASS } from './helpers.js';
import { setUser } from '../src/users.js';

const t = await makeTestApp();
after(() => t.close());
const login = (username, password, ip) => t.call('POST', '/api/auth/login', { body: { username, password }, ip });

test('signing in returns a token and the user, never the password hash', async () => {
  const res = await login('Ameer', PASS.ameer);
  assert.equal(res.status, 200);
  assert.ok(res.body.token.length >= 40);
  assert.equal(res.body.user.username, 'ameer');
  assert.equal(res.body.user.displayName, 'Ameer Test');
  assert.equal(JSON.stringify(res.body).includes('scrypt'), false);
  const me = await t.call('GET', '/api/me', { token: res.body.token });
  assert.equal(me.body.user.username, 'ameer');
});

test('a wrong password and an unknown user get the same answer', async () => {
  const guess = PASS.other();
  const wrong = await login('ameer', guess, '10.9.9.1');
  const unknown = await login('nobody', guess, '10.9.9.1');
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(wrong.body.message, unknown.body.message);
});

test('five wrong passwords lock that address and username, even for the right password', async () => {
  const ip = '10.1.1.1';
  for (let i = 1; i <= 4; i++) assert.equal((await login('admin', PASS.other(), ip)).status, 401);
  assert.equal((await login('admin', PASS.other(), ip)).status, 429);
  const right = await login('admin', PASS.admin, ip);
  assert.equal(right.status, 429);
  assert.match(right.body.message, /Try again in \d+ minutes?/);
  assert.ok(Number(right.headers['retry-after']) > 0);
  // Another address is not locked out by someone else's guesses.
  assert.equal((await login('admin', PASS.admin, '10.2.2.2')).status, 200);
});

test('a lock ends when its time is up', async () => {
  const ip = '10.3.3.3';
  for (let i = 0; i < 5; i++) await login('ameer', PASS.other(), ip);
  await t.db.query(`UPDATE login_failures SET locked_until = now() - interval '1 second' WHERE ip = $1`, [ip]);
  assert.equal((await login('ameer', PASS.ameer, ip)).status, 200);
});

test('routes need a session, and signing out ends it', async () => {
  assert.equal((await t.call('GET', '/api/projects')).status, 401);
  assert.equal((await t.call('GET', '/api/projects', { token: 'x'.repeat(43) })).status, 401);
  const token = await t.login();
  assert.equal((await t.call('GET', '/api/projects', { token })).status, 200);
  assert.equal((await t.call('POST', '/api/auth/logout', { token })).status, 200);
  assert.equal((await t.call('GET', '/api/projects', { token })).status, 401);
});

test('a new password signs the account out everywhere', async () => {
  const first = PASS.other(), second = PASS.other();
  await setUser(t.db, { username: 'temp', password: first });
  const token = await t.login('temp', first);
  assert.equal((await t.call('GET', '/api/me', { token })).status, 200);
  await setUser(t.db, { username: 'temp', password: second });
  assert.equal((await t.call('GET', '/api/me', { token })).status, 401);
  assert.equal((await login('temp', first)).status, 401);
  assert.ok(await t.login('temp', second));
});

test('a disabled account cannot sign in and its sessions stop working', async () => {
  const pass = PASS.other();
  await setUser(t.db, { username: 'gone', password: pass });
  const token = await t.login('gone', pass);
  await t.db.query(`UPDATE users SET disabled = true WHERE username = 'gone'`);
  assert.equal((await t.call('GET', '/api/me', { token })).status, 401);
  assert.equal((await login('gone', pass)).status, 403);
});

test('passwords with $ signs survive exactly', async () => {
  const base = PASS.other();
  const withDollars = base.slice(0, 4) + '$$' + base.slice(4);
  await setUser(t.db, { username: 'dollar', password: withDollars });
  assert.ok(await t.login('dollar', withDollars));
  assert.equal((await login('dollar', withDollars.replace('$$', '$'))).status, 401);
});
