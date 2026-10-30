import { HttpError, notFound } from '../errors.js';
import { listAttachments } from './attachments.js';
import { keyAt } from '../positions.js';
import { publicUser } from '../users.js';

// Projects, sections, tasks, subtasks, comments and likes. Everyone signed in works in one shared workspace.

const uuid = { type: 'string', format: 'uuid' };
const idParams = { type: 'object', required: ['id'], properties: { id: uuid } };
const name = { type: 'string', minLength: 1, maxLength: 120 };
const index = { type: 'integer', minimum: 0, maximum: 100000 };
const nullable = (s) => ({ ...s, type: [s.type, 'null'] });
const PRIORITY = ['low', 'medium', 'high'];
const STATUS = ['on_track', 'at_risk', 'off_track'];

const TASK_COLS = `t.id, t.project_id, t.section_id, t.parent_id, t.title, t.notes, t.assignee_id, t.due_on::text AS due_on,
  t.priority, t.status, t.completed_at, t.previous_section_id, t.position, t.created_at, t.updated_at`;
const COUNT_COLS = `
  (SELECT count(*) FROM tasks s WHERE s.parent_id = t.id AND s.deleted_at IS NULL)::int AS subtask_count,
  (SELECT count(*) FROM tasks s WHERE s.parent_id = t.id AND s.deleted_at IS NULL AND s.completed_at IS NOT NULL)::int AS subtask_done_count,
  (SELECT count(*) FROM comments c WHERE c.task_id = t.id)::int AS comment_count,
  (SELECT count(*) FROM attachments a WHERE a.task_id = t.id)::int AS attachment_count,
  (SELECT count(*) FROM task_likes l WHERE l.task_id = t.id)::int AS like_count,
  ARRAY(SELECT l.user_id::text FROM task_likes l WHERE l.task_id = t.id ORDER BY l.user_id) AS liker_ids,
  EXISTS (SELECT 1 FROM task_likes l WHERE l.task_id = t.id AND l.user_id = $2) AS liked`;

const taskOut = (r) => ({
  id: r.id, projectId: r.project_id, sectionId: r.section_id, parentId: r.parent_id,
  title: r.title, notes: r.notes, assigneeId: r.assignee_id, dueOn: r.due_on,
  priority: r.priority, status: r.status, completed: !!r.completed_at, completedAt: r.completed_at,
  previousSectionId: r.previous_section_id ?? null, position: r.position, createdAt: r.created_at, updatedAt: r.updated_at,
  subtaskCount: r.subtask_count ?? 0, subtaskDoneCount: r.subtask_done_count ?? 0,
  commentCount: r.comment_count ?? 0, attachmentCount: r.attachment_count ?? 0, likeCount: r.like_count ?? 0, liked: !!r.liked,
  likerIds: r.liker_ids ?? [],
});
const sectionOut = (r) => ({ id: r.id, projectId: r.project_id, name: r.name, position: r.position });
const projectOut = (r) => ({ id: r.id, name: r.name, color: r.color, position: r.position, doneSectionId: r.done_section_id, createdAt: r.created_at });

// Ordered lists for keyAt(): the item being moved is left out, so `index` means "its new place".
const NONE = '00000000-0000-0000-0000-000000000000';
const sectionsOf = (q, projectId, skip = NONE) => async () => (await q.query('SELECT id, position FROM sections WHERE project_id = $1 AND id <> $2 ORDER BY position', [projectId, skip])).rows;
const tasksOf = (q, sectionId, skip = NONE) => async () => (await q.query('SELECT id, position FROM tasks WHERE section_id = $1 AND parent_id IS NULL AND deleted_at IS NULL AND id <> $2 ORDER BY position', [sectionId, skip])).rows;
const subtasksOf = (q, parentId, skip = NONE) => async () => (await q.query('SELECT id, position FROM tasks WHERE parent_id = $1 AND deleted_at IS NULL AND id <> $2 ORDER BY position', [parentId, skip])).rows;
const projectsList = (q, skip = NONE) => async () => (await q.query('SELECT id, position FROM projects WHERE archived_at IS NULL AND id <> $1 ORDER BY position', [skip])).rows;
const rename = (q, table) => (id, key) => q.query(`UPDATE ${table} SET position = $2 WHERE id = $1`, [id, key]);

