import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, api, type TaskFields } from '../lib/api';
import type { Activity, Board, Comment, Priority, Section, Status, Task, TaskDetail } from '../types';
import type { BoardEngine } from './engine';
import { PRIORITY, STATUS, initials, toneOf, when } from './format';
import { EASE_OUT, reduced } from './motion';

interface Props {
  taskId: string;
  open: boolean;
  engine: BoardEngine;
  board: Board;
  sections: Section[];
  me: string;
  onClose(): void;
  onClosed(): void;
  /** A save was refused: report it and reload the board. */
  onFailure(err: unknown): void;
}

const Check = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 12.5l3.6 3.6 7.4-8.2" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
const Close = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
);

export function Avatar({ board, id }: { board: Board; id: string | null }) {
  const u = board.users.find((x) => x.id === id);
  if (!u) return null;
  return <span className="bd-avatar" data-tone={toneOf(board.users, u.id)} title={u.displayName}>{initials(u.displayName)}</span>;
}

const FIELD_NAMES: Record<string, string> = { title: 'the name', notes: 'the description', assigneeId: 'the assignee', dueOn: 'the due date', priority: 'the priority', status: 'the status' };
const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

function describe(a: Activity, sectionName: (id: unknown) => string) {
  switch (a.kind) {
    case 'created': return 'created this task';
    case 'moved': return `moved this from ${sectionName(a.data.from)} to ${sectionName(a.data.to)}`;
    case 'completed': return 'marked this complete';
    case 'reopened': return 'marked this incomplete';
    case 'edited': return `changed ${list(((a.data.fields as string[]) ?? []).map((f) => FIELD_NAMES[f] ?? f))}`;
    case 'commented': return 'commented';
    case 'subtask-added': return 'added a subtask';
    default: return a.kind.replace(/-/g, ' ');
  }
}

let tmp = 0;
const tempId = () => `tmp-pane-${++tmp}`;

