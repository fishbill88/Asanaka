import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestApp } from './helpers.js';

const t = await makeTestApp();
let token, task;
const call = (method, url, body) => t.call(method, url, { token, body });
const upload = (taskId, name, bytes, type) => t.call('POST', `/api/tasks/${taskId}/attachments?name=${encodeURIComponent(name)}${type ? `&type=${encodeURIComponent(type)}` : ''}`,
  { token, body: bytes, headers: { 'content-type': 'application/octet-stream' } });
const download = (id, auth = token) => t.app.inject({ method: 'GET', url: `/api/attachments/${id}`, headers: auth ? { authorization: `Bearer ${auth}` } : {} });

// A real 1×1 PNG.
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201d5d5a30c0000000049454e44ae426082', 'hex');

before(async () => {
  token = await t.login();
  const project = (await call('GET', '/api/projects')).body.projects[0];
  const board = (await call('GET', `/api/projects/${project.id}/board`)).body;
  task = (await call('POST', `/api/sections/${board.sections[0].id}/tasks`, { title: 'Has files' })).body.task;
});
after(() => t.close());

test('an image uploads, lists on its task, counts on the card and downloads byte for byte', async () => {
  const res = await upload(task.id, 'screenshot.png', PNG, 'image/png');
  assert.equal(res.status, 201);
  const a = res.body.attachment;
  assert.equal(a.filename, 'screenshot.png');
  assert.equal(a.contentType, 'image/png');
  assert.equal(a.size, PNG.length);

  const detail = (await call('GET', `/api/tasks/${task.id}`)).body;
  assert.deepEqual(detail.attachments.map((x) => x.id), [a.id]);
  assert.equal(detail.task.attachmentCount, 1);
  assert.ok(detail.activity.some((x) => x.kind === 'attached' && x.data.name === 'screenshot.png'));

  const got = await download(a.id);
  assert.equal(got.statusCode, 200);
  assert.deepEqual(got.rawPayload, PNG);
  assert.equal(got.headers['content-type'], 'image/png');
  assert.match(got.headers['content-disposition'], /^attachment; filename="screenshot.png"/);
  assert.match(got.headers['content-security-policy'], /sandbox/);
  assert.match(got.headers['cache-control'], /private/);
});

test('a file that looks like JSON is stored as bytes, not parsed', async () => {
  const body = Buffer.from('{"not":"parsed"}');
  const a = (await upload(task.id, 'data.json', body, 'application/json')).body.attachment;
  assert.deepEqual((await download(a.id)).rawPayload, body);
});

test('names lose path parts and control characters; unicode names survive', async () => {
  const a = (await upload(task.id, '../../etc/pass\u0007wd', Buffer.from('x'))).body.attachment;
  assert.equal(a.filename, '....etcpasswd');
  assert.equal(a.contentType, 'application/octet-stream');
  const b = (await upload(task.id, 'Larawan ñ.png', PNG, 'image/png')).body.attachment;
  assert.match((await download(b.id)).headers['content-disposition'], /filename\*=UTF-8''Larawan%20%C3%B1\.png/);
});

test('empty and over-10 MB files are refused with a reason', async () => {
  const empty = await upload(task.id, 'empty.txt', Buffer.alloc(0));
  assert.equal(empty.status, 400);
  const big = await upload(task.id, 'big.bin', Buffer.alloc(10 * 1024 * 1024 + 1));
  assert.equal(big.status, 413);
  assert.equal(big.body.error, 'too-large');
});

test('downloads need a sign-in; removed files are gone; deleted tasks take no uploads', async () => {
  const a = (await upload(task.id, 'gone.txt', Buffer.from('bye'))).body.attachment;
  assert.equal((await download(a.id, null)).statusCode, 401);
  assert.equal((await call('DELETE', `/api/attachments/${a.id}`)).status, 200);
  assert.equal((await download(a.id)).statusCode, 404);
  const detail = (await call('GET', `/api/tasks/${task.id}`)).body;
  assert.ok(detail.activity.some((x) => x.kind === 'attachment-removed' && x.data.name === 'gone.txt'));

  const doomed = (await call('POST', `/api/tasks/${task.id}/subtasks`, { title: 'doomed' })).body.task;
  await call('DELETE', `/api/tasks/${doomed.id}`);
  assert.equal((await upload(doomed.id, 'late.txt', Buffer.from('x'))).status, 404);
});
