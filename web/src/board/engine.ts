import type { Board, Project, Section, Task, User } from '../types';
import { PRIORITY, STATUS, dueOf, esc, initials, toneOf } from './format';
import { EASE_IN_OUT, EASE_OUT, flip, reduced } from './motion';

/* The board: columns and cards, moved by pointer, touch (long press) and keyboard (Space to pick a card up,
   arrows, Space to put it down; or Alt + arrows in one step). The other
   cards make room with FLIP, a ticked card flies to Done along an arc, sections are added, renamed, moved and
   deleted in place. Every change shows at once and is then sent to the API through `actions`; if the API
   refuses one, the caller reloads the board from the server. Changes other people make arrive through
   `remoteTask` and `remoteRemove` and glide into place the same way. The task pane is React's (TaskPane.tsx). */

export type Filter = 'all' | 'mine' | 'week';
export type SortKey = 'manual' | 'due' | 'likes' | 'alpha' | 'assignee' | 'created';
export const SORTS: Record<SortKey, string> = { manual: 'Manual', due: 'Due date', likes: 'Likes', alpha: 'Alphabetical', assignee: 'Assignee', created: 'Newest first' };

export interface BoardActions {
  moveTask(id: string, sectionId: string, index: number): Promise<Task>;
  setCompleted(id: string, completed: boolean): Promise<Task>;
  createTask(sectionId: string, title: string, index?: number): Promise<Task>;
  createSection(name: string): Promise<Section>;
  renameSection(id: string, name: string): Promise<Section>;
  moveSection(id: string, index: number): Promise<Section>;
  deleteSection(id: string): Promise<unknown>;
}

export interface Cheer { card: HTMLElement; task: Task; layer: HTMLElement; x: number; y: number }

export interface EngineOptions {
  board: Board;
  me: string;
  /** The landing page's demo: columns and cards only (no header, section controls, composer or pane). */
  compact?: boolean;
  actions: BoardActions;
  onOpen(id: string): void;
  /** A change was refused: report it and reload the board. */
  onFailure(err: unknown): void;
  /** The board and the server disagree about where something is: reload quietly. */
  onStale(): void;
  onSections?(sections: Section[]): void;
  /** How cards are ordered inside each section; the caller remembers the choice. */
  sort?: SortKey;
  onSort?(sort: SortKey): void;
  celebrate?(c: Cheer): void;
  onLand?(c: { card: HTMLElement; layer: HTMLElement }): void;
}

export interface BoardEngine {
  get(id: string): Task | undefined;
  select(id: string | null): void;
  /** Shows a change at once, before the server has it. */
  patch(id: string, fields: Partial<Task>): void;
  /** Sends a change for one task; the server's answer is applied once no later change for it is pending. */
  save(id: string, request: Promise<Task>): void;
  remove(id: string): void;
  toggle(id: string): void;
  moveTo(id: string, sectionId: string): void;
  subscribe(fn: (t: Task) => void): () => void;
  replace(board: Board): void;
  /** A task changed or appeared because someone else (or another tab) changed it. */
  remoteTask(task: Omit<Task, 'liked'>, actorId: string): void;
  remoteRemove(id: string, actorId: string): void;
  isDragging(): boolean;
  focusCard(id: string): void;
  destroy(): void;
}

