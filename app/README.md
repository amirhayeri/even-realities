# Bio HUD — Even G2 app

Workout D from the design canvas, running on the real Even Hub SDK.
Two image tiles (heart rate + zone, timer + steps + kcal + distance) over
four text lines (zone, Spotify now playing, next track + Move ring, action bar).
Falls back to a one‑line Ambient screen when no workout is active.

## Test it, three levels

### 1. Browser, 30 seconds, no hardware
```bash
cd app
npm install
npm run dev
```
Open http://localhost:5173. No Even bridge is present, so the page draws the
lens on a canvas and runs a mock gym session: HR wanders, timer counts,
steps and kcal climb, tracks roll over. **Click** = tap (pause / resume).
**M** = context menu, arrows + Enter to choose. **↑/↓** = swipe (skip track).

### 2. Even simulator, same page
```bash
npm run sim          # opens the simulator pointed at localhost:5173
```
It renders through the real SDK bridge instead of the preview canvas, with the
firmware font and container rules. `--automation-port 9898` is on, so
`curl localhost:9898/api/screenshot/glasses > lens.png` grabs the frame and
`curl -X POST localhost:9898/api/input -d '{"action":"click"}'` taps.

### 3. Your glasses, dev mode
```bash
npm run dev          # keep running, phone must be on the same network
npm run qr           # prints a QR for the dev server
```
Even app → Settings → Developer mode → scan the QR. The HUD opens on the
glasses and in the Even app. Hot reload works: edit, save, the lens updates.

## Controls on the glasses
| Gesture | Action |
|---|---|
| Tap right temple | Pause / resume the (mock) workout and Spotify |
| Swipe up or down | Skip track |
| Tap-and-hold | OS menu: Pause, Resume, Skip track, Exit |
| Double tap | Exit (OS behaviour, root page) |

## Data
`src/model.ts` is one JSON shape. With no env var the app runs the mock.
Point it at a live feed with:
```bash
VITE_HUD_ENDPOINT=https://hud.bioconscious.tech/state npm run dev
```
The app polls that URL every 2 s and POSTs `/pause` and `/skip` on gestures.
The endpoint is the next piece to build; it will aggregate:

| Field | Source | Status |
|---|---|---|
| workout.hr, steps, activeKcal, distanceM, elapsedSec | watchOS companion (phase 2) or Health Auto Export (phase 1) | planned |
| workout.active / startedAt | iOS Shortcuts automation on workout start/end | planned |
| spotify.* | Spotify Web API: currently‑playing + queue, polled | planned |
| glucose.* incl. prediction | Bioconscious pipeline | planned |
| rings.* | HealthKit via the same companion | planned |
| battery | Even SDK device status | trivial |

`app.json` whitelists `https://hud.bioconscious.tech`. Change it if the
endpoint lives elsewhere; the Even app blocks every other origin.

## The gym routine

Phone is the hub: it can reach the Watch and the glasses, the Watch can't
reach the glasses.

**iPhone Shortcut "Gym"** (run by tap or "Hey Siri, gym"):
1. Start Workout → Outdoor Run (Apple's action starts it on the paired Watch;
   once our watch app exists, swap this for its "Start session" intent).
2. Spotify → Play playlist "Gym" (the endpoint can also do this with shuffle on
   via the Web API when it sees the workout start).
3. Set Focus → Fitness, on.
4. Open App → Even.

**iPhone Automations** (Shortcuts → Automation → New, run immediately):
- When *any workout starts*: Get Contents of URL, POST
  `https://hud.bioconscious.tech/workout/start` with the workout type.
- When *any workout ends*: POST `/workout/end`, Set Focus off.

The glasses switch from Ambient to Workout D the moment the endpoint reports
an active session, and back when it ends. Nothing to tap on the glasses.

## Build and ship
```bash
npm run build
npm run pack                       # even-hud.ehpk
npx evenhub login                  # once
npx evenhub create even-hud.ehpk --name "Bio HUD" --tagline "Live workout, glucose and music on your lens"
npx evenhub promote 0.1.0 --to beta && npx evenhub testers add you@example.com
```
Store icon rules and the full CLI loop are in `../docs/even-hub-reference.md`.

## Layout
```
src/main.ts     tick loop, event handling, write scheduling
src/model.ts    HudState shape, mock session, remote poller
src/draw.ts     tile renderer → PNG (dot‑matrix digits, zone bar, activity row)
src/layout.ts   container spec, space‑padded left/right lines via pretext
src/bridge.ts   real Even bridge, or canvas preview when none is present
src/queue.ts    one glasses write in flight, latest wins per container
```
Hard limits respected: 6 of 12 containers, 2 of 4 images at 288×144, text
upgraded only when changed, images once per second.

## Beta route (no QR, survives a locked phone)

```bash
cd app
npm run build                                   # reads .env, bakes endpoint + token in
npx evenhub pack app.json dist -o even-hud.ehpk --check
npx evenhub create even-hud.ehpk --name "Bio HUD" --tagline "Live workout, music and glucose on your lens" --icon icon.png
npx evenhub promote 0.1.0 --to beta
npx evenhub testers add YOUR_EVEN_EMAIL
```
Accept the tester invite on the phone (email link), then install Bio HUD from
the Even Hub tab. Later builds: bump `version` in `app.json`, `npm run build`,
`npm run pack`, `npx evenhub upload even-hud.ehpk -m "what changed"`,
`npx evenhub promote <version> --to beta`.
