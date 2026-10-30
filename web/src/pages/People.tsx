import { useEffect, useRef, useState, type FormEvent } from 'react';
import { initials, when } from '../board/format';
import { api, messageOf } from '../lib/api';
import type { Person, User } from '../types';

interface Props {
  me: User;
}

// The account whose password rotates on the server; the page never resets or turns it off.
const ROTATED = 'admin';
const isRotated = (p: Person) => p.username.toLowerCase() === ROTATED;

function status(p: Person) {
  if (p.disabled) return 'Turned off';
  if (!p.lastSeenAt) return 'Hasn’t signed in yet';
  if (p.sessions > 0 && Date.now() - new Date(p.lastSeenAt).getTime() < 10 * 60_000) return 'Here now';
  return `Last here ${when(p.lastSeenAt).toLowerCase()}`;
}

type Ask = { id: string; what: 'reset' | 'off' } | null;
type Shown = { name: string; username: string; password: string; fresh: boolean } | null;

// Who can sign in, for admins: add someone, rename them, change their role, turn them off, reset a password.
// A new password is shown once, here, and never again.
export function People({ me }: Props) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ username: '', displayName: '', role: 'member' as User['role'] });
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<Ask>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [shown, setShown] = useState<Shown>(null);
  const [copied, setCopied] = useState(false);
  const shownRef = useRef<HTMLDivElement>(null);
  const tones = useRef(new Map<string, number>());

  useEffect(() => {
    document.title = 'People · Asanaka';
    let alive = true;
    api.people().then((r) => { if (alive) setPeople(r.users); }, (err) => { if (alive) setError(messageOf(err)); });
    return () => { alive = false; };
  }, []);

  useEffect(() => { if (shown) shownRef.current?.focus(); }, [shown]);

  // Avatar fills follow the board's rule (order people are listed in), kept stable while the list changes.
  const toneOf = (id: string) => {
    if (!tones.current.has(id)) tones.current.set(id, tones.current.size % 4);
    return tones.current.get(id)!;
  };
  const put = (u: Person) => setPeople((ps) => (ps ? (ps.some((x) => x.id === u.id) ? ps.map((x) => (x.id === u.id ? u : x)) : [...ps, u]) : [u]));
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (err) { setError(messageOf(err)); } finally { setBusy(false); }
  };

  const add = (e: FormEvent) => {
    e.preventDefault();
    const username = form.username.trim(), displayName = form.displayName.trim().replace(/\s+/g, ' ');
    if (!username || !displayName) { setError('Give the person a username and a name.'); return; }
    void run(async () => {
      const r = await api.addPerson(username, displayName, form.role);
      put(r.user);
      setForm({ username: '', displayName: '', role: 'member' });
      setAdding(false);
      setCopied(false);
      setShown({ name: r.user.displayName, username: r.user.username, password: r.password, fresh: true });
    });
  };
  const reset = (p: Person) => run(async () => {
    const r = await api.resetPassword(p.id);
    put(r.user);
    setAsk(null);
    setCopied(false);
    setShown({ name: p.displayName, username: p.username, password: r.password, fresh: false });
  });
  const update = (p: Person, fields: Parameters<typeof api.updatePerson>[1]) => run(async () => {
    put((await api.updatePerson(p.id, fields)).user);
    setAsk(null);
    setRenaming(null);
  });
  const copy = async () => {
    if (!shown) return;
    try { await navigator.clipboard.writeText(shown.password); setCopied(true); } catch { setError('Couldn’t copy. Select the password and copy it yourself.'); }
  };

  return (
    <section className="people" aria-labelledby="people-h">
      <header className="people-top">
        <div>
          <h1 id="people-h">People</h1>
          <p>Everyone who can sign in to Asanaka.</p>
        </div>
        {!adding && <button type="button" className="bd-primary" onClick={() => { setAdding(true); setShown(null); }}>Add a person</button>}
      </header>

      {error && <p className="people-error" role="alert">{error}</p>}

      {shown && (
        <div className="people-pass" ref={shownRef} tabIndex={-1} role="status" aria-labelledby="pass-h">
          <h2 id="pass-h">{shown.fresh ? `${shown.name} can sign in now` : `${shown.name} has a new password`}</h2>
          <p>Username <strong>{shown.username}</strong>. This password is shown once. Send it to {shown.name.split(' ')[0]} yourself; they can change it under their name after signing in.{shown.fresh ? '' : ' They’ve been signed out everywhere.'}</p>
          <div className="people-pass-row">
            <code className="people-pass-value" aria-label="Password">{shown.password}</code>
            <button type="button" className="bd-btn" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
            <button type="button" className="bd-btn-quiet" onClick={() => setShown(null)}>Done</button>
          </div>
        </div>
      )}

      {adding && (
        <form className="people-add" onSubmit={add} aria-labelledby="add-h">
          <h2 id="add-h">Add a person</h2>
          <div className="people-fields">
            <label className="people-field">
              <span>Name people see</span>
              <input className="pane-input" autoFocus maxLength={60} autoComplete="off" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
            </label>
            <label className="people-field">
              <span>Username for signing in</span>
              <input className="pane-input" maxLength={40} autoComplete="off" autoCapitalize="none" spellCheck={false} pattern="[A-Za-z0-9._\-]{2,40}"
                title="2 to 40 letters, digits, dots, dashes or underscores" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </label>
            <label className="people-field">
              <span>Role</span>
              <select className="pane-input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as User['role'] })}>
                <option value="member">Member</option>
                <option value="admin">Admin: can manage people</option>
              </select>
            </label>
          </div>
          <div className="people-row-actions">
            <button type="submit" className="bd-btn" aria-busy={busy}>Add and make a password</button>
            <button type="button" className="bd-btn-quiet" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </form>
      )}

      {!people ? (
        !error && <p className="board-state" role="status"><span className="dot" aria-hidden="true" />Loading people…</p>
      ) : (
        <ul className="people-list">
          {people.map((p) => {
            const self = p.id === me.id, rotated = isRotated(p);
            return (
              <li key={p.id} className={`people-card${p.disabled ? ' is-off' : ''}`}>
                <span className="bd-avatar people-avatar" data-tone={toneOf(p.id)} aria-hidden="true">{initials(p.displayName)}</span>
                <div className="people-who">
                  {renaming === p.id ? (
                    <form onSubmit={(e) => { e.preventDefault(); const v = draft.trim().replace(/\s+/g, ' '); if (v && v !== p.displayName) void update(p, { displayName: v }); else setRenaming(null); }}>
                      <label className="sr-only" htmlFor={`rn-${p.id}`}>Name for {p.username}</label>
                      <input id={`rn-${p.id}`} className="pane-input people-rename" autoFocus maxLength={60} value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setRenaming(null); } }} />
                    </form>
                  ) : (
                    <h2>{p.displayName}{self && <span className="people-you"> (you)</span>}</h2>
                  )}
                  <p>
                    <span>{p.username}</span>
                    <span className="people-chip" data-role={p.role}>{p.role === 'admin' ? 'Admin' : 'Member'}</span>
                    <span>{status(p)}</span>
                  </p>
                  {rotated && <p className="people-note">Its password rotates on the server: run rotate-admin-password.bat on the PC.</p>}
                </div>

                <div className="people-row-actions">
                  {ask?.id === p.id ? (
                    <>
                      <span className="people-ask">{ask.what === 'reset' ? `Make a new password for ${p.displayName}? They’ll be signed out everywhere.` : `Turn off ${p.displayName}? They’ll be signed out and can’t sign in until you turn them back on.`}</span>
                      <button type="button" className="bd-btn is-danger" aria-busy={busy} onClick={() => (ask.what === 'reset' ? reset(p) : update(p, { disabled: true }))}>
                        {ask.what === 'reset' ? 'Reset password' : 'Turn off'}
                      </button>
                      <button type="button" className="bd-btn-quiet" onClick={() => setAsk(null)}>Keep as is</button>
                    </>
                  ) : (
                    <>
                      {renaming !== p.id && <button type="button" className="people-act" onClick={() => { setRenaming(p.id); setDraft(p.displayName); }}>Rename</button>}
                      {!self && !rotated && !p.disabled && (
                        <button type="button" className="people-act" onClick={() => update(p, { role: p.role === 'admin' ? 'member' : 'admin' })}>
                          {p.role === 'admin' ? 'Make member' : 'Make admin'}
                        </button>
                      )}
                      {!self && !rotated && !p.disabled && <button type="button" className="people-act" onClick={() => { setAsk({ id: p.id, what: 'reset' }); setShown(null); }}>Reset password</button>}
                      {!self && !rotated && (p.disabled
                        ? <button type="button" className="people-act" onClick={() => update(p, { disabled: false })}>Turn on</button>
                        : <button type="button" className="people-act is-danger" onClick={() => setAsk({ id: p.id, what: 'off' })}>Turn off</button>)}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
