import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, api, apiConfigured, messageOf } from '../lib/api';
import { follow, href } from '../lib/router';
import type { Session } from '../types';

// Design B's sign-in: the motif as a ball rising from the corner, the form on the sky.
// `username` arrives from the landing page's "Sign in as ___ and go"; the password is the only thing left.
export function SignIn({ onSignedIn, username: given = '' }: { onSignedIn(s: Session): void; username?: string }) {
  const [username, setUsername] = useState(given);
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [bad, setBad] = useState<'username' | 'password' | null>(null);
  const userRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = 'Sign in · Asanaka';
    (given ? passRef : userRef).current?.focus();
  }, [given]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const name = username.trim();
    if (!name) { setError('Enter your username.'); setBad('username'); userRef.current?.focus(); return; }
    if (!password) { setError('Enter your password.'); setBad('password'); passRef.current?.focus(); return; }
    setBusy(true);
    setError('');
    setBad(null);
    try {
      onSignedIn(await api.login(name, password));
    } catch (err) {
      setBusy(false);
      setError(err instanceof ApiError && err.status === 401
        ? 'That username and password don’t match. Check both and try again.'
        : messageOf(err));
      setBad('password');
      passRef.current?.select();
    }
  };

  return (
    <section className="signin" aria-labelledby="signin-title">
      <div className="signin-ball" aria-hidden="true" />
      <a className="signin-top" href={href('/')} onClick={(e) => follow(e, '/')}><span className="dot" aria-hidden="true" />Asanaka</a>
      <form className="signin-card" onSubmit={submit} noValidate>
        <h1 id="signin-title"><span>Sign in.</span><span>You are here.</span></h1>
        <div className="field">
          <label htmlFor="si-user">Username</label>
          <input id="si-user" ref={userRef} name="username" autoComplete="username" autoCapitalize="none" spellCheck={false}
            aria-invalid={bad === 'username'} aria-describedby="si-error" value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="si-pass">Password</label>
          <div className="field-row">
            <input id="si-pass" ref={passRef} name="password" type={show ? 'text' : 'password'} autoComplete="current-password"
              aria-invalid={bad === 'password'} aria-describedby="si-error" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" className="reveal" aria-controls="si-pass" aria-pressed={show} onClick={() => setShow((s) => !s)}>{show ? 'Hide' : 'Show'}</button>
          </div>
        </div>
        <p className="form-error" id="si-error" role="alert">{apiConfigured ? error : 'This copy of the site was built without the board’s server address, so signing in can’t work yet.'}</p>
        <button className="btn" type="submit" aria-busy={busy} disabled={!apiConfigured}>
          <span className="spin" aria-hidden="true" /><span>{busy ? 'Signing in…' : 'Sign in'}</span>
        </button>
        <p className="signin-note">No account? Ask the admin to make one. <a href={href('/')} onClick={(e) => follow(e, '/')}>Back to the page</a></p>
      </form>
    </section>
  );
}
