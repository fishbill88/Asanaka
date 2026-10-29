#!/usr/bin/env bash
# Runs ON THE VPS (vps/local.mjs deploy calls it over SSH). Unpacks the staged release into
# ~/asanaka/releases/<label>, points ~/asanaka/current at it, rebuilds the api image and restarts it.
# The database container and its volume are never rebuilt or removed here.
#
#   remote-deploy.sh <label> <host-port> <allowed-origins>
set -euo pipefail
LABEL="${1:?release label}"
PORT="${2:-7360}"
ORIGINS="${3:-https://fishbill88.github.io}"
ROOT="$HOME/asanaka"
IN="$HOME/asanaka-incoming"
REL="$ROOT/releases/$LABEL"

mkdir -p "$ROOT/releases" "$ROOT/backups"
chmod 700 "$ROOT"

# The compose file, the operator command and the scripts travel with each release.
for f in docker-compose.yml asanaka backup.sh host-setup.sh asanaka.caddy; do
  install -m 0644 "$IN/vps/$f" "$ROOT/$f"
done
chmod 0755 "$ROOT/asanaka" "$ROOT/backup.sh" "$ROOT/host-setup.sh"

# Secrets are made here, on the box, and never leave it.
if [ ! -f "$ROOT/.env" ]; then
  if ss -ltn | grep -q ":$PORT "; then echo "REFUSED: port $PORT is already in use on this box" >&2; exit 1; fi
  ( umask 077
    { echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
      echo "ASANAKA_HOST_PORT=$PORT"
      echo "ASANAKA_ALLOWED_ORIGINS=$ORIGINS"; } > "$ROOT/.env" )
  echo "created $ROOT/.env (secrets, mode 600)"
fi

rm -rf "$REL"
mkdir -p "$REL"
tar -xzf "$IN/app.tgz" -C "$REL"
ln -sfn "$REL" "$ROOT/current"

cd "$ROOT"
docker compose build api
docker compose up -d db
docker compose up -d api

for _ in $(seq 1 40); do
  curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 && break
  sleep 2
done
curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null && echo "api healthy on 127.0.0.1:$PORT"
docker compose logs --tail 20 api | grep -E "migrations applied|listening" || true

# The admin account exists from the first deploy on. Its password is never printed here:
# read it with `asanaka admin-password --show` (rotate-admin-password.bat -Show from the PC).
if [ ! -f "$ROOT/.admin-password" ]; then
  "$ROOT/asanaka" admin-password --rotate >/dev/null
  echo "admin account created; its password is in $ROOT/.admin-password (mode 600)"
fi

# Nightly backup at 03:17 Manila time (19:17 UTC), added once to this operator's crontab.
if ! crontab -l 2>/dev/null | grep -q 'asanaka/backup.sh'; then
  ( crontab -l 2>/dev/null; echo "17 19 * * * $ROOT/backup.sh >> $ROOT/backups/backup.log 2>&1" ) | crontab -
  echo "added the nightly backup to crontab"
fi

# Keep the last five releases.
ls -1dt "$ROOT"/releases/*/ | tail -n +6 | xargs -r rm -rf
docker image prune -f >/dev/null || true
echo "deployed $LABEL"
