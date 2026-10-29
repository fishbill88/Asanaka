# Asanaka — build plan

Asanaka is a kanban board modelled on Asana's Board view. The name is Cebuano: *Asa na ka?*, "where
are you now?", which is the question every card on a board answers by the column it sits in.

- **Frontend:** `https://fishbill88.github.io/Asanaka/` (GitHub Pages, built by Actions from this repo).
- **API + database:** our VPS, in Docker, behind the box's existing Caddy, on its own HTTPS hostname.
- **Accounts:** `admin` (password rotates) and `ameerperalta`. There's no sign-up, password reset
  or SSO. Sign-in exists, but it isn't the focus of the build.

We copy Asana's board interactions, not its name, logo or artwork.

---

## 1. Decisions

| Area | Choice | Why |
| --- | --- | --- |
| Frontend | Vite + React 19 + TypeScript, static build | Pages serves static files only |
| Drag and drop | The design prototype's own engine, ported to TypeScript (`web/src/board/engine.ts`): pointer, touch long-press, Alt + arrows | Design B's drag, card reflow and arc to Done were approved as built; porting keeps them exact (changed from dnd-kit in phase 4) |
| Motion | Web Animations and CSS (FLIP reflow, drawer curve); GSAP + ScrollTrigger on the landing page only | Transform and opacity only; every move honours reduced motion |
| Server state | Optimistic: a change shows at once, writes go out one at a time in order, a refused one reloads the board | No query library needed for one board at a time (changed from TanStack Query in phase 4) |
| API | Node 22 + Fastify + `pg` | Same runtime as the other services on the box; schema validation built in |
| Database | Postgres 16 in its own container, compose project `asanaka` | Isolated from every other tenant and from the host's Postgres |
| Local dev DB | PGlite (Postgres compiled to WASM) | This PC has no Docker; tests still run real Postgres SQL |
| Ordering | Fractional-index string keys on sections and tasks | A drag rewrites one row, never the whole column |
| Auth | Username + password, `scrypt` hashes, opaque bearer tokens (12 h) | Cookies won't cross from github.io to the API host; tokens will |
| Brute force | 5 wrong passwords per address and username → 15-minute lock | The login page is public |
| Realtime | Server-sent events per project (phase 6) | One-way updates are enough; they pass through Caddy unchanged |

## 2. What we replicate from Asana's board

**v1 (the board works end to end)**
- Sidebar: project list with colour, the current user, sign out.
- Project header: name, member avatars, filter (all / my tasks / due this week), *Add task*.
- Sections as columns: inline rename, task count, *+* to add a task at the top, menu (rename,
  move left/right, delete), *Add section* column at the end, drag to reorder sections.
- Cards: check circle, title, assignee avatar, due date (red when overdue, highlighted today),
  priority and status chips, subtask and comment counts.
- Drag cards within and across sections; the other cards make room with a layout animation;
  autoscroll near the edges; keyboard moves (pick up, arrows, drop) and touch long-press.
- Inline composer at the bottom of each section: type, Enter, and it stays open for the next.
- Task pane sliding in from the right, deep-linkable (`/p/:project/t/:task`): title, complete,
  assignee, due date, section, priority, status, description, subtasks, comments, activity.
- Completing a task: the check fills, a short celebration plays, the card settles in *Done*.
  Unchecking puts it back in the section it came from.
- Attachments (added 30 Oct 2026): files and images up to 10 MB each, from *Attach files*, by dropping
  them on the task pane, or by pasting into the description, where they upload at once and images show in
  place. Cards count them; images open in a lightbox.

**v1.1 (phase 6–7)**: live updates between people, sort, likes, task activity feed, admin users page,
multi-select drag, keyboard shortcuts (`Tab+Q` quick add, `Tab+Enter` complete).

**Later**: list, timeline and calendar views, attachments, custom fields, notifications.

## 3. Architecture

```
Browser ── fishbill88.github.io/Asanaka (static: HTML, JS, fonts)
   │  HTTPS, Authorization: Bearer <token>
   ▼
Caddy on the VPS ── asanaka.<vps-host> (TLS, gzip, 1 MB body limit)
   │  127.0.0.1:<api-port>
   ▼
api container (Fastify) ── db container (Postgres 16, no published port, volume asanaka_pgdata)
```

