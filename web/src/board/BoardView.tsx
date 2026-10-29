import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, messageOf } from '../lib/api';
import { follow, href, navigate } from '../lib/router';
import type { Board, Section } from '../types';
import { pinCelebration } from './celebrate';
import { mountBoard, type BoardEngine } from './engine';
import { TaskPane } from './TaskPane';

interface Props {
  projectId: string;
  taskId: string | null;
  me: string;
  onBoard(b: Board): void;
}

// One project's board. The engine owns the columns and cards; this component loads the data, turns the
// engine's changes into API calls, and shows the task pane for /p/<project>/t/<task>.
export function BoardView({ projectId, taskId, me, onBoard }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const band = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<BoardEngine | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [missing, setMissing] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [paneId, setPaneId] = useState<string | null>(taskId);
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
        celebrate: cheer.celebrate,
        onLand: cheer.onLand,
      });
      setEngine(eng);
      setBoard(b);
      onBoardRef.current(b);
    }, (err) => {
      if (!alive || (err instanceof ApiError && err.status === 401)) return;
      setMissing(err instanceof ApiError && err.status === 404 ? 'This project isn’t here any more. It may have been archived.' : messageOf(err));
    });

    return () => {
      alive = false;
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
