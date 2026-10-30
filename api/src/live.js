import { HttpError, notFound } from './errors.js';

// Live updates. Each open board keeps one server-sent-events stream on its project. Once a change has
// committed, it goes to every stream on that project except the browser tab that made it: tabs name
// themselves in the X-Asanaka-Client header on writes and in ?client= on the stream. There is one API
// process, so the hub is a map in memory; a stream that reconnects reloads its board to catch up.

const CLIENT = /^[A-Za-z0-9_-]{8,64}$/;
const HEARTBEAT = 25_000;
const MAX_STREAMS = 20; // per person: a few tabs on a few devices

export const clientOf = (req) => {
  const c = req.headers['x-asanaka-client'];
  return typeof c === 'string' && CLIENT.test(c) ? c : null;
};

export function createHub() {
  const byProject = new Map();
  const all = new Set();
  return {
    add(projectId, stream) {
      if (!byProject.has(projectId)) byProject.set(projectId, new Set());
      byProject.get(projectId).add(stream);
      all.add(stream);
      return () => {
        all.delete(stream);
        const set = byProject.get(projectId);
        set?.delete(stream);
        if (set && !set.size) byProject.delete(projectId);
      };
    },
    has: (projectId) => byProject.has(projectId),
    countFor: (userId) => [...all].filter((s) => s.userId === userId).length,
    publish(projectId, from, event) {
      const frame = `data: ${JSON.stringify(event)}\n\n`;
      for (const s of byProject.get(projectId) ?? []) if (!from || s.client !== from) s.write(frame);
    },
    closeAll: () => [...all].forEach((s) => s.end()),
  };
}

// What the routes call after a change commits. `readTask` gives a task with its counts as everyone sees
// it; whether *you* liked it is worked out in the browser from likerIds.
export function publisher(hub, readTask) {
  const send = (req, projectId, event) => hub.publish(projectId, clientOf(req), { ...event, actorId: req.user.id });
  return {
    async task(req, projectId, id) {
      if (!hub.has(projectId)) return;
      try {
        const { liked, ...task } = await readTask(id);
        send(req, projectId, { type: 'task', task });
      } catch (err) {
        req.log.warn(err, 'live update not sent');
      }
    },
    removed: (req, projectId, id) => send(req, projectId, { type: 'task-removed', id }),
    // Sections or the project itself changed: boards on it reload.
    board: (req, projectId) => send(req, projectId, { type: 'board' }),
  };
}

export default function liveRoutes(app, { db, hub }) {
  // Drops every stream before the server closes, or close() would wait on them; browsers reconnect.
  app.addHook('preClose', async () => hub.closeAll());

  app.get('/api/projects/:id/events', {
    schema: {
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      querystring: { type: 'object', additionalProperties: false, properties: { client: { type: 'string', pattern: CLIENT.source } } },
    },
  }, async (req, reply) => {
    const p = (await db.query('SELECT id FROM projects WHERE id = $1 AND archived_at IS NULL', [req.params.id])).rows[0];
    if (!p) throw notFound('project');
    if (hub.countFor(req.user.id) >= MAX_STREAMS) {
      throw new HttpError(429, 'too-many-streams', 'Too many boards are open at once. Close a few tabs, then reload this one.');
    }

    // From here the response is ours: the CORS headers set so far are copied, the onSend hook won't run.
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      ...reply.getHeaders(),
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    });

    let open = true;
    const stream = { client: req.query.client ?? null, userId: req.user.id, write: (s) => { if (open) res.write(s); }, end: () => finish(true) };
    const off = hub.add(p.id, stream);
    // A comment line keeps proxies from closing a quiet stream; it also notices a session that has ended.
    const beat = setInterval(async () => {
      const live = (await db.query(
        `SELECT 1 FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1 AND s.expires_at > now() AND NOT u.disabled`,
        [req.user.session_id]).catch(() => ({ rows: [1] }))).rows[0];
      if (!live) { stream.write('data: {"type":"signed-out"}\n\n'); finish(); return; }
      stream.write(': still here\n\n');
    }, HEARTBEAT);
    function finish(drop = false) {
      if (!open) return;
      open = false;
      clearInterval(beat);
      off();
      if (drop) res.destroy(); else res.end();
    }
    res.on('close', () => finish());
    stream.write('retry: 3000\ndata: {"type":"hello"}\n\n');
    return reply;
  });
}
