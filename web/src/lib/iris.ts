import { navigate } from './router';

// Design B's view change: a circle of magenta opens from where you pressed, the page changes underneath,
// and the circle closes on the wordmark's dot. Without motion it is a plain navigation.
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const EASE = 'cubic-bezier(0.76, 0, 0.24, 1)';
let press = { x: innerWidth / 2, y: innerHeight / 2 };
addEventListener('pointerdown', (e) => { press = { x: e.clientX, y: e.clientY }; }, true);

let turn = 0;
export async function irisTo(to: string, { replace = false } = {}) {
  if (reduced()) { navigate(to, { replace }); scrollTo(0, 0); return; }
  const mine = ++turn;
  document.querySelectorAll('.iris').forEach((x) => x.remove());
  const el = document.createElement('div');
  el.className = 'iris';
  el.setAttribute('aria-hidden', 'true');
  document.body.append(el);
  const { x, y } = press;
  const far = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  try {
    await el.animate([{ clipPath: `circle(0px at ${x}px ${y}px)` }, { clipPath: `circle(${far}px at ${x}px ${y}px)` }], { duration: 560, easing: EASE, fill: 'forwards' }).finished;
    if (mine !== turn) return;
    navigate(to, { replace });
    scrollTo(0, 0);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const end = '48px 44px';
    await el.animate([{ clipPath: `circle(${Math.hypot(innerWidth, innerHeight)}px at ${end})` }, { clipPath: `circle(0px at ${end})` }], { duration: 620, easing: EASE, fill: 'forwards' }).finished;
  } catch {
    if (mine === turn) navigate(to, { replace });
  } finally {
    el.remove();
  }
}
