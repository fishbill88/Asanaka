import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestApp, PASS } from './helpers.js';

const t = await makeTestApp();
let admin, ameer, ids;
const call = (token, method, url, body) => t.call(method, url, { token, body });

before(async () => {
  admin = await t.login('admin', PASS.admin);
  ameer = await t.login();
  ids = Object.fromEntries((await call(admin, 'GET', '/api/admin/users')).body.users.map((u) => [u.username, u.id]));
});
after(() => t.close());

test('only an admin sees the People routes', async () => {
  assert.equal((await call(ameer, 'GET', '/api/admin/users')).status, 403);
  assert.equal((await call(ameer, 'POST', `/api/admin/users/${ids.admin}/password`)).status, 403);
  const list = (await call(admin, 'GET', '/api/admin/users')).body.users;
  assert.deepEqual(list.map((u) => u.username).sort(), ['admin', 'ameer']);
  assert.equal(list.some((u) => 'password_hash' in u || 'passwordHash' in u), false, 'no hash ever leaves');
  assert.ok(list.find((u) => u.username === 'ameer').sessions >= 1);
});

test('an admin adds a person, who can sign in with the password shown once', async () => {
  const res = await call(admin, 'POST', '/api/admin/users', { username: 'joy', displayName: 'Joy Cruz' });
  assert.equal(res.status, 201);
  assert.equal(res.body.user.role, 'member');
  assert.equal(res.body.password.length, 16);
  assert.ok(await t.login('joy', res.body.password));
  assert.equal((await call(admin, 'POST', '/api/admin/users', { username: 'JOY', displayName: 'Again' })).status, 409);
  assert.equal((await call(admin, 'POST', '/api/admin/users', { username: 'no spaces', displayName: 'X' })).status, 400);
  ids.joy = res.body.user.id;
});

test('a reset gives a new password and signs that person out everywhere', async () => {
  const joy = await t.login('joy', (await call(admin, 'POST', `/api/admin/users/${ids.joy}/password`)).body.password);
  const res = await call(admin, 'POST', `/api/admin/users/${ids.joy}/password`);
  assert.equal(res.status, 200);
  assert.equal((await call(joy, 'GET', '/api/me')).status, 401, 'the old session ended');
  assert.ok(await t.login('joy', res.body.password));
});

test('the rotated admin account and your own password are not reset here', async () => {
  const other = (await call(admin, 'POST', '/api/admin/users', { username: 'boss2', displayName: 'Second Admin', role: 'admin' })).body;
  const boss2 = await t.login('boss2', other.password);
  const r1 = await call(boss2, 'POST', `/api/admin/users/${ids.admin}/password`);
  assert.equal(r1.status, 409);
  assert.equal(r1.body.error, 'rotated');
  assert.equal((await call(admin, 'POST', `/api/admin/users/${ids.admin}/password`)).body.error, 'rotated');
  assert.equal((await call(boss2, 'POST', `/api/admin/users/${other.user.id}/password`)).body.error, 'own-password');
  assert.equal((await call(boss2, 'PATCH', `/api/admin/users/${ids.admin}`, { disabled: true })).status, 409, 'the admin account stays on');
  assert.equal((await call(boss2, 'PATCH', `/api/admin/users/${other.user.id}`, { role: 'member' })).status, 409, 'no demoting yourself');
});

test('renaming, roles, and turning an account off and on', async () => {
  let u = (await call(admin, 'PATCH', `/api/admin/users/${ids.joy}`, { displayName: '  Joy C.  ', role: 'admin' })).body.user;
  assert.deepEqual([u.displayName, u.role], ['Joy C.', 'admin']);
  const joyPass = (await call(admin, 'POST', `/api/admin/users/${ids.joy}/password`)).body.password;
  const joy = await t.login('joy', joyPass);
  u = (await call(admin, 'PATCH', `/api/admin/users/${ids.joy}`, { disabled: true, role: 'member' })).body.user;
  assert.equal(u.disabled, true);
  assert.equal((await call(joy, 'GET', '/api/me')).status, 401, 'turning off ends their sessions');
  assert.equal((await t.call('POST', '/api/auth/login', { body: { username: 'joy', password: joyPass } })).status, 403);
  assert.equal((await call(admin, 'GET', '/api/users')).body.users.some((x) => x.username === 'joy'), false, 'off accounts leave the assignee list');
  await call(admin, 'PATCH', `/api/admin/users/${ids.joy}`, { disabled: false });
  assert.ok(await t.login('joy', joyPass));
});

test('anyone changes their own password with the current one; other sessions end, this one stays', async () => {
  const other = await t.login();
  assert.equal((await call(ameer, 'POST', '/api/me/password', { current: 'wrong', next: 'a-much-longer-one' })).body.error, 'wrong-password');
  assert.equal((await call(ameer, 'POST', '/api/me/password', { current: PASS.ameer, next: 'short' })).body.error, 'too-short');
  assert.equal((await call(ameer, 'POST', '/api/me/password', { current: PASS.ameer, next: 'a-much-longer-one' })).status, 200);
  assert.equal((await call(ameer, 'GET', '/api/me')).status, 200, 'this session stays');
  assert.equal((await call(other, 'GET', '/api/me')).status, 401, 'the other one ended');
  assert.ok(await t.login('ameer', 'a-much-longer-one'));
  assert.equal((await call(admin, 'POST', '/api/me/password', { current: PASS.admin, next: 'a-much-longer-one' })).body.error, 'rotated');
});