CORS allows exactly one origin, `https://fishbill88.github.io`. The API base URL is baked into the
build from a GitHub Actions repository variable (`ASANAKA_API_ORIGIN`), not from source. It's public by
nature, since the browser calls it, but it isn't a credential.

## 4. Repository layout

```
web/                     Vite + React app (landing, sign-in, board)
  src/board/             engine.ts (columns, cards, drag), TaskPane.tsx, BoardView.tsx, celebrate.ts
  src/pages/             Home, SignIn, Workspace
api/
  src/                   Fastify routes, auth, board logic
  migrations/            numbered SQL files, each applied once at start-up
  tools/admin.mjs        CLI: add user, set password (read from stdin), list, disable
  tools/dev-server.mjs   the API on PGlite for local work (npm run dev:api)
  test/                  node:test suites against PGlite
vps/
  docker-compose.yml     db + api, ports on 127.0.0.1 only, memory/CPU limits
  Dockerfile.api
  asanaka.caddy          the Caddy site
  asanaka                operator CLI on the box (status, logs, psql, backup, admin-password)
  remote-deploy.sh       runs on the box: unpack, build, restart, health check
  local.mjs              runs here: deploy, publish, rotate-admin, seed-users, status, smoke
  site-sync.sh           the Caddy site, through TaskTopFight's passwordless host helper
designs/                 the three design prototypes (static HTML)
.github/workflows/
  pages.yml              build web/ and deploy to Pages
  secrets-scan.yml       gitleaks on every push
.githooks/pre-commit     refuses .env, .secrets/, .local/ and password-looking strings
deploy-vps.bat · publish-api.bat · rotate-admin-password.bat · seed-users.bat   double-click helpers
```

## 5. Data model

```sql
users      (id uuid pk, username citext unique, display_name, password_hash, role 'admin'|'member',
            avatar_hue int, disabled bool, session_epoch int, created_at, updated_at)
sessions   (id uuid pk, user_id fk, token_hash bytea unique, epoch int, created_at, expires_at,
            last_seen_at, ip inet, user_agent)
projects   (id uuid pk, name, color, position text, archived_at, created_by fk, created_at)
sections   (id uuid pk, project_id fk, name, position text, created_at)
tasks      (id uuid pk, project_id fk, section_id fk, parent_id fk null,       -- parent = subtask
            title, notes, assignee_id fk null, due_on date null,
            priority 'low'|'medium'|'high' null, status 'on_track'|'at_risk'|'off_track' null,
            completed_at null, completed_by null, previous_section_id null,
            position text, created_by, created_at, updated_at, deleted_at null)
comments   (id uuid pk, task_id fk, author_id fk, body, created_at, edited_at null)
attachments (id uuid pk, task_id fk, uploader_id fk, filename, content_type, size, data bytea, created_at)
task_likes (task_id, user_id, pk both)
activity   (id bigserial, project_id, task_id null, actor_id, kind, data jsonb, created_at)
login_failures (ip inet, username citext, failures int, locked_until timestamptz, pk (ip, username))
schema_migrations (name pk, applied_at)
```

Indexes: `tasks (section_id, position) where deleted_at is null and parent_id is null`,
`sessions (token_hash)`, `activity (task_id, created_at desc)`.

## 6. API (JSON, under `/api`)

