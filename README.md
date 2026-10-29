# Asanaka

An Asana-style project tracker built around the kanban board. The name is Cebuano: *Asa na ka?*,
"where are you now?", which is what every card on a board answers by the column it sits in.

- **Site:** https://fishbill88.github.io/Asanaka/ (GitHub Pages, built from `web/`)
- **Plan:** [PLAN.md](PLAN.md), or open [plan.html](plan.html) in a browser for the review page
- **Designs:** [designs/](designs/) holds the three prototypes; design B (Pin) was chosen

## Layout

| Folder | What it is |
| --- | --- |
| `web/` | The site: Vite + React + TypeScript, published to GitHub Pages |
| `api/` | The board API: Fastify on Node 22, run in Docker on the VPS with its own Postgres |
| `scripts/check-secrets.mjs` | Refuses commits that would publish a secret (run by `.githooks/pre-commit` and CI) |
| `.github/workflows/` | `pages.yml` publishes the site; `checks.yml` runs the secret scans, tests and build |
| `designs/` | The three design prototypes and the shared board engine they use |

## Working on it

Needs Node 22.12 or newer.

```
npm install          # also turns on the secret-checking commit hook
npm run dev          # the site at http://localhost:5173/Asanaka/
npm test             # API tests
npm run build        # production build into web/dist
```

## Secrets stay local

The repository is public. Passwords, the VPS address and server notes live only in gitignored
folders (`.secrets/`, `.local/`) on the machine that deploys. The commit hook refuses environment
files, those folders, private keys, server IP addresses and any password listed in
`.secrets/users.local.json`; CI repeats the check and runs gitleaks over the whole history.
