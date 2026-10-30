import type { LiveEvent } from '../types';
import { CLIENT_ID, apiBase, authToken, signalAuthLost } from './api';

/* Live updates for one project: the API's server-sent-events stream, read with fetch because EventSource
   can't send the bearer token. It reconnects by itself, waiting longer after each failure; once it is back,
   `onResync` runs, since changes made while it was away were not sent. A stream that goes quiet past two
   missed heartbeats is treated as dropped (a laptop waking from sleep, a network change). */

export type LiveState = 'connecting' | 'live' | 'retrying';
export interface LiveOptions {
  onEvent(e: Exclude<LiveEvent, { type: 'hello' | 'signed-out' }>): void;
  onResync(): void;
  onState?(s: LiveState): void;
}

const WAITS = [1000, 2000, 5000, 10000, 30000];
const QUIET = 60_000;

export function connectLive(projectId: string, o: LiveOptions): () => void {
  let stopped = false;
  let ac: AbortController | null = null;
  let tries = 0;
  let wasLive = false;
  let retry = 0;
  let waiting = false;
  let heard = Date.now();

  async function open() {
    if (stopped) return;
    ac = new AbortController();
    heard = Date.now();
    o.onState?.(wasLive ? 'retrying' : 'connecting');
    try {
      const res = await fetch(`${apiBase}/api/projects/${projectId}/events?client=${CLIENT_ID}`, {
        headers: { Authorization: `Bearer ${authToken()}`, Accept: 'text/event-stream' },
        cache: 'no-store',
        signal: ac.signal,
      });
      if (res.status === 401) { stopped = true; signalAuthLost(); return; }
      if (res.status === 404) { stopped = true; return; } // archived: the board says so on its next load
      if (!res.ok || !res.body) throw new Error(`stream answered ${res.status}`);
      await read(res.body);
    } catch {
      // dropped or refused: try again below
    }
    if (stopped) return;
    o.onState?.('retrying');
    waiting = true;
    retry = window.setTimeout(() => { waiting = false; void open(); }, WAITS[Math.min(tries++, WAITS.length - 1)]! * (0.8 + Math.random() * 0.4));
  }

  async function read(body: ReadableStream<Uint8Array>) {
    const reader = body.getReader();
    const text = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done || stopped) return;
      heard = Date.now();
      buf += text.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = frame.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
        if (!data) continue;
        let e: LiveEvent;
        try { e = JSON.parse(data) as LiveEvent; } catch { continue; }
        if (e.type === 'hello') {
          tries = 0;
          o.onState?.('live');
          if (wasLive) o.onResync();
          wasLive = true;
        } else if (e.type === 'signed-out') {
          stopped = true;
          signalAuthLost();
          return;
        } else o.onEvent(e);
      }
    }
  }

  const watchdog = window.setInterval(() => { if (!stopped && Date.now() - heard > QUIET) ac?.abort(); }, 15_000);
  // Back online: retry now rather than at the end of a long wait.
  const online = () => {
    if (stopped) return;
    tries = 0;
    if (waiting) { clearTimeout(retry); waiting = false; void open(); } else if (Date.now() - heard > 5000) ac?.abort();
  };
  addEventListener('online', online);
  void open();

  return () => {
    stopped = true;
    clearTimeout(retry);
    clearInterval(watchdog);
    removeEventListener('online', online);
    ac?.abort();
  };
}
