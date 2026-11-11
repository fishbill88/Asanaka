import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestApp, PASS } from './helpers.js';

const t = await makeTestApp();
let admin, ameer, other, task;
const call = (token, method, url, body) => t.call(method, url, { token, body });
const comment = async (token, body) => (await call(token, 'POST', `/api/tasks/${task.id}/comments`, { body })).body.comment;
const commentsOf = async () => (await call(admin, 'GET', `/api/tasks/${task.id}`)).body;

before(async () => {
  admin = await t.login('admin', PASS.admin);
  ameer = await t.login();
  const made = (await call(admin, 'POST', '/api/admin/users', { username: 'joy', displayName: 'Joy' })).body;
  other = await t.login('joy', made.password);
  const project = (await call(ameer, 'POST', '/api/projects', { name: 'Comments' })).body.project;
  const board = (await call(ameer, 'GET', `/api/projects/${project.id}/board`)).body;
  task = (await call(ameer, 'POST', `/api/sections/${board.sections[0].id}/tasks`, { title: 'Talk about it' })).body.task;
});
after(() => t.close());

test('the author edits a comment; it says when, and nobody else can', async () => {
  const c = await comment(ameer, 'First thought');
  assert.equal(c.editedAt, null);
  const res = await call(ameer, 'PATCH', `/api/comments/${c.id}`, { body: '  Second thought  ' });
  assert.equal(res.status, 200);
  assert.equal(res.body.comment.body, 'Second thought');
  assert.ok(res.body.comment.editedAt, 'edited time set');
  assert.equal(res.body.comment.createdAt, c.createdAt, 'posted time kept');

  const joy = await call(other, 'PATCH', `/api/comments/${c.id}`, { body: 'Hijack' });
  assert.equal(joy.status, 403);
  assert.equal(joy.body.error, 'not-yours');
  assert.equal((await call(admin, 'PATCH', `/api/comments/${c.id}`, { body: 'Admin edit' })).status, 403, 'not even an admin rewrites your words');
  assert.equal((await call(ameer, 'PATCH', `/api/comments/${c.id}`, { body: '   ' })).status, 400);
  const d = await commentsOf();
  assert.equal(d.comments.find((x) => x.id === c.id).body, 'Second thought');
});

test('the author or an admin deletes a comment; others cannot', async () => {
  const mine = await comment(ameer, 'Delete me');
  const theirs = await comment(other, 'Joy was here');
  assert.equal((await call(other, 'DELETE', `/api/comments/${mine.id}`)).status, 403);
  assert.equal((await call(ameer, 'DELETE', `/api/comments/${mine.id}`)).status, 200);
  assert.equal((await call(ameer, 'DELETE', `/api/comments/${mine.id}`)).status, 404, 'gone');
  assert.equal((await call(admin, 'DELETE', `/api/comments/${theirs.id}`)).status, 200, 'an admin can delete anyone’s');
  const d = await commentsOf();
  assert.equal(d.comments.some((x) => x.id === mine.id || x.id === theirs.id), false);
  assert.equal(d.activity.some((a) => a.kind === 'commented' && [mine.id, theirs.id].includes(a.data.commentId)), false, 'its feed entry goes too');
  assert.equal(d.task.commentCount, d.comments.length, 'the card’s count follows');
});

test('a comment can carry a file, and deleting the comment keeps the file on the task', async () => {
  const up = await t.app.inject({
    method: 'POST', url: `/api/tasks/${task.id}/attachments?name=shot.png&type=image/png`,
    headers: { authorization: `Bearer ${ameer}`, 'content-type': 'application/octet-stream', origin: 'https://fishbill88.github.io' },
    payload: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]),
  });
  assert.equal(up.statusCode, 201);
  const a = up.json().attachment;
  const c = await comment(ameer, `Look: ![shot.png](attachment:${a.id})`);
  assert.equal((await call(ameer, 'DELETE', `/api/comments/${c.id}`)).status, 200);
  assert.ok((await commentsOf()).attachments.some((x) => x.id === a.id));
});

test('comments on a deleted task cannot be changed', async () => {
  const c = await comment(ameer, 'Soon gone');
  await call(ameer, 'DELETE', `/api/tasks/${task.id}`);
  assert.equal((await call(ameer, 'PATCH', `/api/comments/${c.id}`, { body: 'Too late' })).status, 404);
  assert.equal((await call(ameer, 'DELETE', `/api/comments/${c.id}`)).status, 404);
});
