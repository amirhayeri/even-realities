# Bio HUD Watch

A one-screen watchOS app that owns the workout session and streams heart rate,
steps, active energy and distance to the HUD endpoint every second. It also
sends workout start and end, so the iPhone Shortcuts automations are no longer
needed once this is installed. Rings and Fitness history fill exactly as with
Apple's Workout app: it is the same HKWorkout.

## Build, first time (Mac with Xcode 15+)

```bash
xcode-select --install            # if you have never built anything
brew install xcodegen
cd ~/even-realities/watch
./make-config.sh                  # Config.swift from ../app/.env (endpoint + token)
xcodegen                          # writes BioHUDWatch.xcodeproj
open BioHUDWatch.xcodeproj
```

In Xcode:
1. Select the **BioHUDWatch** target → **Signing & Capabilities** → Team: your
   Apple ID (a free personal team works for your own watch; it expires weekly,
   a paid developer account does not).
2. Plug the iPhone in, or have it on the same Wi‑Fi, with the Watch unlocked
   and on your wrist. Choose the Watch as the run destination.
3. Press Run. First time: the Watch asks to trust the developer, Settings →
   General → Device Management on the Watch, and Health asks for permissions.

## Use
Pick the workout type, Start. Heart rate and the counters update on the Watch,
and the glasses switch to the Workout screen with the playlist. Stop ends the
workout, saves it to Health, pauses Spotify, and the glasses go back to Ambient.

## Files
- `WorkoutManager.swift` – HKWorkoutSession + HKLiveWorkoutBuilder, reads stats, 1 s timer.
- `Uploader.swift` – POSTs to the endpoint, one request in flight, latest wins.
- `ContentView.swift` – picker + Start, then live numbers + pause/stop.
- `project.yml` – XcodeGen spec: HealthKit entitlement, workout-processing background mode.
- `make-config.sh` – writes the git-ignored `Config.swift` from `../app/.env`.