export function TaskPane({ taskId, open, engine, board, sections, me, onClose, onClosed, onFailure }: Props) {
  const pane = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const [shown, setShown] = useState(false);
  const [task, setTask] = useState<Task | undefined>(() => engine.get(taskId));
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [newSub, setNewSub] = useState('');
  const [say, setSay] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const t = task ?? detail?.task;

  // Slide in on the next frame (so the closed position is painted first); slide out, then unmount.
  useEffect(() => {
    if (!open) { setShown(false); return; }
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [open]);

  // A different task: show what the board already knows, then load subtasks, comments and activity.
  const load = useCallback(() => api.task(taskId), [taskId]);
  useEffect(() => {
    let alive = true;
    const known = engine.get(taskId);
    setTask(known ? { ...known } : undefined);
    setTitle(known?.title ?? '');
    setNotes(known?.notes ?? '');
    setDetail(null);
    setConfirmDelete(false);
    setNewSub('');
    load().then((d) => {
      if (!alive) return;
      setDetail(d);
      if (!known) { setTitle(d.task.title); setNotes(d.task.notes); }
    }, (err) => {
      if (!alive) return;
      if (err instanceof ApiError && err.status === 404) onFailure(new Error('That task isn’t on the board any more.'));
      else onFailure(err);
      onClose();
    });
    const off = engine.subscribe((x) => { if (x.id === taskId) setTask({ ...x }); });
    return () => { alive = false; off(); };
  }, [taskId, engine, load, onClose, onFailure]);

  // Changes made elsewhere (the board, a reload) reach the drafts unless you're typing in them.
  useEffect(() => { if (t && document.activeElement !== titleRef.current) setTitle(t.title); }, [t?.title]);
  useEffect(() => { if (t && document.activeElement !== notesRef.current) setNotes(t.notes); }, [t?.notes]);

  useLayoutEffect(() => {
    const ta = titleRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }, [title, shown]);

  // Opening: fields rise in order; focus goes into the pane. Closing: focus returns to the card.
  useEffect(() => {
    const el = pane.current;
    if (!el || !shown) return;
    if (!reduced()) {
      el.querySelectorAll('.pane-title, .pane-field, .pane-block').forEach((x, i) =>
        x.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 300, delay: 60 + i * 28, easing: EASE_OUT, fill: 'backwards' }));
    }
    const id = window.setTimeout(() => {
      if (matchMedia('(pointer: fine)').matches) titleRef.current?.focus({ preventScroll: true });
      else el.focus({ preventScroll: true });
    }, reduced() ? 0 : 200);
    return () => clearTimeout(id);
  }, [shown, taskId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented && !engine.isDragging()) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, engine, onClose]);

  const refreshing = useRef(0);
  const refreshSoon = useCallback((after: Promise<unknown>) => {
    const n = ++refreshing.current;
    after.then(() => new Promise((r) => setTimeout(r, 300))).then(() => {
      if (n !== refreshing.current) return;
      return load().then((d) => { if (n === refreshing.current) setDetail((cur) => (cur ? { ...cur, activity: d.activity } : d)); });
    }).catch(() => undefined);
  }, [load]);

  const saveFields = useCallback((fields: TaskFields) => {
    engine.patch(taskId, fields as Partial<Task>);
    const req = api.updateTask(taskId, fields).then((r) => r.task);
    engine.save(taskId, req);
    refreshSoon(req);
  }, [engine, taskId, refreshSoon]);

  if (!t) return null;

  const commitTitle = () => {
    const v = title.trim().replace(/\s+/g, ' ');
    if (!v) setTitle(t.title);
    else if (v !== t.title) saveFields({ title: v });
  };
  const commitNotes = () => { if (notes !== t.notes) saveFields({ notes }); };

  const sectionName = (id: unknown) => sections.find((s) => s.id === id)?.name ?? 'another section';
  const userName = (id: string) => board.users.find((u) => u.id === id)?.displayName ?? 'Someone';
  const subtasks = detail?.subtasks ?? [];
  const comments = detail?.comments ?? [];

  const toggleSub = (s: Task) => {
    if (s.id.startsWith('tmp-')) return;
    const completed = !s.completed;
    setDetail((d) => d && { ...d, subtasks: d.subtasks.map((x) => (x.id === s.id ? { ...x, completed } : x)) });
    engine.patch(taskId, { subtaskDoneCount: Math.max(0, t.subtaskDoneCount + (completed ? 1 : -1)) });
    const req = api.updateTask(s.id, { completed });
    req.catch(onFailure);
    refreshSoon(req);
  };

  const addSub = (e: FormEvent) => {
    e.preventDefault();
    const v = newSub.trim().replace(/\s+/g, ' ');
    if (!v) return;
    const id = tempId();
    const draft = { ...t, id, parentId: taskId, title: v, completed: false } as Task;
    setDetail((d) => d && { ...d, subtasks: [...d.subtasks, draft] });
    setNewSub('');
    engine.patch(taskId, { subtaskCount: t.subtaskCount + 1 });
    const req = api.addSubtask(taskId, v);
    req.then((r) => setDetail((d) => d && { ...d, subtasks: d.subtasks.map((x) => (x.id === id ? r.task : x)) }), onFailure);
    refreshSoon(req);
  };

  const postComment = (e?: FormEvent) => {
    e?.preventDefault();
    const body = say.trim();
    if (!body) return;
    const id = tempId();
    const draft: Comment = { id, body, authorId: me, createdAt: new Date().toISOString(), editedAt: null };
    setDetail((d) => d && { ...d, comments: [...d.comments, draft] });
    setSay('');
    engine.patch(taskId, { commentCount: t.commentCount + 1 });
    const req = api.addComment(taskId, body);
    req.then((r) => setDetail((d) => d && { ...d, comments: d.comments.map((x) => (x.id === id ? r.comment : x)) }), onFailure);
    refreshSoon(req);
    requestAnimationFrame(() => pane.current?.querySelector('.pane-comments li:last-child')?.scrollIntoView({ block: 'nearest', behavior: reduced() ? 'auto' : 'smooth' }));
  };

  const deleteTask = () => {
    engine.remove(taskId);
    api.deleteTask(taskId).catch(onFailure);
    onClose();
  };

  const seg = <V extends string>(label: string, field: 'priority' | 'status', options: Record<V, string>, value: V | null) => (
    <div className="pane-field">
      <dt id={`pf-${field}`}>{label}</dt>
      <dd>
        <div className="pane-seg" role="radiogroup" aria-labelledby={`pf-${field}`}>
          {([['', 'None'], ...Object.entries(options)] as [string, string][]).map(([v, l]) => (
            <button key={v} type="button" role="radio" aria-checked={(value ?? '') === v} onClick={() => saveFields({ [field]: v || null } as TaskFields)}>{l}</button>
          ))}
        </div>
      </dd>
    </div>
  );

  return (
    <aside
      ref={pane}
      className={`pane${shown ? ' is-open' : ''}`}
      aria-label="Task details"
      tabIndex={-1}
      inert={!open}
      onTransitionEnd={(e) => { if (e.target === pane.current && !open) onClosed(); }}
    >
      <div className="pane-bar">
        <button type="button" className="pane-complete" aria-pressed={t.completed} onClick={() => engine.toggle(taskId)}>
          <Check /><span>{t.completed ? 'Completed' : 'Mark complete'}</span>
        </button>
        <button type="button" className="pane-close" aria-label="Close task details" onClick={onClose}><Close /></button>
      </div>

      <div className="pane-scroll">
        <label className="sr-only" htmlFor="pane-title">Task name</label>
        <textarea
          id="pane-title" ref={titleRef} className="pane-title" rows={1} maxLength={120} value={title}
          onChange={(e) => setTitle(e.target.value.replace(/\n/g, ' '))}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
          onBlur={commitTitle}
        />

        <dl className="pane-fields">
          <div className="pane-field">
            <dt><label htmlFor="pf-assignee">Assignee</label></dt>
            <dd>
              <select id="pf-assignee" className="pane-input" value={t.assigneeId ?? ''} onChange={(e) => saveFields({ assigneeId: e.target.value || null })}>
                <option value="">Nobody yet</option>
                {board.users.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}
              </select>
            </dd>
          </div>
          <div className="pane-field">
            <dt><label htmlFor="pf-due">Due date</label></dt>
            <dd><input id="pf-due" type="date" className="pane-input" value={t.dueOn ?? ''} onChange={(e) => saveFields({ dueOn: e.target.value || null })} /></dd>
          </div>
          <div className="pane-field">
            <dt><label htmlFor="pf-section">Section</label></dt>
            <dd>
              <select id="pf-section" className="pane-input" value={t.sectionId ?? ''} onChange={(e) => engine.moveTo(taskId, e.target.value)}>
                {sections.map((s) => <option key={s.id} value={s.id} disabled={s.id.startsWith('tmp-')}>{s.name}</option>)}
              </select>
            </dd>
          </div>
          {seg<Priority>('Priority', 'priority', PRIORITY, t.priority)}
          {seg<Status>('Status', 'status', STATUS, t.status)}
        </dl>

        <div className="pane-block">
          <label className="pane-h" htmlFor="pane-notes">Description</label>
          <textarea id="pane-notes" ref={notesRef} className="pane-notes" rows={3} maxLength={20000} placeholder="What is this task about?"
            value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={commitNotes} />
        </div>

        <div className="pane-block">
          <h2 className="pane-h">Subtasks{t.subtaskCount > 0 && <span className="pane-sub-count">{t.subtaskDoneCount} of {t.subtaskCount}</span>}</h2>
          {detail && subtasks.length > 0 && (
            <ul className="pane-subs">
              {subtasks.map((s) => (
                <li key={s.id} className={`pane-sub${s.completed ? ' is-done' : ''}`}>
                  <button type="button" className="pane-sub-check" aria-pressed={s.completed} disabled={s.id.startsWith('tmp-')}
                    aria-label={s.completed ? `Mark ${s.title} incomplete` : `Mark ${s.title} complete`} onClick={() => toggleSub(s)}><Check /></button>
                  <span>{s.title}</span>
                </li>
              ))}
            </ul>
          )}
          {!detail && t.subtaskCount > 0 && <p className="pane-empty">Loading subtasks…</p>}
          <form className="pane-sub-add" onSubmit={addSub}>
            <label className="sr-only" htmlFor="pane-sub">New subtask</label>
            <input id="pane-sub" className="pane-input" placeholder="Add a subtask" autoComplete="off" maxLength={120} value={newSub} onChange={(e) => setNewSub(e.target.value)} />
          </form>
        </div>

        <div className="pane-block">
          <h2 className="pane-h">Comments</h2>
          {!detail ? <p className="pane-empty">{t.commentCount ? 'Loading comments…' : 'No comments yet.'}</p> : (
            <ul className="pane-comments">
              {comments.length === 0 && <li className="pane-empty">No comments yet.</li>}
              {comments.map((c) => (
                <li key={c.id} className="pane-comment">
                  <Avatar board={board} id={c.authorId} />
                  <div>
                    <p className="pane-comment-by"><strong>{userName(c.authorId)}</strong> <span>{when(c.createdAt)}</span></p>
                    <p className="pane-comment-body">{c.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {detail && detail.activity.length > 0 && (
          <div className="pane-block">
            <h2 className="pane-h">Activity</h2>
            <ol className="pane-activity">
              {detail.activity.slice(0, 12).map((a) => (
                <li key={a.id}><strong>{userName(a.actorId)}</strong> {describe(a, sectionName)} <span>{when(a.createdAt)}</span></li>
              ))}
            </ol>
          </div>
        )}

        <div className="pane-block pane-danger">
          {confirmDelete ? (
            <>
              <p>Delete this task{t.subtaskCount ? ' and its subtasks' : ''}?</p>
              <div className="pane-danger-row">
                <button type="button" className="bd-btn is-danger" onClick={deleteTask}>Delete task</button>
                <button type="button" className="bd-btn-quiet" onClick={() => setConfirmDelete(false)}>Keep it</button>
              </div>
            </>
          ) : (
            <button type="button" className="bd-btn-quiet pane-delete" onClick={() => setConfirmDelete(true)}>Delete task</button>
          )}
        </div>
      </div>

      <form className="pane-say" onSubmit={postComment}>
        <Avatar board={board} id={me} />
        <label className="sr-only" htmlFor="pane-say">Comment</label>
        <textarea id="pane-say" rows={1} maxLength={10000} placeholder="Ask a question or post an update" value={say}
          onChange={(e) => setSay(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) postComment(); }} />
        <button type="submit" className="bd-btn">Comment</button>
      </form>
    </aside>
  );
}
