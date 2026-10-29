import { useEffect, useState } from 'react';
import { api, onAuthLost, setToken } from './lib/api';
import { irisTo } from './lib/iris';
import { navigate, useLocation } from './lib/router';
import { clearSession, loadSession, saveSession } from './lib/session';
import { Landing } from './pages/Landing';
import { SignIn } from './pages/SignIn';
import { Workspace } from './pages/Workspace';
import type { Session } from './types';

const BOARD = /^\/p\/([0-9a-f-]{36})(?:\/t\/([0-9a-f-]{36}))?\/?$/;

// Only paths inside this app are followed after signing in.
const safeNext = (next: string | null) => (next && next.startsWith('/') && !next.startsWith('//') ? next : '/board');

function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, { replace: true }), [to]);
  return null;
}

export function App() {
  const loc = useLocation();
  const [path, search = ''] = loc.split('?');
  const [session, setSession] = useState<Session | null>(() => {
    const s = loadSession();
    setToken(s?.token ?? null);
    return s;
  });

  // The API refused the token (expired, signed out elsewhere, password changed): back to sign-in, then here.
  useEffect(() => {
    onAuthLost(() => {
      clearSession();
      setToken(null);
      setSession(null);
      const here = location.pathname.replace(import.meta.env.BASE_URL.replace(/\/$/, ''), '') || '/';
      navigate(`/signin?next=${encodeURIComponent(here)}`, { replace: true });
    });
    return () => onAuthLost(null);
  }, []);

  // Signing in: the sign-in page stays put until the iris covers it, then the board opens underneath.
  const [leaving, setLeaving] = useState(false);
  const signedIn = (s: Session) => {
    saveSession(s);
    setToken(s.token);
    setSession(s);
    setLeaving(true);
    void irisTo(safeNext(new URLSearchParams(search).get('next')), { replace: true }).finally(() => setLeaving(false));
  };

  const signOut = async () => {
    await api.logout().catch(() => undefined);
    clearSession();
    setToken(null);
    setSession(null);
    navigate('/signin', { replace: true });
  };

  if (path === '/signin') {
    return session && !leaving ? <Redirect to={safeNext(new URLSearchParams(search).get('next'))} /> : <SignIn onSignedIn={signedIn} username={new URLSearchParams(search).get('u') ?? ''} />;
  }
  const m = path!.match(BOARD);
  if (path === '/board' || m) {
    if (!session) return <Redirect to={`/signin?next=${encodeURIComponent(path!)}`} />;
    return <Workspace session={session} projectId={m?.[1] ?? null} taskId={m?.[2] ?? null} onSignOut={signOut} />;
  }
  return <Landing signedIn={!!session} />;
}
