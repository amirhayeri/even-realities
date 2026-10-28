# Even Hub developer reference (G2)

Compiled 2026-10-28 from the published packages, not from memory:
`@evenrealities/even_hub_sdk` 0.0.16, `@evenrealities/evenhub-cli` 0.2.0,
`@evenrealities/evenhub-simulator` 0.9.5, `@evenrealities/pretext` 0.1.4,
plus the community libraries `even-toolkit` 1.7.7, `@maticsh/glasses` 0.2.0
and the matic-even hardware findings. The hub.evenrealities.com docs site was
not reachable from the machine that wrote this; everything below comes from
code and READMEs that ship in those packages.

---

## 1. Mental model

An Even Hub app is a **web page**. It runs inside the Even phone app's
WebView (Flutter `flutter_inappwebview`). The page talks to the phone through
a JS bridge, and the phone drives the glasses over BLE. Your app never touches
the glasses directly.

```
 your page (TS/JS in WebView)  --bridge-->  Even app (phone)  --BLE-->  G2 glasses
                               <--events--                   <--BLE--  temple / ring
```

Consequences:
- Anything heavy (network, audio processing, state) runs on the phone or your server.
- The glasses render **containers** you declare, not arbitrary pixels, except via image containers.
- Latency to the lens is BLE-bound. Budget 150 to 300 ms for an image, less for text.

Requirements: Even app 2.2.10+, SDK 0.0.16, Node 20.17+ / 22.13+ / 23.5+.

---

## 2. Display facts

| Fact | Value |
|---|---|
| Canvas | 576 × 288 px, origin top-left |
| Text | one font, one size, fixed 27 px line height, max 10 lines full-height |
| Text brightness | `textColor` 0..4 (4 = default, brightest) |
| Text alignment | none in firmware. Centre or right-align by padding with spaces, measured in pixels |
| Image grey levels | 16 (Gray4). Also accepts Gray8 raw and encoded PNG; SDK converts, LZ4-compresses |
| Image container | min 20 px side, max 288 wide × 144 tall, max 4 per page |
| Containers per page | 1..12 total; text+list max 8; images max 4 |
| Text content | 1000 chars on create/rebuild, 2000 via `textContainerUpgrade`, simulator caps at 999 bytes |
| List | max 20 items, 64 chars (63 bytes) per item |
| Container name | 16 bytes |
| Menu | max 10 items, `itemID` non-zero unique, name ≤ 32 UTF-8 bytes |
| Event capture | exactly one container per page has `isEventCapture: 1` |
| IDs | start at 1. Protobuf drops zero values, so ID 0 or zOrder 0 silently vanish |
| Fonts | Latin → Cyrillic/Greek → CJK fallback chain, plus emoji. Missing glyphs drop silently |
| Store icon | 24×24 PNG, pixels either transparent or opaque `#F4F4F4`, lit pixels in aligned 2×2 blocks |

Use `@evenrealities/pretext` for pixel-exact widths: `getTextWidth`,
`measureTextWrap(text, innerWidth)`, `pxTruncate(text, maxPx)`.

---

## 3. SDK API (`@evenrealities/even_hub_sdk`)

```ts
import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk';
const bridge = await waitForEvenAppBridge();   // throws "Flutter handler not available" outside the Even app
```

### Phone-side calls
| Method | Returns | Notes |
|---|---|---|
| `getUserInfo()` | `{uid, name, avatar, country}` | |
| `getDeviceInfo()` | `{model: 'g1'\|'g2'\|'ring1', sn, status}` or null | |
| `setLocalStorage(k, v)` / `getLocalStorage(k)` | boolean / string | bridge storage; whether browser `localStorage` persists is undocumented, prefer this |
| `getAppLocation({accuracy, timeoutMs})` | `{latitude, longitude, accuracy?, altitude?, speed?, heading?, timestamp?}` | needs `location` permission in app.json |
| `startAppLocationUpdates({accuracy, intervalMs, distanceFilter})` / `stopAppLocationUpdates()` | boolean | pair with `onAppLocationChanged` |
| `pickImageFromAlbum()` / `captureImageFromCamera()` | `{path, name, mimeType, size, base64}` | single select |

