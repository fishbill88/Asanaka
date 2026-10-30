import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent } from 'react';
import { ApiError, api, deleteAttachment, messageOf, uploadAttachment, type TaskFields } from '../lib/api';
import type { Activity, Attachment, Board, Comment, Priority, Section, Status, Task, TaskDetail } from '../types';
import { FileTile, Lightbox, NotesView, markerFor, openAttachment } from './Attachments';
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
  /** Something to tell the visitor that needs no reload (a file too big, an upload that failed). */
  onNotice(message: string): void;
  /** Bumped when someone else changed a task; the pane reloads its comments and activity if it's this one. */
  remote: { id: string; n: number } | null;
}

type Feed = 'comments' | 'all';
const FEED_KEY = 'asanaka.feed';
const savedFeed = (): Feed => { try { return localStorage.getItem(FEED_KEY) === 'all' ? 'all' : 'comments'; } catch { return 'comments'; } };

const Check = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 12.5l3.6 3.6 7.4-8.2" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
const Close = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
);
const Thumb = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 11v9h-3v-9h3zm0 9h9.2a2 2 0 0 0 2-1.6l1.2-6.1a2 2 0 0 0-2-2.3h-4.5l.8-3.6a1.8 1.8 0 0 0-3.3-1.4L7.5 11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
const Clip = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 7.5l-6.8 6.8a2 2 0 0 0 2.8 2.8l7.1-7.1a4 4 0 0 0-5.7-5.7l-7.1 7.1a6 6 0 0 0 8.5 8.5l5.3-5.3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
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
    case 'attached': return `attached ${String(a.data.name ?? 'a file')}`;
    case 'attachment-removed': return `removed ${String(a.data.name ?? 'an attachment')}`;
    default: return a.kind.replace(/-/g, ' ');
  }
}

// The feed reads top to bottom, oldest first, so the newest sits by the comment box. "All activity" weaves
// the changes in with the comments (a "commented" entry is the comment itself, so it isn't listed twice).
type FeedItem = { kind: 'comment'; at: string; c: Comment } | { kind: 'event'; at: string; a: Activity };
function feedOf(feed: Feed, comments: Comment[], activity: Activity[]): FeedItem[] {
  const items: FeedItem[] = comments.map((c) => ({ kind: 'comment', at: c.createdAt, c }));
  if (feed === 'all') for (const a of activity) if (a.kind !== 'commented') items.push({ kind: 'event', at: a.createdAt, a });
  return items.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
}

let tmp = 0;
const tempId = () => `tmp-pane-${++tmp}`;
const hasFiles = (e: DragEvent) => [...e.dataTransfer.types].includes('Files');

