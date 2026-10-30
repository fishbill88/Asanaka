import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { BoardView } from '../board/BoardView';
import { initials, toneOf } from '../board/format';
import { api, messageOf } from '../lib/api';
import { follow, href, navigate } from '../lib/router';
import type { Board, Project, Session, User } from '../types';
import { AccountMenu, ChangePassword, canChangePassword } from './Account';
import { People } from './People';

interface Props {
  session: Session;
  view?: 'board' | 'people';
  projectId: string | null;
  taskId: string | null;
  onSignOut(): void;
}

const Plus = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
);

// The signed-in app: projects on the left, the board of the one you're in (or People, for admins), your
// name, password and sign-out. On a phone the sidebar folds into the top bar and your avatar's menu.
export function Workspace({ session, view = 'board', projectId, taskId, onSignOut }: Props) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [users, setUsers] = useState<User[]>([session.user]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    let alive = true;
    api.projects().then((r) => { if (alive) setProjects(r.projects); }, (err) => { if (alive) setError(messageOf(err)); });
    return () => { alive = false; };
  }, []);

  // /board opens the first project.
  useEffect(() => {
    if (view === 'board' && projects?.length && !projectId) navigate(`/p/${projects[0]!.id}`, { replace: true });
  }, [view, projects, projectId]);

  const current = projects?.find((p) => p.id === projectId);
  useEffect(() => { if (view === 'board') document.title = current ? `${current.name} · Asanaka` : 'Asanaka'; }, [view, current]);

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
  const isAdmin = me.role === 'admin';
  const meAvatar = <span className="bd-avatar" data-tone={toneOf(users, me.id)} aria-hidden="true">{initials(me.displayName)}</span>;
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
                <a className="side-proj" href={href(`/p/${p.id}`)} aria-current={view === 'board' && p.id === projectId ? 'page' : undefined} onClick={(e) => follow(e, `/p/${p.id}`)}>
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
          {isAdmin && (
            <>
              <h2 className="side-h-gap">Admin</h2>
              <a className="side-proj" href={href('/people')} aria-current={view === 'people' ? 'page' : undefined} onClick={(e) => follow(e, '/people')}>
                <span className="dot side-dot-ink" aria-hidden="true" /><span className="side-proj-name">People</span>
              </a>
            </>
          )}
        </nav>
        <p className="side-tip">Tap a dot to finish a task. Drag a card to move it, or press Space on it, then the arrow keys, then Space. Enter opens a card; Q adds one.</p>
        <div className="side-me">
          {meAvatar}
          <span>{me.displayName}</span>
          <div className="side-me-actions">
            {canChangePassword(me) && <button type="button" onClick={() => setChanging(true)}>Change password</button>}
            <button type="button" onClick={onSignOut}>Sign out</button>
          </div>
        </div>
      </aside>

      <div className="app-top">
        {mark}
        {projects && projects.length > 1 && (
          <select className="app-top-project" aria-label="Project" value={projectId ?? ''} onChange={(e) => navigate(`/p/${e.target.value}`)}>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <AccountMenu avatar={meAvatar} label={`${me.displayName}: account`}>
          {view === 'people' && projects?.[0] && <button type="button" role="menuitem" onClick={() => navigate(`/p/${projects[0]!.id}`)}>Back to the board</button>}
          {isAdmin && view !== 'people' && <button type="button" role="menuitem" onClick={() => navigate('/people')}>People</button>}
          {canChangePassword(me) && <button type="button" role="menuitem" onClick={() => setChanging(true)}>Change password</button>}
          <button type="button" role="menuitem" onClick={onSignOut}>Sign out</button>
        </AccountMenu>
      </div>

      <main className="app-main">
        {view === 'people' ? (
          isAdmin ? <People me={me} /> : <div className="board-state"><p>Only an admin can manage people.</p></div>
        ) : error && !projects ? (
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
      <ChangePassword open={changing} onClose={() => setChanging(false)} />
    </div>
  );
}
