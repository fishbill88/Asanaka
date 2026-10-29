#!/usr/bin/env node
// End-to-end check against a running API: signs in, makes a throwaway project, adds a task, moves it,
// ticks and unticks it, comments, deletes it, archives the project, signs out and checks the token is dead.
//
//   node tools/smoke.mjs <origin>       stdin: {"username","password"} as JSON
//
// The account's password arrives on stdin so it never appears in a command line.
const origin = (process.argv[2] || '').replace(/\/+$/, '');
if (!origin) { console.error('usage: node tools/smoke.mjs <origin>   (credentials as JSON on stdin)'); process.exit(2); }
let input = '';
for await (const c of process.stdin) input += c;
const { username, password } = JSON.parse(input);

let token = '';
let step = 0;
async function call(method, path, body, expect = 200) {
  const res = await fetch(origin + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (res.status !== expect) throw new Error(`${method} ${path}: expected ${expect}, got ${res.status} ${JSON.stringify(data)}`);
  return data;
}
const ok = (label) => console.log(`  ok ${String(++step).padStart(2)}  ${label}`);
function check(cond, label) { if (!cond) throw new Error('failed: ' + label); ok(label); }

let projectId;
try {
  await call('GET', '/healthz'); ok('health check');
  token = (await call('POST', '/api/auth/login', { username, password })).token; ok('signed in');
  const me = (await call('GET', '/api/me')).user; check(me.username.toLowerCase() === username.toLowerCase(), `signed in as ${me.username}`);
  projectId = (await call('POST', '/api/projects', { name: `Smoke test ${new Date().toISOString()}` }, 201)).project.id; ok('project created');
  let board = await call('GET', `/api/projects/${projectId}/board`);
  check(board.sections.map((s) => s.name).join() === 'To do,Doing,Review,Done', 'four default sections');
  const [todo, doing, , done] = board.sections;
  const task = (await call('POST', `/api/sections/${todo.id}/tasks`, { title: 'Smoke test task' }, 201)).task; ok('task added');
  let t = (await call('PATCH', `/api/tasks/${task.id}`, { sectionId: doing.id, index: 0 })).task; check(t.sectionId === doing.id, 'moved to Doing');
  t = (await call('PATCH', `/api/tasks/${task.id}`, { completed: true })).task; check(t.completed && t.sectionId === done.id, 'ticked, and it moved to Done');
  t = (await call('PATCH', `/api/tasks/${task.id}`, { completed: false })).task; check(!t.completed && t.sectionId === doing.id, 'unticked, and it went back to Doing');
  await call('POST', `/api/tasks/${task.id}/comments`, { body: 'Smoke test comment' }, 201);
  t = (await call('GET', `/api/tasks/${task.id}`)); check(t.comments.length === 1 && t.activity.length >= 4, 'comment and activity recorded');
  await call('DELETE', `/api/tasks/${task.id}`); ok('task deleted');
  board = await call('GET', `/api/projects/${projectId}/board`); check(board.tasks.length === 0, 'board empty again');
  await call('DELETE', `/api/projects/${projectId}`); projectId = null; ok('project archived');
  await call('POST', '/api/auth/logout'); ok('signed out');
  await call('GET', '/api/me', undefined, 401); ok('old token refused');
  console.log(`\n  smoke test passed against ${origin}`);
} catch (err) {
  console.error(`\n  [x] ${err.message}`);
  if (projectId && token) await call('DELETE', `/api/projects/${projectId}`).catch(() => {});
  process.exit(1);
}
