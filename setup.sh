#!/usr/bin/env bash
# Bio HUD guided setup. Run once; re-run any time, it keeps existing answers as defaults.
# Creates: endpoint/wrangler.toml, app/.env, app/app.json; deploys the Worker; prints the last manual steps.
set -euo pipefail
cd "$(dirname "$0")"
say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ask()  { local v; read -r -p "$1 [$2]: " v; echo "${v:-$2}"; }
need() { command -v "$1" >/dev/null || { echo "missing: $1 — $2"; exit 1; }; }
getv() { grep -E "^$2 ?= ?\"?" "$1" 2>/dev/null | head -1 | sed -E 's/^[^=]*= ?"?//; s/"?\s*(#.*)?$//' || true; }

need node "install Node 20+ from https://nodejs.org"
need npm "comes with Node"
need openssl "comes with macOS"

say "1/7  Install dependencies"
(cd endpoint && npm install --silent)
(cd app && npm install --silent)

say "2/7  Cloudflare login"
(cd endpoint && npx wrangler whoami >/dev/null 2>&1) || (cd endpoint && npx wrangler login)

say "3/7  Your answers"
TOML=endpoint/wrangler.toml
PKG=$(ask "Even Hub package id (reverse domain, yours)" "$(python3 -c 'import json;print(json.load(open("app/app.json"))["package_id"])' 2>/dev/null || echo com.example.biohud)")
NAME=$(ask "App name shown on the glasses store" "$(python3 -c 'import json;print(json.load(open("app/app.json"))["name"])' 2>/dev/null || echo Bio HUD)")
PL=$(ask "Spotify playlist link or URI for workouts" "$(getv $TOML SPOTIFY_PLAYLIST_URI)")
PLID=$(echo "$PL" | sed -E 's#.*playlist[/:]([A-Za-z0-9]+).*#\1#')
HRMAX=$(ask "Your max heart rate" "$(getv $TOML HR_MAX | grep -E '^[0-9]+$' || echo 185)")
CITY=$(ask "City for weather" "$(getv $TOML WEATHER_CITY | grep -v CITY || echo Vancouver)")
LAT=$(ask "Latitude" "$(getv $TOML WEATHER_LAT | grep -v LAT || echo 49.2827)")
LON=$(ask "Longitude" "$(getv $TOML WEATHER_LON | grep -v LON || echo -123.1207)")
TEAM=$(ask "Apple developer Team ID (10 chars, blank to set in Xcode)" "$(getv app/.env DEVELOPMENT_TEAM)")
WBID=$(ask "Watch app bundle id" "$(getv app/.env WATCH_BUNDLE_ID | grep -v '^$' || echo ${PKG}.watchos)")

say "4/7  Spotify app credentials (developer.spotify.com → your app → Settings)"
read -r -p "Spotify Client ID: " SPID
read -r -s -p "Spotify Client Secret (hidden): " SPSECRET; echo

say "5/7  Worker storage and config"
KVID=$(getv $TOML id | grep -E '^[a-f0-9]{32}$' || true)
if [ -z "$KVID" ]; then
  KVID=$(cd endpoint && npx wrangler kv namespace create HUD 2>/dev/null | grep -oE 'id = "[a-f0-9]+"' | grep -oE '[a-f0-9]{32}' | head -1)
  [ -n "$KVID" ] || { echo "could not create the KV namespace; run: cd endpoint && npx wrangler kv namespace create HUD"; exit 1; }
fi
BASE=$(getv $TOML BASE_URL | grep -v WORKER_URL || echo "https://WORKER_URL")
write_toml() {
  sed -e "s#KV_NAMESPACE_ID#$KVID#" -e "s#https://WORKER_URL#$BASE#" -e "s#spotify:playlist:PLAYLIST_ID#spotify:playlist:$PLID#" \
      -e "s#\"LAT\"#\"$LAT\"#" -e "s#\"LON\"#\"$LON\"#" -e "s#\"CITY\"#\"$CITY\"#" -e "s#\"HRMAX\"#\"$HRMAX\"#" \
      endpoint/wrangler.example.toml > "$TOML"
}
write_toml
if [ "$BASE" = "https://WORKER_URL" ]; then
  echo "first deploy to learn the Worker URL…"
  OUT=$(cd endpoint && npx wrangler deploy 2>&1 | tee /dev/stderr)
  BASE=$(echo "$OUT" | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -1)
  [ -n "$BASE" ] || { echo "could not read the Worker URL from the deploy output"; exit 1; }
  write_toml
fi

say "6/7  Secrets and deploy"
TOKEN=$(getv app/.env VITE_HUD_TOKEN | grep -E '^[a-f0-9]{48}$' || openssl rand -hex 24)
(cd endpoint && printf '%s' "$TOKEN" | npx wrangler secret put HUD_TOKEN >/dev/null && printf '%s' "$SPID" | npx wrangler secret put SPOTIFY_CLIENT_ID >/dev/null && printf '%s' "$SPSECRET" | npx wrangler secret put SPOTIFY_CLIENT_SECRET >/dev/null)
(cd endpoint && npx wrangler deploy | tail -3)
printf 'VITE_HUD_ENDPOINT=%s\nVITE_HUD_TOKEN=%s\nDEVELOPMENT_TEAM=%s\nWATCH_BUNDLE_ID=%s\n' "$BASE" "$TOKEN" "$TEAM" "$WBID" > app/.env
python3 - "$PKG" "$NAME" "$BASE" <<'PY'
import json,sys
pkg,name,base=sys.argv[1:4]
d=json.load(open('app/app.example.json')); d['package_id']=pkg; d['name']=name; d['permissions'][0]['whitelist']=[base]
json.dump(d,open('app/app.json','w'),indent=2); open('app/app.json','a').write('\n')
PY
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $TOKEN" "$BASE/state")
echo "Worker check: $BASE/state -> $CODE"

say "7/7  Finish by hand, in this order"
cat <<TXT
1. Spotify dashboard → your app → Settings → Redirect URIs → add exactly:
     $BASE/spotify/callback
   then open this once in a browser and approve:
     $BASE/spotify/login?token=$TOKEN
2. Glasses (Even Hub beta, needs Developer Mode on your Even account):
     cd app && npx evenhub login
     npm run build && npx evenhub pack app.json dist -o even-hud.ehpk --check
     npx evenhub create even-hud.ehpk --name "$NAME" --tagline "Live workout on your lens" --icon icon.png
     npx evenhub promote 0.1.6 --to beta && npx evenhub testers add YOUR_EVEN_EMAIL
   later releases: npm run release -- "what changed"
3. Watch (Xcode, Tailscale OFF, phone cabled, Watch Developer Mode on):
     cd watch && ./make-config.sh && open BioHUDWatch.xcodeproj   → pick your Watch → Cmd+R
   then on the Watch: Settings → Privacy & Security → Health → $NAME → allow Workouts.
4. Open Spotify on the phone once, press Start on the Watch, look at the glasses.
Control from this folder: app/hud state|start|end|hr 140|playlists|token
TXT
