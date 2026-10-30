import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestApp, PASS, SITE } from './helpers.js';

// The live stream over a real socket: two "tabs" on one project, each hearing the other's changes and not its own.
const t = await makeTestApp();
let base, ameer, admin, project, sec;
const call = (token, method, url, body, client) => fetch(base + url, {
  method,
  headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}), ...(client ? { 'x-asanaka-client': client } : {}) },
  body: body ? JSON.stringify(body) : undefined,
}).then(async (r) => ({ status: r.status, body: await r.json() }));

// Opens a stream and collects its events; `next(pred)` waits for one that matches.
async function listen(token, client) {
  const ac = new AbortController();
  const res = await fetch(`${base}/api/projects/${project.id}/events?client=${client}`, { headers: { authorization: `Bearer ${token}`, origin: SITE }, signal: ac.signal });
  const events = [];
  const waiters = [];
  (async () => {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
          if (!data) continue;
          const ev = JSON.parse(data);
          events.push(ev);
          for (const w of [...waiters]) if (w.pred(ev)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(ev); }
        }
      }
    } catch { /* aborted */ }
  })();
  const next = (pred, ms = 2000) => {
    const found = events.find(pred);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const w = { pred, resolve };
      waiters.push(w);
      setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) { waiters.splice(i, 1); reject(new Error('no matching event')); } }, ms);
    });
  };
  return { res, events, next, close: () => ac.abort() };
}

before(async () => {
  await t.app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${t.app.server.address().port}`;
  ameer = await t.login();
  admin = await t.login('admin', PASS.admin);
  project = (await call(ameer, 'GET', '/api/projects')).body.projects[0];
  sec = Object.fromEntries((await call(ameer, 'GET', `/api/projects/${project.id}/board`)).body.sections.map((s) => [s.name, s.id]));
});
// fetch keeps a socket from the aborted streams that the server never sees as idle; drop the rest at once.
after(async () => {
  const closing = t.close();
  t.app.server.closeAllConnections();
  await closing;
});

test('a stream needs a session and a live project, and says hello', async () => {
  assert.equal((await fetch(`${base}/api/projects/${project.id}/events`)).status, 401);
  assert.equal((await call(ameer, 'GET', '/api/projects/11111111-1111-4111-8111-111111111111/events')).status, 404);
  const a = await listen(ameer, 'tab-aaaaaaaa');
  assert.equal(a.res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  assert.equal(a.res.headers.get('access-control-allow-origin'), SITE);
  assert.ok(await a.next((e) => e.type === 'hello'));
  a.close();
});

test('each tab hears the other tab’s changes, never its own', async () => {
  const a = await listen(ameer, 'tab-aaaaaaaa');
  const b = await listen(admin, 'tab-bbbbbbbb');
  await a.next((e) => e.type === 'hello');
  await b.next((e) => e.type === 'hello');

  const made = (await call(admin, 'POST', `/api/sections/${sec['To do']}/tasks`, { title: 'Live one' }, 'tab-bbbbbbbb')).body.task;
  const seen = await a.next((e) => e.type === 'task' && e.task.id === made.id);
  assert.equal(seen.task.title, 'Live one');
  assert.equal(seen.actorId, (await call(admin, 'GET', '/api/me')).body.user.id, 'it says who did it');
  assert.equal('liked' in seen.task, false, 'no one’s own like state goes out');

  await call(ameer, 'PATCH', `/api/tasks/${made.id}`, { sectionId: sec.Doing, index: 0 }, 'tab-aaaaaaaa');
  const moved = await b.next((e) => e.type === 'task' && e.task.id === made.id && e.task.sectionId === sec.Doing);
  assert.ok(moved.task.position);

  await call(ameer, 'PUT', `/api/tasks/${made.id}/like`, undefined, 'tab-aaaaaaaa');
  const liked = await b.next((e) => e.type === 'task' && e.task.id === made.id && e.task.likeCount === 1);
  assert.equal(liked.task.likerIds.length, 1);

  await call(admin, 'POST', `/api/tasks/${made.id}/comments`, { body: 'Seen it' }, 'tab-bbbbbbbb');
  await a.next((e) => e.type === 'task' && e.task.id === made.id && e.task.commentCount === 1);

  await call(admin, 'POST', `/api/projects/${project.id}/sections`, { name: 'Later' }, 'tab-bbbbbbbb');
  await a.next((e) => e.type === 'board');

  await call(admin, 'DELETE', `/api/tasks/${made.id}`, undefined, 'tab-bbbbbbbb');
  await a.next((e) => e.type === 'task-removed' && e.id === made.id);

  // b made the task, the comment, the section and the delete: none of those came back to b.
  assert.equal(b.events.some((e) => e.type === 'task' && e.task.commentCount === 1), false);
  assert.equal(b.events.some((e) => e.type === 'board' || e.type === 'task-removed'), false);
  assert.equal(b.events.some((e) => e.type === 'task' && e.task.title === 'Live one' && e.task.sectionId === sec['To do']), false);
  a.close();
  b.close();
});

test('a change without a tab name goes to every stream', async () => {
  const a = await listen(ameer, 'tab-cccccccc');
  await a.next((e) => e.type === 'hello');
  const made = (await call(ameer, 'POST', `/api/sections/${sec['To do']}/tasks`, { title: 'From a script' })).body.task;
  await a.next((e) => e.type === 'task' && e.task.id === made.id);
  a.close();
});
