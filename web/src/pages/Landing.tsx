import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { pinCelebration } from '../board/celebrate';
import { mountBoard, type BoardEngine } from '../board/engine';
import { burst, reduced, ring } from '../board/motion';
import { irisTo } from '../lib/iris';
import { href } from '../lib/router';
import type { Board, Task } from '../types';
import mapPic from '../assets/map-of-cebu-city.webp';
import routePic from '../assets/jeepney-in-cebu-city-route-04c-january.webp';
import duskPic from '../assets/jeepney-in-cebu-city-january-2021.webp';
import kanbanPic from '../assets/simple-kanban-board.webp';

gsap.registerPlugin(ScrollTrigger);

const PLAN_URL = 'https://github.com/fishbill88/Asanaka/blob/main/PLAN.md';
const REPO_URL = 'https://github.com/fishbill88/Asanaka';
const CHECK = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 12.5l3.6 3.6 7.4-8.2" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;

// ---- the live board on the hero stage: the real engine, with changes kept in the page
const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function demoBoard(): Board {
  const t = (id: string, sectionId: string, title: string, o: Partial<Task> = {}): Task => ({
    id, projectId: 'demo', sectionId, parentId: null, title, notes: '', assigneeId: null, dueOn: null, priority: null, status: null,
    completed: sectionId === 'done', completedAt: null, previousSectionId: null, position: id, createdAt: '', updatedAt: '',
    subtaskCount: 0, subtaskDoneCount: 0, commentCount: 0, attachmentCount: 0, likeCount: 0, liked: false, likerIds: [], ...o,
  });
  return {
    project: { id: 'demo', name: 'Demo', color: '#b0298f', position: 'a0', doneSectionId: 'done', createdAt: '' },
    sections: [{ id: 'todo', projectId: 'demo', name: 'To do', position: 'a0' }, { id: 'doing', projectId: 'demo', name: 'Doing', position: 'a1' }, { id: 'done', projectId: 'demo', name: 'Done', position: 'a2' }],
    users: [
      { id: 'ap', username: 'ameerperalta', displayName: 'Ameer Peralta', role: 'member', avatarHue: 0 },
      { id: 'bi', username: 'admin', displayName: 'Biloy', role: 'admin', avatarHue: 0 },
    ],
    tasks: [
      t('h1', 'todo', 'Write the sign-in error messages', { assigneeId: 'bi', dueOn: day(4), priority: 'medium' }),
      t('h2', 'todo', 'Nightly backup at 03:17', { assigneeId: 'bi', dueOn: day(6), priority: 'low' }),
      t('h3', 'doing', 'Move the board API onto the VPS', { assigneeId: 'ap', dueOn: day(1), priority: 'high' }),
      t('h4', 'doing', 'Cards make room while you drag', { assigneeId: 'ap', dueOn: day(-1) }),
      t('h5', 'done', 'Seed the two accounts', { assigneeId: 'bi', dueOn: day(-2) }),
    ],
  };
}