export function TaskPane({ taskId, open, engine, board, sections, me, onClose, onClosed, onFailure, onNotice, remote }: Props) {
  const pane = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [shown, setShown] = useState(false);
  const [task, setTask] = useState<Task | undefined>(() => engine.get(taskId));
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [title, setTitle] = useState('');
  const [notes, setNotesState] = useState('');
  const notesLive = useRef('');
  const [editingNotes, setEditingNotes] = useState(false);
  const [newSub, setNewSub] = useState('');
  const [say, setSay] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [dropping, setDropping] = useState(false);
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const [feed, setFeedState] = useState<Feed>(savedFeed);
  const likeRef = useRef<HTMLButtonElement>(null);
  const t = task ?? detail?.task;
  const setFeed = (v: Feed) => { setFeedState(v); try { localStorage.setItem(FEED_KEY, v); } catch { /* lasts this visit */ } };
  const setNotes = useCallback((v: string) => { notesLive.current = v; setNotesState(v); }, []);

  // Slide in on the next frame (so the closed position is painted first); slide out, then unmount.
  useEffect(() => {
    if (!open) { setShown(false); return; }
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [open]);

  // A different task: show what the board already knows, then load subtasks, comments, files and activity.
  const load = useCallback(() => api.task(taskId), [taskId]);
  useEffect(() => {
    let alive = true;
    const known = engine.get(taskId);
    setTask(known ? { ...known } : undefined);
    setTitle(known?.title ?? '');
    setNotes(known?.notes ?? '');
    setEditingNotes(false);
    setDetail(null);
    setConfirmDelete(false);
    setNewSub('');
    setViewing(null);
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
  }, [taskId, engine, load, onClose, onFailure, setNotes]);

  // Changes made elsewhere (the board, a reload) reach the drafts unless you're typing in them.
  useEffect(() => { if (t && document.activeElement !== titleRef.current) setTitle(t.title); }, [t?.title]);
  useEffect(() => { if (t && document.activeElement !== notesRef.current && !notesLive.current.includes('](uploading:')) setNotes(t.notes); }, [t?.notes, setNotes]);

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

  // Escape closes the lightbox first, then the pane.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // Ctrl (or Cmd) + Enter completes the task, except in the comment box, where it posts.
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.defaultPrevented && !(e.target as HTMLElement).closest?.('#pane-say')) {
        e.preventDefault();
        engine.toggle(taskId);
        return;
      }
      if (e.key !== 'Escape' || e.defaultPrevented || engine.isDragging()) return;
      if (viewing) { setViewing(null); return; }
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, engine, onClose, viewing, taskId]);

  const refreshing = useRef(0);
  const refreshSoon = useCallback((after: Promise<unknown>) => {
    const n = ++refreshing.current;
    after.then(() => new Promise((r) => setTimeout(r, 300))).then(() => {
      if (n !== refreshing.current) return;
      // Everything is replaced unless a comment or subtask of ours is still on its way; then only the activity.
      return load().then((d) => {
        if (n !== refreshing.current) return;
        setDetail((cur) => (!cur ? d : [...cur.comments, ...cur.subtasks].some((x) => x.id.startsWith('tmp-')) ? { ...cur, activity: d.activity } : d));
      });
    }).catch(() => undefined);
  }, [load]);

  // Someone else changed this task: fetch its comments, subtasks, files and activity again.
  useEffect(() => { if (remote?.id === taskId) refreshSoon(Promise.resolve()); }, [remote, taskId, refreshSoon]);

  const saveFields = useCallback((fields: TaskFields) => {
    engine.patch(taskId, fields as Partial<Task>);
    const req = api.updateTask(taskId, fields).then((r) => r.task);
    engine.save(taskId, req);
    refreshSoon(req);
  }, [engine, taskId, refreshSoon]);

  // Files: each upload adds a tile; files pasted or dropped into the description also leave a marker there,
  // first "Uploading…", then the image or file itself. The description saves once it holds no pending marker.
  const countFiles = (delta: number) => engine.patch(taskId, { attachmentCount: Math.max(0, (engine.get(taskId)?.attachmentCount ?? 0) + delta) });
  const replaceInNotes = (from: string, to: string) => {
    const next = notesLive.current.replace(from, to).replace(/\n{3,}/g, '\n\n');
    setNotes(next);
    if (document.activeElement !== notesRef.current && !next.includes('](uploading:') && next !== engine.get(taskId)?.notes) saveFields({ notes: next });
  };
  const sendFiles = (files: File[], into?: { at: number }) => {
    if (!files.length) return;
    const tokens = files.map((f) => `[Uploading ${(f.name && f.name !== 'image.png' ? f.name : 'pasted image').replace(/[[\]\n]/g, '')}…](uploading:${tempId()})`);
    if (into) {
      const cur = notesLive.current;
      const before = cur.slice(0, into.at), after = cur.slice(into.at);
      const pad = (s: string, side: 'start' | 'end') => (s && !(side === 'start' ? s.endsWith('\n') : s.startsWith('\n')) ? '\n' : '');
      setNotes(`${before}${pad(before, 'start')}${tokens.join('\n')}${pad(after, 'end')}${after}`);
    }
    files.forEach((file, i) => {
      setUploading((n) => n + 1);
      const req = uploadAttachment(taskId, file);
      req.then((a) => {
        setDetail((d) => d && { ...d, attachments: d.attachments.some((x) => x.id === a.id) ? d.attachments : [...d.attachments, a] });
        countFiles(1);
        if (into) replaceInNotes(tokens[i]!, markerFor(a));
      }, (err) => {
        if (into) replaceInNotes(tokens[i]!, '');
        onNotice(messageOf(err));
      }).finally(() => setUploading((n) => n - 1));
      refreshSoon(req);
    });
  };

  if (!t) return null;

  const commitTitle = () => {
    const v = title.trim().replace(/\s+/g, ' ');
    if (!v) setTitle(t.title);
    else if (v !== t.title) saveFields({ title: v });
  };
  const commitNotes = () => {
    const v = notesLive.current;
    if (v !== t.notes && !v.includes('](uploading:')) saveFields({ notes: v });
  };

  const sectionName = (id: unknown) => sections.find((s) => s.id === id)?.name ?? 'another section';
  const userName = (id: string) => board.users.find((u) => u.id === id)?.displayName ?? 'Someone';
  const subtasks = detail?.subtasks ?? [];
  const comments = detail?.comments ?? [];
  const attachments = detail?.attachments ?? [];
  const open_ = (a: Attachment) => { openAttachment(a, setViewing).catch((err) => onNotice(messageOf(err))); };

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

  const removeFile = (a: Attachment) => {
    setDetail((d) => d && { ...d, attachments: d.attachments.filter((x) => x.id !== a.id) });
    countFiles(-1);
    const req = deleteAttachment(a.id);
    req.catch(onFailure);
    refreshSoon(req);
  };

  const toggleLike = () => {
    const on = !t.liked;
    const likerIds = on ? [...t.likerIds.filter((x) => x !== me), me] : t.likerIds.filter((x) => x !== me);
    engine.patch(taskId, { liked: on, likeCount: likerIds.length, likerIds });
    engine.save(taskId, api.like(taskId, on).then((r) => r.task));
    if (on && !reduced()) likeRef.current?.querySelector('svg')?.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.35) rotate(-12deg)' }, { transform: 'scale(1)' }], { duration: 360, easing: EASE_OUT });
  };
  const likers = t.likerIds.map((id) => (id === me ? 'you' : userName(id)));
  const likedBy = likers.length ? `Liked by ${list(likers)}` : 'No likes yet';

  const deleteTask = () => {
    engine.remove(taskId);
    api.deleteTask(taskId).catch(onFailure);
    onClose();
  };

  // Pasting or dropping files into the description uploads them where the caret is.
  const filesIn = (data: DataTransfer | null) => [...(data?.files ?? [])];
  const onNotesPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = filesIn(e.clipboardData);
    if (!files.length) return;
    e.preventDefault();
    sendFiles(files, { at: e.currentTarget.selectionStart ?? notesLive.current.length });
  };
  const onNotesDrop = (e: DragEvent<HTMLElement>) => {
    const files = filesIn(e.dataTransfer);
    if (!files.length) return;
    e.preventDefault();
    e.stopPropagation();
    setDropping(false);
    const at = e.currentTarget === notesRef.current ? notesRef.current.selectionStart ?? notesLive.current.length : notesLive.current.length;
    setEditingNotes(true);
    sendFiles(files, { at });
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

  const showNotesView = !editingNotes && notes.trim() !== '';

  return (
    <aside
      ref={pane}
      className={`pane${shown ? ' is-open' : ''}${dropping ? ' is-dropping' : ''}`}
      aria-label="Task details"
      tabIndex={-1}
      inert={!open}
      onTransitionEnd={(e) => { if (e.target === pane.current && !open) onClosed(); }}
      onDragOver={(e) => { if (hasFiles(e)) { e.preventDefault(); setDropping(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false); }}
      onDrop={(e) => {
        const files = filesIn(e.dataTransfer);
        setDropping(false);
        if (!files.length) return;
        e.preventDefault();
        sendFiles(files);
      }}
    >
      <div className="pane-bar">
        <button type="button" className="pane-complete" aria-pressed={t.completed} onClick={() => engine.toggle(taskId)}>
          <Check /><span>{t.completed ? 'Completed' : 'Mark complete'}</span>
        </button>
        <div className="pane-bar-end">
          <button type="button" ref={likeRef} className="pane-like" aria-pressed={t.liked} aria-label={`Like. ${likedBy}.`} title={likedBy} onClick={toggleLike}>
            <Thumb />{t.likeCount > 0 && <span>{t.likeCount}</span>}
          </button>
          <button type="button" className="pane-close" aria-label="Close task details" onClick={onClose}><Close /></button>
        </div>
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
          <label className="pane-h" htmlFor="pane-notes" id="pane-notes-label">Description</label>
          {showNotesView ? (
            <div
              className="pane-notes pane-notes-view" role="button" tabIndex={0} aria-labelledby="pane-notes-label" aria-describedby="pane-notes-hint"
              onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) setEditingNotes(true); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); setEditingNotes(true); } }}
              onDragOver={(e) => { if (hasFiles(e)) e.preventDefault(); }}
              onDrop={onNotesDrop}
            >
              <NotesView text={notes} attachments={attachments} onOpen={open_} />
              <span className="sr-only" id="pane-notes-hint">Press Enter to edit.</span>
            </div>
          ) : (
            <textarea
              id="pane-notes" ref={notesRef} className="pane-notes" rows={3} maxLength={20000} autoFocus={editingNotes}
              placeholder="What is this task about? Paste or drop images and files here."
              value={notes} onChange={(e) => setNotes(e.target.value)}
              onFocus={() => setEditingNotes(true)}
              onBlur={() => { commitNotes(); setEditingNotes(false); }}
              onPaste={onNotesPaste}
              onDragOver={(e) => { if (hasFiles(e)) e.preventDefault(); }}
              onDrop={onNotesDrop}
            />
          )}
        </div>

        <div className="pane-block">
          <div className="pane-h-row">
            <h2 className="pane-h">Attachments{attachments.length > 0 && <span className="pane-sub-count">{attachments.length}</span>}</h2>
            <button type="button" className="pane-attach" onClick={() => fileInput.current?.click()}><Clip />Attach files</button>
            <input ref={fileInput} type="file" multiple hidden onChange={(e) => { sendFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
          </div>
          {uploading > 0 && <p className="pane-empty" role="status">Uploading {uploading} file{uploading === 1 ? '' : 's'}…</p>}
          {attachments.length > 0 ? (
            <ul className="pane-files">
              {attachments.map((a) => <FileTile key={a.id} a={a} onOpen={() => open_(a)} onRemove={() => removeFile(a)} />)}
            </ul>
          ) : !uploading && detail && <p className="pane-empty">Drop files on this panel, or paste an image into the description.</p>}
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
          <div className="pane-h-row">
            <h2 className="pane-h" id="pane-feed-h">{feed === 'comments' ? 'Comments' : 'Activity'}</h2>
            <div className="pane-seg" role="radiogroup" aria-label="Show">
              <button type="button" role="radio" aria-checked={feed === 'comments'} onClick={() => setFeed('comments')}>Comments</button>
              <button type="button" role="radio" aria-checked={feed === 'all'} onClick={() => setFeed('all')}>All activity</button>
            </div>
          </div>
          {!detail ? <p className="pane-empty">{t.commentCount ? 'Loading comments…' : 'No comments yet.'}</p> : (
            <ol className="pane-feed" aria-labelledby="pane-feed-h">
              {feedOf(feed, comments, detail.activity).map((item) => item.kind === 'comment' ? (
                <li key={`c-${item.c.id}`} className="pane-comment">
                  <Avatar board={board} id={item.c.authorId} />
                  <div>
                    <p className="pane-comment-by"><strong>{userName(item.c.authorId)}</strong> <span>{when(item.c.createdAt)}</span></p>
                    <p className="pane-comment-body">{item.c.body}</p>
                  </div>
                </li>
              ) : (
                <li key={`a-${item.a.id}`} className="pane-event">
                  <span className="pane-event-dot" aria-hidden="true" />
                  <p><strong>{userName(item.a.actorId)}</strong> {describe(item.a, sectionName)} <span>{when(item.a.createdAt)}</span></p>
                </li>
              ))}
              {feed === 'comments' && comments.length === 0 && <li className="pane-empty">No comments yet.</li>}
            </ol>
          )}
        </div>

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
        <textarea id="pane-say" rows={1} maxLength={10000} placeholder="Write a comment" value={say}
          onChange={(e) => setSay(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) postComment(); }} />
        <button type="submit" className="bd-btn">Comment</button>
      </form>

      {dropping && <div className="pane-drop" aria-hidden="true"><span>Drop to attach</span></div>}
      {viewing && <Lightbox a={viewing} onClose={() => setViewing(null)} />}
    </aside>
  );
}
