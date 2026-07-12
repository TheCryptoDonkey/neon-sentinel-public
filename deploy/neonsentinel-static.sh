#!/usr/bin/env bash
set -euo pipefail

# Safe static deploy for Neon Sentinel.
#
# This only syncs this app's dist into /opt/neonsentinel/releases/<timestamp>
# and flips /opt/neonsentinel/current. It does not edit existing game roots.
#
# Caddy setup is opt-in:
#   APPLY_CADDY=1 VPS_HOST=95.217.39.110 ./deploy/neonsentinel-static.sh
#
# Without APPLY_CADDY=1, the script deploys the files and prints the Caddy
# validation command needed on the host.

VPS_HOST="${VPS_HOST:-95.217.39.110}"
VPS_USER="${VPS_USER:-deploy}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_rsa_thecryptodonkey}"
REMOTE_BASE="${REMOTE_BASE:-/opt/neonsentinel}"
SITE_HOST="${SITE_HOST:-neonsentinel.com}"
APPLY_CADDY="${APPLY_CADDY:-0}"
APPLY_API="${APPLY_API:-1}"
RELEASE_ID="${RELEASE_ID:-$(date -u +%Y%m%d%H%M%S)}"
RUN_PRODUCTION_SMOKE="${RUN_PRODUCTION_SMOKE:-1}"

SSH_CMD=(ssh -o IdentityFile="$SSH_KEY" -o IdentitiesOnly=yes "$VPS_USER@$VPS_HOST")
RSYNC_SSH="ssh -o IdentityFile=$SSH_KEY -o IdentitiesOnly=yes"

echo "=== Neon Sentinel deploy ==="
echo "Host: $VPS_USER@$VPS_HOST"
echo "Remote: $REMOTE_BASE/releases/$RELEASE_ID"

echo "[1/7] Building local dist and claim API..."
npm run build

