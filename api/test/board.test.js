import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { makeTestApp } from './helpers.js';

const t = await makeTestApp();
let token, project, sec;
const call = (method, url, body) => t.call(method, url, { token, body });
const board = async () => (await call('GET', `/api/projects/${project.id}/board`)).body;
const titlesIn = (b, sectionId) => b.tasks.filter((x) => x.sectionId === sectionId).map((x) => x.title);
const add = async (sectionId, title, index) => (await call('POST', `/api/sections/${sectionId}/tasks`, { title, ...(index !== undefined ? { index } : {}) })).body.task;

before(async () => {
  token = await t.login();
  project = (await call('GET', '/api/projects')).body.projects[0];
  const b = await board();
  sec = Object.fromEntries(b.sections.map((s) => [s.name, s.id]));
});
after(() => t.close());

test('a fresh install has one project with To do, Doing, Review and Done', async () => {
  const b = await board();
  assert.equal(b.project.name, 'Asanaka launch');
  assert.deepEqual(b.sections.map((s) => s.name), ['To do', 'Doing', 'Review', 'Done']);
  assert.equal(b.project.doneSectionId, sec.Done);
  assert.ok(b.users.some((u) => u.username === 'ameer'));
});

test('new tasks go where they are asked: bottom by default, or at an index', async () => {
  await add(sec['To do'], 'B');
  await add(sec['To do'], 'C');
  await add(sec['To do'], 'A', 0);
  await add(sec['To do'], 'B and a half', 2);
  assert.deepEqual(titlesIn(await board(), sec['To do']), ['A', 'B', 'B and a half', 'C']);
});

test('dragging reorders within a section and across sections', async () => {
  const b = await board();
  const c = b.tasks.find((x) => x.title === 'C');
  await call('PATCH', `/api/tasks/${c.id}`, { index: 0 });
  assert.deepEqual(titlesIn(await board(), sec['To do']), ['C', 'A', 'B', 'B and a half']);
  const a = b.tasks.find((x) => x.title === 'A');
  const moved = (await call('PATCH', `/api/tasks/${a.id}`, { sectionId: sec.Doing, index: 0 })).body.task;
  assert.equal(moved.sectionId, sec.Doing);
  assert.deepEqual(titlesIn(await board(), sec['To do']), ['C', 'B', 'B and a half']);
  assert.deepEqual(titlesIn(await board(), sec.Doing), ['A']);
});

test('order holds after many drops into the same gap', async () => {
  const first = await add(sec.Review, 'first');
  const last = await add(sec.Review, 'last');
  for (let i = 1; i <= 60; i++) await add(sec.Review, `n${i}`, i);
  const titles = titlesIn(await board(), sec.Review);
  assert.equal(titles[0], 'first');
  assert.equal(titles.at(-1), 'last');
  assert.deepEqual(titles.slice(1, -1), Array.from({ length: 60 }, (_, i) => `n${i + 1}`));
  for (const x of (await board()).tasks.filter((y) => y.sectionId === sec.Review)) await call('DELETE', `/api/tasks/${x.id}`);
  assert.ok(first && last);
});

test('ticking moves a task to the top of Done; unticking puts it back where it was', async () => {
  const task = await add(sec.Doing, 'Ship it');
  let res = (await call('PATCH', `/api/tasks/${task.id}`, { completed: true })).body.task;
  assert.equal(res.completed, true);
  assert.equal(res.sectionId, sec.Done);
  assert.equal(res.previousSectionId, sec.Doing);
  assert.equal(titlesIn(await board(), sec.Done)[0], 'Ship it');
  res = (await call('PATCH', `/api/tasks/${task.id}`, { completed: false })).body.task;
  assert.equal(res.completed, false);
  assert.equal(res.sectionId, sec.Doing);
  assert.equal(titlesIn(await board(), sec.Doing)[0], 'Ship it');
});

test('dragging into Done ticks a task; dragging it out unticks it', async () => {
  const task = await add(sec['To do'], 'Drag me');
  let res = (await call('PATCH', `/api/tasks/${task.id}`, { sectionId: sec.Done, index: 1 })).body.task;
  assert.equal(res.completed, true);
  res = (await call('PATCH', `/api/tasks/${task.id}`, { sectionId: sec.Review, index: 0 })).body.task;
  assert.equal(res.completed, false);
  assert.equal(res.sectionId, sec.Review);
  const added = await add(sec.Done, 'Born finished');
  assert.equal(added.completed, true);
});

