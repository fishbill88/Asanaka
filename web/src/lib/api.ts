import type { Board, Comment, Project, Section, Session, Task, TaskDetail, User } from '../types';

// The API's address is baked in at build time from the ASANAKA_API_ORIGIN repository variable. In
// development the site calls its own origin and Vite passes /api through (see vite.config.ts).
const ORIGIN = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_ORIGIN ?? '').replace(/\/+$/, '');
export const apiConfigured = import.meta.env.DEV || ORIGIN !== '';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

let token: string | null = null;
let authLost: (() => void) | null = null;
export const setToken = (t: string | null) => { token = t; };
export const onAuthLost = (fn: (() => void) | null) => { authLost = fn; };

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(ORIGIN + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'offline', 'Couldn’t reach the board’s server. Check your connection and try again.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // A 401 with a token means the session ended (expired, signed out elsewhere, password changed).
    if (res.status === 401 && token) authLost?.();
    throw new ApiError(res.status, data?.error ?? 'error', data?.message ?? `The server answered ${res.status}. Try again in a moment.`);
  }
  return data as T;
}

// Changes go out one at a time, in the order they were made, so a quick move-then-tick can't arrive swapped.
let chain: Promise<unknown> = Promise.resolve();
function inOrder<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn);
  chain = next.catch(() => undefined);
  return next;
}
const write = <T>(method: string, path: string, body?: unknown) => inOrder(() => request<T>(method, path, body));

export type TaskFields = Partial<Pick<Task, 'title' | 'notes' | 'assigneeId' | 'dueOn' | 'priority' | 'status' | 'completed'>> & { sectionId?: string; index?: number };

export const api = {
  login: (username: string, password: string) => request<Session>('POST', '/api/auth/login', { username, password }),
  logout: () => request<{ ok: true }>('POST', '/api/auth/logout'),
  me: () => request<{ user: User }>('GET', '/api/me'),

  projects: () => request<{ projects: Project[] }>('GET', '/api/projects'),
  createProject: (name: string) => write<{ project: Project }>('POST', '/api/projects', { name }),
  board: (projectId: string) => request<Board>('GET', `/api/projects/${projectId}/board`),

  createSection: (projectId: string, name: string) => write<{ section: Section }>('POST', `/api/projects/${projectId}/sections`, { name }),
  updateSection: (id: string, fields: { name?: string; index?: number }) => write<{ section: Section }>('PATCH', `/api/sections/${id}`, fields),
  deleteSection: (id: string) => write<{ ok: true; movedTasks: number; movedTo: string }>('DELETE', `/api/sections/${id}`),

  task: (id: string) => request<TaskDetail>('GET', `/api/tasks/${id}`),
  createTask: (sectionId: string, title: string, index?: number) => write<{ task: Task }>('POST', `/api/sections/${sectionId}/tasks`, { title, index }),
  updateTask: (id: string, fields: TaskFields) => write<{ task: Task }>('PATCH', `/api/tasks/${id}`, fields),
  deleteTask: (id: string) => write<{ ok: true }>('DELETE', `/api/tasks/${id}`),
  addSubtask: (id: string, title: string) => write<{ task: Task }>('POST', `/api/tasks/${id}/subtasks`, { title }),
  addComment: (id: string, body: string) => write<{ comment: Comment }>('POST', `/api/tasks/${id}/comments`, { body }),
};

export const messageOf = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong. Try again in a moment.');
