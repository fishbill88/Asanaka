import type { Session } from '../types';

// The sign-in token lives in this browser only, until it expires (12 hours) or you sign out.
const KEY = 'asanaka.session';

export function loadSession(): Session | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null') as Session | null;
    if (s?.token && new Date(s.expiresAt).getTime() > Date.now()) return s;
  } catch {
    // Storage blocked or the value is damaged: treat it as signed out.
  }
  clearSession();
  return null;
}

export function saveSession(s: Session) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode: the session lasts this tab */ }
}

export function clearSession() {
  try { localStorage.removeItem(KEY); } catch { /* nothing stored */ }
}
