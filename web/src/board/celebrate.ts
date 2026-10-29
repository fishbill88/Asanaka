import type { Cheer } from './engine';
import { burst, reduced, ring } from './motion';

// Design B's celebration is its motif: rings spread from the check, round confetti in the palette, and
// "Nahuman na." (Cebuano: "it's finished") rises as a magenta pill with the task's name.
const DOTS = ['#b0298f', '#ffc013', '#0a0a0a', '#f1e3b5', '#cbe4f2'];
const MAGENTA = '#b0298f';

export function pinCelebration(band: HTMLElement) {
  const pill = band.querySelector<HTMLElement>('.done-pill')!;
  const line = pill.querySelector('span')!;
  let timer = 0;

  function sayDone(title: string) {
    if (reduced()) return;
    clearTimeout(timer);
    line.textContent = `${title} is finished.`;
    band.hidden = false;
    pill.getAnimations().forEach((a) => a.cancel());
    pill.animate([{ transform: 'translateY(140%) scale(0.9)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 460, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' });
    timer = window.setTimeout(() => {
      pill.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateY(140%) scale(0.94)', opacity: 0 }], { duration: 300, easing: 'cubic-bezier(0.76, 0, 0.24, 1)', fill: 'forwards' })
        .onfinish = () => { band.hidden = true; };
    }, 1600);
  }

  return {
    celebrate({ layer, x, y, task }: Cheer) {
      ring(layer, x, y, { color: MAGENTA, count: 3, size: 26, scale: 5, stroke: 3, duration: 760 });
      burst(layer, x, y, { colors: DOTS, count: 18, size: 10, round: true, distance: 120, gravity: 60, spread: Math.PI * 2 });
      sayDone(task.title);
    },
    // A card arriving somewhere gets one ring on its dot: "you are here".
    onLand({ card, layer }: { card: HTMLElement; layer: HTMLElement }) {
      const c = card.querySelector('.bd-check')?.getBoundingClientRect();
      if (c) ring(layer, c.left + c.width / 2, c.top + c.height / 2, { color: MAGENTA, count: 1, size: 24, scale: 3, stroke: 3, duration: 600 });
    },
    dispose() { clearTimeout(timer); },
  };
}