test('editing fields keeps dates exact and checks the assignee', async () => {
  const task = await add(sec['To do'], 'Edit me');
  const users = (await call('GET', '/api/users')).body.users;
  const ameer = users.find((u) => u.username === 'ameer');
  const res = (await call('PATCH', `/api/tasks/${task.id}`, { dueOn: '2026-12-31', priority: 'high', status: 'at_risk', assigneeId: ameer.id, notes: 'Notes here' })).body.task;
  assert.equal(res.dueOn, '2026-12-31');
  assert.equal(res.priority, 'high');
  assert.equal(res.assigneeId, ameer.id);
  const again = (await call('PATCH', `/api/tasks/${task.id}`, { title: 'Edited' })).body.task;
  assert.equal(again.dueOn, '2026-12-31', 'an unrelated edit leaves the date alone');
  const bad = await call('PATCH', `/api/tasks/${task.id}`, { assigneeId: '11111111-1111-4111-8111-111111111111' });
  assert.equal(bad.status, 400);
  assert.equal((await call('PATCH', `/api/tasks/${task.id}`, { priority: 'urgent' })).status, 400);
  assert.equal((await call('PATCH', `/api/tasks/${task.id}`, { dueOn: '31/12/2026' })).status, 400);
});

test('subtasks, comments and likes show up as counts on the card', async () => {
  const task = await add(sec['To do'], 'Parent');
  const s1 = (await call('POST', `/api/tasks/${task.id}/subtasks`, { title: 'one' })).body.task;
  await call('POST', `/api/tasks/${task.id}/subtasks`, { title: 'two' });
  await call('PATCH', `/api/tasks/${s1.id}`, { completed: true });
  await call('POST', `/api/tasks/${task.id}/comments`, { body: 'Looks good' });
  await call('PUT', `/api/tasks/${task.id}/like`);
  const card = (await board()).tasks.find((x) => x.id === task.id);
  assert.deepEqual([card.subtaskCount, card.subtaskDoneCount, card.commentCount, card.likeCount, card.liked], [2, 1, 1, 1, true]);
  const detail = (await call('GET', `/api/tasks/${task.id}`)).body;
  assert.deepEqual(detail.subtasks.map((s) => [s.title, s.completed]), [['one', true], ['two', false]]);
  assert.equal(detail.comments[0].body, 'Looks good');
  assert.ok(detail.activity.some((a) => a.kind === 'commented'));
  const sub = (await board()).tasks.find((x) => x.id === s1.id);
  assert.equal(sub, undefined, 'subtasks are not cards on the board');
  assert.equal((await call('POST', `/api/tasks/${s1.id}/subtasks`, { title: 'deeper' })).status, 400);
  await call('DELETE', `/api/tasks/${task.id}/like`);
  assert.equal((await board()).tasks.find((x) => x.id === task.id).likeCount, 0);
});

test('sections can be added, renamed, moved and deleted without losing tasks', async () => {
  const s = (await call('POST', `/api/projects/${project.id}/sections`, { name: 'Blocked', index: 1 })).body.section;
  let b = await board();
  assert.deepEqual(b.sections.map((x) => x.name), ['To do', 'Blocked', 'Doing', 'Review', 'Done']);
  await call('PATCH', `/api/sections/${s.id}`, { name: 'Waiting', index: 4 });
  b = await board();
  assert.deepEqual(b.sections.map((x) => x.name), ['To do', 'Doing', 'Review', 'Done', 'Waiting']);
  await add(s.id, 'Stuck task');
  const res = (await call('DELETE', `/api/sections/${s.id}`)).body;
  assert.equal(res.movedTasks, 1);
  b = await board();
  assert.equal(b.sections.length, 4);
  assert.ok(titlesIn(b, sec['To do']).includes('Stuck task'));
});

test('a project always keeps one section', async () => {
  const p = (await call('POST', '/api/projects', { name: 'Tiny' })).body.project;
  const b = (await call('GET', `/api/projects/${p.id}/board`)).body;
  for (const s of b.sections.slice(1)) assert.equal((await call('DELETE', `/api/sections/${s.id}`)).status, 200);
  const last = await call('DELETE', `/api/sections/${b.sections[0].id}`);
  assert.equal(last.status, 409);
  assert.equal(last.body.error, 'last-section');
  await call('DELETE', `/api/projects/${p.id}`);
  assert.equal((await call('GET', `/api/projects/${p.id}/board`)).status, 404);
});

test('deleted tasks leave the board', async () => {
  const task = await add(sec['To do'], 'Delete me');
  assert.equal((await call('DELETE', `/api/tasks/${task.id}`)).status, 200);
  assert.equal((await board()).tasks.some((x) => x.id === task.id), false);
  assert.equal((await call('GET', `/api/tasks/${task.id}`)).status, 404);
});