// ---- the plate: three things a card tells you; the pin moves on the picture
const TABS = {
  where: {
    title: 'Every task has an address.',
    desc: 'Its section is its street: To do, Doing, Review, Done. One look at the board says where a task stands, the way a pin on a map says where you are.',
    cap: <>Cebu City in 1699, on a museum wall. The language in our name is spoken here. Photo: Agravanteflav, <a href="https://commons.wikimedia.org/wiki/File:Map_of_Cebu_City.jpg" rel="noopener">CC0, Wikimedia Commons</a>.</>,
    pic: mapPic, alt: 'A 1699 site plan of Cebu City shown in a museum: a grid of blocks, a cathedral and the shoreline.', at: '52% 48%', pin: [50, 50],
  },
  who: {
    title: 'Every task has a driver.',
    desc: 'The initials on a card say who has it. Change the assignee in the task pane and the card says so on everyone’s screen.',
    cap: <>A jeepney on its route in Cebu City. Photo: Martin Michlmayr, <a href="https://commons.wikimedia.org/wiki/File:Jeepney_in_Cebu_City_route_04C_January_2021.jpg" rel="noopener">CC BY-SA 4.0, Wikimedia Commons</a>.</>,
    pic: routePic, alt: 'A silver and blue jeepney with riders inside, driving up a street in Cebu City.', at: '54% 60%', pin: [44, 56],
  },
  when: {
    title: 'Every task has a time.',
    desc: 'A due date that warns you. Today shows in magenta, late in red, and Due this week filters the board down to what’s close.',
    cap: <>Riders heading home at dusk in Cebu City. Photo: Martin Michlmayr, <a href="https://commons.wikimedia.org/wiki/File:Jeepney_in_Cebu_City_January_2021.jpg" rel="noopener">CC BY-SA 4.0, Wikimedia Commons</a>.</>,
    pic: duskPic, alt: 'A blue jeepney full of riders at dusk in Cebu City, blurred with speed.', at: '48% 50%', pin: [58, 44],
  },
} as const;
type Tab = keyof typeof TABS;
const TAB_KEYS = Object.keys(TABS) as Tab[];

const STEPS = [
  { title: 'First, write it down.', text: 'Click Add task at the bottom of a section, type, press Enter. The box stays open for the next one.' },
  { title: 'Then drag it to where it is.', text: 'Pick the card up and the others make room. Drop it in Doing and everyone sees it there.' },
  { title: 'Tap the dot when it’s done.', text: 'The dot fills, the card glides into Done, and the column counts itself again. Nahuman na.' },
];
const MINI_COUNTS = [[3, 1, 1], [2, 2, 1], [2, 1, 2]];

