// Motion shared by the board and the celebration. Transform and opacity only; every move is skipped
// when the visitor asks for reduced motion.
export const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
export const EASE_IN_OUT = 'cubic-bezier(0.77, 0, 0.175, 1)';
export const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// FLIP: measure, change the DOM, then play each element from where it was to where it is.
export function flip(els: Element[], mutate: () => void, duration = 240, easing = EASE_OUT) {
  const first = new Map<HTMLElement, DOMRect>();
  for (const el of els as HTMLElement[]) if (el.isConnected && !el.hidden) first.set(el, el.getBoundingClientRect());
  for (const el of first.keys()) el.getAnimations().forEach((a) => a.cancel());
  mutate();
  if (reduced() || duration === 0) return;
  for (const [el, f] of first) {
    if (!el.isConnected || el.hidden) continue;
    const l = el.getBoundingClientRect();
    const dx = f.left - l.left, dy = f.top - l.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], { duration, easing });
  }
}

interface BurstOptions { colors?: string[]; count?: number; size?: number; round?: boolean; distance?: number; gravity?: number; spread?: number; angle?: number; duration?: number }

// Confetti from a point: the Pin direction uses round pieces in the palette.
export function burst(layer: HTMLElement, x: number, y: number, o: BurstOptions = {}) {
  if (reduced()) return;
  const lo = layer.getBoundingClientRect();
  x -= lo.left; y -= lo.top;
  const colors = o.colors ?? ['currentColor'];
  const n = o.count ?? 14;
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    p.className = 'bd-particle';
    const size = (o.size ?? 9) * (0.7 + Math.random() * 0.6);
    p.style.width = p.style.height = `${size}px`;
    p.style.background = colors[i % colors.length]!;
    if (o.round) p.style.borderRadius = '50%';
    layer.append(p);
    const a = (o.angle ?? -Math.PI / 2) + (Math.random() - 0.5) * (o.spread ?? Math.PI * 1.6);
    const dist = (o.distance ?? 120) * (0.55 + Math.random() * 0.6);
    const dx = Math.cos(a) * dist, dy = Math.sin(a) * dist;
    const rot = (Math.random() - 0.5) * 540;
    const g = o.gravity ?? 70;
    p.animate([
      { transform: `translate(${x - size / 2}px, ${y - size / 2}px) rotate(0deg) scale(0.6)`, opacity: 1 },
      { transform: `translate(${x + dx * 0.8 - size / 2}px, ${y + dy * 0.8 - size / 2}px) rotate(${rot * 0.6}deg) scale(1)`, opacity: 1, offset: 0.45 },
      { transform: `translate(${x + dx - size / 2}px, ${y + dy + g - size / 2}px) rotate(${rot}deg) scale(0.9)`, opacity: 0 },
    ], { duration: (o.duration ?? 900) * (0.8 + Math.random() * 0.4), easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }).onfinish = () => p.remove();
  }
}

interface RingOptions { color?: string; count?: number; size?: number; stroke?: number; scale?: number; duration?: number }

// Expanding rings: the "you are here" pulse.
export function ring(layer: HTMLElement, x: number, y: number, o: RingOptions = {}) {
  if (reduced()) return;
  const lo = layer.getBoundingClientRect();
  x -= lo.left; y -= lo.top;
  const s = o.size ?? 28;
  for (let i = 0; i < (o.count ?? 2); i++) {
    const r = document.createElement('i');
    r.className = 'bd-particle';
    r.style.width = r.style.height = `${s}px`;
    r.style.borderRadius = '50%';
    r.style.border = `${o.stroke ?? 3}px solid ${o.color ?? 'currentColor'}`;
    layer.append(r);
    r.animate([
      { transform: `translate(${x - s / 2}px, ${y - s / 2}px) scale(0.6)`, opacity: 0.9 },
      { transform: `translate(${x - s / 2}px, ${y - s / 2}px) scale(${o.scale ?? 4})`, opacity: 0 },
    ], { duration: o.duration ?? 700, delay: i * 140, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' }).onfinish = () => r.remove();
  }
}
