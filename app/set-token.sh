#!/usr/bin/env bash
# Generate a fresh HUD token and set it everywhere at once:
#   app/.env (glasses build)  ·  Cloudflare secret (Worker)  ·  ~/even-hud-rc/app/.env (watch build), if present
# Afterwards: npm run release (glasses) and rebuild the watch in Xcode, both pick the new token up.
set -euo pipefail
cd "$(dirname "$0")"
EP=$(grep '^VITE_HUD_ENDPOINT=' .env 2>/dev/null | cut -d= -f2- | tr -d '[:space:]"'"'"'')
EP=${EP:-https://even-hud-endpoint.amir-e77.workers.dev}
TK=$(openssl rand -hex 24)
printf 'VITE_HUD_ENDPOINT=%s\nVITE_HUD_TOKEN=%s\n' "$EP" "$TK" > .env
echo "wrote app/.env"
if [ -f "$HOME/even-hud-rc/app/.env" ] || [ -d "$HOME/even-hud-rc/app" ]; then
  printf 'VITE_HUD_ENDPOINT=%s\nVITE_HUD_TOKEN=%s\n' "$EP" "$TK" > "$HOME/even-hud-rc/app/.env"
  echo "wrote ~/even-hud-rc/app/.env (watch build)"
fi
( cd ../endpoint && printf '%s' "$TK" | npx wrangler secret put HUD_TOKEN )
code=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TK" "$EP/state")
echo "Worker check: /state -> $code (200 means the new token is live)"
echo
echo "Next:"
echo "  glasses: npm run release -- \"new token\"   then update Bio HUD on the phone"
echo "  watch:   cd ~/even-hud-rc/watch && ./make-config.sh && xcodegen   then Cmd+R in Xcode (Tailscale off)"
echo "  Spotify relink is NOT needed; the token only guards your own endpoint."