| Method & path | Does |
| --- | --- |
| `POST /auth/login` | `{username, password}` → `{token, user, expiresAt}`; counts failures |
| `POST /auth/logout` · `GET /me` | end this session · who am I |
| `GET /users` | people for the assignee picker |
| `GET/POST /projects` · `PATCH/DELETE /projects/:id` | list, create, rename/recolour, archive |
| `GET /projects/:id/board` | project + sections + top-level tasks (with subtask/comment counts) |
| `POST /projects/:id/sections` · `PATCH/DELETE /sections/:id` | add; rename or move; delete (tasks move to the first section) |
| `POST /sections/:id/tasks` | add a task at the top or bottom |
| `PATCH /tasks/:id` | any field, including `{sectionId, position}` for a drag and `{completed}` |
| `GET /tasks/:id` · `DELETE /tasks/:id` | full task with subtasks, comments, activity · soft delete |
| `POST /tasks/:id/subtasks` · `POST /tasks/:id/comments` · `PUT/DELETE /tasks/:id/like` | |
| `POST /tasks/:id/attachments?name=&type=` · `GET/DELETE /attachments/:id` | upload raw bytes (10 MB), download (always as a sandboxed attachment), remove |
| `GET /projects/:id/events` | server-sent events: task and section changes by other people (phase 6) |
| `GET/POST /admin/users` · `POST /admin/users/:id/password` | admin only (phase 7) |
| `GET /healthz` | liveness for Docker and the deploy script |

Moves are last-write-wins on one row. The client sends the new `position` key computed between its
neighbours, so a concurrent move elsewhere in the column can't conflict.

## 7. Accounts and passwords

**admin.** The password is 20 random characters, generated on the VPS. It never exists in this repo
or on this PC's disk.
- `asanaka admin-password --rotate` on the box makes a new one, pipes it on stdin to
  `tools/admin.mjs set-password admin` (the hash updates and admin sessions are signed out at once,
  with no restart), stores the plain copy in a `0600` file next to the compose file, and prints it once.
- **Rotation happens only when asked** (decided 29 Oct 2026). There is no schedule.
- From this PC: `rotate-admin-password.bat` rotates now and shows the new password.
  `rotate-admin-password.bat -Show` shows the current one.

**ameerperalta.** `seed-users.bat` reads `.secrets/users.local.json` (gitignored) and sends each
password over SSH **on stdin** to `tools/admin.mjs set-password`. The password never appears in the
repo, in a command line (which `ps` would expose) or in shell history. That also sidesteps a trap with
this particular password: `$$` inside a double-quoted shell string expands to a process id, and inside
a compose `.env` it collapses to a single `$`. Stdin carries it byte for byte.

The given password is short and common. Lockout and rate limits protect it, but it should change
after the first sign-in (the admin users page in phase 7 can do it).

## 8. Where secrets live

| Secret | Lives only in | Never in |
| --- | --- | --- |
| SSH key, VPS address, operator account | `~/.ssh/` on this PC | the repo |
| VPS survey notes (ports, tenants, sudo rules) | `.local/VPS.md` (gitignored) | the repo |
| Postgres password | `.env` on the VPS (`0600`), generated there | anywhere else |
| admin password | VPS (`0600` file + hash in the DB) | the repo, this PC |
| ameerperalta password | `.secrets/users.local.json` here + hash in the DB | the repo, the VPS's disk in plain text |
| API base URL | GitHub Actions repository variable | source files (it ends up in the built JS by design) |

Three guards: the `.gitignore` above, a pre-commit hook that refuses those paths and anything shaped
like a password assignment, and gitleaks in Actions as the backstop.

## 9. VPS

Asanaka gets its own compose project in the operator's home directory, because that account can't
create folders under `/opt`. It has its own Postgres container and volume, and its API listens on
127.0.0.1 only. Limits: api 0.5 CPU / 256 MB, db 512 MB. The other services on the box are left alone.

The public address needs no password. TaskTopFight's root-owned helper (`ttf-host-sync`, which the
operator may run with sudo and no password) installs `/opt/ttf/ttf.caddy`, and that file imports
`/opt/ttf/extra-sites/*.caddy`. Each deploy runs `site-sync.sh`: it checks Asanaka's site file parses,
copies it into `extra-sites`, and runs the helper, which validates everything (rolling back on failure)
and restarts Caddy only when something changed. Caddy runs with its admin API off, so that restart is a
~1 second blip for **every** site on the box.

Backups: nightly `pg_dump -Fc` from the operator's crontab, 14 kept. `asanaka backup` dumps on demand.

## 10. Deploying

- **Frontend:** push to `main`, and `pages.yml` builds `web/` with `ASANAKA_API_ORIGIN` and publishes
  it. Pages has no SPA fallback, so the build copies `index.html` to `404.html`. React Router runs with
  `basename="/Asanaka"`. A `<meta>` Content-Security-Policy limits scripts to our own files.
