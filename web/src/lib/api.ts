import type { Attachment, Board, Comment, Project, Section, Session, Task, TaskDetail, User } from '../types';

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

async function request<T>(method: string, path: string, body?: unknown, file?: Blob): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (file) headers['Content-Type'] = 'application/octet-stream';
  else if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(ORIGIN + path, { method, headers, body: file ?? (body === undefined ? undefined : JSON.stringify(body)) });
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

// ---- attachments
export const MAX_FILE = 10 * 1024 * 1024;
const MIME = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/;

// A pasted screenshot arrives as "image.png"; give it a name that says when it was pasted.
function nameFor(file: File) {
  if (file.name && file.name !== 'image.png') return file.name;
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const ext = (file.type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'png';
  return `Pasted image ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}.${ext}`;
}

export async function uploadAttachment(taskId: string, file: File): Promise<Attachment> {
  const name = nameFor(file);
  if (file.size > MAX_FILE) throw new ApiError(413, 'too-large', `${name} is over 10 MB. Attach a smaller file, or share a link to it instead.`);
  if (file.size === 0) throw new ApiError(400, 'empty-file', `${name} is empty.`);
  const q = new URLSearchParams({ name });
  if (MIME.test(file.type)) q.set('type', file.type);
  return (await request<{ attachment: Attachment }>('POST', `/api/tasks/${taskId}/attachments?${q}`, undefined, file)).attachment;
}

// Files need the bearer token, so they're fetched once and shown from a blob URL for the rest of the visit.
const blobs = new Map<string, Promise<string>>();
export function attachmentUrl(id: string): Promise<string> {
  let url = blobs.get(id);
  if (!url) {
    url = fetch(`${ORIGIN}/api/attachments/${id}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }).then(async (res) => {
      if (!res.ok) throw new ApiError(res.status, 'error', 'Couldn’t load that file. It may have been removed.');
      return URL.createObjectURL(await res.blob());
    });
    blobs.set(id, url);
    url.catch(() => blobs.delete(id));
  }
  return url;
}
export const deleteAttachment = (id: string) => write<{ ok: true }>('DELETE', `/api/attachments/${id}`);
export const isImage = (a: Attachment) => /^image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml)$/.test(a.contentType);

export const messageOf = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong. Try again in a moment.');