const ICON = {
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="bd-check-path" d="M6.5 12.5l3.6 3.6 7.4-8.2" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5.5" cy="12" r="1.9" fill="currentColor"/><circle cx="12" cy="12" r="1.9" fill="currentColor"/><circle cx="18.5" cy="12" r="1.9" fill="currentColor"/></svg>',
  subtasks: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4v10a3 3 0 0 0 3 3h6M6 9h9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="18" cy="9" r="2.2" fill="currentColor"/><circle cx="18" cy="17" r="2.2" fill="currentColor"/></svg>',
  comment: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v10H10l-4 4v-4H5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  clip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 7.5l-6.8 6.8a2 2 0 0 0 2.8 2.8l7.1-7.1a4 4 0 0 0-5.7-5.7l-7.1 7.1a6 6 0 0 0 8.5 8.5l5.3-5.3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  thumb: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 11v9h-3v-9h3zm0 9h9.2a2 2 0 0 0 2-1.6l1.2-6.1a2 2 0 0 0-2-2.3h-4.5l.8-3.6a1.8 1.8 0 0 0-3.3-1.4L7.5 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  sort: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5v14M3.5 15.5L7 19l3.5-3.5M17 19V5M13.5 8.5L17 5l3.5 3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
let seq = 0;
const uid = (p: string) => `${p}-${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const isTemp = (id: string) => id.startsWith('tmp-');
const NEWCOL_BTN = `<button type="button" class="bd-newcol-btn">${ICON.plus}<span>Add section</span></button>`;
const NEWCOL = `<div class="bd-newcol">${NEWCOL_BTN}</div>`;

interface Drag {
  kind: 'card' | 'col';
  el: HTMLElement;
  id: string;
  pointerId: number;
  type: string;
  sx: number; sy: number; x: number; y: number;
  started: boolean;
  timer?: number;
  ox: number; oy: number; px: number; py: number; lx: number; ly: number;
  rot: number; scale: number;
  ghost?: HTMLElement;
  raf?: number;
  from: { sid: string; index: number };
  origin: { parent: HTMLElement; next: Element | null };
}

export function mountBoard(root: HTMLElement, o: EngineOptions): BoardEngine {
  const ac = new AbortController();
  const listen = (target: EventTarget, type: string, fn: (e: Event) => void, opts: AddEventListenerOptions = {}) =>
    target.addEventListener(type, fn, { ...opts, signal: ac.signal });
  const timers = new Set<number>();
  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => { timers.delete(id); if (!ac.signal.aborted) fn(); }, ms);
    timers.add(id);
  };

  let project!: Project;
  let sections: Section[] = [];
  let users: User[] = [];
  const tasks = new Map<string, Task>();
  const pending = new Map<string, number>();
  const flying = new Set<string>();
  const subs = new Set<(t: Task) => void>();
  let filter: Filter = 'all';
  let current: string | null = null;
  let lastDragEnd = 0;
  let reloadWanted = false;
  let renaming = false;
  // A card picked up with Space: arrows move it, Space or Enter put it down, Escape puts it back.
  let lifted: { card: HTMLElement; from: { sid: string; index: number }; origin: { parent: HTMLElement; next: Element | null } } | null = null;
  let composer: { box: HTMLElement; ta: HTMLTextAreaElement; list: HTMLElement; col: HTMLElement; where: 'top' | 'bottom' } | null = null;
  let sort: SortKey = o.sort && o.sort in SORTS ? o.sort : 'manual';
  const inbox: (() => void)[] = []; // other people's changes that arrived mid-drag, applied on drop
  const staleAfter = new Set<string>(); // tasks someone else changed while a save of ours was on its way
  const P = uid('b');

  function load(b: Board) {
    project = { ...b.project };
    sections = b.sections.map((s) => ({ ...s }));
    users = b.users;
    tasks.clear();
    for (const t of b.tasks) tasks.set(t.id, { ...t });
  }
  load(o.board);

  const compact = !!o.compact;
  root.classList.add('bd');
  root.classList.toggle('bd-compact', compact);
  root.innerHTML = `${compact ? '' : `
    <div class="bd-top">
      <div class="bd-proj">
        <h1 class="bd-proj-name"></h1>
        <div class="bd-people" aria-label="People"></div>
      </div>
      <div class="bd-tools">
        <div class="bd-filters" role="group" aria-label="Show tasks">
          <button type="button" class="bd-filter" data-filter="all" aria-pressed="true">All tasks</button>
          <button type="button" class="bd-filter" data-filter="mine" aria-pressed="false">My tasks</button>
          <button type="button" class="bd-filter" data-filter="week" aria-pressed="false">Due this week</button>
        </div>
        <button type="button" class="bd-sort" aria-haspopup="menu" aria-expanded="false">${ICON.sort}<span class="bd-sort-value">Sort</span></button>
        <button type="button" class="bd-primary" data-act="add-top">${ICON.plus}<span>Add task</span></button>
      </div>
    </div>`}
    <div class="bd-scroll"><div class="bd-cols"></div></div>
    <div class="bd-layer" aria-hidden="true"></div>
    <div class="bd-menu" role="menu" hidden></div>
    <p class="sr-only" aria-live="polite" data-live></p>
    <p class="sr-only" id="${P}-howto">Enter opens it. Space picks it up to move with the arrow keys; Space puts it down. Control Enter completes it.</p>`;

  const $ = (sel: string) => root.querySelector(sel) as HTMLElement;
  const scroller = $('.bd-scroll');
  const colsEl = $('.bd-cols');
  const layer = $('.bd-layer');
  const menu = $('.bd-menu');
  const live = $('[data-live]');
  const colOf = (sid: string) => colsEl.querySelector<HTMLElement>(`.bd-col[data-section="${CSS.escape(sid)}"]`);
  const listOf = (sid: string) => colOf(sid)?.querySelector<HTMLElement>('.bd-list') ?? null;
  const cardOf = (id: string) => colsEl.querySelector<HTMLElement>(`.bd-card[data-id="${CSS.escape(id)}"]`);
  const allCards = () => [...colsEl.querySelectorAll<HTMLElement>('.bd-card')];
  const allCols = () => [...colsEl.querySelectorAll<HTMLElement>('.bd-col')];
  const movables = () => [...colsEl.querySelectorAll<HTMLElement>('.bd-card, .bd-add, .bd-composer')];
  const colOfCard = (card: HTMLElement) => card.closest<HTMLElement>('.bd-col')!.dataset.section!;
  const indexOfCard = (card: HTMLElement) => [...card.parentElement!.querySelectorAll(':scope > .bd-card')].indexOf(card);
  const visible = () => root.getClientRects().length > 0;
  const announce = (msg: string) => { live.textContent = ''; requestAnimationFrame(() => { live.textContent = msg; }); };
  const emit = (t: Task) => subs.forEach((fn) => fn(t));
  const sectionById = (id: string | null) => sections.find((s) => s.id === id);
  const doneId = () => (project.doneSectionId && sectionById(project.doneSectionId) ? project.doneSectionId : null);
  const nameOf = (id: string | null) => users.find((u) => u.id === id)?.displayName;
  const sectionsChanged = () => o.onSections?.(sections.map((s) => ({ ...s })));

  const avatar = (id: string | null) => {
    const u = id ? users.find((x) => x.id === id) : undefined;
    return u ? `<span class="bd-avatar" data-tone="${toneOf(users, u.id)}" title="${esc(u.displayName)}">${esc(initials(u.displayName))}</span>` : '';
  };

  const colHTML = (s: Section) => `
    <section class="bd-col${isTemp(s.id) ? ' is-pending' : ''}" data-section="${esc(s.id)}"${s.id === doneId() ? ' data-done' : ''} aria-labelledby="${P}-h-${esc(s.id)}">
      <header class="bd-col-head">
        <h2 class="bd-col-name" id="${P}-h-${esc(s.id)}">${esc(s.name)}</h2>
        <span class="bd-col-count" aria-label="tasks">0</span>
        ${compact ? '' : `<button type="button" class="bd-col-plus" aria-label="Add a task to the top of ${esc(s.name)}">${ICON.plus}</button>
        <button type="button" class="bd-col-more" aria-label="More for ${esc(s.name)}" aria-haspopup="menu" aria-expanded="false">${ICON.more}</button>`}
      </header>
      <div class="bd-list"></div>
      ${compact ? '' : `<button type="button" class="bd-add">${ICON.plus}<span>Add task</span></button>`}
    </section>`;

  // ---- cards
  function cardHTML(t: Task) {
    const d = dueOf(t.dueOn, t.completed);
    const chips =
      (t.priority ? `<span class="bd-chip" data-v="${t.priority}">${PRIORITY[t.priority]}</span>` : '') +
      (t.status ? `<span class="bd-chip" data-v="${t.status}">${STATUS[t.status]}</span>` : '');
    const counts =
      (t.subtaskCount ? `<span class="bd-count" title="Subtasks done">${ICON.subtasks}${t.subtaskDoneCount}/${t.subtaskCount}</span>` : '') +
      (t.commentCount ? `<span class="bd-count" title="Comments">${ICON.comment}${t.commentCount}</span>` : '') +
      (t.attachmentCount ? `<span class="bd-count" title="Attachments">${ICON.clip}${t.attachmentCount}</span>` : '') +
      (t.likeCount ? `<span class="bd-count${t.liked ? ' is-mine' : ''}" title="${t.liked ? 'You like this' : 'Likes'}">${ICON.thumb}${t.likeCount}</span>` : '');
    const foot = t.assigneeId || d || counts
      ? `<div class="bd-foot">${avatar(t.assigneeId)}${d ? `<span class="bd-due" data-state="${d.state}">${d.label}</span>` : ''}${counts ? `<span class="bd-counts">${counts}</span>` : ''}</div>`
      : '';
    return `<button type="button" class="bd-check" aria-pressed="${t.completed}" aria-label="${t.completed ? 'Mark incomplete' : 'Mark complete'}">${ICON.check}</button>
      <div class="bd-card-body"><p class="bd-title">${esc(t.title)}</p>${chips ? `<div class="bd-chips">${chips}</div>` : ''}${foot}</div>`;
  }
  function paint(el: HTMLElement, t: Task) {
    el.innerHTML = cardHTML(t);
    el.classList.toggle('is-done', t.completed);
    el.classList.toggle('is-pending', isTemp(t.id));
    const d = dueOf(t.dueOn, t.completed);
    const who = nameOf(t.assigneeId);
    el.setAttribute('aria-label', `${t.title}${t.completed ? ', completed' : ''}${who ? `, ${who}` : ''}${d ? `, due ${d.label}` : ''}`);
  }
  function makeCard(t: Task) {
    const el = document.createElement('article');
    el.className = 'bd-card';
    el.dataset.id = t.id;
    el.tabIndex = 0;
    el.setAttribute('aria-keyshortcuts', 'Enter Space Control+Enter Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown');
    el.setAttribute('aria-describedby', `${P}-howto`);
    paint(el, t);
    return el;
  }

  function counts(animate = true) {
    for (const col of allCols()) {
      const n = col.querySelectorAll('.bd-card:not([hidden])').length;
      const el = col.querySelector<HTMLElement>('.bd-col-count')!;
      if (el.textContent === String(n)) continue;
      el.textContent = String(n);
      if (animate && !reduced() && visible()) el.animate([{ transform: 'translateY(-45%)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 220, easing: EASE_OUT });
    }
  }

  function render() {
    if (!compact) {
      $('.bd-proj-name').textContent = project.name;
      $('.bd-people').innerHTML = users.map((u) => avatar(u.id)).join('');
    }
    colsEl.innerHTML = sections.map(colHTML).join('') + (compact ? '' : NEWCOL);
    for (const t of tasks.values()) if (t.sectionId) listOf(t.sectionId)?.append(makeCard(t));
    for (const c of allCards()) c.hidden = !matches(tasks.get(c.dataset.id!)!);
    if (sort !== 'manual') arrange(undefined, false);
    showSort();
    counts(false);
    sectionsChanged();
  }

  // ---- sort: Manual keeps the order people dragged; the others order each section by a field.
  const byPosition = (a: Task, b: Task) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0);
  function compare(a: Task, b: Task) {
    let d = 0;
    if (sort === 'due') d = a.dueOn === b.dueOn ? 0 : !a.dueOn ? 1 : !b.dueOn ? -1 : a.dueOn < b.dueOn ? -1 : 1;
    else if (sort === 'likes') d = b.likeCount - a.likeCount;
    else if (sort === 'alpha') d = collator.compare(a.title, b.title);
    else if (sort === 'assignee') {
      const x = nameOf(a.assigneeId), y = nameOf(b.assigneeId);
      d = x === y ? 0 : !x ? 1 : !y ? -1 : collator.compare(x, y);
    } else if (sort === 'created') d = a.createdAt === b.createdAt ? 0 : a.createdAt < b.createdAt ? 1 : -1;
    return d || byPosition(a, b);
  }
  // Where a task belongs in a list: before the first settled card that sorts after it.
  function slotFor(list: HTMLElement, t: Task): Element | null {
    for (const c of list.querySelectorAll<HTMLElement>(':scope > .bd-card')) {
      const x = tasks.get(c.dataset.id!);
      if (!x || x.id === t.id || isTemp(x.id)) continue;
      if (compare(t, x) < 0) return c;
    }
    return composer?.list === list && composer.where === 'bottom' ? composer.box : null;
  }
  const nextSettled = (card: Element) => {
    let n = card.nextElementSibling as HTMLElement | null;
    while (n?.classList.contains('bd-card') && isTemp(n.dataset.id!)) n = n.nextElementSibling as HTMLElement | null;
    return n;
  };
  function arrange(sids = sections.map((x) => x.id), animate = true) {
    const mutate = () => {
      for (const sid of sids) {
        const list = listOf(sid);
        if (!list) continue;
        const cards = [...list.querySelectorAll<HTMLElement>(':scope > .bd-card')].filter((c) => !isTemp(c.dataset.id!));
        const order = [...cards].sort((x, y) => compare(tasks.get(x.dataset.id!)!, tasks.get(y.dataset.id!)!));
        if (order.every((c, i) => c === cards[i])) continue;
        const end = composer?.list === list && composer.where === 'bottom' ? composer.box : null;
        for (const c of order) list.insertBefore(c, end);
      }
    };
    if (animate && visible()) flip(movables(), mutate, 300, EASE_IN_OUT); else mutate();
  }
  // A field that a sort reads changed: the card moves to its new place.
  function resort(t: Task) {
    if (sort === 'manual' || drag || flying.has(t.id) || !t.sectionId) return;
    arrange([t.sectionId]);
  }
  function showSort() {
    if (compact) return;
    const b = $('.bd-sort');
    b.querySelector('.bd-sort-value')!.textContent = sort === 'manual' ? 'Sort' : `Sort: ${SORTS[sort]}`;
    b.toggleAttribute('data-active', sort !== 'manual');
    b.setAttribute('aria-label', `Sort tasks: ${SORTS[sort]}`);
  }
  function setSort(k: SortKey) {
    if (k === sort) return;
    sort = k;
    o.onSort?.(k);
    showSort();
    arrange();
    announce(k === 'manual' ? 'Tasks in the order you put them.' : `Tasks sorted by ${SORTS[k].toLowerCase()}.`);
  }
  const sortedNote = () => announce(`Sorted by ${SORTS[sort].toLowerCase()}. Choose Manual in Sort to order cards by hand.`);

  render();

  // ---- saving: show first, then send; the server's answer wins once nothing newer is on its way
  function persist<T>(request: Promise<T>, ok?: (v: T) => void, failed?: () => void, id?: string) {
    if (id) pending.set(id, (pending.get(id) ?? 0) + 1);
    const settle = () => {
      if (!id) return 0;
      const left = (pending.get(id) ?? 1) - 1;
      if (left > 0) pending.set(id, left); else pending.delete(id);
      return Math.max(0, left);
    };
    request.then(
      (v) => {
        if (ac.signal.aborted || settle() > 0) return;
        ok?.(v);
        if (id && staleAfter.delete(id)) o.onStale();
      },
      (err) => { if (ac.signal.aborted) return; settle(); failed?.(); o.onFailure(err); },
    );
  }
  const save = (id: string, request: Promise<Task>) => persist(request, update, undefined, id);

  function update(s: Task) {
    const t = tasks.get(s.id);
    if (!t) return;
    Object.assign(t, s);
    const card = cardOf(t.id);
    if (card) {
      paint(card, t);
      const moving = flying.has(t.id) || drag?.el === card;
      if (!moving && t.sectionId && colOfCard(card) !== t.sectionId) o.onStale();
      else resort(t);
    }
    emit(t);
  }

  function patch(id: string, fields: Partial<Task>) {
    const t = tasks.get(id);
    if (!t) return;
    Object.assign(t, fields);
    const card = cardOf(id);
    if (card) { paint(card, t); resort(t); }
    emit(t);
  }

  // ---- filters
  function matches(t: Task) {
    if (filter === 'mine') return t.assigneeId === o.me;
    if (filter === 'week') { const d = dueOf(t.dueOn, t.completed); return !!d && !t.completed && d.diff <= 6; }
    return true;
  }
  function setFilter(f: Filter) {
    filter = f;
    root.querySelectorAll<HTMLElement>('.bd-filter').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === f)));
    const before = new Set(allCards().filter((c) => !c.hidden));
    flip(movables(), () => allCards().forEach((c) => { c.hidden = !matches(tasks.get(c.dataset.id!)!); }));
    if (!reduced()) {
      allCards().filter((c) => !c.hidden && !before.has(c)).forEach((c) =>
        c.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: EASE_OUT }));
    }
    counts();
    announce(`${allCards().filter((c) => !c.hidden).length} tasks shown.`);
  }

  // ---- completing: the check fills, the Pin celebration plays, the card flies to the top of Done
  function markDone(t: Task) {
    t.completed = true;
    const card = cardOf(t.id);
    if (!card) return;
    card.classList.add('is-ticked');
    later(() => card.classList.remove('is-ticked'), 500);
    paint(card, t);
    if (visible()) {
      const r = card.querySelector('.bd-check')!.getBoundingClientRect();
      o.celebrate?.({ card, task: t, layer, x: r.left + r.width / 2, y: r.top + r.height / 2 });
    }
  }

  function tick(t: Task) {
    if (t.completed || isTemp(t.id)) return;
    const d = doneId();
    const from = t.sectionId;
    markDone(t);
    if (d && from !== d) {
      t.previousSectionId = from;
      t.sectionId = d;
      flying.add(t.id);
      later(() => flyTo(t, d), reduced() || !visible() ? 0 : 520);
    }
    announce(`${t.title} completed.`);
    emit(t);
    save(t.id, o.actions.setCompleted(t.id, true));
  }

  function untick(t: Task) {
    if (!t.completed || isTemp(t.id)) return;
    t.completed = false;
    const card = cardOf(t.id);
    if (card) paint(card, t);
    const d = doneId();
    if (d && t.sectionId === d) {
      // Back where it came from, or to the first section that isn't Done (the API does the same).
      const back = sectionById(t.previousSectionId)?.id ?? sections.find((s) => s.id !== d)?.id;
      if (back) { t.sectionId = back; flying.add(t.id); flyTo(t, back); }
    }
    announce(`${t.title} marked incomplete.`);
    emit(t);
    save(t.id, o.actions.setCompleted(t.id, false));
  }

  // A card changing section by tick or by the pane flies there along an arc; the others make room.
  function flyTo(t: Task, sid: string) {
    const card = cardOf(t.id), list = listOf(sid);
    const land = () => {
      flying.delete(t.id);
      if (card) card.classList.remove('is-arriving');
      if (card && !pending.has(t.id) && t.sectionId && colOfCard(card) !== t.sectionId) o.onStale();
      else if (!pending.has(t.id) && staleAfter.delete(t.id)) o.onStale();
    };
    if (!card || !list) { land(); return; }
    const animate = visible() && !reduced();
    const from = card.getBoundingClientRect();
    const before = sort === 'manual' ? list.querySelector('.bd-card') : slotFor(list, t);
    flip(movables().filter((x) => x !== card), () => list.insertBefore(card, before), animate ? 320 : 0);
    counts();
    if (!animate) { land(); return; }
    if (sort === 'manual') list.scrollTop = 0;
    else list.scrollTop = Math.max(0, card.offsetTop - list.clientHeight / 2);
    card.classList.add('is-arriving');
    const to = card.getBoundingClientRect();
    const wrap = document.createElement('div');
    wrap.className = 'bd-fly';
    const g = card.cloneNode(true) as HTMLElement;
    g.classList.remove('is-arriving', 'is-selected');
    g.classList.add('bd-ghost');
    g.removeAttribute('tabindex');
    g.style.width = `${from.width}px`;
    g.style.height = `${from.height}px`;
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
      land();
      card.animate([{ transform: 'scale(1.03)' }, { transform: 'none' }], { duration: 260, easing: EASE_OUT });
      o.onLand?.({ card, layer });
    };
  }

  function moveTo(id: string, sid: string) {
    const t = tasks.get(id);
    if (!t || t.sectionId === sid || isTemp(id) || !sectionById(sid)) return;
    const d = doneId();
    if (sid === d && !t.completed) { tick(t); return; }
    if (d && t.sectionId === d && t.completed) {
      t.completed = false;
      const card = cardOf(id);
      if (card) paint(card, t);
    }
    t.sectionId = sid;
    flying.add(id);
    flyTo(t, sid);
    emit(t);
    save(id, o.actions.moveTask(id, sid, 0));
  }

  // A dropped card: one request carries the move; the API ticks or unticks it when it enters or leaves Done.
  function settleCard(t: Task, card: HTMLElement, from: { sid: string; index: number }) {
    const sid = colOfCard(card), index = indexOfCard(card);
    if (sid === from.sid && index === from.index) return;
    if (sort !== 'manual' && sid === from.sid) { arrange([sid]); sortedNote(); return; }
    const d = doneId();
    t.sectionId = sid;
    if (d && sid === d && from.sid !== d && !t.completed) { t.previousSectionId = from.sid; markDone(t); }
    else if (d && from.sid === d && sid !== d && t.completed) { t.completed = false; paint(card, t); }
    counts();
    const shown = [...card.parentElement!.querySelectorAll(':scope > .bd-card:not([hidden])')];
    announce(`${t.title}: ${sectionById(sid)?.name}, ${shown.indexOf(card) + 1} of ${shown.length}.`);
    emit(t);
    // Sorted, a card dropped in another section goes to the top of that section's manual order.
    save(t.id, o.actions.moveTask(t.id, sid, sort === 'manual' ? index : 0));
    if (sort !== 'manual') arrange([sid]);
  }

  function settleCol(col: HTMLElement, fromIndex: number) {
    const index = allCols().indexOf(col);
    if (index === fromIndex) return;
    const id = col.dataset.section!;
    const order = allCols().map((c) => c.dataset.section);
    sections.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    sectionsChanged();
    announce(`${sectionById(id)?.name} moved to place ${index + 1} of ${sections.length}.`);
    persist(o.actions.moveSection(id, index), (s) => { const x = sectionById(s.id); if (x) x.position = s.position; });
  }

  // ---- pointer and touch drag, for cards and (by their header) sections
  let drag: Drag | null = null;
  listen(root, 'pointerdown', (ev) => {
    const e = ev as PointerEvent;
    if (e.button !== 0 || drag || lifted) return;
    const target = e.target as HTMLElement;
    if (target.closest('.bd-layer, .bd-menu')) return;
    const card = target.closest<HTMLElement>('.bd-card');
    const head = target.closest<HTMLElement>('.bd-col-head');
    let kind: Drag['kind'];
    let el: HTMLElement;
    if (card && root.contains(card)) {
      if (target.closest('button, a, input, textarea, select') || card.classList.contains('is-pending') || flying.has(card.dataset.id!)) return;
      kind = 'card';
      el = card;
    } else if (head && !compact) {
      if (target.closest('button, input') || head.closest('.bd-col.is-pending')) return;
      kind = 'col';
      el = head.closest<HTMLElement>('.bd-col')!;
    } else return;
    drag = {
      kind, el, id: kind === 'card' ? el.dataset.id! : el.dataset.section!, pointerId: e.pointerId, type: e.pointerType,
      sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, started: false,
      ox: 0, oy: 0, px: 0, py: 0, lx: 0, ly: 0, rot: 0, scale: 1,
      from: kind === 'card' ? { sid: colOfCard(el), index: indexOfCard(el) } : { sid: '', index: allCols().indexOf(el) },
      origin: { parent: el.parentElement!, next: el.nextElementSibling },
    };
    if (e.pointerType === 'touch') drag.timer = window.setTimeout(() => { if (drag && !drag.started) start(); }, 230);
    addEventListener('pointermove', onMove, { passive: false, signal: ac.signal });
    addEventListener('pointerup', onUp, { signal: ac.signal });
    addEventListener('pointercancel', onCancel, { signal: ac.signal });
  });
  listen(document, 'touchmove', (e) => { if (drag?.started) e.preventDefault(); }, { passive: false });
  listen(root, 'contextmenu', (e) => { if (drag) e.preventDefault(); });

  function onMove(ev: Event) {
    const e = ev as PointerEvent;
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
    const d = drag!;
    d.started = true;
    clearTimeout(d.timer);
    closeComposer();
    closeMenu(false);
    const r = d.el.getBoundingClientRect();
    d.ox = d.sx - r.left;
    d.oy = d.sy - r.top;
    d.px = r.left;
    d.py = r.top;
    const lo = layer.getBoundingClientRect();
    d.lx = lo.left;
    d.ly = lo.top;
    const g = d.el.cloneNode(true) as HTMLElement;
    g.classList.add('bd-ghost');
    g.classList.remove('is-selected');
    g.removeAttribute('tabindex');
    g.removeAttribute('aria-labelledby');
    g.querySelectorAll('[id]').forEach((x) => x.removeAttribute('id'));
    g.style.width = `${r.width}px`;
    g.style.height = `${r.height}px`;
    g.style.transformOrigin = `${d.ox}px ${d.oy}px`;
    g.style.transform = `translate3d(${r.left - d.lx}px, ${r.top - d.ly}px, 0)`;
    layer.append(g);
    d.ghost = g;
    d.el.classList.add(d.kind === 'card' ? 'is-placeholder' : 'is-col-placeholder');
    root.classList.add('is-dragging');
    document.documentElement.classList.add('bd-grabbing');
    if (d.type === 'touch') navigator.vibrate?.(8);
    announce(d.kind === 'card' ? `Picked up ${tasks.get(d.id)?.title}.` : `Picked up section ${sectionById(d.id)?.name}.`);
    d.raf = requestAnimationFrame(frame);
  }

  function frame() {
    const d = drag;
    if (!d || !d.started || !d.ghost) return;
    const tx = d.x - d.ox, ty = d.kind === 'col' ? d.py + (d.y - d.oy - d.py) * 0.25 : d.y - d.oy;
    if (reduced()) { d.px = tx; d.py = ty; } else {
      const nx = d.px + (tx - d.px) * 0.4;
      const vx = nx - d.px;
      d.px = nx;
      d.py += (ty - d.py) * 0.4;
      const lean = d.kind === 'col' ? 3 : 8;
      d.rot += (clamp(vx * 0.8, -lean, lean) - d.rot) * 0.2;
      d.scale += ((d.kind === 'col' ? 1.02 : 1.04) - d.scale) * 0.22;
    }
    d.ghost.style.transform = `translate3d(${d.px - d.lx}px, ${d.py - d.ly}px, 0) rotate(${d.rot}deg) scale(${d.scale})`;
    autoscroll();
    if (d.kind === 'card') placeCard(); else placeCol();
    d.raf = requestAnimationFrame(frame);
  }

  function autoscroll() {
    const d = drag!, r = scroller.getBoundingClientRect(), edge = 80;
    if (d.x < r.left + edge) scroller.scrollLeft -= ((r.left + edge - d.x) / edge) * 16;
    else if (d.x > r.right - edge) scroller.scrollLeft += ((d.x - (r.right - edge)) / edge) * 16;
    if (d.kind !== 'card') return;
    const list = d.el.parentElement!, lr = list.getBoundingClientRect();
    if (d.x >= lr.left && d.x <= lr.right && list.scrollHeight > list.clientHeight) {
      if (d.y < lr.top + 48) list.scrollTop -= 9;
      else if (d.y > lr.bottom - 48) list.scrollTop += 9;
    }
  }

  function placeCard() {
    const d = drag!;
    const hit = document.elementFromPoint(clamp(d.x, 1, innerWidth - 2), clamp(d.y, 1, innerHeight - 2));
    const col = hit?.closest<HTMLElement>('.bd-col');
    if (!col || !colsEl.contains(col) || col.classList.contains('is-pending')) return;
    const list = col.querySelector<HTMLElement>('.bd-list')!;
    if (sort !== 'manual') {
      if (d.el.parentElement === list) return;
      flip(movables(), () => list.insertBefore(d.el, slotFor(list, tasks.get(d.id)!)), 240);
      counts();
      return;
    }
    const lr = list.getBoundingClientRect();
    const y = d.y - lr.top + list.scrollTop;
    let next: HTMLElement | null = null;
    for (const c of list.querySelectorAll<HTMLElement>(':scope > .bd-card:not([hidden])')) {
      if (c === d.el) continue;
      if (y < c.offsetTop + c.offsetHeight / 2) { next = c; break; }
    }
    if (d.el.parentElement === list && (d.el.nextElementSibling === next || (!next && !d.el.nextElementSibling))) return;
    flip(movables(), () => list.insertBefore(d.el, next), 240);
    counts();
  }

  function placeCol() {
    const d = drag!;
    let next: Element | null = null;
    for (const c of allCols()) {
      if (c === d.el) continue;
      const r = c.getBoundingClientRect();
      if (d.x < r.left + r.width / 2) { next = c; break; }
    }
    next ??= colsEl.querySelector('.bd-newcol');
    if (d.el.nextElementSibling === next) return;
    flip(allCols(), () => colsEl.insertBefore(d.el, next), 260);
  }

  function stopListening(abort: boolean) {
    removeEventListener('pointermove', onMove);
    removeEventListener('pointerup', onUp);
    removeEventListener('pointercancel', onCancel);
    if (abort && drag) { clearTimeout(drag.timer); drag = null; }
  }
  function onUp(ev: Event) {
    const e = ev as PointerEvent;
    if (!drag || e.pointerId !== drag.pointerId) return;
    stopListening(false);
    clearTimeout(drag.timer);
    if (!drag.started) { drag = null; return; }
    drop(false);
  }
  function onCancel(ev: Event) {
    if (!drag || (ev as PointerEvent).pointerId !== drag.pointerId) return;
    stopListening(false);
    cancelDrag();
  }
  function cancelDrag() {
    const d = drag;
    if (!d) return;
    clearTimeout(d.timer);
    if (!d.started) { drag = null; return; }
    const els = d.kind === 'card' ? movables() : allCols();
    flip(els, () => d.origin.parent.insertBefore(d.el, d.origin.next?.isConnected ? d.origin.next : null), 240);
    counts();
    drop(true);
  }
  function drop(cancelled: boolean) {
    const d = drag!;
    drag = null;
    lastDragEnd = performance.now();
    cancelAnimationFrame(d.raf!);
    d.el.getAnimations().forEach((a) => a.finish());
    const r = d.el.getBoundingClientRect();
    const finish = () => {
      d.ghost?.remove();
      d.el.classList.remove('is-placeholder', 'is-col-placeholder');
      root.classList.remove('is-dragging');
      document.documentElement.classList.remove('bd-grabbing');
      if (!cancelled) {
        if (d.kind === 'card') {
          const t = tasks.get(d.id);
          if (t) settleCard(t, d.el, d.from);
          if (visible()) o.onLand?.({ card: d.el, layer });
        } else settleCol(d.el, d.from.index);
      }
      for (const f of inbox.splice(0)) f();
      flushReload();
    };
    if (reduced() || !d.ghost) { finish(); return; }
    d.ghost.animate([
      { transform: d.ghost.style.transform },
      { transform: `translate3d(${r.left - d.lx}px, ${r.top - d.ly}px, 0) rotate(0deg) scale(1)` },
    ], { duration: 220, easing: EASE_OUT, fill: 'forwards' }).onfinish = finish;
  }

  // ---- keyboard: Enter opens a card, Alt + arrows move it (keyboard moves don't animate)
  listen(document, 'keydown', (ev) => {
    const e = ev as KeyboardEvent;
    if (e.key === 'Escape' && drag?.started) { e.preventDefault(); stopListening(false); cancelDrag(); }
    // Q also works when nothing has focus yet (the page itself), not only from inside the board.
    if (!compact && (e.key === 'q' || e.key === 'Q') && !e.ctrlKey && !e.metaKey && !e.altKey && e.target === document.body && !drag && !lifted && visible()) {
      const first = allCols().find((c) => !c.classList.contains('is-pending'));
      if (first) { e.preventDefault(); openComposer(first, 'top'); }
    }
  });
  // One step of a keyboard move; nothing is saved until the card is put down.
  function step(card: HTMLElement, key: string) {
    const list = card.parentElement!;
    const siblings = [...list.querySelectorAll<HTMLElement>(':scope > .bd-card:not([hidden])')];
    const i = siblings.indexOf(card);
    if (sort !== 'manual' && (key === 'ArrowUp' || key === 'ArrowDown')) { sortedNote(); return false; }
    if (key === 'ArrowUp' && i > 0) list.insertBefore(card, siblings[i - 1]!);
    else if (key === 'ArrowDown' && i < siblings.length - 1) list.insertBefore(card, siblings[i + 1]!.nextElementSibling);
    else if (key === 'ArrowLeft' || key === 'ArrowRight') {
      const cols = allCols().filter((c) => !c.classList.contains('is-pending'));
      const target = cols[cols.indexOf(card.closest<HTMLElement>('.bd-col')!) + (key === 'ArrowRight' ? 1 : -1)];
      if (!target) return false;
      const tl = target.querySelector<HTMLElement>('.bd-list')!;
      if (sort === 'manual') tl.prepend(card); else tl.insertBefore(card, slotFor(tl, tasks.get(card.dataset.id!)!));
    } else return false;
    card.focus();
    card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    counts(false);
    return true;
  }
  const whereIs = (card: HTMLElement) => {
    const shown = [...card.parentElement!.querySelectorAll(':scope > .bd-card:not([hidden])')];
    return `${sectionById(colOfCard(card))?.name}, ${shown.indexOf(card) + 1} of ${shown.length}`;
  };
  function lift(card: HTMLElement) {
    closeComposer();
    closeMenu(false);
    lifted = { card, from: { sid: colOfCard(card), index: indexOfCard(card) }, origin: { parent: card.parentElement!, next: card.nextElementSibling } };
    card.classList.add('is-lifted');
    announce(`Picked up ${tasks.get(card.dataset.id!)?.title}. ${whereIs(card)}. Arrow keys move it, Space puts it down, Escape puts it back.`);
  }
  function putDown(cancel = false) {
    const l = lifted;
    if (!l) return;
    lifted = null;
    l.card.classList.remove('is-lifted');
    if (cancel) {
      l.origin.parent.insertBefore(l.card, l.origin.next?.isConnected && l.origin.next.parentElement === l.origin.parent ? l.origin.next : null);
      l.card.focus();
      counts(false);
      announce('Move cancelled. The card is back where it was.');
    } else {
      const t = tasks.get(l.card.dataset.id!);
      const moved = colOfCard(l.card) !== l.from.sid || indexOfCard(l.card) !== l.from.index;
      if (t) settleCard(t, l.card, l.from);
      if (!moved) announce('Put down. Nothing moved.');
    }
    for (const f of inbox.splice(0)) f();
    flushReload();
  }

  listen(root, 'keydown', (ev) => {
    const e = ev as KeyboardEvent;
    const tgt = e.target as HTMLElement;
    // Q adds a task to the top of the first section (when you aren't typing somewhere).
    if (!compact && (e.key === 'q' || e.key === 'Q') && !e.ctrlKey && !e.metaKey && !e.altKey && !lifted && !tgt.closest?.('input, textarea, select, [contenteditable="true"]')) {
      const first = allCols().find((c) => !c.classList.contains('is-pending'));
      if (first) { e.preventDefault(); openComposer(first, 'top'); }
      return;
    }
    const card = tgt.closest?.<HTMLElement>('.bd-card');
    if (!card || e.target !== card || card.classList.contains('is-pending')) return;
    if (lifted?.card === card) {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); putDown(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); putDown(true); }
      else if (e.key.startsWith('Arrow')) { e.preventDefault(); if (step(card, e.key)) announce(`${whereIs(card)}.`); }
      else if (e.key === 'Tab') putDown();
      return;
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); const t = tasks.get(card.dataset.id!); if (t) (t.completed ? untick : tick)(t); return; }
    if (e.key === 'Enter') { e.preventDefault(); o.onOpen(card.dataset.id!); return; }
    if (e.key === ' ' && !compact && !drag) { e.preventDefault(); lift(card); return; }
    if (!e.altKey || !e.key.startsWith('Arrow')) return;
    e.preventDefault();
    const from = { sid: colOfCard(card), index: indexOfCard(card) };
    if (!step(card, e.key)) return;
    const t = tasks.get(card.dataset.id!);
    if (t) settleCard(t, card, from);
  });
  // A click anywhere puts a lifted card down where it is.
  listen(document, 'pointerdown', () => { if (lifted) putDown(); }, { capture: true });

  // ---- inline composer: type, Enter, and it stays open for the next one
  function openComposer(col: HTMLElement, where: 'top' | 'bottom') {
    closeComposer();
    const list = col.querySelector<HTMLElement>('.bd-list')!;
    const box = document.createElement('div');
    box.className = 'bd-composer';
    const id = uid(`${P}-new`);
    box.innerHTML = `<label class="sr-only" for="${id}">Task name</label><textarea id="${id}" rows="2" maxlength="120" placeholder="Write a task name"></textarea>
      <div class="bd-composer-row"><button type="button" class="bd-btn" data-act="compose-add">Add task</button><button type="button" class="bd-btn-quiet" data-act="compose-cancel">Cancel</button></div>`;
    flip(movables(), () => (where === 'top' ? list.prepend(box) : list.append(box)), 200);
    if (!reduced()) box.animate([{ opacity: 0, transform: 'translateY(6px) scale(0.98)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: EASE_OUT });
    const ta = box.querySelector('textarea')!;
    composer = { box, ta, list, col, where };
    ta.focus();
    list.scrollTop = where === 'top' ? 0 : list.scrollHeight;
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addFromComposer(); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeComposer(true); }
    });
    ta.addEventListener('blur', () => later(() => {
      if (composer?.box === box && !box.contains(document.activeElement) && !ta.value.trim()) closeComposer();
    }, 120));
  }

  function addFromComposer() {
    if (!composer) return;
    const { ta, list, col, where, box } = composer;
    const title = ta.value.trim().replace(/\s+/g, ' ');
    if (!title) { ta.focus(); return; }
    const sid = col.dataset.section!;
    const t: Task = {
      id: uid('tmp'), projectId: project.id, sectionId: sid, parentId: null, title, notes: '', assigneeId: null, dueOn: null,
      priority: null, status: null, completed: sid === doneId(), completedAt: null, previousSectionId: null, position: '',
      createdAt: '', updatedAt: '', subtaskCount: 0, subtaskDoneCount: 0, commentCount: 0, attachmentCount: 0, likeCount: 0, liked: false, likerIds: [],
    };
    tasks.set(t.id, t);
    const el = makeCard(t);
    flip(movables(), () => list.insertBefore(el, where === 'top' ? box.nextSibling : box), 220);
    if (!reduced()) el.animate([{ opacity: 0, transform: 'translateY(10px) scale(0.97)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: EASE_OUT });
    ta.value = '';
    ta.focus();
    counts();
    announce(`Added ${title} to ${sectionById(sid)?.name}.`);
    persist(o.actions.createTask(sid, title, where === 'top' ? 0 : undefined), (real) => {
      const card = cardOf(t.id);
      tasks.delete(t.id);
      tasks.set(real.id, { ...real });
      if (card) { card.dataset.id = real.id; paint(card, tasks.get(real.id)!); resort(tasks.get(real.id)!); }
    }, () => {
      tasks.delete(t.id);
      cardOf(t.id)?.remove();
      counts(false);
    });
  }

  function closeComposer(focusBack = false) {
    if (!composer) return;
    const { box, col } = composer;
    composer = null;
    flip(movables().filter((x) => x !== box), () => box.remove(), 180);
    if (focusBack) col.querySelector<HTMLElement>('.bd-add')?.focus();
    flushReload();
  }

  // ---- sections
  function relabel(col: HTMLElement, s: Section) {
    col.querySelector('.bd-col-name')!.textContent = s.name;
    col.querySelector('.bd-col-plus')!.setAttribute('aria-label', `Add a task to the top of ${s.name}`);
    col.querySelector('.bd-col-more')!.setAttribute('aria-label', `More for ${s.name}`);
  }

  function newSection(btn: HTMLElement) {
    const wrap = btn.parentElement!;
    const id = uid(`${P}-sec`);
    wrap.innerHTML = `<form class="bd-newcol-form"><label class="sr-only" for="${id}">Section name</label><input id="${id}" class="bd-newcol-input" maxlength="120" placeholder="Name the section" autocomplete="off"></form>`;
    const input = wrap.querySelector('input')!;
    input.focus();
    const restore = () => { wrap.innerHTML = NEWCOL_BTN; };
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); restore(); wrap.querySelector('button')?.focus(); } });
    input.addEventListener('blur', () => later(() => { if (wrap.contains(input) && !input.value.trim()) restore(); }, 120));
    wrap.querySelector('form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = input.value.trim().replace(/\s+/g, ' ');
      if (!name) return;
      const s: Section = { id: uid('tmp'), projectId: project.id, name, position: '' };
      sections.push(s);
      const tmp = document.createElement('div');
      tmp.innerHTML = colHTML(s);
      const col = tmp.firstElementChild as HTMLElement;
      colsEl.insertBefore(col, wrap);
      counts(false);
      if (!reduced()) col.animate([{ opacity: 0, transform: 'translateX(16px)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: EASE_OUT });
      input.value = '';
      scroller.scrollTo({ left: scroller.scrollWidth, behavior: reduced() ? 'auto' : 'smooth' });
      announce(`Section ${name} added.`);
      persist(o.actions.createSection(name), (real) => {
        const i = sections.indexOf(s);
        if (i >= 0) sections[i] = { ...real };
        col.dataset.section = real.id;
        col.classList.remove('is-pending');
        sectionsChanged();
      }, () => {
        sections = sections.filter((x) => x !== s);
        col.remove();
      });
    });
  }

  function renameSection(col: HTMLElement) {
    const h = col.querySelector<HTMLElement>('.bd-col-name');
    const s = sectionById(col.dataset.section!);
    if (!h || !s || col.classList.contains('is-pending')) return;
    const input = document.createElement('input');
    input.className = 'bd-col-rename';
    input.value = s.name;
    input.maxLength = 120;
    input.setAttribute('aria-label', 'Section name');
    h.replaceWith(input);
    input.focus();
    input.select();
    renaming = true;
    let finished = false;
    const finish = (keep: boolean) => {
      if (finished) return;
      finished = true;
      renaming = false;
      const name = input.value.trim().replace(/\s+/g, ' ');
      input.replaceWith(h);
      if (keep && name && name !== s.name) {
        s.name = name;
        relabel(col, s);
        sectionsChanged();
        announce(`Section renamed to ${name}.`);
        persist(o.actions.renameSection(s.id, name));
      }
      col.querySelector<HTMLElement>('.bd-col-more')?.focus();
      flushReload();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
  }

  function shiftSection(col: HTMLElement, dir: -1 | 1) {
    const cols = allCols();
    const i = cols.indexOf(col), j = i + dir;
    if (j < 0 || j >= cols.length || cols[j]!.classList.contains('is-pending')) return;
    flip(cols, () => colsEl.insertBefore(col, dir < 0 ? cols[j]! : cols[j]!.nextElementSibling), 260);
    settleCol(col, i);
    col.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // Deleting keeps the tasks: they go to the end of the first other section, as the API does.
  function deleteSection(col: HTMLElement) {
    const sid = col.dataset.section!;
    const target = sections.find((x) => x.id !== sid);
    const tlist = target && listOf(target.id);
    if (!target || !tlist) return;
    const cards = [...col.querySelectorAll<HTMLElement>('.bd-card')];
    flip([...movables(), ...allCols()], () => {
      for (const c of cards) { tlist.append(c); const t = tasks.get(c.dataset.id!); if (t) t.sectionId = target.id; }
      col.remove();
    }, 260);
    sections = sections.filter((x) => x.id !== sid);
    if (project.doneSectionId === sid) project.doneSectionId = null;
    counts();
    sectionsChanged();
    announce(`Section deleted.${cards.length ? ` Its tasks moved to ${target.name}.` : ''}`);
    persist(o.actions.deleteSection(sid));
  }

  // ---- the section menu: rename, move left or right, delete (with a second step)
  let menuFor: HTMLElement | null = null; // the column, for a section menu
  let menuBtn: HTMLElement | null = null;
  const menuItems = () => [...menu.querySelectorAll<HTMLButtonElement>('button:not([disabled])')];
  function showMenu(btn: HTMLElement, origin: 'left' | 'right') {
    menu.hidden = false;
    const r = btn.getBoundingClientRect();
    const w = menu.offsetWidth;
    menu.style.left = `${clamp(origin === 'right' ? r.right - w : r.left, 8, innerWidth - w - 8)}px`;
    menu.style.top = `${r.bottom + 6}px`;
    menu.style.transformOrigin = `top ${origin}`;
    btn.setAttribute('aria-expanded', 'true');
    if (!reduced()) menu.animate([{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'none' }], { duration: 160, easing: EASE_OUT });
  }
  function openSortMenu(btn: HTMLElement) {
    if (menuBtn === btn) { closeMenu(true); return; }
    closeMenu(false);
    menuBtn = btn;
    menu.innerHTML = `<p class="bd-menu-note">Order cards in each section by</p>${(Object.keys(SORTS) as SortKey[]).map((k) =>
      `<button type="button" role="menuitemradio" aria-checked="${k === sort}" data-m="sort:${k}">${SORTS[k]}</button>`).join('')}`;
    menu.setAttribute('aria-label', 'Sort tasks');
    showMenu(btn, 'right');
    (menu.querySelector<HTMLElement>('[aria-checked="true"]') ?? menuItems()[0])?.focus();
  }
  function openMenu(btn: HTMLElement) {
    const col = btn.closest<HTMLElement>('.bd-col')!;
    if (menuFor === col) { closeMenu(true); return; }
    closeMenu(false);
    menuFor = col;
    menuBtn = btn;
    const cols = allCols(), i = cols.indexOf(col);
    menu.innerHTML = `
      <button type="button" role="menuitem" data-m="rename">Rename</button>
      <button type="button" role="menuitem" data-m="left"${i === 0 ? ' disabled' : ''}>Move left</button>
      <button type="button" role="menuitem" data-m="right"${i === cols.length - 1 ? ' disabled' : ''}>Move right</button>
      <button type="button" role="menuitem" data-m="delete" class="is-danger"${cols.length < 2 ? ' disabled' : ''}>Delete section</button>`;
    menu.setAttribute('aria-label', `${sectionById(col.dataset.section!)?.name ?? 'Section'} options`);
    showMenu(btn, 'right');
    menuItems()[0]?.focus();
  }
  function closeMenu(focusBack: boolean) {
    if (!menuBtn) return;
    const btn = menuBtn;
    btn.setAttribute('aria-expanded', 'false');
    menuFor = null;
    menuBtn = null;
    menu.hidden = true;
    if (focusBack && btn.isConnected) btn.focus();
  }
  function menuChoice(m: string) {
    if (m.startsWith('sort:')) { closeMenu(true); setSort(m.slice(5) as SortKey); return; }
    const col = menuFor;
    if (!col) return;
    const sid = col.dataset.section!;
    if (m === 'rename') { closeMenu(false); renameSection(col); }
    else if (m === 'left' || m === 'right') { closeMenu(true); shiftSection(col, m === 'left' ? -1 : 1); }
    else if (m === 'delete') {
      const s = sectionById(sid), target = sections.find((x) => x.id !== sid);
      const n = col.querySelectorAll('.bd-card').length;
      menu.innerHTML = `<p class="bd-menu-note">Delete “${esc(s?.name ?? '')}”?${n && target ? ` Its ${n} task${n === 1 ? '' : 's'} move to “${esc(target.name)}”.` : ''}</p>
        <button type="button" role="menuitem" data-m="confirm" class="is-danger">Delete section</button>
        <button type="button" role="menuitem" data-m="cancel">Keep it</button>`;
      menuItems()[0]?.focus();
    } else if (m === 'confirm') { closeMenu(false); deleteSection(col); }
    else closeMenu(true);
  }
  listen(menu, 'keydown', (ev) => {
    const e = ev as KeyboardEvent;
    const items = menuItems();
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); }
    else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); items[e.key === 'Home' ? 0 : items.length - 1]?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(true); }
    else if (e.key === 'Tab') closeMenu(false);
  });
  listen(document, 'pointerdown', (e) => {
    if (menuBtn && !menu.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('.bd-col-more, .bd-sort')) closeMenu(false);
  });
  listen(scroller, 'scroll', () => closeMenu(false), { passive: true });

  // ---- clicks
  listen(root, 'click', (ev) => {
    if (performance.now() - lastDragEnd < 80) return;
    const tgt = ev.target as HTMLElement;
    const item = tgt.closest<HTMLElement>('.bd-menu [data-m]');
    if (item) { menuChoice(item.dataset.m!); return; }
    if (tgt.closest('.bd-col.is-pending, .bd-layer')) return;
    const check = tgt.closest('.bd-check');
    if (check) {
      const t = tasks.get(check.closest<HTMLElement>('.bd-card')!.dataset.id!);
      if (t) (t.completed ? untick : tick)(t);
      return;
    }
    const col = tgt.closest<HTMLElement>('.bd-col');
    if (tgt.closest('.bd-add') && col) { openComposer(col, 'bottom'); return; }
    if (tgt.closest('.bd-col-plus') && col) { openComposer(col, 'top'); return; }
    const more = tgt.closest<HTMLElement>('.bd-col-more');
    if (more) { openMenu(more); return; }
    const sortBtn = tgt.closest<HTMLElement>('.bd-sort');
    if (sortBtn) { openSortMenu(sortBtn); return; }
    if (tgt.closest('[data-act="add-top"]')) { const first = allCols()[0]; if (first) openComposer(first, 'top'); return; }
    if (tgt.closest('[data-act="compose-add"]')) { addFromComposer(); return; }
    if (tgt.closest('[data-act="compose-cancel"]')) { closeComposer(true); return; }
    const f = tgt.closest<HTMLElement>('.bd-filter');
    if (f) { setFilter(f.dataset.filter as Filter); return; }
    const nc = tgt.closest<HTMLElement>('.bd-newcol-btn');
    if (nc) { newSection(nc); return; }
    const card = tgt.closest<HTMLElement>('.bd-card');
    if (card && !card.classList.contains('is-pending') && !compact) o.onOpen(card.dataset.id!);
  });
  listen(root, 'dblclick', (e) => {
    const h = (e.target as HTMLElement).closest('.bd-col-name');
    if (h && !compact) renameSection(h.closest<HTMLElement>('.bd-col')!);
  });

  // ---- for the React side
  function select(id: string | null) {
    current = id;
    colsEl.querySelectorAll('.bd-card.is-selected').forEach((c) => c.classList.remove('is-selected'));
    if (!id) return;
    const card = cardOf(id);
    card?.classList.add('is-selected');
    card?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function remove(id: string) {
    const card = cardOf(id);
    tasks.delete(id);
    if (current === id) current = null;
    if (!card) return;
    flip(movables().filter((x) => x !== card), () => card.remove(), 220);
    counts();
  }

  // A reload never lands mid-drag, mid-rename or while the composer is open; it waits, then asks for a fresh copy.
  const busy = () => !!drag || !!composer || renaming || !!lifted;
  function flushReload() {
    if (!reloadWanted || busy()) return;
    reloadWanted = false;
    later(() => o.onStale(), 0);
  }
  function replace(b: Board) {
    if (busy()) { reloadWanted = true; return; }
    closeComposer();
    closeMenu(false);
    const left = scroller.scrollLeft;
    const tops = new Map(allCols().map((c) => [c.dataset.section, c.querySelector<HTMLElement>('.bd-list')!.scrollTop]));
    load(b);
    pending.clear();
    flying.clear();
    render();
    scroller.scrollLeft = left;
    for (const c of allCols()) c.querySelector<HTMLElement>('.bd-list')!.scrollTop = tops.get(c.dataset.section) ?? 0;
    root.querySelectorAll<HTMLElement>('.bd-filter').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.filter === filter)));
    select(current);
    for (const t of tasks.values()) emit(t);
  }

  // ---- other people's changes
  const who = (id: string) => nameOf(id) ?? 'Someone';
  function remoteTask(s: Omit<Task, 'liked'>, actorId: string) {
    if (drag || lifted) { inbox.push(() => remoteTask(s, actorId)); return; }
    if (s.parentId || s.projectId !== project.id) return;
    if (pending.has(s.id) || flying.has(s.id)) { staleAfter.add(s.id); return; }
    const t = tasks.get(s.id);
    const liked = s.likerIds.includes(o.me);
    if (!t) {
      const list = s.sectionId ? listOf(s.sectionId) : null;
      if (!list) return;
      const nt: Task = { ...s, liked };
      tasks.set(nt.id, nt);
      const card = makeCard(nt);
      card.hidden = !matches(nt);
      flip(movables(), () => list.insertBefore(card, slotFor(list, nt)), 260);
      if (visible() && !reduced() && !card.hidden) card.animate([{ opacity: 0, transform: 'translateY(10px) scale(0.97)' }, { opacity: 1, transform: 'none' }], { duration: 300, easing: EASE_OUT });
      counts();
      mark(card, actorId);
      announce(`${who(actorId)} added ${nt.title} to ${sectionById(nt.sectionId)?.name}.`);
      return;
    }
    if (t.updatedAt && s.updatedAt && s.updatedAt < t.updatedAt) return; // an older copy than ours
    const from = t.sectionId, wasDone = t.completed;
    Object.assign(t, s, { liked });
    const card = cardOf(t.id);
    if (!card) { emit(t); return; }
    const list = t.sectionId ? listOf(t.sectionId) : null;
    if (!list) { o.onStale(); return; }
    paint(card, t);
    card.hidden = !matches(t);
    const slot = slotFor(list, t);
    if (card.parentElement !== list || nextSettled(card) !== slot) {
      flip(movables(), () => list.insertBefore(card, slot), 420, EASE_IN_OUT);
      counts();
    }
    if (t.completed && !wasDone) { card.classList.add('is-ticked'); later(() => card.classList.remove('is-ticked'), 500); }
    mark(card, actorId);
    if (from !== t.sectionId) announce(`${who(actorId)} moved ${t.title} to ${sectionById(t.sectionId)?.name}.`);
    else if (t.completed !== wasDone) announce(`${who(actorId)} marked ${t.title} ${t.completed ? 'complete' : 'incomplete'}.`);
    emit(t);
  }

  function remoteRemove(id: string, actorId: string) {
    if (drag || lifted) { inbox.push(() => remoteRemove(id, actorId)); return; }
    const t = tasks.get(id);
    if (!t) return;
    staleAfter.delete(id);
    remove(id);
    announce(`${who(actorId)} deleted ${t.title}.`);
  }

  // Whose change it was: their avatar on the card for a moment, and a ring around it.
  function mark(card: HTMLElement, actorId: string) {
    const u = users.find((x) => x.id === actorId);
    if (!u || card.hidden || !visible()) return;
    card.querySelector('.bd-by')?.remove();
    const b = document.createElement('span');
    b.className = 'bd-avatar bd-by';
    b.dataset.tone = String(toneOf(users, u.id));
    b.textContent = initials(u.displayName);
    b.title = `Changed by ${u.displayName}`;
    b.setAttribute('aria-hidden', 'true');
    card.append(b);
    card.classList.remove('is-remote');
    void card.offsetWidth;
    card.classList.add('is-remote');
    if (!reduced()) b.animate([{ opacity: 0, transform: 'scale(0.6)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: EASE_OUT });
    later(() => {
      card.classList.remove('is-remote');
      if (reduced()) { b.remove(); return; }
      b.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(0.8)' }], { duration: 300, easing: EASE_OUT, fill: 'forwards' }).onfinish = () => b.remove();
    }, 2400);
  }

  return {
    get: (id) => tasks.get(id),
    select,
    patch,
    save,
    remove,
    toggle: (id) => { const t = tasks.get(id); if (t) (t.completed ? untick : tick)(t); },
    moveTo,
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
    replace,
    remoteTask,
    remoteRemove,
    isDragging: () => !!drag?.started,
    focusCard: (id) => cardOf(id)?.focus({ preventScroll: true }),
    destroy() {
      ac.abort();
      timers.forEach((t) => clearTimeout(t));
      if (drag) { cancelAnimationFrame(drag.raf!); clearTimeout(drag.timer); }
      document.documentElement.classList.remove('bd-grabbing');
      root.classList.remove('bd', 'is-dragging');
      root.innerHTML = '';
    },
  };
}
