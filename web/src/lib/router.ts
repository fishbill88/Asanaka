import { useSyncExternalStore, type MouseEvent } from 'react';

// A small router over the History API. Paths inside the app are written without the /Asanaka base.
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
const EVENT = 'asanaka:navigate';

const read = () => {
  const p = location.pathname.startsWith(BASE) ? location.pathname.slice(BASE.length) : location.pathname;
  return (p || '/') + location.search;
};
const subscribe = (fn: () => void) => {
  addEventListener('popstate', fn);
  addEventListener(EVENT, fn);
  return () => {
    removeEventListener('popstate', fn);
    removeEventListener(EVENT, fn);
  };
};

/** The current path and query, e.g. "/p/<id>/t/<id>" or "/signin?next=%2Fboard". */
export const useLocation = () => useSyncExternalStore(subscribe, read);

export function navigate(to: string, { replace = false } = {}) {
  if (to === read()) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', BASE + to);
  dispatchEvent(new Event(EVENT));
}

export const href = (to: string) => BASE + to;

/** Follows an in-app link without reloading, unless the visitor asked for a new tab or window. */
export function follow(e: MouseEvent<HTMLAnchorElement>, to: string) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navigate(to);
}