export function Landing({ signedIn }: { signedIn: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const heroBoard = useRef<HTMLDivElement>(null);
  const band = useRef<HTMLDivElement>(null);
  const mini = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>('where');
  const [step, setStep] = useState(1);
  const [user, setUser] = useState('');
  const to = signedIn ? '/board' : '/signin';
  const go = (e: MouseEvent, path = to) => { e.preventDefault(); void irisTo(path); };

  useEffect(() => { document.title = 'Asanaka · Asa na ka? The board knows.'; }, []);

  // The demo board on the stage, kept inside the circle whatever the window's shape.
  useEffect(() => {
    const el = heroBoard.current!;
    const cheer = pinCelebration(band.current!);
    let eng: BoardEngine | null = null;
    const here = (id: string) => Promise.resolve({ ...eng!.get(id)! });
    const refuse = () => Promise.reject(new Error('The demo board keeps its changes in this page.'));
    eng = mountBoard(el, {
      board: demoBoard(), me: 'ap', compact: true,
      actions: { moveTask: here, setCompleted: here, createTask: refuse, createSection: refuse, renameSection: refuse, moveSection: refuse, deleteSection: refuse },
      onOpen: () => {}, onFailure: () => {}, onStale: () => {},
      celebrate: cheer.celebrate, onLand: cheer.onLand,
    });
    const place = () => {
      const hero = el.closest<HTMLElement>('.hero')!, stage = hero.querySelector<HTMLElement>('.stage')!, hint = hero.querySelector<HTMLElement>('.stage-hint')!, copy = hero.querySelector<HTMLElement>('.hero-copy')!;
      if (matchMedia('(max-width: 900px)').matches) { el.style.left = el.style.top = el.style.width = hint.style.left = hint.style.top = ''; return; }
      const r = stage.offsetWidth / 2, cx = stage.offsetLeft + r, cy = stage.offsetTop + r;
      const top = Math.max(hero.clientHeight * 0.5, copy.offsetTop + copy.offsetHeight - 40);
      const edgeAt = (y: number) => cx - Math.sqrt(Math.max(0, (r - 36) ** 2 - (cy - y) ** 2));
      const left = Math.max(edgeAt(top - 44), edgeAt(top), copy.offsetLeft + 520);
      el.style.left = `${left}px`;
      el.style.width = `${Math.max(520, Math.min(640, hero.clientWidth - left - 32))}px`;
      el.style.top = `${top}px`;
      hint.style.left = `${left}px`;
      hint.style.top = `${top - 44}px`;
    };
    place();
    addEventListener('resize', place);
    void document.fonts?.ready.then(place);
    return () => { removeEventListener('resize', place); cheer.dispose(); eng?.destroy(); };
  }, []);

  // How a card moves: the step nearest the middle of the screen drives the fragment.
  useLayoutEffect(() => {
    const m = mini.current!;
    const fit = () => {
      const mover = m.querySelector<HTMLElement>('.mini-mover')!;
      const h = mover.offsetHeight + 8;
      m.querySelectorAll<HTMLElement>('.mini-spacer').forEach((sp) => { sp.style.height = `${h}px`; });
      mover.style.top = `${m.querySelector<HTMLElement>('.mini-spacer')!.offsetTop}px`;
    };
    fit();
    addEventListener('resize', fit);
    void document.fonts?.ready.then(fit);
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) setStep(Number((e.target as HTMLElement).dataset.step));
    }, { rootMargin: '-45% 0px -45% 0px' });
    root.current!.querySelectorAll('.how-step').forEach((s) => io.observe(s));
    return () => { removeEventListener('resize', fit); io.disconnect(); };
  }, []);

  useEffect(() => {
    if (step !== 3 || reduced()) return;
    const id = window.setTimeout(() => {
      const c = mini.current?.querySelector('.mini-mover .bd-check')?.getBoundingClientRect();
      if (!c) return;
      const layer = document.body.appendChild(Object.assign(document.createElement('div'), { className: 'bd-layer' }));
      ring(layer, c.left + c.width / 2, c.top + c.height / 2, { color: '#b0298f', count: 3, size: 22, scale: 4, stroke: 3, duration: 760 });
      burst(layer, c.left + c.width / 2, c.top + c.height / 2, { colors: ['#b0298f', '#ffc013', '#0a0a0a', '#f1e3b5'], count: 14, size: 9, round: true, distance: 90, gravity: 50, spread: Math.PI * 2 });
      window.setTimeout(() => layer.remove(), 1400);
    }, 720);
    return () => clearTimeout(id);
  }, [step]);

  // Reveal each part of a section once, in reading order; then the scroll-linked moves.
  useEffect(() => {
    const els = root.current!.querySelectorAll('[data-reveal]');
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.1 });
    els.forEach((el) => io.observe(el));
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.to('.stage', { scale: 1.08, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
      gsap.fromTo('.plate-frame', { rotate: -8 }, { rotate: 0, ease: 'none', scrollTrigger: { trigger: '.plate', start: 'top bottom', end: 'center center', scrub: true } });
      gsap.utils.toArray<HTMLElement>('.tile-ui').forEach((el) => gsap.fromTo(el, { y: 30 }, { y: -30, ease: 'none', scrollTrigger: { trigger: el.parentElement, start: 'top bottom', end: 'bottom top', scrub: true } }));
      gsap.from('.mark span', { yPercent: 100, stagger: 0.06, ease: 'power3.out', duration: 0.9, scrollTrigger: { trigger: '.foot', start: 'top 85%' } });
    }, root.current!);
    return () => { io.disconnect(); mm.revert(); };
  }, []);

  // Changing tab: the text rises again and the pin pulses where it lands.
  const tabsSeen = useRef(false);
  useEffect(() => {
    if (!tabsSeen.current) { tabsSeen.current = true; return; }
    const r = root.current!;
    const pin = r.querySelector<HTMLElement>('.plate-pin')!;
    pin.classList.remove('is-pulsing');
    void pin.offsetWidth;
    pin.classList.add('is-pulsing');
    if (!reduced()) r.querySelectorAll('.plate-body h2, .plate-body p:first-of-type').forEach((el, i) =>
      el.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 380, delay: i * 70, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' }));
  }, [tab]);

  const onTabKey = (e: KeyboardEvent) => {
    const i = TAB_KEYS.indexOf(tab);
    const next = e.key === 'ArrowRight' ? TAB_KEYS[(i + 1) % 3] : e.key === 'ArrowLeft' ? TAB_KEYS[(i + 2) % 3] : null;
    if (!next) return;
    e.preventDefault();
    setTab(next);
    root.current!.querySelector<HTMLElement>(`#tab-${next}`)?.focus();
  };

  const closeForm = (e: FormEvent) => {
    e.preventDefault();
    const u = user.trim();
    void irisTo(signedIn ? '/board' : `/signin${u ? `?u=${encodeURIComponent(u)}` : ''}`);
  };

  const t = TABS[tab];
  const counts = MINI_COUNTS[step - 1]!;

  return (
    <div className="landing" ref={root}>
      <header className="nav gutter">
        <a className="wordmark" href="#top"><span className="dot" aria-hidden="true" />Asanaka</a>
        <nav aria-label="Main">
          <a className="link" href="#where">Where</a>
          <a className="link" href="#how">How it moves</a>
          <a className="link" href="#close">Up close</a>
          <a className="link" href={href(to)} onClick={go}>{signedIn ? 'Open the board' : 'Sign in'}</a>
        </nav>
      </header>

      <main>
        <section className="hero gutter" id="top" aria-labelledby="hero-title">
          <div className="hero-copy">
            <h1 id="hero-title" data-rise style={{ '--i': 0 } as CSSProperties}><span>Asa na ka?</span><span>The board knows.</span></h1>
            <p className="hero-sub" data-rise style={{ '--i': 1 } as CSSProperties}>Cebuano for “where are you now?” Asanaka is a kanban board for a small team. Drag a card and everyone sees where it went.</p>
            <a className="btn" href={href(to)} onClick={go} data-rise style={{ '--i': 2 } as CSSProperties}>{signedIn ? 'Open the board' : 'Sign in'}</a>
          </div>
          <div className="stage" aria-hidden="true" />
          <p className="stage-hint" data-rise style={{ '--i': 4 } as CSSProperties}><span className="dot" aria-hidden="true" />A live board. Drag a card, or tap its dot.</p>
          <div className="stage-board" data-ui="" ref={heroBoard} aria-label="Sample board you can try" />
        </section>

        <section className="plate" id="where" aria-labelledby="plate-title">
          <div className="plate-pic">
            <figure className="plate-frame" data-reveal="pop">
              {TAB_KEYS.map((k) => (
                <img key={k} src={TABS[k].pic} width={1600} height={1200} alt={k === tab ? TABS[k].alt : ''} aria-hidden={k !== tab}
                  className={k === tab ? 'is-on' : undefined} style={{ objectPosition: TABS[k].at }} loading={k === 'where' ? 'eager' : 'lazy'} decoding="async" />
              ))}
              <span className="plate-ring" aria-hidden="true" />
              <span className="plate-pin" aria-hidden="true" style={{ left: `${t.pin[0]}%`, top: `${t.pin[1]}%` }} />
            </figure>
          </div>
          <div className="plate-text">
            <div className="tabs" role="tablist" aria-label="What a card tells you" onKeyDown={onTabKey}>
              {TAB_KEYS.map((k) => (
                <button key={k} type="button" role="tab" id={`tab-${k}`} aria-selected={k === tab} aria-controls="plate-body" tabIndex={k === tab ? 0 : -1} onClick={() => setTab(k)}>
                  {k[0]!.toUpperCase() + k.slice(1)}
                </button>
              ))}
            </div>
            <div className="plate-body" id="plate-body" role="tabpanel" aria-labelledby={`tab-${tab}`}>
              <h2 id="plate-title">{t.title}</h2>
              <p>{t.desc}</p>
              <p className="plate-cap">{t.cap}</p>
            </div>
            <div className="cells">
              <a className="btn btn--ink" href={href(to)} onClick={go}>Open the board</a>
              <a className="btn btn--tone" href={PLAN_URL} rel="noopener">How it’s built</a>
            </div>
          </div>
        </section>

        <section className="how gutter" id="how" aria-labelledby="how-title">
          <div className="how-steps">
            <h2 id="how-title">How a card moves</h2>
            {STEPS.map((s, i) => (
              <div key={s.title} className={`how-step${step === i + 1 ? ' is-active' : ''}`} data-step={i + 1}>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </div>
            ))}
          </div>
          <div className="how-stage">
            <div className="mini" data-ui="" data-state={step} ref={mini} aria-hidden="true">
              <div className="mini-board">
                {['To do', 'Doing', 'Done'].map((name, i) => (
                  <div className="mini-col" key={name}>
                    <div className="mini-head">{name} <i>{counts[i]}</i></div>
                    <div className="mini-spacer" />
                    <div className="mini-card">
                      <span className={`bd-check${i === 2 ? ' is-filled' : ''}`}>{i === 2 && CHECK}</span>
                      <span>{['Write the sign-in errors', 'Move the API to the VPS', 'Seed the two accounts'][i]}</span>
                    </div>
                  </div>
                ))}
                <div className="mini-mover"><div className="mini-card"><span className="bd-check">{CHECK}</span><span>Book the room for Friday<span className="caret" /></span></div></div>
              </div>
            </div>
          </div>
        </section>

        <section className="tiles" id="close" aria-labelledby="tiles-title">
          <div className="tile t-h"><h2 id="tiles-title">Up close</h2></div>
          <div className="tile t-a" data-reveal style={{ '--i': 0 } as CSSProperties}><div data-ui="" className="tile-ui big-check" aria-hidden="true"><span className="bd-check">{CHECK}</span></div><p className="tile-cap"><strong>Finish with one tap</strong><span>The dot fills, and the card moves to Done.</span></p></div>
          <div className="tile t-b" data-reveal style={{ '--i': 1 } as CSSProperties}><div data-ui="" className="tile-ui big-avatars" aria-hidden="true"><span>AP</span><span>BI</span><span>+</span></div><p className="tile-cap"><strong>Give it to someone</strong><span>Initials on every card.</span></p></div>
          <div className="tile t-c" data-reveal style={{ '--i': 2 } as CSSProperties}><div data-ui="" className="tile-ui big-due" aria-hidden="true"><span>Today</span></div><p className="tile-cap"><strong>Dates that warn you</strong><span>Today and late stand out.</span></p></div>
          <div className="tile t-d" data-reveal style={{ '--i': 0 } as CSSProperties}><div data-ui="" className="tile-ui big-drag" aria-hidden="true"><div className="mini-card"><span className="bd-check" /><span>Cards make room while you drag</span></div></div><p className="tile-cap"><strong>Drag it anywhere</strong><span>The other cards slide out of the way.</span></p></div>
          <div className="tile t-e" data-reveal style={{ '--i': 1 } as CSSProperties}><figure className="tile-ui big-clip" data-ui=""><img src={kanbanPic} width={1600} height={954} alt="A paper kanban board on a wall, sticky notes in columns." loading="lazy" decoding="async" /><figcaption aria-hidden="true">board.jpg</figcaption></figure><p className="tile-cap"><strong>Paste a screenshot</strong><span>It uploads into the description and shows in place.</span></p></div>
          <div className="tile t-f" data-reveal style={{ '--i': 2 } as CSSProperties}><div data-ui="" className="tile-ui big-compose" aria-hidden="true"><b>Book the room for Fri</b><span className="caret" /></div><p className="tile-cap"><strong>Add without leaving</strong><span>Type, press Enter, type the next one.</span></p></div>
          <div className="tile t-g" data-reveal style={{ '--i': 3 } as CSSProperties}><div data-ui="" className="tile-ui big-comment" aria-hidden="true"><i>AP</i><span>Containers are up. Caddy next.</span></div><p className="tile-cap"><strong>Talk on the task</strong><span>Comments sit with the work they’re about.</span></p></div>
        </section>

        <section className="close gutter" id="signup" aria-label={signedIn ? 'Open the board' : 'Sign in'}>
          {signedIn ? (
            <form onSubmit={closeForm}><span>You’re signed in.</span><span className="line2"><button type="submit">Open the board</button></span></form>
          ) : (
            <form onSubmit={closeForm}>
              <span>Sign in as</span>
              <span className="line2">
                <input aria-label="Username" placeholder="username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={user} onChange={(e) => setUser(e.target.value)} />
                <span className="and">and</span>
                <button type="submit">go</button>
              </span>
            </form>
          )}
          <p className="close-note">{signedIn ? 'Your board is where you left it.' : 'You’ll type your password on the next screen, then land on your board.'}</p>
        </section>
      </main>

      <footer className="foot gutter">
        <div className="mark" role="img" aria-label="Asanaka">{[...'Asanaka'].map((c, i) => <span key={i} aria-hidden="true">{c}</span>)}</div>
        <div className="foot-links">
          <div className="foot-col"><h3>On this page</h3><ul><li><a className="link" href="#where">Where</a></li><li><a className="link" href="#how">How it moves</a></li><li><a className="link" href="#close">Up close</a></li></ul></div>
          <div className="foot-col"><h3>The board</h3><ul><li><a className="link" href={href(to)} onClick={go}>{signedIn ? 'Open the board' : 'Sign in'}</a></li><li>Enter opens a card</li><li>Alt and arrows move it</li></ul></div>
          <div className="foot-col"><h3>The code</h3><ul><li><a className="link" href={REPO_URL} rel="noopener">GitHub</a></li><li><a className="link" href={PLAN_URL} rel="noopener">The plan</a></li></ul></div>
          <div className="foot-col"><h3>The name</h3><p>Asa na ka? is Cebuano for “where are you now?”</p></div>
          <div className="foot-contact"><span><span className="dot" aria-hidden="true" /> fishbill88.github.io/Asanaka</span><span>One motif: the circle you tap to finish a task.</span></div>
        </div>
        <p className="credits">Pictures: <a href="https://commons.wikimedia.org/wiki/File:Map_of_Cebu_City.jpg" rel="noopener">“Map of Cebu City”</a> by Agravanteflav, CC0; <a href="https://commons.wikimedia.org/wiki/File:Jeepney_in_Cebu_City_route_04C_January_2021.jpg" rel="noopener">“Jeepney in Cebu City route 04C”</a> and <a href="https://commons.wikimedia.org/wiki/File:Jeepney_in_Cebu_City_January_2021.jpg" rel="noopener">“Jeepney in Cebu City”</a> by Martin Michlmayr, <a href="https://creativecommons.org/licenses/by-sa/4.0" rel="noopener">CC BY-SA 4.0</a>; <a href="https://commons.wikimedia.org/wiki/File:Simple-kanban-board-.jpg" rel="noopener">“Simple-kanban-board-”</a> by Jeff.lasovski, <a href="https://creativecommons.org/licenses/by-sa/3.0" rel="noopener">CC BY-SA 3.0</a>; all via Wikimedia Commons, re-encoded as WebP.</p>
        <div className="foot-legal"><span>© 2026 Asanaka.</span><a className="btn btn--ink" href="#top">Back to top</a></div>
      </footer>

      <div ref={band} className="done-band" aria-hidden="true" hidden>
        <div className="done-pill"><strong>Nahuman na.</strong><span /></div>
      </div>
    </div>
  );
}