### Glasses UI calls
| Method | Returns | Notes |
|---|---|---|
| `createStartUpPageContainer({containerTotalNum, listObject?, textObject?, imageObject?, menuObject?})` | `StartUpPageCreateResult` 0 success / 1 invalid / 2 oversize / 3 outOfMemory | call first, before mic or anything else |
| `rebuildPageContainer(same shape)` | boolean | replaces the page. Omit `menuObject` to clear the custom menu |
| `textContainerUpgrade({containerID, containerName, content, textColor?})` | boolean | cheapest update. ID and name must both match or it no-ops silently |
| `updateImageRawData({containerID, containerName, imageData})` | `ImageRawDataUpdateResult` success / imageException / imageSizeInvalid / imageToGray4Failed / sendFailed | PNG bytes or raw grey; call after container exists |
| `audioControl(isOpen, 'glasses'\|'phone')` | boolean | glasses mic needs a page up first |
| `imuControl(isOpen, ImuReportPace.P100..P1000)` | boolean | pace is a protocol code, P100 fastest |
| `shutDownPageContainer(0 \| 1)` | boolean | 0 close now, 1 let foreground layer decide |

### Container properties
```ts
// Text
{ xPosition, yPosition, width, height, containerID, containerName,
  content, textColor?, isEventCapture?, zOrderIndex?,
  borderWidth?, borderColor?, borderRadius?, paddingLength? }
// List
{ ...same box fields, itemContainer: { itemCount, itemName: string[], itemWidth?, isItemSelectBorderEn? } }
// Image
{ xPosition, yPosition, width, height, containerID, containerName, zOrderIndex? }
// Menu
{ menuItems: [{ itemName, itemID }] }
```
zOrder rule: either no container sets `zOrderIndex`, or all do, unique, larger = in front.

### Events
```ts
bridge.onLaunchSource(src => ...)            // 'appMenu' | 'glassesMenu', pushed once after load
bridge.onDeviceStatusChanged(s => ...)       // {sn, connectType, isWearing, batteryLevel, isCharging, isInCase}
bridge.onAppLocationChanged(loc => ...)
bridge.onEvenHubEvent(e => ...)              // e.listEvent | e.textEvent | e.sysEvent | e.audioEvent | e.menuItemClickEvent
```

`OsEventTypeList`: 0 CLICK, 1 SCROLL_TOP, 2 SCROLL_BOTTOM, 3 DOUBLE_CLICK,
4 FOREGROUND_ENTER, 5 FOREGROUND_EXIT, 6 ABNORMAL_EXIT, 7 SYSTEM_EXIT,
8 IMU_DATA_REPORT, 9 LONG_PRESS, 10 LONG_PRESS_RELEASE.

`EventSourceType`: 1 GLASSES_R, 2 RING, 3 GLASSES_L (0 = unknown).

Audio: 16 kHz, signed 16-bit LE PCM, 100 ms per event (3200 bytes). Each
event carries `source`, `direction` (raw int16 or null) and `speakerRole`
(`self` / `other` / `unknown`, a phone-side guess).

IMU: `sysEvent.imuData = {x, y, z}` at the requested pace.

---

## 4. Input quirks you must design around (hardware findings)

