#!/usr/bin/env bash
# Puts the API on its public HTTPS address with no password, the same way TaskTopFight does: through
# TTF's root-owned helper /usr/local/sbin/ttf-host-sync, which this operator may run with sudo -n.
#
# The helper installs /opt/ttf/ttf.caddy into Caddy, validates the whole config (putting the old files
# back if it fails) and restarts Caddy only when that file changed. TaskTopFight's ttf.caddy imports
# /opt/ttf/extra-sites/*.caddy, so Asanaka's site lives there. When Asanaka's site file changes, a marker
# line in ttf.caddy is updated so the helper sees a change and restarts Caddy (~1 s for every site).
#
# Run by remote-deploy.sh on every deploy; safe to run again by hand: ~/asanaka/site-sync.sh
set -euo pipefail
ROOT="$HOME/asanaka"
SITE="$ROOT/asanaka.caddy"
TTF=/opt/ttf
EXTRA="$TTF/extra-sites"
HELPER=/usr/local/sbin/ttf-host-sync
HOST="$(awk 'NF && $1 !~ /^#/ && /\{$/ { print $1; exit }' "$SITE")"
IMPORT='import /opt/ttf/extra-sites/*.caddy'

[ -f "$SITE" ] && [ -n "$HOST" ] || { echo "site-sync: no rendered $SITE; deploy first" >&2; exit 1; }
if [ ! -w "$TTF/ttf.caddy" ] || ! sudo -n -l "$HELPER" >/dev/null 2>&1; then
  echo "site-sync: TTF's host helper is not usable by $(id -un); the Caddy site was not installed" >&2
  exit 1
fi

# Check Asanaka's site on its own first, so a broken file can never reach Caddy or block a TTF deploy.
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp "$SITE" "$work/Caddyfile"
if ! caddy adapt --config "$work/Caddyfile" --adapter caddyfile >/dev/null 2>"$work/adapt.log"; then
  cat "$work/adapt.log" >&2
  echo "site-sync: $SITE does not parse; nothing changed" >&2
  exit 1
fi

umask 002
mkdir -p "$EXTRA"
changed=0
if ! cmp -s "$SITE" "$EXTRA/asanaka.caddy"; then
  [ -f "$EXTRA/asanaka.caddy" ] && cp -p "$EXTRA/asanaka.caddy" "$work/asanaka.caddy.before"
  install -m 0664 "$SITE" "$EXTRA/asanaka.caddy"
  changed=1
fi
cp -p "$TTF/ttf.caddy" "$work/ttf.caddy.before"
if ! grep -qF "$IMPORT" "$TTF/ttf.caddy"; then
  printf '\n# Other projects on this box (see TaskTopFight vps/ttf.caddy).\n%s\n' "$IMPORT" >> "$TTF/ttf.caddy"
  echo "site-sync: added the extra-sites import to $TTF/ttf.caddy (TaskTopFight's vps/ttf.caddy carries it too)"
  changed=1
fi
if [ "$changed" = 1 ]; then
  sum="$(cat "$EXTRA"/*.caddy | sha256sum | cut -c1-12)"
  sed -i '/^# extra-sites: /d' "$TTF/ttf.caddy"
  printf '# extra-sites: %s\n' "$sum" >> "$TTF/ttf.caddy"
fi

if ! sudo -n "$HELPER"; then
  echo "site-sync: the helper refused the config; putting Asanaka's files back" >&2
  cp -p "$work/ttf.caddy.before" "$TTF/ttf.caddy"
  if [ -f "$work/asanaka.caddy.before" ]; then cp -p "$work/asanaka.caddy.before" "$EXTRA/asanaka.caddy"; else rm -f "$EXTRA/asanaka.caddy"; fi
  exit 1
fi

for _ in $(seq 1 45); do
  if curl -fsS "https://$HOST/healthz" >/dev/null 2>&1; then echo "site-sync: https://$HOST/healthz answers"; exit 0; fi
  sleep 2
done
echo "site-sync: Caddy has the site, but https://$HOST/healthz is not answering yet (certificates can take a minute)" >&2