async function loadProject(q, id, lock = false) {
  const p = (await q.query(`SELECT * FROM projects WHERE id = $1 AND archived_at IS NULL${lock ? ' FOR UPDATE' : ''}`, [id])).rows[0];
  if (!p) throw notFound('project');
  return p;
}
async function loadSection(q, id, lock = false) {
  const s = (await q.query(`SELECT sec.* FROM sections sec JOIN projects p ON p.id = sec.project_id
    WHERE sec.id = $1 AND p.archived_at IS NULL${lock ? ' FOR UPDATE OF sec' : ''}`, [id])).rows[0];
  if (!s) throw notFound('section');
  return s;
}
async function loadTask(q, id, lock = false) {
  // Dates are read as text: a Date object would shift by a day when written back from another time zone.
  const t = (await q.query(`SELECT id, project_id, section_id, parent_id, title, notes, assignee_id, due_on::text AS due_on, priority, status,
    completed_at, completed_by, previous_section_id, position FROM tasks WHERE id = $1 AND deleted_at IS NULL${lock ? ' FOR UPDATE' : ''}`, [id])).rows[0];
  if (!t) throw notFound('task');
  return t;
}
async function taskWithCounts(q, id, userId) {
  return taskOut((await q.query(`SELECT ${TASK_COLS}, ${COUNT_COLS} FROM tasks t WHERE t.id = $1`, [id, userId])).rows[0]);
}
// A task as everyone sees it, for live updates (no one's "liked").
export const readTask = (q, id) => taskWithCounts(q, id, NONE);
async function assertUser(q, id) {
  if (id && !(await q.query('SELECT 1 FROM users WHERE id = $1 AND NOT disabled', [id])).rows[0]) {
    throw new HttpError(400, 'unknown-user', 'That person isn’t on Asanaka. Pick someone from the list.');
  }
}
const log = (q, projectId, taskId, actorId, kind, data = {}) =>
  q.query('INSERT INTO activity (project_id, task_id, actor_id, kind, data) VALUES ($1, $2, $3, $4, $5)', [projectId, taskId, actorId, kind, JSON.stringify(data)]);

async function createProjectWithSections(q, { name: projectName, color, userId }) {
  const key = await keyAt(q, { list: projectsList(q), rename: rename(q, 'projects') });
  const p = (await q.query('INSERT INTO projects (name, color, position, created_by) VALUES ($1, $2, $3, $4) RETURNING *', [projectName, color || '#b0298f', key, userId])).rows[0];
  const ids = [];
  for (const [i, n] of ['To do', 'Doing', 'Review', 'Done'].entries()) {
    ids.push((await q.query('INSERT INTO sections (project_id, name, position) VALUES ($1, $2, $3) RETURNING id', [p.id, n, `a${i}`])).rows[0].id);
  }
  return (await q.query('UPDATE projects SET done_section_id = $2 WHERE id = $1 RETURNING *', [p.id, ids[3]])).rows[0];
}

