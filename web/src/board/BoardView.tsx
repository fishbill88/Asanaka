import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, messageOf } from '../lib/api';
import { connectLive } from '../lib/live';
import { follow, href, navigate } from '../lib/router';
import type { Board, Section } from '../types';
import { pinCelebration } from './celebrate';
import { SORTS, mountBoard, type BoardEngine, type SortKey } from './engine';
import { TaskPane } from './TaskPane';

interface Props {
  projectId: string;
  taskId: string | null;
  me: string;
  onBoard(b: Board): void;
}

// One project's board. The engine owns the columns and cards; this component loads the data, turns the
// engine's changes into API calls, keeps the live stream open so other people's changes arrive, and shows
// the task pane for /p/<project>/t/<task>.

// The sort is a per-browser preference for each project.
const sortKey = (projectId: string) => `asanaka.sort.${projectId}`;
function savedSort(projectId: string): SortKey {
  try { const v = localStorage.getItem(sortKey(projectId)); return v && v in SORTS ? (v as SortKey) : 'manual'; } catch { return 'manual'; }
}
function saveSort(projectId: string, k: SortKey) {
  try { if (k === 'manual') localStorage.removeItem(sortKey(projectId)); else localStorage.setItem(sortKey(projectId), k); } catch { /* storage blocked: lasts this visit */ }
}
export function BoardView({ projectId, taskId, me, onBoard }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const band = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<BoardEngine | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [missing, setMissing] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [paneId, setPaneId] = useState<string | null>(taskId);
  const [remote, setRemote] = useState<{ id: string; n: number } | null>(null);
  const openTask = useRef(taskId);
  useEffect(() => { openTask.current = taskId; }, [taskId]);
  const reloadRef = useRef<() => void>(() => {});
  const onBoardRef = useRef(onBoard);
  useEffect(() => { onBoardRef.current = onBoard; }, [onBoard]);

  // A refused change: say why, then show the board as the server has it.
  const fail = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.status === 401) return; // signed out; the app takes you to sign-in
    setToast(`Not saved. ${messageOf(err)}`);
    reloadRef.current();
  }, []);

  useEffect(() => {
    let alive = true;
    let eng: BoardEngine | null = null;
    let stopLive = () => {};
    const cheer = pinCelebration(band.current!);
    let reloading = false;
    const reload = async () => {
      if (reloading || !eng) return;
      reloading = true;
      try {
        const b = await api.board(projectId);
        if (alive) { eng.replace(b); setBoard(b); onBoardRef.current(b); }
      } catch (err) {
        if (alive && !(err instanceof ApiError && err.status === 401)) setToast(messageOf(err));
      } finally {
        reloading = false;
      }
    };
    reloadRef.current = () => { void reload(); };

    api.board(projectId).then((b) => {
      if (!alive) return;
      eng = mountBoard(host.current!, {
        board: b,
        me,
        actions: {
          moveTask: (id, sectionId, index) => api.updateTask(id, { sectionId, index }).then((r) => r.task),
          setCompleted: (id, completed) => api.updateTask(id, { completed }).then((r) => r.task),
          createTask: (sectionId, title, index) => api.createTask(sectionId, title, index).then((r) => r.task),
          createSection: (name) => api.createSection(projectId, name).then((r) => r.section),
          renameSection: (id, name) => api.updateSection(id, { name }).then((r) => r.section),
          moveSection: (id, index) => api.updateSection(id, { index }).then((r) => r.section),
          deleteSection: (id) => api.deleteSection(id),
        },
        onOpen: (id) => navigate(`/p/${projectId}/t/${id}`),
        onFailure: fail,
        onStale: () => { void reload(); },
        onSections: setSections,
        sort: savedSort(projectId),
        onSort: (k) => saveSort(projectId, k),
        celebrate: cheer.celebrate,
        onLand: cheer.onLand,
      });
      setEngine(eng);
      setBoard(b);
      onBoardRef.current(b);

      let n = 0;
      stopLive = connectLive(projectId, {
        onEvent: (e) => {
          if (!eng) return;
          if (e.type === 'task') {
            eng.remoteTask(e.task, e.actorId);
            setRemote({ id: e.task.id, n: ++n });
          } else if (e.type === 'task-removed') {
            const name = b.users.find((u) => u.id === e.actorId)?.displayName ?? 'Someone';
            eng.remoteRemove(e.id, e.actorId);
            if (openTask.current === e.id) {
              setToast(`${name} deleted this task.`);
              navigate(`/p/${projectId}`, { replace: true });
            }
          } else if (e.type === 'board') void reload();
        },
        onResync: () => { void reload(); },
      });
    }, (err) => {
      if (!alive || (err instanceof ApiError && err.status === 401)) return;
      setMissing(err instanceof ApiError && err.status === 404 ? 'This project isn’t here any more. It may have been archived.' : messageOf(err));
    });

    return () => {
      alive = false;
      stopLive();
      cheer.dispose();
      eng?.destroy();
      setEngine(null);
    };
  }, [projectId, me, fail]);

  // The URL says which task is open; the pane stays mounted while it slides out.
  useEffect(() => { if (taskId) setPaneId(taskId); }, [taskId]);
  useEffect(() => { engine?.select(taskId); }, [engine, taskId]);

  const closePane = useCallback(() => {
    if (paneId) engine?.focusCard(paneId);
    navigate(`/p/${projectId}`);
  }, [engine, paneId, projectId]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(id);
  }, [toast]);

  return (
    <div className="board-wrap">
      <div ref={host} />
      {!engine && !missing && <p className="board-state" role="status"><span className="dot" aria-hidden="true" />Opening the board…</p>}
      {missing && (
        <div className="board-state">
          <p>{missing}</p>
          <a className="bd-btn" href={href('/board')} onClick={(e) => follow(e, '/board')}>Go to your first project</a>
        </div>
      )}
      {engine && board && paneId && (
        <TaskPane
          taskId={paneId}
          open={!!taskId}
          engine={engine}
          board={board}
          sections={sections}
          me={me}
          onClose={closePane}
          onClosed={() => setPaneId(null)}
          onFailure={fail}
          onNotice={setToast}
          remote={remote}
        />
      )}
      <div ref={band} className="done-band" aria-hidden="true" hidden>
        <div className="done-pill"><strong>Nahuman na.</strong><span /></div>
      </div>
      <div className="toast-slot" role="status" aria-live="polite">
        {toast && (
          <p className="toast">
            <span>{toast}</span>
            <button type="button" aria-label="Dismiss" onClick={() => setToast(null)}>OK</button>
          </p>
        )}
      </div>
    </div>
  );
}