- **API:** `deploy-vps.bat` → `vps/local.mjs deploy` stages `api/` and `vps/`, copies them over SSH, and runs
  `remote-deploy.sh`. That script builds the image, starts db then api, waits for `/healthz`, and
  keeps the last five releases. Migrations apply themselves on start. The db container is never rebuilt.
- **Smoke test:** `node api/tools/smoke.mjs <origin>` signs in, makes a project, adds, moves,
  completes and deletes a task, then signs out.

## 11. Design

Three directions are in `designs/`, each a working prototype of the landing page, sign-in and
board (drag, task pane, completion). **Design B (Pin) is chosen** and becomes the landing page
and the skin of the React app. From C it takes the "Nahuman na." banner (Cebuano for "it's
finished"), shown as a magenta pill when a task is ticked. `plan.html` is a review page for this
plan with live previews of all three designs.

| | Direction | Idea |
| --- | --- | --- |
| A | **Chapters**: charcoal with flat poster primaries, General Sans | The four sections of a board are four colour chapters; one card travels through them as you scroll |
| B | **Pin**: sky and sand with magenta, Roundo | The round check you tap to finish a task is the "you are here" dot; every shape on the site is that circle |
| C | **Departures**: mustard and black, Hanken Grotesk | "Asa na ka?" set as one huge line with a live card inside it; the board reads like a departures board |

## 12. Phases

Each phase ends with something that can be checked.

| # | Phase | Done when |
| --- | --- | --- |
| 0 | Plan + three designs | Done 29 Oct 2026: design B picked, questions answered (§13) |
| 1 | Repo scaffold: `web/`, `api/`, hooks, gitleaks, Pages workflow | **Done 29 Oct 2026.** Pages serves the app at the GitHub link; committing a fake `.env`, the real password or the server IP is refused |
| 2 | API + schema, tested locally on PGlite | **Done 29 Oct 2026.** 23 tests: sign-in, lockout, sessions, board read, move ordering, complete/uncomplete, subtasks, comments, likes, sections |
| 3 | VPS: compose, first deploy, Caddy site, seed users, password rotation, backups | **Done 29 Oct 2026.** Smoke passes on the box and through the public address; rotation verified; backups nightly |
| 4 | Board UI: sections, cards, drag, composer, task pane, completion | **Done 30 Oct 2026.** A 31-step browser drive (real mouse and keys) passes against the API on PGlite: sign-in, tick and untick, drags, Alt + arrows, composer, pane edits, sections, filters, deep links, phone. On the GitHub link, signed in as `ameerperalta` against the live API, an 11-step check passes in a throwaway project (archived after) |
| 5 | Landing + sign-in in the chosen design; production build on Pages | Signing in at the GitHub link as `ameerperalta` opens the board, end to end |
| 6 | Realtime, sort, likes, activity | Two browsers see each other's moves within a second |
| 7 | Admin users page, accessibility and mobile pass, reduced motion | Keyboard-only drag works; the phone layout passes; admin can reset a password |

## 13. Decisions from review (29 Oct 2026)

1. Design: **B (Pin)**, with the "Nahuman na." banner from C.
2. Admin password: rotates **only when asked**.
3. Display name for `ameerperalta`: **Ameer Peralta**.
4. Caddy restart: **any time** is fine.
5. "Nahuman na." is the right Cebuano for "it's finished".

Added 30 Oct 2026: the `admin` account is shown as **Biloy** (`node vps/local.mjs rename admin Biloy`; a
password rotation keeps the name). Tasks take **attachments**; files are stored in Postgres so the nightly
dump backs them up, and Caddy lets the upload path through at 11 MB while every other API call stays at 1 MB.

## 14. Risks

- **Shared box.** A runaway container could starve the others; the compose limits prevent it.
- **sslip.io** provides the hostname. If it goes away, the API needs a real domain (one Caddy line
  and one repository variable).
- **Tokens in `localStorage`** can be read by any script that runs on the page. The CSP meta and
  no third-party scripts keep that surface small.
