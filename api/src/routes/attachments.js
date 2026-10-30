import { HttpError, notFound } from '../errors.js';

// Files and images on a task. An upload is the raw file as application/octet-stream, with its name and
// type in the query string, so a file that happens to be JSON is never parsed. Downloads need the same
// bearer token as everything else; the site fetches them as blobs.

export const MAX_FILE = 10 * 1024 * 1024;
const uuid = { type: 'string', format: 'uuid' };
const idParams = { type: 'object', required: ['id'], properties: { id: uuid } };

const attachmentOut = (r) => ({
  id: r.id, taskId: r.task_id, filename: r.filename, contentType: r.content_type, size: r.size,
  uploaderId: r.uploader_id, createdAt: r.created_at,
});
export const ATTACHMENT_COLS = 'id, task_id, filename, content_type, size, uploader_id, created_at';
export const listAttachments = async (q, taskId) =>
  (await q.query(`SELECT ${ATTACHMENT_COLS} FROM attachments WHERE task_id = $1 ORDER BY created_at, id`, [taskId])).rows.map(attachmentOut);

// Names come from the visitor's computer: no path parts, no control characters.
const cleanName = (s) => s.replace(/[\u0000-\u001f\u007f/\\]/g, '').trim().slice(0, 200) || 'file';
const disposition = (name) => {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["%]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
};

async function liveTask(q, id) {
  const t = (await q.query(`SELECT t.id, t.project_id FROM tasks t JOIN projects p ON p.id = t.project_id
    WHERE t.id = $1 AND t.deleted_at IS NULL AND p.archived_at IS NULL`, [id])).rows[0];
  if (!t) throw notFound('task');
  return t;
}
async function liveAttachment(q, id) {
  const a = (await q.query(`SELECT a.id, a.task_id, a.filename, t.project_id FROM attachments a
    JOIN tasks t ON t.id = a.task_id JOIN projects p ON p.id = t.project_id
    WHERE a.id = $1 AND t.deleted_at IS NULL AND p.archived_at IS NULL`, [id])).rows[0];
  if (!a) throw notFound('attachment');
  return a;
}
const log = (q, projectId, taskId, actorId, kind, data) =>
  q.query('INSERT INTO activity (project_id, task_id, actor_id, kind, data) VALUES ($1, $2, $3, $4, $5)', [projectId, taskId, actorId, kind, JSON.stringify(data)]);

export default function attachmentRoutes(app, { db, live }) {
  app.post('/api/tasks/:id/attachments', {
    bodyLimit: MAX_FILE,
    schema: {
      params: idParams,
      querystring: {
        type: 'object', additionalProperties: false, required: ['name'],
        properties: { name: { type: 'string', minLength: 1, maxLength: 400 }, type: { type: 'string', maxLength: 120, pattern: '^[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+$' } },
      },
    },
  }, async (req, reply) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw new HttpError(400, 'empty-file', 'That file is empty. Pick another one.');
    }
    const name = cleanName(req.query.name);
    const type = (req.query.type || 'application/octet-stream').toLowerCase();
    const row = await db.tx(async (t) => {
      const task = await liveTask(t, req.params.id);
      const a = (await t.query(
        `INSERT INTO attachments (task_id, uploader_id, filename, content_type, size, data) VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${ATTACHMENT_COLS}`,
        [task.id, req.user.id, name, type, req.body.length, req.body])).rows[0];
      await log(t, task.project_id, task.id, req.user.id, 'attached', { attachmentId: a.id, name });
      return { ...a, project_id: task.project_id };
    });
    await live.task(req, row.project_id, row.task_id);
    return reply.code(201).send({ attachment: attachmentOut(row) });
  });

  // The file itself. Stored files are never shown as pages on the API's address: they always download,
  // sandboxed, and the browser may keep them (an attachment never changes once uploaded).
  app.get('/api/attachments/:id', { schema: { params: idParams } }, async (req, reply) => {
    await liveAttachment(db, req.params.id);
    const r = (await db.query('SELECT filename, content_type, data FROM attachments WHERE id = $1', [req.params.id])).rows[0];
    const data = Buffer.from(r.data);
    reply.header('Content-Type', r.content_type);
    reply.header('Content-Disposition', disposition(r.filename));
    reply.header('Content-Security-Policy', "default-src 'none'; sandbox");
    reply.header('Cache-Control', 'private, max-age=31536000, immutable');
    return reply.send(data);
  });

  app.delete('/api/attachments/:id', { schema: { params: idParams } }, async (req) => db.tx(async (t) => {
    const a = await liveAttachment(t, req.params.id);
    await t.query('DELETE FROM attachments WHERE id = $1', [a.id]);
    await log(t, a.project_id, a.task_id, req.user.id, 'attachment-removed', { name: a.filename });
    return a;
  }).then(async (a) => {
    await live.task(req, a.project_id, a.task_id);
    return { ok: true };
  }));
}
