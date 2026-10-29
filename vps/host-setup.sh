#!/usr/bin/env bash
# One time, run by the box's operator with their own sudo password (host-setup.bat from the PC):
# installs the Caddy site for the API, adds its import line, checks the config and restarts Caddy.
# Caddy runs with its admin API off, so the restart is a ~1 second blip for every site on this box.
#
# Only commands the operator's sudo rules allow are used: sudoedit (with a non-interactive "editor"),
# caddy and systemctl. If the new config does not validate, the Caddyfile is put back untouched.
set -euo pipefail
ROOT="$HOME/asanaka"
SITE="$ROOT/asanaka.caddy"
HOST="$(awk 'NF && $1 !~ /^#/ && /\{$/ { print $1; exit }' "$SITE")"
[ -f "$SITE" ] && [ -n "$HOST" ] || { echo "No rendered $SITE: deploy first." >&2; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp /etc/caddy/Caddyfile "$work/Caddyfile.before"
cp /etc/caddy/Caddyfile "$ROOT/Caddyfile.before-asanaka"

# sudoedit hands its "editor" a temporary copy of the file; these editors write our content into it.
cat > "$work/put-site" <<EOF
#!/bin/sh
cat "$SITE" > "\$1"
EOF
cat > "$work/add-import" <<'EOF'
#!/bin/sh
grep -qF 'import /etc/caddy/asanaka.caddy' "$1" || printf '\nimport /etc/caddy/asanaka.caddy\n' >> "$1"
EOF
cat > "$work/restore" <<EOF
#!/bin/sh
cat "$work/Caddyfile.before" > "\$1"
EOF
chmod 700 "$work"/put-site "$work"/add-import "$work"/restore

echo "Installing the Caddy site for $HOST. sudo will ask for your password."
SUDO_EDITOR="$work/put-site" sudoedit /etc/caddy/asanaka.caddy
SUDO_EDITOR="$work/add-import" sudoedit /etc/caddy/Caddyfile

if ! sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile; then
  echo "The new config did not validate; putting the Caddyfile back." >&2
  SUDO_EDITOR="$work/restore" sudoedit /etc/caddy/Caddyfile
  exit 1
fi

echo "Restarting Caddy (about a second for every site on this box)..."
sudo systemctl restart caddy
sleep 2
systemctl is-active --quiet caddy && echo "Caddy is running."

echo "Waiting for the certificate for https://$HOST ..."
for _ in $(seq 1 45); do
  if curl -fsS "https://$HOST/healthz" >/dev/null 2>&1; then echo "https://$HOST/healthz answers. Done."; exit 0; fi
  sleep 2
done
echo "Caddy is up but https://$HOST/healthz is not answering yet; certificates can take a minute. Check again with: curl https://$HOST/healthz" >&2