export default function boardRoutes(app, { db, live }) {
  // ---- people
  app.get('/api/users', async () => ({ users: (await db.query('SELECT * FROM users WHERE NOT disabled ORDER BY display_name')).rows.map(publicUser) }));

  // ---- projects
  app.get('/api/projects', async () => ({
    projects: (await db.query('SELECT * FROM projects WHERE archived_at IS NULL ORDER BY position')).rows.map(projectOut),
  }));

  app.post('/api/projects', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['name'], properties: { name, color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' } } } },
  }, async (req, reply) => {
    const p = await db.tx((t) => createProjectWithSections(t, { name: req.body.name.trim(), color: req.body.color, userId: req.user.id }));
    return reply.code(201).send({ project: projectOut(p) });
  });

  app.patch('/api/projects/:id', {
    schema: {
      params: idParams,
      body: { type: 'object', additionalProperties: false, minProperties: 1, properties: { name, color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }, index, doneSectionId: nullable(uuid) } },
    },
  }, async (req) => db.tx(async (t) => {
    const p = await loadProject(t, req.params.id, true);
    const b = req.body;
    if (b.doneSectionId) {
      const s = await loadSection(t, b.doneSectionId);
      if (s.project_id !== p.id) throw new HttpError(400, 'wrong-project', 'That section belongs to another project.');
    }
    const position = b.index !== undefined ? await keyAt(t, { list: projectsList(t, p.id), rename: rename(t, 'projects'), index: b.index }) : p.position;
    const row = (await t.query(
      `UPDATE projects SET name = $2, color = $3, position = $4, done_section_id = $5 WHERE id = $1 RETURNING *`,
      [p.id, b.name?.trim() ?? p.name, b.color ?? p.color, position, b.doneSectionId !== undefined ? b.doneSectionId : p.done_section_id])).rows[0];
    return { project: projectOut(row) };
  }).then((r) => { live.board(req, r.project.id); return r; }));

  app.delete('/api/projects/:id', { schema: { params: idParams } }, async (req) => {
    const p = (await db.query('UPDATE projects SET archived_at = now() WHERE id = $1 AND archived_at IS NULL RETURNING id', [req.params.id])).rows[0];
    if (!p) throw notFound('project');
    live.board(req, p.id);
    return { ok: true };
  });

  // ---- the board: a project with its sections and top-level tasks, in order
  app.get('/api/projects/:id/board', { schema: { params: idParams } }, async (req) => {
    const p = await loadProject(db, req.params.id);
    const sections = (await db.query('SELECT * FROM sections WHERE project_id = $1 ORDER BY position', [p.id])).rows;
    const tasks = (await db.query(
      `SELECT ${TASK_COLS}, ${COUNT_COLS} FROM tasks t JOIN sections sec ON sec.id = t.section_id
       WHERE t.project_id = $1 AND t.parent_id IS NULL AND t.deleted_at IS NULL ORDER BY sec.position, t.position`, [p.id, req.user.id])).rows;
    const users = (await db.query('SELECT * FROM users WHERE NOT disabled ORDER BY display_name')).rows;
    return { project: projectOut(p), sections: sections.map(sectionOut), tasks: tasks.map(taskOut), users: users.map(publicUser) };
  });

  // ---- sections
  app.post('/api/projects/:id/sections', {
    schema: { params: idParams, body: { type: 'object', additionalProperties: false, required: ['name'], properties: { name, index } } },
  }, async (req, reply) => db.tx(async (t) => {
    const p = await loadProject(t, req.params.id, true);
    const key = await keyAt(t, { list: sectionsOf(t, p.id), rename: rename(t, 'sections'), index: req.body.index });
    return (await t.query('INSERT INTO sections (project_id, name, position) VALUES ($1, $2, $3) RETURNING *', [p.id, req.body.name.trim(), key])).rows[0];
  }).then((s) => { live.board(req, s.project_id); return reply.code(201).send({ section: sectionOut(s) }); }));

  app.patch('/api/sections/:id', {
    schema: { params: idParams, body: { type: 'object', additionalProperties: false, minProperties: 1, properties: { name, index } } },
  }, async (req) => db.tx(async (t) => {
    const s = await loadSection(t, req.params.id);
    await loadProject(t, s.project_id, true);
    const position = req.body.index !== undefined
      ? await keyAt(t, { list: sectionsOf(t, s.project_id, s.id), rename: rename(t, 'sections'), index: req.body.index })
      : s.position;
    const row = (await t.query('UPDATE sections SET name = $2, position = $3 WHERE id = $1 RETURNING *', [s.id, req.body.name?.trim() ?? s.name, position])).rows[0];
    return { section: sectionOut(row) };
  }).then((r) => { live.board(req, r.section.projectId); return r; }));

  // Deleting a section keeps its tasks: they move to the end of the first remaining section.
  app.delete('/api/sections/:id', { schema: { params: idParams } }, async (req) => db.tx(async (t) => {
    const s = await loadSection(t, req.params.id);
    await loadProject(t, s.project_id, true);
    const rest = await sectionsOf(t, s.project_id, s.id)();
    if (!rest.length) throw new HttpError(409, 'last-section', 'A project needs at least one section. Add another before deleting this one.');
    const target = rest[0].id;
    const moving = await tasksOf(t, s.id)();
    for (const task of moving) {
      const key = await keyAt(t, { list: tasksOf(t, target), rename: rename(t, 'tasks') });
      await t.query('UPDATE tasks SET section_id = $2, position = $3, updated_at = now() WHERE id = $1', [task.id, target, key]);
    }
    await t.query('UPDATE projects SET done_section_id = NULL WHERE done_section_id = $1', [s.id]);
    await t.query('DELETE FROM sections WHERE id = $1', [s.id]);
    return { projectId: s.project_id, out: { ok: true, movedTasks: moving.length, movedTo: target } };
  }).then(({ projectId, out }) => { live.board(req, projectId); return out; }));

  // ---- tasks
  const taskFields = {
    title: name,
    notes: { type: 'string', maxLength: 20000 },
    assigneeId: nullable(uuid),
    dueOn: { type: ['string', 'null'], format: 'date' },
    priority: { type: ['string', 'null'], enum: [...PRIORITY, null] },
    status: { type: ['string', 'null'], enum: [...STATUS, null] },
  };

  app.post('/api/sections/:id/tasks', {
    schema: { params: idParams, body: { type: 'object', additionalProperties: false, required: ['title'], properties: { ...taskFields, index } } },
  }, async (req, reply) => {
    const id = await db.tx(async (t) => {
      const s = await loadSection(t, req.params.id, true);
      const p = await loadProject(t, s.project_id);
      const b = req.body;
      await assertUser(t, b.assigneeId);
      const key = await keyAt(t, { list: tasksOf(t, s.id), rename: rename(t, 'tasks'), index: b.index });
      const done = p.done_section_id === s.id;
      const row = (await t.query(
        `INSERT INTO tasks (project_id, section_id, title, notes, assignee_id, due_on, priority, status, position, created_by, completed_at, completed_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, ${done ? 'now()' : 'NULL'}, ${done ? '$10' : 'NULL'}) RETURNING id`,
        [p.id, s.id, b.title.trim(), b.notes ?? '', b.assigneeId ?? null, b.dueOn ?? null, b.priority ?? null, b.status ?? null, key, req.user.id])).rows[0];
      await log(t, p.id, row.id, req.user.id, 'created', { sectionId: s.id });
      return row.id;
    });
    const task = await taskWithCounts(db, id, req.user.id);
    await live.task(req, task.projectId, id);
    return reply.code(201).send({ task });
  });

  // One endpoint for every change to a task, including a drag (sectionId and/or index) and ticking it.
  // Ticking moves a task to the top of the project's Done section; unticking returns it to where it was.
  // Dragging into Done ticks it; dragging out of Done unticks it. Subtasks only tick, they never move.
  app.patch('/api/tasks/:id', {
    schema: {
      params: idParams,
      body: { type: 'object', additionalProperties: false, minProperties: 1, properties: { ...taskFields, completed: { type: 'boolean' }, sectionId: uuid, index } },
    },
  }, async (req) => {
    const changed = await db.tx(async (t) => {
      const task = await loadTask(t, req.params.id, true);
      const p = await loadProject(t, task.project_id);
      const b = req.body;
      if (b.assigneeId !== undefined) await assertUser(t, b.assigneeId);

      const top = !task.parent_id;
      const doneId = p.done_section_id;
      let section = task.section_id;
      let at;
      let moved = false;
      if (top && b.sectionId && b.sectionId !== task.section_id) {
        const s = await loadSection(t, b.sectionId);
        if (s.project_id !== p.id) throw new HttpError(400, 'wrong-project', 'A task can only move between sections of its own project.');
        section = s.id;
        moved = true;
      }
      if (top && b.index !== undefined) { at = b.index; moved = true; }

      const wasDone = !!task.completed_at;
      let done = wasDone;
      let previous = task.previous_section_id;
      if (b.completed !== undefined && b.completed !== wasDone) {
        done = b.completed;
        if (top && doneId && b.sectionId === undefined) {
          if (done && section !== doneId) { previous = task.section_id; section = doneId; at = 0; moved = true; }
          if (!done && section === doneId) {
            const back = previous && (await t.query('SELECT id FROM sections WHERE id = $1 AND project_id = $2', [previous, p.id])).rows[0];
            section = back ? back.id : (await sectionsOf(t, p.id, doneId)())[0]?.id ?? doneId;
            at = 0;
            moved = true;
          }
        }
      } else if (top && doneId && section !== task.section_id) {
        if (section === doneId && !wasDone) { done = true; previous = task.section_id; }
        if (task.section_id === doneId && section !== doneId && wasDone) done = false;
      }
      if (done && !wasDone && top && task.section_id !== doneId && previous === task.previous_section_id) previous = task.section_id;

      let position = task.position;
      if (moved) {
        if (top) {
          await loadSection(t, section, true);
          position = await keyAt(t, { list: tasksOf(t, section, task.id), rename: rename(t, 'tasks'), index: at ?? 0 });
        } else {
          position = await keyAt(t, { list: subtasksOf(t, task.parent_id, task.id), rename: rename(t, 'tasks'), index: at });
        }
      }

      await t.query(
        `UPDATE tasks SET title = $2, notes = $3, assignee_id = $4, due_on = $5, priority = $6, status = $7,
           section_id = $8, position = $9, previous_section_id = $10,
           completed_at = CASE WHEN $11::boolean THEN COALESCE(completed_at, now()) ELSE NULL END,
           completed_by = CASE WHEN $11::boolean THEN COALESCE(completed_by, $12) ELSE NULL END,
           updated_at = now()
         WHERE id = $1`,
        [task.id, b.title?.trim() ?? task.title, b.notes ?? task.notes,
          b.assigneeId !== undefined ? b.assigneeId : task.assignee_id,
          b.dueOn !== undefined ? b.dueOn : task.due_on,
          b.priority !== undefined ? b.priority : task.priority,
          b.status !== undefined ? b.status : task.status,
          section, position, previous, done, req.user.id]);

      if (section !== task.section_id) await log(t, p.id, task.id, req.user.id, 'moved', { from: task.section_id, to: section });
      if (done !== wasDone) await log(t, p.id, task.id, req.user.id, done ? 'completed' : 'reopened');
      const edited = ['title', 'notes', 'assigneeId', 'dueOn', 'priority', 'status'].filter((k) => b[k] !== undefined);
      if (edited.length) await log(t, p.id, task.id, req.user.id, 'edited', { fields: edited });
      return { projectId: p.id, cardId: task.parent_id ?? task.id };
    });
    // A subtask isn't a card; its parent's counts are what changed on the board.
    await live.task(req, changed.projectId, changed.cardId);
    return { task: await taskWithCounts(db, req.params.id, req.user.id) };
  });

  app.get('/api/tasks/:id', { schema: { params: idParams } }, async (req) => {
    const task = await loadTask(db, req.params.id);
    await loadProject(db, task.project_id);
    const subtasks = (await db.query(`SELECT ${TASK_COLS} FROM tasks t WHERE t.parent_id = $1 AND t.deleted_at IS NULL ORDER BY t.position`, [task.id])).rows;
    const comments = (await db.query(
      `SELECT c.id, c.body, c.created_at, c.edited_at, c.author_id FROM comments c WHERE c.task_id = $1 ORDER BY c.created_at, c.id`, [task.id])).rows;
    const activity = (await db.query(
      `SELECT id::text, kind, data, actor_id, created_at FROM activity WHERE task_id = $1 ORDER BY created_at DESC, id DESC LIMIT 50`, [task.id])).rows;
    return {
      task: await taskWithCounts(db, task.id, req.user.id),
      subtasks: subtasks.map(taskOut),
      comments: comments.map((c) => ({ id: c.id, body: c.body, authorId: c.author_id, createdAt: c.created_at, editedAt: c.edited_at })),
      attachments: await listAttachments(db, task.id),
      activity: activity.map((a) => ({ id: a.id, kind: a.kind, data: a.data, actorId: a.actor_id, createdAt: a.created_at })),
    };
  });

  app.delete('/api/tasks/:id', { schema: { params: idParams } }, async (req) => db.tx(async (t) => {
    const task = await loadTask(t, req.params.id, true);
    await t.query('UPDATE tasks SET deleted_at = now() WHERE id = $1 OR parent_id = $1', [task.id]);
    await log(t, task.project_id, task.id, req.user.id, 'deleted');
    return task;
  }).then(async (task) => {
    if (task.parent_id) await live.task(req, task.project_id, task.parent_id);
    else live.removed(req, task.project_id, task.id);
    return { ok: true };
  }));

  app.post('/api/tasks/:id/subtasks', {
    schema: { params: idParams, body: { type: 'object', additionalProperties: false, required: ['title'], properties: { title: name, assigneeId: nullable(uuid), index } } },
  }, async (req, reply) => {
    const id = await db.tx(async (t) => {
      const parent = await loadTask(t, req.params.id, true);
      if (parent.parent_id) throw new HttpError(400, 'nested-subtask', 'Subtasks can’t have subtasks of their own.');
      await assertUser(t, req.body.assigneeId);
      const key = await keyAt(t, { list: subtasksOf(t, parent.id), rename: rename(t, 'tasks'), index: req.body.index });
      const row = (await t.query(
        `INSERT INTO tasks (project_id, parent_id, title, assignee_id, position, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [parent.project_id, parent.id, req.body.title.trim(), req.body.assigneeId ?? null, key, req.user.id])).rows[0];
      await log(t, parent.project_id, parent.id, req.user.id, 'subtask-added', { subtaskId: row.id });
      return { sub: row.id, parent };
    }).then(async ({ sub, parent }) => { await live.task(req, parent.project_id, parent.id); return sub; });
    return reply.code(201).send({ task: await taskWithCounts(db, id, req.user.id) });
  });

  app.post('/api/tasks/:id/comments', {
    schema: { params: idParams, body: { type: 'object', additionalProperties: false, required: ['body'], properties: { body: { type: 'string', minLength: 1, maxLength: 10000 } } } },
  }, async (req, reply) => db.tx(async (t) => {
    const task = await loadTask(t, req.params.id);
    const c = (await t.query('INSERT INTO comments (task_id, author_id, body) VALUES ($1, $2, $3) RETURNING *', [task.id, req.user.id, req.body.body.trim()])).rows[0];
    await log(t, task.project_id, task.id, req.user.id, 'commented', { commentId: c.id });
    return { c, task };
  }).then(async ({ c, task }) => {
    await live.task(req, task.project_id, task.parent_id ?? task.id);
    return reply.code(201).send({ comment: { id: c.id, body: c.body, authorId: c.author_id, createdAt: c.created_at, editedAt: null } });
  }));

  app.put('/api/tasks/:id/like', { schema: { params: idParams } }, async (req) => {
    const task = await loadTask(db, req.params.id);
    await db.query('INSERT INTO task_likes (task_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [task.id, req.user.id]);
    await live.task(req, task.project_id, task.parent_id ?? task.id);
    return { task: await taskWithCounts(db, task.id, req.user.id) };
  });
  app.delete('/api/tasks/:id/like', { schema: { params: idParams } }, async (req) => {
    const task = await loadTask(db, req.params.id);
    await db.query('DELETE FROM task_likes WHERE task_id = $1 AND user_id = $2', [task.id, req.user.id]);
    await live.task(req, task.project_id, task.parent_id ?? task.id);
    return { task: await taskWithCounts(db, task.id, req.user.id) };
  });
}
