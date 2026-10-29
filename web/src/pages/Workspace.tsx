import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { BoardView } from '../board/BoardView';
import { initials, toneOf } from '../board/format';
import { api, messageOf } from '../lib/api';
import { follow, href, navigate } from '../lib/router';
import type { Board, Project, Session, User } from '../types';

interface Props {
  session: Session;
  projectId: string | null;
  taskId: string | null;
  onSignOut(): void;
}

const Plus = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
);

// The signed-in app: projects on the left, the board of the one you're in, your name and sign-out.
export function Workspace({ session, projectId, taskId, onSignOut }: Props) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [users, setUsers] = useState<User[]>([session.user]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api.projects().then((r) => { if (alive) setProjects(r.projects); }, (err) => { if (alive) setError(messageOf(err)); });
    return () => { alive = false; };
  }, []);

  // /board opens the first project.
  useEffect(() => {
    if (projects?.length && !projectId) navigate(`/p/${projects[0]!.id}`, { replace: true });
  }, [projects, projectId]);

  const current = projects?.find((p) => p.id === projectId);
  useEffect(() => { document.title = current ? `${current.name} · Asanaka` : 'Asanaka'; }, [current]);

  const onBoard = useCallback((b: Board) => {
    setUsers(b.users);
    setProjects((ps) => ps?.map((p) => (p.id === b.project.id ? b.project : p)) ?? ps);
  }, []);

  const createProject = async (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim().replace(/\s+/g, ' ');
    if (!n || busy) return;
    setBusy(true);
    try {
      const { project } = await api.createProject(n);
      setProjects((ps) => [...(ps ?? []), project]);
      setAdding(false);
      setName('');
      navigate(`/p/${project.id}`);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const me = session.user;
  const meAvatar = <span className="bd-avatar" data-tone={toneOf(users, me.id)}>{initials(me.displayName)}</span>;
  const mark = (
    <a className="side-mark" href={href('/')} onClick={(e) => follow(e, '/')}><span className="dot" aria-hidden="true" />Asanaka</a>
  );

  return (
    <div className="app">
      <aside className="side" aria-label="Workspace">
        {mark}
        <nav aria-label="Projects">
          <h2>Projects</h2>
          <ul className="side-projects">
            {projects?.map((p) => (
              <li key={p.id}>
                <a className="side-proj" href={href(`/p/${p.id}`)} aria-current={p.id === projectId ? 'page' : undefined} onClick={(e) => follow(e, `/p/${p.id}`)}>
                  <span className="dot" style={{ background: p.color }} aria-hidden="true" />
                  <span className="side-proj-name">{p.name}</span>
                </a>
              </li>
            ))}
          </ul>
          {adding ? (
            <form className="side-new-form" onSubmit={createProject}>
              <label className="sr-only" htmlFor="new-project">Project name</label>
              <input id="new-project" className="side-new-input" placeholder="Name the project" maxLength={120} autoComplete="off" autoFocus
                value={name} onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setAdding(false); setName(''); } }}
                onBlur={() => { if (!name.trim()) setAdding(false); }} />
            </form>
          ) : (
            <button type="button" className="side-new" onClick={() => setAdding(true)}><Plus />New project</button>
          )}
          {error && projects && <p className="side-error" role="alert">{error}</p>}
        </nav>
        <p className="side-tip">Tap a dot to finish a task. Drag a card to move it. Enter opens one; Alt and the arrow keys move it.</p>
        <div className="side-me">
          {meAvatar}
          <span>{me.displayName}</span>
          <button type="button" onClick={onSignOut}>Sign out</button>
        </div>
      </aside>

      <div className="app-top">
        {mark}
        {projects && projects.length > 1 && (
          <select className="app-top-project" aria-label="Project" value={projectId ?? ''} onChange={(e) => navigate(`/p/${e.target.value}`)}>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <button type="button" onClick={onSignOut}>Sign out</button>
      </div>

      <main className="app-main">
        {error && !projects ? (
          <div className="board-state"><p>{error}</p></div>
        ) : projectId ? (
          <BoardView key={projectId} projectId={projectId} taskId={taskId} me={me.id} onBoard={onBoard} />
        ) : projects && projects.length === 0 ? (
          <div className="board-state">
            <p>There are no projects yet.</p>
            <button type="button" className="bd-btn" onClick={() => setAdding(true)}>Start one</button>
          </div>
        ) : (
          <p className="board-state" role="status"><span className="dot" aria-hidden="true" />Opening your projects…</p>
        )}
      </main>
    </div>
  );
}
