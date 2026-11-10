import { Fragment } from 'react';

// Web addresses in plain text become links. The text is never parsed as HTML: everything else stays a string,
// and only http and https addresses (or ones starting with www.) are linked, so `javascript:` can't sneak in.
const URLISH = /\b(?:https?:\/\/|www\.)[^\s<>"]+/gi;
const TRAILING = /[.,;:!?'"*_~]+$/;

/** Trims the punctuation a sentence puts after an address, keeping a closing bracket that belongs to it. */
function trim(raw: string) {
  let s = raw.replace(TRAILING, '');
  for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']] as const) {
    while (s.endsWith(close) && s.split(close).length > s.split(open).length) s = s.slice(0, -1).replace(TRAILING, '');
  }
  return s;
}

function hrefOf(text: string) {
  try {
    const u = new URL(/^www\./i.test(text) ? `https://${text}` : text);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

export function Linkify({ text }: { text: string }) {
  const parts: (string | { text: string; href: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(URLISH)) {
    const shown = trim(m[0]);
    const href = shown && hrefOf(shown);
    if (!href) continue;
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push({ text: shown, href });
    last = m.index + shown.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return (
    <>
      {parts.map((p, i) => typeof p === 'string'
        ? <Fragment key={i}>{p}</Fragment>
        : <a key={i} className="text-link" href={p.href} target="_blank" rel="noopener noreferrer">{p.text}</a>)}
    </>
  );
}
