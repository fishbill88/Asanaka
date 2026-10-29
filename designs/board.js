/* Asanaka board: the prototype engine shared by the three design directions in designs/.
   It renders a board, moves cards by pointer, touch (long press) and keyboard (Alt + arrows),
   lets the other cards make room with FLIP, adds tasks and sections inline, filters, opens the
   task pane and completes tasks. Each design styles the bd-* and pane-* classes and brings its
   own celebration. Sample data only: nothing leaves the page. */
(function () {
  'use strict';

  const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
  const EASE_IN_OUT = 'cubic-bezier(0.77, 0, 0.175, 1)';
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let seq = 0;
  const uid = (p) => p + (++seq).toString(36) + Math.random().toString(36).slice(2, 6);

  // Dates are relative to the viewer's today, so "Today" and "Yesterday" always read true.
  const DAY = 864e5;
  const today0 = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const iso = (offset) => isoOf(new Date(today0().getTime() + offset * DAY));
  const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function due(t) {
    if (!t.due) return null;
    const d = parse(t.due);
    const diff = Math.round((d - today0()) / DAY);
    const plain = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
    if (t.done) return { label: plain, state: 'later', diff };
    if (diff < -1) return { label: plain, state: 'overdue', diff };
    if (diff === -1) return { label: 'Yesterday', state: 'overdue', diff };
    if (diff === 0) return { label: 'Today', state: 'today', diff };
    if (diff === 1) return { label: 'Tomorrow', state: 'soon', diff };
    if (diff < 7) return { label: DAYS[d.getDay()], state: 'soon', diff };
    return { label: plain, state: 'later', diff };
  }

  const PEOPLE = {
    ap: { id: 'ap', name: 'Ameer Peralta', short: 'AP' },
    ad: { id: 'ad', name: 'Admin', short: 'AD' },
  };
  const SECTIONS = [
    { id: 'todo', name: 'To do' },
    { id: 'doing', name: 'Doing' },
    { id: 'review', name: 'Review' },
    { id: 'done', name: 'Done' },
  ];
  const PRIORITY = { low: 'Low', medium: 'Medium', high: 'High' };
  const STATUS = { on_track: 'On track', at_risk: 'At risk', off_track: 'Off track' };

  // The sample board is this build's own to-do list, so every card is real work.
  function sample() {
    const st = (title, done = false) => ({ id: uid('s'), title, done });
    const cm = (by, when, body) => ({ id: uid('c'), by, when, body });
    const t = (id, section, title, o = {}) => ({
      id, section, title, assignee: null, due: null, priority: null, status: null, notes: '',
      subtasks: [], comments: [], done: section === 'done', prev: null, ...o,
    });
    return {
      sections: SECTIONS.map((s) => ({ ...s })),
      tasks: [
        t('t1', 'todo', 'Pick one of the three designs', { assignee: 'ap', due: iso(0), priority: 'high', notes: 'Open Chapters, Pin and Departures, then reply with a letter.', subtasks: [st('Open Chapters', true), st('Open Pin'), st('Open Departures')], comments: [cm('ad', 'Yesterday', 'All three are in the designs folder.')] }),
        t('t2', 'todo', 'Write the sign-in error messages', { assignee: 'ad', due: iso(4), priority: 'medium', notes: 'Say what went wrong and how to fix it. No apologies.' }),
        t('t3', 'todo', 'Nightly database backup at 03:17', { assignee: 'ad', due: iso(6), priority: 'low', subtasks: [st('Dump with pg_dump -Fc'), st('Keep the last 14')] }),
        t('t4', 'todo', 'Keyboard moves for cards', { priority: 'medium', notes: 'Alt + arrow keys move a focused card between sections.' }),
        t('t5', 'doing', 'Move the board API onto the VPS', { assignee: 'ap', due: iso(1), priority: 'high', status: 'at_risk', notes: 'Own compose project, own Postgres, port 7360 on loopback only.', subtasks: [st('Compose file', true), st('Dockerfile', true), st('Caddy site'), st('Seed the two accounts'), st('Smoke test')], comments: [cm('ap', '2 h ago', 'Containers are up. Waiting on the Caddy restart.'), cm('ad', '1 h ago', 'Do it after 22:00, the box is quiet then.'), cm('ap', '40 min ago', 'Will do.')] }),
        t('t6', 'doing', 'Cards make room while you drag', { assignee: 'ap', due: iso(-1), priority: 'medium', subtasks: [st('FLIP the siblings', true), st('Autoscroll near the edges')] }),
        t('t7', 'doing', 'Task pane slides in from the right', { assignee: 'ad', due: iso(2) }),
        t('t8', 'review', 'Rotate the admin password on request', { assignee: 'ad', due: iso(3), priority: 'high', status: 'on_track', comments: [cm('ad', 'Today', 'rotate-admin-password.bat works. The old password stops at once.'), cm('ap', 'Today', 'Tested it twice, looks right.')] }),
        t('t9', 'review', 'Celebrate a finished task', { assignee: 'ap', due: iso(2), priority: 'low' }),
        t('t10', 'done', 'Seed the ameerperalta account', { assignee: 'ad', due: iso(-2) }),
        t('t11', 'done', 'Allow only fishbill88.github.io in CORS', { assignee: 'ap', due: iso(-3) }),
        t('t12', 'done', 'Inline add at the bottom of each section', { assignee: 'ap', due: iso(-4) }),
      ],
    };
  }

  const ICON = {
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="bd-check-path" d="M6.5 12.5l3.6 3.6 7.4-8.2" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    subtasks: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4v10a3 3 0 0 0 3 3h6M6 9h9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="18" cy="9" r="2.2" fill="currentColor"/><circle cx="18" cy="17" r="2.2" fill="currentColor"/></svg>',
    comment: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v10H10l-4 4v-4H5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  };

  // Layout-critical rules only; every colour and size comes from the design's own stylesheet.
  const BASE_CSS = `
[hidden]{display:none!important}
.bd{position:relative}
.bd-layer{position:fixed;inset:0;pointer-events:none;z-index:90;overflow:hidden}
.bd-ghost{position:fixed!important;left:0;top:0;margin:0!important;pointer-events:none;will-change:transform;z-index:91}
.bd-fly{position:fixed;left:0;top:0;will-change:transform;z-index:92}
.bd-fly>.bd-ghost{position:absolute!important}
.bd-list{position:relative}
.bd-card{touch-action:pan-x pan-y;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;cursor:grab}
.bd-card.is-placeholder>*{visibility:hidden}
.bd-card.is-arriving{opacity:0}
.bd-grabbing,.bd-grabbing *{cursor:grabbing!important}
.bd-particle{position:absolute;left:0;top:0;pointer-events:none;will-change:transform,opacity}
.bd .sr-only,.sr-only{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.pane{transform:translateX(104%);transition:transform 380ms cubic-bezier(0.32,0.72,0,1)}
.pane.is-open{transform:none}
@media (prefers-reduced-motion: reduce){.pane{transition:opacity 200ms ease;transform:none;opacity:0}.pane.is-open{opacity:1}}
`;
  function injectBase() {
    if (document.getElementById('bd-base-css')) return;
    const s = document.createElement('style');
    s.id = 'bd-base-css';
    s.textContent = BASE_CSS;
    document.head.prepend(s);
  }

  // FLIP: measure, change the DOM, then play each element from where it was to where it is.
  function flip(els, mutate, duration = 240, easing = EASE_OUT) {
    const first = new Map();
    for (const el of els) if (el.isConnected && !el.hidden) first.set(el, el.getBoundingClientRect());
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

  // Particles for celebrations: shape, colours and spread are the design's choice.
  function burst(layer, x, y, o = {}) {
    if (reduced() || !layer) return;
    const lo = layer.getBoundingClientRect();
    x -= lo.left; y -= lo.top;
    const colors = o.colors || ['currentColor'];
    const n = o.count || 14;
    for (let i = 0; i < n; i++) {
      const p = document.createElement('i');
      p.className = 'bd-particle ' + (o.className || '');
      const size = (o.size || 9) * (0.7 + Math.random() * 0.6);
      p.style.width = p.style.height = size + 'px';
      p.style.background = colors[i % colors.length];
      if (o.round) p.style.borderRadius = '50%';
      layer.append(p);
      const a = (o.angle ?? -Math.PI / 2) + (Math.random() - 0.5) * (o.spread ?? Math.PI * 1.6);
      const dist = (o.distance || 120) * (0.55 + Math.random() * 0.6);
      const dx = Math.cos(a) * dist, dy = Math.sin(a) * dist;
      const rot = (Math.random() - 0.5) * 540;
      const g = o.gravity ?? 70;
      p.animate([
        { transform: `translate(${x - size / 2}px, ${y - size / 2}px) rotate(0deg) scale(0.6)`, opacity: 1 },
        { transform: `translate(${x + dx * 0.8 - size / 2}px, ${y + dy * 0.8 - size / 2}px) rotate(${rot * 0.6}deg) scale(1)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${x + dx - size / 2}px, ${y + dy + g - size / 2}px) rotate(${rot}deg) scale(0.9)`, opacity: 0 },
      ], { duration: (o.duration || 900) * (0.8 + Math.random() * 0.4), easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }).onfinish = () => p.remove();
    }
  }

  // Expanding rings, for the Pin direction's "you are here" pulse.
  function ring(layer, x, y, o = {}) {
    if (reduced() || !layer) return;
    const lo = layer.getBoundingClientRect();
    x -= lo.left; y -= lo.top;
    const n = o.count || 2;
    for (let i = 0; i < n; i++) {
      const r = document.createElement('i');
      r.className = 'bd-particle bd-ring ' + (o.className || '');
      const s = o.size || 28;
      r.style.width = r.style.height = s + 'px';
      r.style.borderRadius = '50%';
      r.style.border = `${o.stroke || 3}px solid ${o.color || 'currentColor'}`;
      layer.append(r);
      r.animate([
        { transform: `translate(${x - s / 2}px, ${y - s / 2}px) scale(0.6)`, opacity: 0.9 },
        { transform: `translate(${x - s / 2}px, ${y - s / 2}px) scale(${o.scale || 4})`, opacity: 0 },
      ], { duration: o.duration || 700, delay: i * 140, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' }).onfinish = () => r.remove();
    }
  }

  function mount(root, opts = {}) {
    injectBase();
    const data = opts.data || sample();
    const me = opts.me || 'ap';
    const compact = !!opts.compact;
    const P = uid('b');
    const listeners = [];
    const state = { filter: 'all', current: null, lastFocus: null, lastDragEnd: 0 };
    const task = (id) => data.tasks.find((t) => t.id === id);
    const section = (id) => data.sections.find((s) => s.id === id);
    const doneId = () => (data.sections.find((s) => s.id === 'done') || data.sections[data.sections.length - 1]).id;

    root.classList.add('bd');
    root.setAttribute('data-ui', '');
    if (compact) root.classList.add('bd-compact');

    const avatar = (pid, extra = '') => {
      const p = PEOPLE[pid];
      return p ? `<span class="bd-avatar ${extra}" data-p="${p.id}" title="${esc(p.name)}">${p.short}</span>` : '';
    };

    const colHTML = (s) => `
      <section class="bd-col" data-section="${esc(s.id)}" aria-labelledby="${P}-h-${esc(s.id)}">
        <header class="bd-col-head">
          <span class="bd-col-swatch" aria-hidden="true"></span>
          <h3 class="bd-col-name" id="${P}-h-${esc(s.id)}">${esc(s.name)}</h3>
          <span class="bd-col-count" aria-label="tasks">0</span>
          ${compact ? '' : `<button type="button" class="bd-col-plus" aria-label="Add a task to ${esc(s.name)}">${ICON.plus}</button>`}
        </header>
        <div class="bd-list"></div>
        ${compact ? '' : `<button type="button" class="bd-add">${ICON.plus}<span>Add task</span></button>`}
      </section>`;

    root.innerHTML = `
      ${compact ? '' : `
      <div class="bd-top">
        <div class="bd-proj">
          <h2 class="bd-proj-name">${esc(opts.project || 'Asanaka launch')}</h2>
          <div class="bd-people" aria-label="Members">${Object.keys(PEOPLE).map((id) => avatar(id)).join('')}</div>
        </div>
        <div class="bd-tools">
          <div class="bd-filters" role="group" aria-label="Show tasks">
            <button type="button" class="bd-filter" data-filter="all" aria-pressed="true">All tasks</button>
            <button type="button" class="bd-filter" data-filter="mine" aria-pressed="false">My tasks</button>
            <button type="button" class="bd-filter" data-filter="week" aria-pressed="false">Due this week</button>
          </div>
          <button type="button" class="bd-primary" data-act="add-top">${ICON.plus}<span>Add task</span></button>
        </div>
      </div>`}
      <div class="bd-scroll">
        <div class="bd-cols">
          ${data.sections.map(colHTML).join('')}
          ${compact ? '' : `<div class="bd-newcol"><button type="button" class="bd-newcol-btn">${ICON.plus}<span>Add section</span></button></div>`}
        </div>
      </div>
      <div class="bd-layer" aria-hidden="true"></div>
      <p class="sr-only" aria-live="polite" data-live></p>
      ${compact ? '' : paneHTML()}`;

    const scroller = root.querySelector('.bd-scroll');
    const layer = root.querySelector('.bd-layer');
    const live = root.querySelector('[data-live]');
    const pane = root.querySelector('.pane');
    const colOf = (sid) => root.querySelector(`.bd-col[data-section="${CSS.escape(sid)}"]`);
    const cardOf = (id) => root.querySelector(`.bd-card[data-id="${CSS.escape(id)}"]`);
    const allCards = () => [...root.querySelectorAll('.bd-cols .bd-card')];
    const movables = () => [...root.querySelectorAll('.bd-cols .bd-card, .bd-cols .bd-add, .bd-cols .bd-composer')];
    const visible = () => root.getClientRects().length > 0;
    const announce = (msg) => { live.textContent = ''; requestAnimationFrame(() => { live.textContent = msg; }); };
    const changed = () => listeners.forEach((fn) => fn(data));

    // ---- cards
    function cardHTML(t) {
      const d = due(t);
      const subDone = t.subtasks.filter((s) => s.done).length;
      const chips = [
        t.priority ? `<span class="bd-chip" data-kind="priority" data-v="${t.priority}">${PRIORITY[t.priority]}</span>` : '',
        t.status ? `<span class="bd-chip" data-kind="status" data-v="${t.status}">${STATUS[t.status]}</span>` : '',
      ].join('');
      const counts = [
        t.subtasks.length ? `<span class="bd-count" title="Subtasks">${ICON.subtasks}${subDone}/${t.subtasks.length}</span>` : '',
        t.comments.length ? `<span class="bd-count" title="Comments">${ICON.comment}${t.comments.length}</span>` : '',
      ].join('');
      const foot = (t.assignee || d || counts)
        ? `<div class="bd-foot">${avatar(t.assignee)}${d ? `<span class="bd-due" data-state="${d.state}">${d.label}</span>` : ''}${counts ? `<span class="bd-counts">${counts}</span>` : ''}</div>`
        : '';
      return `
        <button type="button" class="bd-check" aria-pressed="${t.done}" aria-label="${t.done ? 'Mark incomplete' : 'Mark complete'}">${ICON.check}</button>
        <div class="bd-card-body">
          <p class="bd-title">${esc(t.title)}</p>
          ${chips ? `<div class="bd-chips">${chips}</div>` : ''}
          ${foot}
        </div>`;
    }
    function makeCard(t) {
      const el = document.createElement('article');
      el.className = 'bd-card';
      el.dataset.id = t.id;
      el.tabIndex = 0;
      el.setAttribute('aria-keyshortcuts', 'Enter Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown');
      paint(el, t);
      return el;
    }
    function paint(el, t) {
      el.innerHTML = cardHTML(t);
      el.classList.toggle('is-done', t.done);
      const d = due(t);
      el.setAttribute('aria-label', `${t.title}${t.done ? ', completed' : ''}${t.assignee ? ', ' + PEOPLE[t.assignee].name : ''}${d ? ', due ' + d.label : ''}`);
    }
    const repaint = (t) => { const el = cardOf(t.id); if (el) paint(el, t); };

    for (const t of data.tasks) colOf(t.section)?.querySelector('.bd-list').append(makeCard(t));

    function syncOrder() {
      for (const col of root.querySelectorAll('.bd-col')) {
        [...col.querySelectorAll('.bd-card')].forEach((c, i) => {
          const t = task(c.dataset.id);
          if (t) { t.section = col.dataset.section; t.order = i; }
        });
      }
      data.tasks.sort((a, b) => (data.sections.findIndex((s) => s.id === a.section) - data.sections.findIndex((s) => s.id === b.section)) || (a.order - b.order));
    }

    function counts(animate = true) {
      for (const col of root.querySelectorAll('.bd-col')) {
        const n = col.querySelectorAll('.bd-card:not([hidden])').length;
        const el = col.querySelector('.bd-col-count');
        if (el.textContent !== String(n)) {
          el.textContent = n;
          if (animate && !reduced() && visible()) el.animate([{ transform: 'translateY(-45%)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 220, easing: EASE_OUT });
        }
      }
    }
    counts(false);

    // ---- filters
    function matches(t, f) {
      if (f === 'mine') return t.assignee === me;
      if (f === 'week') { const d = due(t); return !!d && !t.done && d.diff <= 6; }
      return true;
    }
    function setFilter(f) {
      state.filter = f;
      root.querySelectorAll('.bd-filter').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === f)));
      const before = new Set(allCards().filter((c) => !c.hidden));
      flip(movables(), () => allCards().forEach((c) => { c.hidden = !matches(task(c.dataset.id), f); }));
      if (!reduced()) allCards().filter((c) => !c.hidden && !before.has(c)).forEach((c) => c.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: EASE_OUT }));
      counts();
      const n = allCards().filter((c) => !c.hidden).length;
      announce(`${n} tasks shown.`);
    }

    // ---- moving
    function move(card, list, next, duration = 240) {
      flip(movables(), () => list.insertBefore(card, next), duration);
      counts();
    }
    function settle(t, card) {
      syncOrder();
      const sid = card.closest('.bd-col').dataset.section;
      if (sid === doneId() && !t.done) complete(t, false);
      else if (sid !== doneId() && t.done) uncomplete(t, false);
      const list = [...card.parentElement.querySelectorAll('.bd-card:not([hidden])')];
      announce(`${t.title}: ${section(sid).name}, ${list.indexOf(card) + 1} of ${list.length}.`);
      changed();
    }

    // Completed cards fly to Done along an arc; the others make room underneath.
    function flyTo(t, sid, where = 'top') {
      const card = cardOf(t.id), col = colOf(sid);
      if (!card || !col) return;
      const list = col.querySelector('.bd-list');
      const animate = visible() && !reduced();
      const from = card.getBoundingClientRect();
      const anchor = where === 'top' ? list.querySelector('.bd-card') : null;
      flip(movables().filter((x) => x !== card), () => list.insertBefore(card, anchor), animate ? 320 : 0);
      t.section = sid;
      syncOrder();
      counts();
      if (!animate) return;
      if (where === 'top') list.scrollTop = 0;
      card.classList.add('is-arriving');
      const to = card.getBoundingClientRect();
      const wrap = document.createElement('div');
      wrap.className = 'bd-fly';
      const g = card.cloneNode(true);
      g.classList.remove('is-arriving', 'is-selected');
      g.classList.add('bd-ghost', 'is-flying');
      g.removeAttribute('tabindex');
      g.style.width = from.width + 'px';
      g.style.height = from.height + 'px';
      wrap.append(g);
      layer.append(wrap);
      const lo = layer.getBoundingClientRect();
      const peak = Math.min(from.top, to.top) - 70 - lo.top;
      const dur = 680;
      wrap.animate([{ transform: `translateX(${from.left - lo.left}px)` }, { transform: `translateX(${to.left - lo.left}px)` }], { duration: dur, easing: EASE_IN_OUT, fill: 'forwards' });
      const tilt = to.left >= from.left ? 5 : -5;
      g.animate([
        { transform: `translateY(${from.top - lo.top}px) rotate(0deg) scale(1)`, easing: 'cubic-bezier(0.33, 1, 0.68, 1)' },
        { transform: `translateY(${peak}px) rotate(${tilt}deg) scale(1.05)`, offset: 0.42, easing: 'cubic-bezier(0.32, 0, 0.67, 0)' },
        { transform: `translateY(${to.top - lo.top}px) rotate(0deg) scale(1)` },
      ], { duration: dur, fill: 'forwards' }).onfinish = () => {
        wrap.remove();
        card.classList.remove('is-arriving');
        card.animate([{ transform: 'scale(1.03)' }, { transform: 'none' }], { duration: 260, easing: EASE_OUT });
        opts.onLand?.({ card, task: t, layer, root });
      };
    }

    function complete(t, fly = true) {
      if (t.done) return;
      t.done = true;
      if (t.section !== doneId()) t.prev = t.section;
      const card = cardOf(t.id);
      if (card) {
        card.classList.add('is-done');
        const check = card.querySelector('.bd-check');
        check.setAttribute('aria-pressed', 'true');
        check.setAttribute('aria-label', 'Mark incomplete');
        const dueEl = card.querySelector('.bd-due');
        if (dueEl) { const d = due(t); dueEl.dataset.state = d.state; dueEl.textContent = d.label; }
        if (visible()) {
          const r = check.getBoundingClientRect();
          opts.celebrate?.({ card, check, task: t, layer, root, x: r.left + r.width / 2, y: r.top + r.height / 2 });
        }
      }
      if (fly && t.section !== doneId()) setTimeout(() => flyTo(t, doneId()), reduced() || !visible() ? 0 : 520);
      announce(`${t.title} completed.`);
      if (state.current === t.id) paneState(t);
      changed();
    }
    function uncomplete(t, fly = true) {
      if (!t.done) return;
      t.done = false;
      repaint(t);
      if (fly && t.section === doneId()) flyTo(t, t.prev && section(t.prev) ? t.prev : data.sections[0].id);
      announce(`${t.title} marked incomplete.`);
      if (state.current === t.id) paneState(t);
      changed();
    }
    const toggle = (id) => { const t = task(id); if (t) (t.done ? uncomplete : complete)(t); };

    function moveTo(id, sid) {
      const t = task(id);
      if (!t || t.section === sid) return;
      if (sid === doneId()) { complete(t); return; }
      if (t.done) { t.done = false; repaint(t); }
      flyTo(t, sid);
      changed();
    }

    // ---- pointer and touch drag
    let drag = null;
    root.addEventListener('pointerdown', (e) => {
      const card = e.target.closest('.bd-card');
      if (!card || !root.contains(card) || card.closest('.bd-layer')) return;
      if (e.button !== 0 || drag) return;
      if (e.target.closest('.bd-check, button, a, input, textarea, select')) return;
      drag = { card, id: card.dataset.id, pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, type: e.pointerType, started: false };
      if (e.pointerType === 'touch') drag.timer = setTimeout(() => { if (drag && !drag.started) start(); }, 230);
      addEventListener('pointermove', onMove, { passive: false });
      addEventListener('pointerup', onUp);
      addEventListener('pointercancel', onCancel);
    });
    document.addEventListener('touchmove', (e) => { if (drag && drag.started) e.preventDefault(); }, { passive: false });
    root.addEventListener('contextmenu', (e) => { if (drag) e.preventDefault(); });

    function onMove(e) {
      if (!drag || e.pointerId !== drag.pointerId) return;
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (!drag.started) {
        const dist = Math.hypot(drag.x - drag.sx, drag.y - drag.sy);
        if (drag.type === 'touch') { if (dist > 9) stopListening(true); return; }
        if (dist < 5) return;
        start();
      }
      e.preventDefault();
    }
    function start() {
      const d = drag;
      d.started = true;
      clearTimeout(d.timer);
      closeComposer();
      const r = d.card.getBoundingClientRect();
      d.ox = d.sx - r.left;
      d.oy = d.sy - r.top;
      d.px = r.left;
      d.py = r.top;
      d.rot = 0;
      d.scale = 1;
      const lo = layer.getBoundingClientRect();
      d.lx = lo.left;
      d.ly = lo.top;
      d.origin = { list: d.card.parentElement, next: d.card.nextElementSibling };
      const g = d.card.cloneNode(true);
      g.classList.add('bd-ghost');
      g.removeAttribute('tabindex');
      g.style.width = r.width + 'px';
      g.style.height = r.height + 'px';
      g.style.transformOrigin = `${d.ox}px ${d.oy}px`;
      g.style.transform = `translate3d(${r.left - d.lx}px, ${r.top - d.ly}px, 0)`;
      layer.append(g);
      d.ghost = g;
      d.card.classList.add('is-placeholder');
      root.classList.add('is-dragging');
      document.documentElement.classList.add('bd-grabbing');
      if (d.type === 'touch' && navigator.vibrate) navigator.vibrate(8);
      opts.onPick?.({ card: d.card, ghost: g, task: task(d.id) });
      announce(`Picked up ${task(d.id).title}.`);
      d.raf = requestAnimationFrame(tick);
    }
    function tick() {
      const d = drag;
      if (!d || !d.started) return;
      const tx = d.x - d.ox, ty = d.y - d.oy;
      if (reduced()) { d.px = tx; d.py = ty; } else {
        const nx = d.px + (tx - d.px) * 0.4;
        const vx = nx - d.px;
        d.px = nx;
        d.py += (ty - d.py) * 0.4;
        d.rot += (clamp(vx * 0.8, -8, 8) - d.rot) * 0.2;
        d.scale += (1.04 - d.scale) * 0.22;
      }
      d.ghost.style.transform = `translate3d(${d.px - d.lx}px, ${d.py - d.ly}px, 0) rotate(${d.rot}deg) scale(${d.scale})`;
      autoscroll();
      place();
      d.raf = requestAnimationFrame(tick);
    }
    function autoscroll() {
      const d = drag, r = scroller.getBoundingClientRect(), edge = 80;
      if (d.x < r.left + edge) scroller.scrollLeft -= ((r.left + edge - d.x) / edge) * 16;
      else if (d.x > r.right - edge) scroller.scrollLeft += ((d.x - (r.right - edge)) / edge) * 16;
      const list = d.card.parentElement, lr = list.getBoundingClientRect();
      if (d.x >= lr.left && d.x <= lr.right && list.scrollHeight > list.clientHeight) {
        if (d.y < lr.top + 48) list.scrollTop -= 9;
        else if (d.y > lr.bottom - 48) list.scrollTop += 9;
      }
    }
    function place() {
      const d = drag;
      const hit = document.elementFromPoint(clamp(d.x, 1, innerWidth - 2), clamp(d.y, 1, innerHeight - 2));
      const col = hit && hit.closest('.bd-col');
      if (!col || !root.contains(col)) return;
      const list = col.querySelector('.bd-list');
      const lr = list.getBoundingClientRect();
      const y = d.y - lr.top + list.scrollTop;
      let next = null;
      for (const c of list.querySelectorAll(':scope > .bd-card:not([hidden])')) {
        if (c === d.card) continue;
        if (y < c.offsetTop + c.offsetHeight / 2) { next = c; break; }
      }
      if (d.card.parentElement === list && (d.card.nextElementSibling === next || (!next && !d.card.nextElementSibling))) return;
      move(d.card, list, next);
    }
    function stopListening(abort) {
      removeEventListener('pointermove', onMove);
      removeEventListener('pointerup', onUp);
      removeEventListener('pointercancel', onCancel);
      if (abort && drag) { clearTimeout(drag.timer); drag = null; }
    }
    function onUp(e) {
      if (!drag || e.pointerId !== drag.pointerId) return;
      stopListening(false);
      clearTimeout(drag.timer);
      if (!drag.started) { drag = null; return; }
      drop();
    }
    function onCancel(e) {
      if (!drag || e.pointerId !== drag.pointerId) return;
      stopListening(false);
      cancelDrag();
    }
    function cancelDrag() {
      const d = drag;
      if (!d) return;
      clearTimeout(d.timer);
      if (!d.started) { drag = null; return; }
      move(d.card, d.origin.list, d.origin.next && d.origin.next.isConnected ? d.origin.next : null);
      drop(true);
    }
    function drop(cancelled = false) {
      const d = drag;
      drag = null;
      state.lastDragEnd = performance.now();
      cancelAnimationFrame(d.raf);
      d.card.getAnimations().forEach((a) => a.finish());
      const r = d.card.getBoundingClientRect();
      const done = () => {
        d.ghost.remove();
        d.card.classList.remove('is-placeholder');
        root.classList.remove('is-dragging');
        document.documentElement.classList.remove('bd-grabbing');
        if (!cancelled) settle(task(d.id), d.card);
        opts.onDrop?.({ card: d.card, task: task(d.id), cancelled });
      };
      if (reduced()) return done();
      d.ghost.animate([
        { transform: d.ghost.style.transform },
        { transform: `translate3d(${r.left - d.lx}px, ${r.top - d.ly}px, 0) rotate(0deg) scale(1)` },
      ], { duration: 220, easing: EASE_OUT, fill: 'forwards' }).onfinish = done;
    }

    // ---- keyboard: Enter opens, Alt + arrows move (no animation for keyboard moves)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && drag && drag.started) { e.preventDefault(); stopListening(false); cancelDrag(); }
    });
    root.addEventListener('keydown', (e) => {
      const card = e.target.closest?.('.bd-card');
      if (!card || e.target !== card) return;
      if (e.key === 'Enter') { e.preventDefault(); openPane(card.dataset.id); return; }
      if (!e.altKey || !e.key.startsWith('Arrow')) return;
      e.preventDefault();
      const list = card.parentElement;
      const siblings = [...list.querySelectorAll(':scope > .bd-card:not([hidden])')];
      const i = siblings.indexOf(card);
      if (e.key === 'ArrowUp' && i > 0) list.insertBefore(card, siblings[i - 1]);
      else if (e.key === 'ArrowDown' && i < siblings.length - 1) list.insertBefore(card, siblings[i + 1].nextElementSibling);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const cols = [...root.querySelectorAll('.bd-col')];
        const target = cols[cols.indexOf(card.closest('.bd-col')) + (e.key === 'ArrowRight' ? 1 : -1)];
        if (!target) return;
        target.querySelector('.bd-list').prepend(card);
      } else return;
      card.focus({ preventScroll: false });
      counts(false);
      settle(task(card.dataset.id), card);
    });

    // ---- composer
    let composer = null;
    function openComposer(col, where) {
      closeComposer();
      const list = col.querySelector('.bd-list');
      const box = document.createElement('div');
      box.className = 'bd-composer';
      const id = uid(P + '-new');
      box.innerHTML = `<label class="sr-only" for="${id}">Task name</label><textarea id="${id}" rows="2" placeholder="Write a task name"></textarea><div class="bd-composer-row"><button type="button" class="bd-btn" data-act="compose-add">Add task</button><button type="button" class="bd-btn-quiet" data-act="compose-cancel">Cancel</button></div>`;
      flip(movables(), () => (where === 'top' ? list.prepend(box) : list.append(box)), 200);
      if (!reduced()) box.animate([{ opacity: 0, transform: 'translateY(6px) scale(0.98)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: EASE_OUT });
      const ta = box.querySelector('textarea');
      composer = { box, ta, list, col, where };
      ta.focus();
      if (where === 'top') list.scrollTop = 0; else list.scrollTop = list.scrollHeight;
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addFromComposer(); }
        if (e.key === 'Escape') { e.preventDefault(); closeComposer(true); }
      });
      ta.addEventListener('blur', () => setTimeout(() => { if (composer && composer.box === box && !box.contains(document.activeElement) && !ta.value.trim()) closeComposer(); }, 120));
    }
    function addFromComposer() {
      if (!composer) return;
      const { ta, list, col, where, box } = composer;
      const title = ta.value.trim().replace(/\s+/g, ' ');
      if (!title) { ta.focus(); return; }
      const t = { id: uid('t'), section: col.dataset.section, title, assignee: null, due: null, priority: null, status: null, notes: '', subtasks: [], comments: [], done: col.dataset.section === doneId(), prev: null };
      data.tasks.push(t);
      const el = makeCard(t);
      flip(movables(), () => list.insertBefore(el, where === 'top' ? box.nextSibling : box), 220);
      if (!reduced()) el.animate([{ opacity: 0, transform: 'translateY(10px) scale(0.97)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: EASE_OUT });
      ta.value = '';
      ta.focus();
      syncOrder();
      counts();
      announce(`Added ${title} to ${section(col.dataset.section).name}.`);
      changed();
    }
    function closeComposer(focusBack) {
      if (!composer) return;
      const { box, col } = composer;
      composer = null;
      flip(movables().filter((x) => x !== box), () => box.remove(), 180);
      if (focusBack) col.querySelector('.bd-add')?.focus();
    }

    // ---- sections
    function newSection(btn) {
      const wrap = btn.parentElement;
      const id = uid(P + '-sec');
      wrap.innerHTML = `<form class="bd-newcol-form"><label class="sr-only" for="${id}">Section name</label><input id="${id}" class="bd-newcol-input" placeholder="Name the section" autocomplete="off"></form>`;
      const input = wrap.querySelector('input');
      input.focus();
      const restore = () => { wrap.innerHTML = `<button type="button" class="bd-newcol-btn">${ICON.plus}<span>Add section</span></button>`; };
      input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { restore(); wrap.querySelector('button').focus(); } });
      input.addEventListener('blur', () => setTimeout(() => { if (wrap.contains(input) && !input.value.trim()) restore(); }, 120));
      wrap.querySelector('form').addEventListener('submit', (e) => {
        e.preventDefault();
        const name = input.value.trim();
        if (!name) return;
        const s = { id: uid('sec'), name };
        data.sections.push(s);
        const tmp = document.createElement('div');
        tmp.innerHTML = colHTML(s);
        const col = tmp.firstElementChild;
        wrap.parentElement.insertBefore(col, wrap);
        counts(false);
        if (!reduced()) col.animate([{ opacity: 0, transform: 'translateX(16px)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: EASE_OUT });
        restore();
        scroller.scrollTo({ left: scroller.scrollWidth, behavior: reduced() ? 'auto' : 'smooth' });
        refreshSectionSelect();
        announce(`Section ${name} added.`);
        changed();
      });
    }
    function renameSection(h) {
      const col = h.closest('.bd-col');
      const s = section(col.dataset.section);
      const input = document.createElement('input');
      input.className = 'bd-col-rename';
      input.value = s.name;
      input.setAttribute('aria-label', 'Section name');
      h.replaceWith(input);
      input.focus();
      input.select();
      const finish = (save) => {
        if (!input.isConnected) return;
        if (save && input.value.trim()) s.name = input.value.trim();
        h.textContent = s.name;
        input.replaceWith(h);
        refreshSectionSelect();
        changed();
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
      input.addEventListener('blur', () => finish(true));
    }

    // ---- task pane
    function paneHTML() {
      return `
      <aside class="pane" aria-label="Task details" hidden>
        <div class="pane-bar">
          <button type="button" class="pane-complete" data-act="pane-complete" aria-pressed="false">${ICON.check}<span>Mark complete</span></button>
          <button type="button" class="pane-close" data-act="pane-close" aria-label="Close task details">${ICON.close}</button>
        </div>
        <div class="pane-scroll">
          <label class="sr-only" for="${P}-title">Task name</label>
          <textarea id="${P}-title" class="pane-title" rows="1"></textarea>
          <dl class="pane-fields">
            <div class="pane-field"><dt><label for="${P}-assignee">Assignee</label></dt><dd><select id="${P}-assignee" class="pane-input" data-field="assignee"><option value="">Nobody yet</option>${Object.values(PEOPLE).map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></dd></div>
            <div class="pane-field"><dt><label for="${P}-due">Due date</label></dt><dd><input type="date" id="${P}-due" class="pane-input" data-field="due"></dd></div>
            <div class="pane-field"><dt><label for="${P}-section">Section</label></dt><dd><select id="${P}-section" class="pane-input" data-field="section"></select></dd></div>
            <div class="pane-field"><dt id="${P}-prio-l">Priority</dt><dd><div class="pane-seg" role="radiogroup" aria-labelledby="${P}-prio-l" data-field="priority">${[['', 'None'], ...Object.entries(PRIORITY)].map(([v, l]) => `<button type="button" role="radio" data-v="${v}" aria-checked="false">${l}</button>`).join('')}</div></dd></div>
            <div class="pane-field"><dt id="${P}-stat-l">Status</dt><dd><div class="pane-seg" role="radiogroup" aria-labelledby="${P}-stat-l" data-field="status">${[['', 'None'], ...Object.entries(STATUS)].map(([v, l]) => `<button type="button" role="radio" data-v="${v}" aria-checked="false">${l}</button>`).join('')}</div></dd></div>
          </dl>
          <div class="pane-block"><label class="pane-h" for="${P}-notes">Description</label><textarea id="${P}-notes" class="pane-notes" rows="3" placeholder="What is this task about?"></textarea></div>
          <div class="pane-block"><h4 class="pane-h">Subtasks <span class="pane-sub-count"></span></h4><ul class="pane-subs"></ul><form class="pane-sub-add"><label class="sr-only" for="${P}-sub">New subtask</label><input id="${P}-sub" class="pane-input" placeholder="Add a subtask" autocomplete="off"></form></div>
          <div class="pane-block"><h4 class="pane-h">Comments</h4><ul class="pane-comments"></ul></div>
        </div>
        <form class="pane-say">${avatar(me)}<label class="sr-only" for="${P}-say">Comment</label><textarea id="${P}-say" rows="1" placeholder="Ask a question or post an update"></textarea><button type="submit" class="bd-btn">Comment</button></form>
      </aside>`;
    }
    const $p = (sel) => pane.querySelector(sel);
    function refreshSectionSelect() {
      if (!pane) return;
      const sel = $p(`#${CSS.escape(P)}-section`);
      sel.innerHTML = data.sections.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
      if (state.current) sel.value = task(state.current).section;
    }
    function paneState(t) {
      const b = $p('.pane-complete');
      b.setAttribute('aria-pressed', String(t.done));
      b.querySelector('span').textContent = t.done ? 'Completed' : 'Mark complete';
      $p(`#${CSS.escape(P)}-section`).value = t.section;
    }
    function fillPane(t) {
      $p('.pane-title').value = t.title;
      fitTitle();
      $p('[data-field="assignee"]').value = t.assignee || '';
      $p('[data-field="due"]').value = t.due || '';
      refreshSectionSelect();
      pane.querySelectorAll('.pane-seg').forEach((seg) => seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === (t[seg.dataset.field] || '')))));
      $p('.pane-notes').value = t.notes || '';
      renderSubs(t);
      renderComments(t);
      paneState(t);
    }
    function fitTitle() { const ta = $p('.pane-title'); ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }
    function renderSubs(t) {
      $p('.pane-sub-count').textContent = t.subtasks.length ? `${t.subtasks.filter((s) => s.done).length} of ${t.subtasks.length}` : '';
      $p('.pane-subs').innerHTML = t.subtasks.map((s) => `<li class="pane-sub${s.done ? ' is-done' : ''}" data-sub="${s.id}"><button type="button" class="pane-sub-check" aria-pressed="${s.done}" aria-label="${s.done ? 'Mark subtask incomplete' : 'Mark subtask complete'}">${ICON.check}</button><span>${esc(s.title)}</span></li>`).join('');
    }
    function renderComments(t) {
      $p('.pane-comments').innerHTML = t.comments.length
        ? t.comments.map((c) => `<li class="pane-comment">${avatar(c.by)}<div><p class="pane-comment-by"><strong>${esc(PEOPLE[c.by]?.name || 'Someone')}</strong> <span>${esc(c.when)}</span></p><p class="pane-comment-body">${esc(c.body)}</p></div></li>`).join('')
        : '<li class="pane-empty">No comments yet.</li>';
    }
    function openPane(id) {
      if (!pane) return;
      const t = task(id);
      if (!t) return;
      root.querySelectorAll('.bd-card.is-selected').forEach((c) => c.classList.remove('is-selected'));
      cardOf(id)?.classList.add('is-selected');
      state.current = id;
      state.lastFocus = cardOf(id);
      fillPane(t);
      pane.hidden = false;
      pane.getBoundingClientRect();
      pane.classList.add('is-open');
      root.classList.add('has-pane');
      if (!reduced()) pane.querySelectorAll('.pane-title, .pane-field, .pane-block').forEach((el, i) => el.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 300, delay: 60 + i * 28, easing: EASE_OUT, fill: 'backwards' }));
      setTimeout(() => $p('.pane-title').focus({ preventScroll: true }), reduced() ? 0 : 200);
      opts.onOpen?.(t);
    }
    function closePane() {
      if (!pane || !pane.classList.contains('is-open')) return;
      pane.classList.remove('is-open');
      root.classList.remove('has-pane');
      root.querySelectorAll('.bd-card.is-selected').forEach((c) => c.classList.remove('is-selected'));
      const finish = () => { if (!pane.classList.contains('is-open')) pane.hidden = true; };
      reduced() ? setTimeout(finish, 200) : pane.addEventListener('transitionend', finish, { once: true });
      state.current = null;
      state.lastFocus?.focus({ preventScroll: true });
    }
    if (pane) {
      $p('.pane-title').addEventListener('input', (e) => {
        fitTitle();
        const t = task(state.current);
        if (!t) return;
        t.title = e.target.value.replace(/\n/g, ' ') || 'Untitled task';
        repaint(t);
        cardOf(t.id)?.classList.add('is-selected');
        changed();
      });
      $p('.pane-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
      $p('.pane-notes').addEventListener('input', (e) => { const t = task(state.current); if (t) t.notes = e.target.value; });
      pane.addEventListener('change', (e) => {
        const t = task(state.current);
        const f = e.target.dataset.field;
        if (!t || !f) return;
        if (f === 'section') { moveTo(t.id, e.target.value); return; }
        t[f] = e.target.value || null;
        repaint(t);
        cardOf(t.id)?.classList.add('is-selected');
        changed();
      });
      pane.addEventListener('click', (e) => {
        const t = task(state.current);
        if (!t) return;
        const segBtn = e.target.closest('.pane-seg button');
        if (segBtn) {
          const seg = segBtn.parentElement;
          t[seg.dataset.field] = segBtn.dataset.v || null;
          seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b === segBtn)));
          repaint(t);
          cardOf(t.id)?.classList.add('is-selected');
          changed();
          return;
        }
        const sub = e.target.closest('.pane-sub-check');
        if (sub) {
          const s = t.subtasks.find((x) => x.id === sub.closest('[data-sub]').dataset.sub);
          s.done = !s.done;
          renderSubs(t);
          repaint(t);
          cardOf(t.id)?.classList.add('is-selected');
          changed();
          return;
        }
        if (e.target.closest('[data-act="pane-complete"]')) { toggle(t.id); paneState(t); return; }
        if (e.target.closest('[data-act="pane-close"]')) closePane();
      });
      $p('.pane-sub-add').addEventListener('submit', (e) => {
        e.preventDefault();
        const t = task(state.current);
        const input = e.target.querySelector('input');
        const title = input.value.trim();
        if (!t || !title) return;
        t.subtasks.push({ id: uid('s'), title, done: false });
        input.value = '';
        renderSubs(t);
        repaint(t);
        cardOf(t.id)?.classList.add('is-selected');
        const li = $p('.pane-subs').lastElementChild;
        if (li && !reduced()) li.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: EASE_OUT });
        changed();
      });
      $p('.pane-say').addEventListener('submit', (e) => {
        e.preventDefault();
        const t = task(state.current);
        const ta = e.target.querySelector('textarea');
        const body = ta.value.trim();
        if (!t || !body) { ta.focus(); return; }
        t.comments.push({ id: uid('c'), by: me, when: 'Just now', body });
        ta.value = '';
        renderComments(t);
        repaint(t);
        cardOf(t.id)?.classList.add('is-selected');
        const li = $p('.pane-comments').lastElementChild;
        if (li && !reduced()) { li.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: EASE_OUT }); li.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
        changed();
      });
      $p('.pane-say textarea').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $p('.pane-say').requestSubmit(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented && !drag && pane.classList.contains('is-open') && visible()) closePane(); });
    }

    // ---- clicks
    root.addEventListener('click', (e) => {
      if (performance.now() - state.lastDragEnd < 80) return;
      const check = e.target.closest('.bd-check');
      if (check && !check.closest('.bd-layer')) { toggle(check.closest('.bd-card').dataset.id); return; }
      if (e.target.closest('.bd-add')) { openComposer(e.target.closest('.bd-col'), 'bottom'); return; }
      if (e.target.closest('.bd-col-plus')) { openComposer(e.target.closest('.bd-col'), 'top'); return; }
      if (e.target.closest('[data-act="add-top"]')) { openComposer(root.querySelector('.bd-col'), 'top'); return; }
      if (e.target.closest('[data-act="compose-add"]')) { addFromComposer(); return; }
      if (e.target.closest('[data-act="compose-cancel"]')) { closeComposer(true); return; }
      const f = e.target.closest('.bd-filter');
      if (f) { setFilter(f.dataset.filter); return; }
      const nc = e.target.closest('.bd-newcol-btn');
      if (nc) { newSection(nc); return; }
      const card = e.target.closest('.bd-card');
      if (card && !compact && !card.closest('.bd-layer')) openPane(card.dataset.id);
    });
    root.addEventListener('dblclick', (e) => { const h = e.target.closest('.bd-col-name'); if (h && !compact) renameSection(h); });

    function add(title, sid = data.sections[0].id, patch = {}) {
      const t = { id: uid('t'), section: sid, title, assignee: null, due: null, priority: null, status: null, notes: '', subtasks: [], comments: [], done: sid === doneId(), prev: null, ...patch };
      data.tasks.push(t);
      const el = makeCard(t);
      const list = colOf(sid).querySelector('.bd-list');
      flip(movables(), () => list.prepend(el), visible() ? 220 : 0);
      el.hidden = !matches(t, state.filter);
      syncOrder();
      counts(false);
      changed();
      return t;
    }

    return {
      root, data, me,
      task, add, open: openPane, close: closePane, toggle, moveTo, setFilter,
      on: (fn) => listeners.push(fn),
      focusCard: (id) => cardOf(id)?.focus(),
    };
  }

  window.AsanakaBoard = { mount, sample, due, burst, ring, flip, PEOPLE, SECTIONS, PRIORITY, STATUS, EASE_OUT, EASE_IN_OUT, esc };
})();
