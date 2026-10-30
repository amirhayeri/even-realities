# Pick-up list

State as of 2026-10-28 evening: HUD renders Workout D on the glasses from the
live endpoint. Spotify, weather and workout state are real. HR, steps, rings and
glucose are waiting on a data source.

## Tonight, in order

1. **Beta build so it survives a locked phone** (10 min, Mac)
   ```bash
   cd ~/even-realities/app && npm run build && npx evenhub pack app.json dist -o even-hud.ehpk --check
   npx evenhub create even-hud.ehpk --name "Bio HUD" --tagline "Live workout, music and glucose on your lens" --icon icon.png
   npx evenhub promote 0.1.0 --to beta && npx evenhub testers add amir_hayeri@me.com
   ```
   Accept the invite email on the phone, install Bio HUD from the Even Hub tab.

2. **Phone automations** (5 min, iPhone Shortcuts app)
   Token: `app/hud token`.
   - Automation → Workout → Starts → Run Immediately → Get Contents of URL:
     POST `https://even-hud-endpoint.amir-e77.workers.dev/workout/start`,
     header `Authorization: Bearer <token>`, JSON body `{"type":"run"}`.
   - Automation → Workout → Ends → same with `/workout/end`, no body.
   - Optional "Gym" shortcut: Start Workout, Set Focus Fitness, Open App Even.

3. **Heart rate today** (5 min, iPhone)
   Health Auto Export → Automations → REST API →
   URL `https://even-hud-endpoint.amir-e77.workers.dev/health`,
   header `Authorization: Bearer <token>`, JSON, metrics Heart Rate, Step Count,
   Active Energy, Walking + Running Distance, shortest interval.

4. **Custom domain** (5 min, Cloudflare dashboard, optional)
   Workers → even-hud-endpoint → Settings → Domains → add `hud.bioconscious.tech`.
   Then set `BASE_URL` in `endpoint/wrangler.toml`, redeploy, add the new
   `/spotify/callback` to the Spotify app, and update `VITE_HUD_ENDPOINT` in `app/.env`.

## Watch app status (2026-10-30)

The watchOS app in `watch/` **compiles and archives** (Xcode on the Mac, team
9CT62KKWY2, bundle `tech.bioconscious.biohud.watchos`). It is **not installed**
yet: Xcode never saw the physical Watch, only a simulator. A TestFlight upload
was attempted and refused: a watch-only archive cannot use the App Store export
method without an iOS container app.

**Direct install, the fast path** (needs the phone on a cable once):
1. iPhone → Settings → Privacy & Security → Developer Mode → on, restart phone.
2. Watch → Settings → Privacy & Security → Developer Mode → on, restart watch.
3. Plug the iPhone into the Mac with a cable, tap Trust. Watch on the wrist,
   unlocked, same Wi‑Fi as the Mac.
4. Xcode → Window → Devices and Simulators: the Watch appears under the phone.
5. `cd ~/even-realities/watch && ./make-config.sh && xcodegen && open BioHUDWatch.xcodeproj`,
   pick the Watch as destination, Run. Trust the developer on the Watch when asked.

**TestFlight, the slow path**: add a minimal iOS container target so the
archive is uploadable, then upload and install via the TestFlight app. Only
worth it if step 4 above never shows the Watch.

## Next build sessions (Claude)

5. **watchOS app install** per the status above; then tune: Swift 6 warning in
   WorkoutManager.swift:101, step count source if the builder does not provide it.
6. **Glucose feed**: a URL returning `{"mmol","trend","delta15","pred30"}`,
   set as `GLUCOSE_URL` in `endpoint/wrangler.toml`. Lights up the Bio detail
   screen and the forecast.
7. **Second screen on the glasses**: Daily or Bio detail, reached by swipe,
   from the canvas designs.
8. **Glyph size pass** after you report how the 9‑px icons read on glass.

## Handy
- `app/hud state|start|end|pause|skip|hr 142|token`
- Dev loop: Window 1 `npm run dev`, Window 2 `npx evenhub qr --url "http://$(ipconfig getifaddr en0):5173"`, phone Prototype mode → scan.
- Known-good bisect app: https://sabowl.sakura.ne.jp/g2/helloworld/
