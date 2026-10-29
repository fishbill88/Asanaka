import type { Priority, Status, User } from '../types';

export const PRIORITY: Record<Priority, string> = { low: 'Low', medium: 'Medium', high: 'High' };
export const STATUS: Record<Status, string> = { on_track: 'On track', at_risk: 'At risk', off_track: 'Off track' };

const DAY = 864e5;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const parseDay = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

export type DueState = 'overdue' | 'today' | 'soon' | 'later';
export interface Due { label: string; state: DueState; diff: number }

// Due dates read relative to the viewer's today: "Today", "Tomorrow", a weekday, then a plain date.
export function dueOf(dueOn: string | null, completed: boolean): Due | null {
  if (!dueOn) return null;
  const d = parseDay(dueOn);
  const diff = Math.round((d.getTime() - today0().getTime()) / DAY);
  const plain = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  if (completed) return { label: plain, state: 'later', diff };
  if (diff < -1) return { label: plain, state: 'overdue', diff };
  if (diff === -1) return { label: 'Yesterday', state: 'overdue', diff };
  if (diff === 0) return { label: 'Today', state: 'today', diff };
  if (diff === 1) return { label: 'Tomorrow', state: 'soon', diff };
  if (diff < 7) return { label: DAYS[d.getDay()], state: 'soon', diff };
  return { label: plain, state: 'later', diff };
}

export function when(iso: string): string {
  const t = new Date(iso);
  const mins = Math.round((Date.now() - t.getTime()) / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 12) return `${Math.round(mins / 60)} h ago`;
  const days = Math.round((today0().getTime() - new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime()) / DAY);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${MONTHS[t.getMonth()]} ${t.getDate()}`;
}

// "Ameer Peralta" → AP; a one-word name gives its first two letters ("Admin" → AD).
export function initials(name: string) {
  const words = name.split(/\s+/).filter(Boolean);
  const s = words.length > 1 ? words[0]![0]! + words[1]![0]! : (words[0] ?? '?').slice(0, 2);
  return s.toUpperCase();
}

// Avatars take one of the palette's four fills, in the order people are listed, so two people never match.
export const toneOf = (users: User[], id: string) => Math.max(0, users.findIndex((u) => u.id === id)) % 4;

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
