import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { attachmentUrl, isImage } from '../lib/api';
import type { Attachment } from '../types';
import { EASE_OUT, reduced } from './motion';

// Images and files on a task: tiles in the pane, images inline in the description, a lightbox.

/** A file's blob URL, fetched with the sign-in token the first time it's needed. */
export function useAttachmentUrl(id: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    attachmentUrl(id).then((u) => { if (alive) setUrl(u); }, () => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [id]);
  return { url, failed };
}

export const sizeOf = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
const extOf = (name: string) => (name.includes('.') ? name.split('.').pop()!.slice(0, 4).toUpperCase() : 'FILE');

/** Opens an image in the lightbox; any other file downloads under its own name. */
export async function openAttachment(a: Attachment, showImage: (a: Attachment) => void) {
  if (isImage(a)) { showImage(a); return; }
  const url = await attachmentUrl(a.id);
  const link = document.createElement('a');
  link.href = url;
  link.download = a.filename;
  document.body.append(link);
  link.click();
  link.remove();
}

function Thumb({ a }: { a: Attachment }) {
  const { url, failed } = useAttachmentUrl(a.id);
  if (failed) return <span className="pane-file-ext">!</span>;
  return url ? <img src={url} alt="" draggable={false} /> : <span className="pane-file-ext is-loading" />;
}

interface TileProps { a: Attachment; onOpen(): void; onRemove(): void }
export function FileTile({ a, onOpen, onRemove }: TileProps) {
  const [confirm, setConfirm] = useState(false);
  const image = isImage(a);
  return (
    <li className={`pane-file${image ? ' is-image' : ''}`}>
      <button type="button" className="pane-file-open" onClick={onOpen} aria-label={`${image ? 'View' : 'Download'} ${a.filename}`}>
        <span className="pane-file-face">{image ? <Thumb a={a} /> : <span className="pane-file-ext">{extOf(a.filename)}</span>}</span>
        <span className="pane-file-text">
          <span className="pane-file-name">{a.filename}</span>
          <span className="pane-file-size">{sizeOf(a.size)}</span>
        </span>
      </button>
      {confirm ? (
        <span className="pane-file-confirm">
          <button type="button" className="bd-btn is-danger" onClick={onRemove}>Remove</button>
          <button type="button" className="bd-btn-quiet" onClick={() => setConfirm(false)}>Keep</button>
        </span>
      ) : (
        <button type="button" className="pane-file-remove" aria-label={`Remove ${a.filename}`} onClick={() => setConfirm(true)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
      )}
    </li>
  );
}

function InlineImage({ a, onOpen }: { a: Attachment; onOpen(): void }) {
  const { url, failed } = useAttachmentUrl(a.id);
  if (failed) return <span className="pane-chip is-gone">{a.filename} (couldn’t load)</span>;
  return (
    <button type="button" className="pane-inline-img" onClick={(e) => { e.stopPropagation(); onOpen(); }} aria-label={`View ${a.filename}`}>
      {url ? <img src={url} alt={a.filename} /> : <span className="pane-inline-wait">Loading {a.filename}…</span>}
    </button>
  );
}

// Markers the description keeps for files: ![name](attachment:<id>) for images, [name](attachment:<id>)
// for other files, and [Uploading name…](uploading:<n>) while a pasted file is on its way.
const MARK = /(!?)\[([^\]\n]{0,240})\]\((attachment|uploading):([\w-]{1,40})\)/g;
export const markerFor = (a: Attachment) => `${isImage(a) ? '!' : ''}[${a.filename.replace(/[[\]\n]/g, '')}](attachment:${a.id})`;

export function NotesView({ text, attachments, onOpen }: { text: string; attachments: Attachment[]; onOpen(a: Attachment): void }) {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(MARK)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const [, bang, name, kind, id] = m;
    const a = kind === 'attachment' ? attachments.find((x) => x.id === id) : undefined;
    if (kind === 'uploading') out.push(<span key={m.index} className="pane-chip is-busy">{name}</span>);
    else if (!a) out.push(<span key={m.index} className="pane-chip is-gone">{name} (removed)</span>);
    else if (bang && isImage(a)) out.push(<InlineImage key={m.index} a={a} onOpen={() => onOpen(a)} />);
    else out.push(<button key={m.index} type="button" className="pane-chip" onClick={(e) => { e.stopPropagation(); onOpen(a); }}>{a.filename}</button>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

export function Lightbox({ a, onClose }: { a: Attachment; onClose(): void }) {
  const { url } = useAttachmentUrl(a.id);
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('.lightbox');
    el?.focus();
    if (el && !reduced()) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: EASE_OUT });
  }, []);
  return createPortal(
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={a.filename} tabIndex={-1} onClick={onClose}>
      {url && <img src={url} alt={a.filename} onClick={(e) => e.stopPropagation()} />}
      <p className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <span>{a.filename} · {sizeOf(a.size)}</span>
        {url && <a className="bd-btn" href={url} download={a.filename}>Download</a>}
        <button type="button" className="bd-btn-quiet" onClick={onClose}>Close</button>
      </p>
    </div>,
    document.body,
  );
}