echo "[2/7] Read-only host preflight..."
"${SSH_CMD[@]}" "
  set -e
  hostname
  df -h /
  command -v caddy >/dev/null 2>&1 && caddy version || true
  command -v node >/dev/null 2>&1 && node --version || true
  sudo test ! -e '$REMOTE_BASE' || sudo find '$REMOTE_BASE' -maxdepth 2 -type d -print
  if sudo test -f /etc/caddy/Caddyfile; then
    sudo grep -n '$SITE_HOST' /etc/caddy/Caddyfile || true
    sudo grep -n '$SITE_HOST' /etc/caddy/conf.d/*.Caddyfile 2>/dev/null || true
  fi
"

echo "[3/7] Creating isolated release directory..."
"${SSH_CMD[@]}" "sudo mkdir -p '$REMOTE_BASE/releases/$RELEASE_ID' && sudo chown -R '$VPS_USER:$VPS_USER' '$REMOTE_BASE'"

echo "[4/7] Syncing dist and API bundle..."
# Hard-link unchanged files against the previous release so a deploy only
# uploads what actually changed — the music alone is ~105MB and rarely moves.
# --timeout aborts a dead connection instead of hanging the deploy forever.
# ${arr[@]+...} keeps the empty-array expansion safe under set -u on bash 3.2.
prev_release="$("${SSH_CMD[@]}" "readlink -f '$REMOTE_BASE/current'" 2>/dev/null || true)"
dist_link=()
server_link=()
if [[ -n "$prev_release" && "$prev_release" != "$REMOTE_BASE/releases/$RELEASE_ID" ]]; then
  echo "Hard-linking unchanged files against $prev_release"
  dist_link=(--link-dest="$prev_release")
  server_link=(--link-dest="$prev_release/server")
fi
rsync -az --delete --timeout=60 ${dist_link[@]+"${dist_link[@]}"} -e "$RSYNC_SSH" dist/ "$VPS_USER@$VPS_HOST:$REMOTE_BASE/releases/$RELEASE_ID/"
rsync -az --delete --timeout=60 ${server_link[@]+"${server_link[@]}"} -e "$RSYNC_SSH" server-dist/ "$VPS_USER@$VPS_HOST:$REMOTE_BASE/releases/$RELEASE_ID/server/"
"${SSH_CMD[@]}" "ln -sfn '$REMOTE_BASE/releases/$RELEASE_ID' '$REMOTE_BASE/current'"

echo "[5/7] Claim API service..."
if [[ "$APPLY_API" == "1" ]]; then
  tmp_service="/tmp/neonsentinel-api.service.$RELEASE_ID"
  rsync -az -e "$RSYNC_SSH" deploy/neonsentinel-api.service "$VPS_USER@$VPS_HOST:$tmp_service"
  "${SSH_CMD[@]}" "
    set -e
    command -v node >/dev/null 2>&1
    sudo mkdir -p /var/lib/neonsentinel
    sudo chown -R '$VPS_USER:$VPS_USER' /var/lib/neonsentinel
    if ! sudo test -f /etc/neonsentinel-api.env; then
      printf '# Neon Sentinel claim signer. Mode 600. Keep the nsec on this server only.\\nNEON_SENTINEL_GAME_NPUB=npub1xuq53wm49lh820yd6sm82t5qrupfz0du0trrxzpg6y742sxyegssntwz40\\nNEON_SENTINEL_GAME_NSEC=\\nNEON_SENTINEL_WRITE_RELAYS=wss://relay.gamestr.io,wss://relay.trotters.cc,wss://nos.lol,wss://relay.damus.io,wss://relay.nostr.band,wss://relay.primal.net,wss://relay.ditto.pub\\n' | sudo tee /etc/neonsentinel-api.env >/dev/null
      sudo chmod 600 /etc/neonsentinel-api.env
    fi
    if ! sudo grep -q '^NEON_SENTINEL_GAME_NPUB=' /etc/neonsentinel-api.env; then
      printf 'NEON_SENTINEL_GAME_NPUB=npub1xuq53wm49lh820yd6sm82t5qrupfz0du0trrxzpg6y742sxyegssntwz40\\n' | sudo tee -a /etc/neonsentinel-api.env >/dev/null
    fi
    if ! sudo grep -q '^NEON_SENTINEL_GAME_NSEC=' /etc/neonsentinel-api.env; then
      printf 'NEON_SENTINEL_GAME_NSEC=\\n' | sudo tee -a /etc/neonsentinel-api.env >/dev/null
    fi
    if ! sudo grep -q '^NEON_SENTINEL_WRITE_RELAYS=' /etc/neonsentinel-api.env; then
      printf 'NEON_SENTINEL_WRITE_RELAYS=wss://relay.gamestr.io,wss://relay.trotters.cc,wss://nos.lol,wss://relay.damus.io,wss://relay.nostr.band,wss://relay.primal.net,wss://relay.ditto.pub\\n' | sudo tee -a /etc/neonsentinel-api.env >/dev/null
    fi
    sudo mv '$tmp_service' /etc/systemd/system/neonsentinel-api.service
    sudo systemctl daemon-reload
    sudo systemctl enable neonsentinel-api.service >/dev/null
    sudo systemctl restart neonsentinel-api.service
    sudo systemctl --no-pager --lines=12 status neonsentinel-api.service
  "
else
  echo "Skipped API service because APPLY_API=$APPLY_API"
fi

echo "[6/7] Caddy handling..."
if [[ "$APPLY_CADDY" == "1" ]]; then
  tmp_remote="/tmp/neonsentinel.Caddyfile.$RELEASE_ID"
  rsync -az -e "$RSYNC_SSH" deploy/neonsentinel.Caddyfile "$VPS_USER@$VPS_HOST:$tmp_remote"
  "${SSH_CMD[@]}" "
    set -e
    sudo mkdir -p /etc/caddy/conf.d
    sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak.neonsentinel.$RELEASE_ID
    sudo mv '$tmp_remote' /etc/caddy/conf.d/neonsentinel.Caddyfile
    if ! sudo grep -q 'import /etc/caddy/conf.d/\\*.Caddyfile' /etc/caddy/Caddyfile; then
      printf '\\nimport /etc/caddy/conf.d/*.Caddyfile\\n' | sudo tee -a /etc/caddy/Caddyfile >/dev/null
    fi
    sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
    sudo systemctl reload caddy
  "
  echo "Caddy reloaded for https://$SITE_HOST"
else
  echo "Files deployed. Caddy was not changed."
  echo "Re-run with APPLY_CADDY=1 after checking existing Caddy config to install the isolated vhost."
fi

echo "[7/7] Production visual smoke..."
if [[ "$RUN_PRODUCTION_SMOKE" == "1" ]]; then
  echo "Waiting for https://$SITE_HOST to serve the deployed app..."
  for attempt in {1..30}; do
    if curl -fsS --max-time 8 "https://$SITE_HOST/api/claim/health" >/dev/null \
      && curl -fsSI --max-time 8 "https://$SITE_HOST/" >/dev/null; then
      break
    fi
    if [[ "$attempt" == "30" ]]; then
      echo "Production host did not become ready in time." >&2
      exit 1
    fi
    sleep 2
  done
  SMOKE_BASE_URL="https://$SITE_HOST/" npm run smoke:visual
else
  echo "Skipped production smoke because RUN_PRODUCTION_SMOKE=$RUN_PRODUCTION_SMOKE"
fi

echo "Release ready: $REMOTE_BASE/current"