- **A tap can arrive with no `eventType`**, on `sysEvent` or `textEvent` depending on source. Treat "event with no type on the capture container" as a tap.
- **Double tap on the root page opens the OS exit dialog.** Never require quick repeated taps. Triple tap never reaches the app.
- **One long swipe fans out as several scroll events.** Gate: act on the first, ignore further scrolls for ~700 ms.
- **Long press reaches the app** (`LONG_PRESS` then `LONG_PRESS_RELEASE`) from a plain hold, but **users can rebind a temple's long press to a system action** (one tester's left-temple hold launches Even AI). Don't make a feature depend on long press. Use the context menu for rare actions.
- **Tap-then-hold is a different gesture** and opens the OS menu.
- **FOREGROUND_ENTER / EXIT fire while your page stays mounted** when an OS overlay appears. Treat every foreground event as a checkpoint (save state, re-arm audio/location), not a start/stop.
- **The WebView can be suspended.** Count time on the wall clock, not ticks.
- **Overlapping writes race.** Run glasses writes through a queue with one in flight and a timeout.
- **Image after text:** in simulator 0.9.5, upgraded text vanished a second after several image sends until resent. Send text after images, or resend text after an image burst. Unverified on glass.
- **Image latency:** a 144×144 PNG lands in 150 to 300 ms. Even's own guidance: plan for 0.5 to 2 s per frame. This is not a 30 fps surface.
- **Simulator always reports source = right temple**, never emits device status, hardcodes user info, and processes images faster than hardware.

---

## 5. Project loop

### Scaffold
```bash
# Official minimal
mkdir my-app && cd my-app
npm init -y && npm i @evenrealities/even_hub_sdk @evenrealities/pretext
npx @evenrealities/evenhub-cli init          # writes app.json

# Or community template (React 19 + Tailwind + even-toolkit, 6 templates)
npx @even-toolkit/create-even-app my-app     # minimal | dashboard | notes | chat | tracker | media
```

### app.json (from `evenhub init`)
```json
{
  "package_id": "com.example.g2demo",
  "edition": "202601",
  "name": "G2 Demo",
  "version": "0.1.0",
  "min_app_version": "2.2.10",
  "min_sdk_version": "0.0.16",
  "entrypoint": "index.html",
  "permissions": [
    { "name": "network",  "desc": "why", "whitelist": ["https://example.com"] },
    { "name": "location", "desc": "why" }
  ],
  "supported_languages": ["en"]
}
```
`package_id` is permanent once released. Network access is whitelisted per origin.

### Develop
```bash
npm run dev                                   # vite on 0.0.0.0:5173
npx @evenrealities/evenhub-simulator http://localhost:5173 --automation-port 9898
npx @evenrealities/evenhub-cli qr             # QR for dev-mode sideload in the Even app
```
Simulator automation (HTTP on 127.0.0.1:9898):
`GET /api/ping`, `GET /api/screenshot/glasses` (576×288 PNG),
`GET /api/screenshot/webview`, `GET /api/console?since_id=N`, `DELETE /api/console`,
`POST /api/input {"action": "up"|"down"|"click"|"double_click"|"long_press"|"long_press_release"|"context_menu"}`.
That API is enough for an agent to drive the app, read logs and diff screenshots.

### Package and ship
```bash
npm run build
evenhub login                                 # once, interactive; creds in ~/.config/evenhub/credentials.yaml
evenhub pack app.json ./dist -o out.ehpk --check
evenhub create out.ehpk --name "My App" --tagline "One line" --icon icon.png   # first build
evenhub upload out.ehpk -m "what changed"     # later builds; bump version in app.json first
evenhub testers add a@x.com,b@y.com           # beta roster, invites expire in 7 days
evenhub promote 1.0.1 --to beta
evenhub ls --channels
```
Public release goes through review in the portal, not the CLI. Listing
edits after publish also go through review (CLI exits 7). Every command
takes `--json`. Exit codes: 0 ok, 1 usage, 2 not logged in, 3 not found,
4 exists, 5 pinned, 6 icon, 7 needs review, 8 rate limit, 9 local fail
(server unchanged), 10 network, 11 server changed then local fail.

Name ≤ 20 chars, tagline ≤ 50, description ≤ 2000, changelog ≤ 500.

---

## 6. Minimal page, no framework

