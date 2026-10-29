#!/usr/bin/env node
// The API for working on the site from this PC: the real app and migrations on PGlite (Postgres in WASM),
// kept in .local/dev-db so the board survives restarts. Nothing here runs on the VPS or touches its data.
//
//   npm run dev:api      starts it on http://127.0.0.1:7361
//   npm run dev          the site; Vite passes /api through to this server
//
// The first start makes two local accounts with fresh random passwords and writes them to
// .local/dev-logins.json (gitignored). Delete .local/dev-db to start again from an empty board.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { fromPglite, migrate } from '../src/db.js';
import { randomPassword } from '../src/passwords.js';
import { setUser } from '../src/users.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const local = join(repo, '.local');
const loginsPath = join(local, 'dev-logins.json');
mkdirSync(local, { recursive: true });

const db = fromPglite(new PGlite(join(local, 'dev-db')));
await migrate(db);
const config = { ...loadConfig({}), port: Number(process.env.ASANAKA_DEV_PORT || 7361), host: '127.0.0.1' };
const app = buildApp({ db, config, logger: { level: 'warn' } });
await app.ready();

const fresh = !(await db.query('SELECT 1 FROM users LIMIT 1')).rows[0];
if (fresh || !existsSync(loginsPath)) {
  const logins = [
    { username: 'admin', password: randomPassword(), displayName: 'Biloy', role: 'admin' },
    { username: 'ameerperalta', password: randomPassword(), displayName: 'Ameer Peralta', role: 'member' },
  ];
  for (const u of logins) await setUser(db, u);
  writeFileSync(loginsPath, JSON.stringify(logins.map(({ username, password }) => ({ username, password })), null, 2) + '\n');
  if (fresh) await seed(logins);
}

// The sample board is the build's own to-do list, entered through the API so positions and activity are real.
async function seed(logins) {
  const call = async (method, url, body, token) => {
    const res = await app.inject({ method, url, payload: body, headers: token ? { authorization: `Bearer ${token}` } : {} });
    if (res.statusCode >= 400) throw new Error(`${method} ${url}: ${res.statusCode} ${res.body}`);
    return res.json();
  };
  const signIn = async (u) => (await call('POST', '/api/auth/login', { username: u.username, password: u.password })).token;
  const [admin, ameer] = await Promise.all(logins.map(signIn));
  const project = (await call('GET', '/api/projects', undefined, ameer)).projects[0];
  const board = await call('GET', `/api/projects/${project.id}/board`, undefined, ameer);
  const sec = Object.fromEntries(board.sections.map((s) => [s.name, s.id]));
  const who = Object.fromEntries(board.users.map((u) => [u.username, u.id]));
  // Local calendar dates: toISOString() would give yesterday's date in the early hours east of UTC.
  const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

  const tasks = [
    ['To do', 'Pick one of the three designs', { assigneeId: who.ameerperalta, dueOn: day(0), priority: 'high', notes: 'Open Chapters, Pin and Departures, then reply with a letter.' }, ['Open Chapters', 'Open Pin', 'Open Departures'], [[admin, 'All three are in the designs folder.']]],
    ['To do', 'Write the sign-in error messages', { assigneeId: who.admin, dueOn: day(4), priority: 'medium', notes: 'Say what went wrong and how to fix it. No apologies.' }],
    ['To do', 'Nightly database backup at 03:17', { assigneeId: who.admin, dueOn: day(6), priority: 'low' }, ['Dump with pg_dump -Fc', 'Keep the last 14']],
    ['To do', 'Keyboard moves for cards', { priority: 'medium', notes: 'Alt + arrow keys move a focused card between sections.' }],
    ['Doing', 'Move the board API onto the VPS', { assigneeId: who.ameerperalta, dueOn: day(1), priority: 'high', status: 'at_risk' }, ['Compose file', 'Dockerfile', 'Caddy site', 'Seed the two accounts'], [[ameer, 'Containers are up. Waiting on the Caddy restart.'], [admin, 'Do it after 22:00, the box is quiet then.']]],
    ['Doing', 'Cards make room while you drag', { assigneeId: who.ameerperalta, dueOn: day(-1), priority: 'medium' }, ['FLIP the siblings', 'Autoscroll near the edges']],
    ['Doing', 'Task pane slides in from the right', { assigneeId: who.admin, dueOn: day(2) }],
    ['Review', 'Rotate the admin password on request', { assigneeId: who.admin, dueOn: day(3), priority: 'high', status: 'on_track' }, [], [[admin, 'rotate-admin-password.bat works. The old password stops at once.']]],
    ['Review', 'Celebrate a finished task', { assigneeId: who.ameerperalta, dueOn: day(2), priority: 'low' }],
    ['Done', 'Seed the ameerperalta account', { assigneeId: who.admin, dueOn: day(-2) }],
    ['Done', 'Allow only fishbill88.github.io in CORS', { assigneeId: who.ameerperalta, dueOn: day(-3) }],
  ];
  for (const [section, title, fields, subtasks = [], comments = []] of tasks) {
    const { task } = await call('POST', `/api/sections/${sec[section]}/tasks`, { title, ...fields }, ameer);
    for (const [i, s] of subtasks.entries()) {
      const sub = (await call('POST', `/api/tasks/${task.id}/subtasks`, { title: s }, ameer)).task;
      if (i === 0) await call('PATCH', `/api/tasks/${sub.id}`, { completed: true }, ameer);
    }
    for (const [token, body] of comments) await call('POST', `/api/tasks/${task.id}/comments`, { body }, token);
  }
  for (const token of [admin, ameer]) await call('POST', '/api/auth/logout', undefined, token);
}

await app.listen({ port: config.port, host: config.host });
console.log(`Asanaka dev API on http://${config.host}:${config.port} (data in .local/dev-db; sign-ins in .local/dev-logins.json)`);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await app.close();
    await db.close();
    process.exit(0);
  });
}
