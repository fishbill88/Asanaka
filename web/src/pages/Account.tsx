import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, messageOf } from '../lib/api';
import type { User } from '../types';

// The account named "admin" changes its password by rotation on the server, not here.
export const canChangePassword = (u: User) => u.username.toLowerCase() !== 'admin';

// Change your own password: a modal dialog (focus stays inside until it closes; Escape closes it).
export function ChangePassword({ open, onClose }: { open: boolean; onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setCurrent(''); setNext(''); setAgain(''); setError(null); setDone(false);
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next.length < 10) { setError('Make the new password at least 10 characters long.'); return; }
    if (next !== again) { setError('The two new passwords don’t match. Type the new one again.'); return; }
    setBusy(true);
    setError(null);
    try {
      await api.changePassword(current, next);
      setDone(true);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className="sheet" aria-labelledby="cp-h" onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {done ? (
        <div className="sheet-body">
          <h2 id="cp-h">Password changed</h2>
          <p>You’re still signed in here. Anywhere else you were signed in, you’ll need the new password.</p>
          <div className="sheet-actions"><button type="button" className="bd-btn" autoFocus onClick={onClose}>Done</button></div>
        </div>
      ) : (
        <form className="sheet-body" onSubmit={submit}>
          <h2 id="cp-h">Change your password</h2>
          <label className="people-field">
            <span>Current password</span>
            <input className="pane-input" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
          </label>
          <label className="people-field">
            <span>New password, 10 characters or more</span>
            <input className="pane-input" type="password" autoComplete="new-password" required minLength={10} value={next} onChange={(e) => setNext(e.target.value)} />
          </label>
          <label className="people-field">
            <span>New password again</span>
            <input className="pane-input" type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} />
          </label>
          <p className="form-error" role="alert">{error}</p>
          <div className="sheet-actions">
            <button type="submit" className="bd-btn" aria-busy={busy}>Change password</button>
            <button type="button" className="bd-btn-quiet" onClick={onClose}>Cancel</button>
          </div>
        </form>
      )}
    </dialog>
  );
}

// On a phone the sidebar is hidden: your avatar opens a short menu with what it held.
export function AccountMenu({ avatar, label, children }: { avatar: ReactNode; label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', key);
    wrap.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key); };
  }, [open]);

  return (
    <div className="acct" ref={wrap}>
      <button type="button" ref={btn} className="acct-btn" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen((v) => !v)}>{avatar}</button>
      {open && (
        <div className="bd-menu acct-menu" role="menu" aria-label={label} onClick={() => setOpen(false)}
          onKeyDown={(e) => {
            const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
            const i = items.indexOf(document.activeElement as HTMLElement);
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); }
            if (e.key === 'Tab') setOpen(false);
          }}>
          {children}
        </div>
      )}
    </div>
  );
}
