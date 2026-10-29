#!/usr/bin/env bash
# Nightly dump of the Asanaka database into ~/asanaka/backups, 14 kept (cron line added by remote-deploy.sh).
# Custom format; restore with:  docker compose exec -T db pg_restore -U asanaka -d asanaka --clean < backups/<file>
# From cron it skips when a dump under 6 hours old exists; `asanaka backup` passes --now and always dumps.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"
umask 077
mkdir -p backups
if [ "${1:-}" != "--now" ] && [ -n "$(find backups -name 'asanaka-*.dump' -mmin -360 -print -quit 2>/dev/null)" ]; then
  echo "backup: a fresh dump exists, skipped"
  exit 0
fi
out="backups/asanaka-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose exec -T db pg_dump -U asanaka -d asanaka -Fc > "$out.part"
mv "$out.part" "$out"
ls -1t backups/asanaka-*.dump | tail -n +15 | xargs -r rm -f
echo "backup: $out ($(du -h "$out" | cut -f1))"