```ts
import { waitForEvenAppBridge, OsEventTypeList, StartUpPageCreateResult } from '@evenrealities/even_hub_sdk';

const bridge = await waitForEvenAppBridge();

const ok = await bridge.createStartUpPageContainer({
  containerTotalNum: 2,
  textObject: [
    { containerID: 1, containerName: 'title', xPosition: 0,  yPosition: 0,   width: 576, height: 27,  content: 'HUD', zOrderIndex: 1, isEventCapture: 1 },
    { containerID: 2, containerName: 'body',  xPosition: 0,  yPosition: 40,  width: 576, height: 220, content: '',    zOrderIndex: 2 },
  ],
  menuObject: { menuItems: [{ itemID: 1, itemName: 'Refresh' }, { itemID: 2, itemName: 'Exit' }] },
});
if (ok !== StartUpPageCreateResult.success) throw new Error(String(ok));

bridge.onEvenHubEvent(async e => {
  if (e.menuItemClickEvent?.itemID === 2) return bridge.shutDownPageContainer(0);
  const t = e.sysEvent?.eventType ?? e.textEvent?.eventType;
  if (t === OsEventTypeList.CLICK_EVENT || t === undefined) {
    await bridge.textContainerUpgrade({ containerID: 2, containerName: 'body', content: new Date().toLocaleTimeString() });
  }
});
```

---

## 7. Libraries worth standing on

| Package | Why |
|---|---|
| `@evenrealities/pretext` | Pixel-exact text measurement, same LVGL metrics as firmware |
| `@maticsh/glasses` | Pure-domain primitives: `toIntent` (normalises tap quirks), `buildPage` (IDs, limits, one capture container, menu re-attach), `createRenderer` (write queue, latest-wins, text before images), `createLifecycle`, `pixels`/`dotText`/`sparkline`/`encodePng` for image-container drawing, `align`/`spread` for fake alignment |
| `@maticsh/testing` | `FakeBridge` for unit tests without glasses |
| `even-toolkit` | React companion-app components, 191 official pixel icons, per-screen glasses router, splash, STT module (Soniox) |
| `@penta2himajin/even-deskless` | Verification without glasses or phone |
| `even-sim-recorder` | GUI recorder for the simulator display |

---

## 8. What this means for a "cyberpunk HUD" app

Hard truths:
- There is no free-pixel canvas. Pixel art lives in **at most 4 image containers of ≤ 288×144**, refreshed at roughly 2 to 5 fps if you push it. Text is one font, one size.
- Without the ring, input is right-temple tap, scroll, double tap (exit), context menu. That's it.
- The display is one colour with 16 grey levels in images, 5 in text.

What still works and looks good:
- **Two image tiles side by side** = the full 576 px width at 144 px tall. One is a compass rose or gauge drawn with `pixels`, the other a sparkline or radar-style ring. Text lines below for labels.
- **Dot-matrix hero numbers** via `dotText` (how Even's own Weather app does it). Big speed, big glucose, big heading.
- **IMU at P100** gives a 10 Hz heading/tilt feel. Smooth the needle client-side and only redraw when it moves a few degrees, or BLE queues up.
- **Location** gives speed, heading, altitude from the phone with no extra work.
- **Battery, wearing state, in-case** from `onDeviceStatusChanged`.
- **Context menu** for mode switches (Nav / Bio / Ambient / Exit) instead of gesture combos.
- **Ambient mode:** one text line, brightness 1, when nothing changes. Expand on tap.

Data you uniquely own: a live CGM trace. One image tile with a 3-hour glucose
sparkline, the current value as a dot-matrix number, trend arrow in text.
Nothing on the Even Hub store has that.

Suggested build order:
1. Plain SDK page: clock + battery + heading text. Prove the loop in the simulator with the automation API, then on glass via `evenhub qr`.
2. Add one image tile with a `pixels`-drawn compass. Measure real latency on glass.
3. Add the glucose tile fed from your existing export pipeline over a whitelisted HTTPS origin.
4. Context menu, ambient mode, store icon, `evenhub create`, beta channel to yourself.
