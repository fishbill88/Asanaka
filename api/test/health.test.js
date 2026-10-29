import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestApp, SITE } from './helpers.js';

const t = await makeTestApp();
after(() => t.close());

test('GET /healthz answers ok once the database answers', async () => {
  const res = await t.call('GET', '/healthz');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});

test('an unknown route is a 404 with a readable message', async () => {
  const res = await t.call('GET', '/nope');
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'not-found');
});

test('only the site may call the API from a browser', async () => {
  const ok = await t.call('GET', '/healthz', { headers: { origin: SITE } });
  assert.equal(ok.headers['access-control-allow-origin'], SITE);
  const other = await t.call('GET', '/healthz', { headers: { origin: 'https://evil.example' } });
  assert.equal(other.headers['access-control-allow-origin'], undefined);
});

test('API answers are never cached and carry safety headers', async () => {
  const token = await t.login();
  const res = await t.call('GET', '/api/me', { token });
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
});
