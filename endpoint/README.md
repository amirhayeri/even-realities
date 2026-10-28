# HUD endpoint (Cloudflare Worker)

One small service the glasses poll. It remembers the current workout and
the latest health numbers, and mixes in Spotify, weather and glucose on every
read. Nothing is stored except workout state, ring totals and the Spotify
refresh token, all in one KV namespace.

## Routes
| Route | Who calls it | Body |
|---|---|---|
| `GET /state` | the glasses app, every 2 s | – |
| `POST /workout/start` | iPhone automation "when workout starts" | `{"type":"run"}` |
| `POST /workout/end` | iPhone automation "when workout ends" | – |
| `POST /health` | Health Auto Export now, the watch app later | flat `{hr, steps, activeKcal, distanceM, move, moveGoal, …}` or Health Auto Export's `{data:{metrics:[…]}}` |
| `POST /pause`, `POST /skip` | glasses gestures | – |
| `GET /spotify/login?token=…` | you, once, in a browser | – |
| `GET /health` | uptime checks, no auth | – |

Every route except `/health` and `/spotify/callback` needs
`Authorization: Bearer HUD_TOKEN` (or `?token=` for the browser link).

On `/workout/start` the Worker turns shuffle on and starts
`SPOTIFY_PLAYLIST_URI` on your phone. On `/workout/end` it pauses.

## Deploy, first time
```bash
cd endpoint && npm install
npx wrangler login
npx wrangler kv namespace create HUD            # paste the id into wrangler.toml
npx wrangler kv namespace create HUD --preview  # paste as preview_id
openssl rand -hex 24                            # this is your HUD_TOKEN
npx wrangler secret put HUD_TOKEN
npx wrangler secret put SPOTIFY_CLIENT_ID
npx wrangler secret put SPOTIFY_CLIENT_SECRET
```
Edit `wrangler.toml`: set `SPOTIFY_PLAYLIST_URI` (right‑click the playlist in
Spotify → Share → Copy Spotify URI), your lat/lon, HR max. Then:
```bash
npm run deploy
```
Add `hud.bioconscious.tech` as a custom domain for the Worker in the
Cloudflare dashboard (Workers → even-hud-endpoint → Settings → Domains), or
uncomment the `routes` line.

In the Spotify developer dashboard add the redirect URI
`https://hud.bioconscious.tech/spotify/callback`. Then open
`https://hud.bioconscious.tech/spotify/login?token=HUD_TOKEN` once and approve.

## Point the glasses at it
```bash
cd ../app
VITE_HUD_ENDPOINT=https://hud.bioconscious.tech VITE_HUD_TOKEN=... npm run dev
```
For a packed build put both in `app/.env.production`. The app starts in
Ambient and switches to Workout the moment `/state` says a session is active.

## Phone side
**Shortcut "Gym"**: Start Workout (Outdoor Run) · Spotify is started by the
Worker · Set Focus Fitness · Open App Even.

**Automation, when any workout starts** → Get Contents of URL:
`POST https://hud.bioconscious.tech/workout/start`, header
`Authorization: Bearer HUD_TOKEN`, JSON body `{"type":"run"}`.

**Automation, when any workout ends** → same with `/workout/end`.

**Health Auto Export** (App Store) → Automations → REST API: URL
`https://hud.bioconscious.tech/health`, header `Authorization: Bearer HUD_TOKEN`,
metrics Heart Rate, Step Count, Active Energy, Walking + Running Distance,
interval as short as the app allows. The Worker reads its native payload.

## Glucose
Set `GLUCOSE_URL` in `wrangler.toml` to a JSON endpoint returning
`{"mmol": 5.8, "trend": "up", "delta15": 0.3, "pred30": 6.2}`; it is passed
through to the glasses as `glucose`.

## Local test
```bash
cp .dev.vars.example .dev.vars   # set HUD_TOKEN
npm run dev                      # http://127.0.0.1:8787
curl -X POST -H 'Authorization: Bearer test-token' -d '{"type":"run"}' localhost:8787/workout/start
curl -H 'Authorization: Bearer test-token' localhost:8787/state
```
Spotify routes answer "not linked" until you complete the login once.
