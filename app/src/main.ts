// Bio HUD for Even G2: Workout D. Two image tiles (HR + zone, timer + activity)
// over four text lines (zone, Spotify, next track + Move ring, action bar).
// Falls back to a one-line Ambient screen when no workout is active.

import { CreateStartUpPageContainer, OsEventTypeList, StartUpPageCreateResult, TextContainerProperty, type EvenHubEvent } from '@evenrealities/even_hub_sdk';
import { getBridge } from './bridge';
import { createMockModel, createRemoteModel, hrAgeSec, hrStale, zoneOf, type Model } from './model';
import { ageLabel, drawActivityTile, drawBlankTile, drawHrTile, drawSongStrip, newStrip, newTile, toPng } from './draw';
import { DIM, IDS, MENU, NAMES, ambientLeft, batteryText, blankPageSpec, clockText, dateText, pageSpec, workoutLines } from './layout';
import { createWriteQueue } from './queue';

const TICK_MS = 1000;
const AWAKE_MS = 15_000;          // lens goes dark this long after the last wake

/** Look-up detector on raw IMU samples. Unit-agnostic: fires when the vector
 *  swings away from a slow rolling baseline, then settles. */
function createLookUp(onLookUp: () => void) {
  let base: [number, number, number] | null = null;
  let hot = 0, cooldownUntil = 0;
  return (x: number, y: number, z: number) => {
    if (!base) { base = [x, y, z]; return; }
    const norm = Math.hypot(...base) || 1;
    const dev = Math.hypot(x - base[0], y - base[1], z - base[2]) / norm;
    const now = Date.now();
    if (dev > 0.35) {
      hot++;
      if (hot >= 2 && now > cooldownUntil) { cooldownUntil = now + 3000; onLookUp(); }
    } else {
      hot = 0;
      // Follow slow posture changes so a new resting head angle becomes the baseline.
      base = [base[0] + (x - base[0]) * 0.1, base[1] + (y - base[1]) * 0.1, base[2] + (z - base[2]) * 0.1];
    }
  };
}
const status = (msg: string) => { const el = document.getElementById('status'); if (el) el.textContent = msg; };

async function main() {
  const bridge = await getBridge();
  status(bridge.kind === 'even' ? 'Connected to Even app' : 'Browser preview');

  const endpoint = import.meta.env.VITE_HUD_ENDPOINT as string | undefined;
  const token = (import.meta.env.VITE_HUD_TOKEN as string | undefined) ?? '';
  const model: Model = endpoint ? createRemoteModel(endpoint, token, status, () => pollInterval(), () => lite()) : createMockModel();
  if (endpoint) status(`connecting to ${endpoint}…`);
  const hint = document.getElementById('hint');
  if (hint) hint.textContent = endpoint
    ? 'Browser preview on live data. Click = tap. M = menu. ↑/↓ = swipe. U = look-up.'
    : 'Browser preview. Click = tap. M = menu. U = look-up. No Even app bridge found, so data is mocked.';

  // Create the page. If the firmware rejects the full layout, step down through
  // simpler variants so the lens still shows something and the phone page says
  // which rule tripped.
  const variants: Array<[string, () => any]> = [
    ['full', () => pageSpec()],
    ['no-menu', () => { const p: any = pageSpec(); delete p.menuObject; return p; }],
    ['no-strip', () => { const p: any = pageSpec(); delete p.menuObject; p.imageObject = p.imageObject.slice(0, 2); p.containerTotalNum = 5; return p; }],
    ['no-zorder', () => { const p: any = pageSpec(); delete p.menuObject; p.imageObject = p.imageObject.slice(0, 2); p.containerTotalNum = 5; for (const c of [...p.imageObject, ...p.textObject]) delete c.zOrderIndex; return p; }],
    ['text-only', () => { const p: any = pageSpec(); delete p.menuObject; p.imageObject = []; p.containerTotalNum = p.textObject.length; for (const c of p.textObject) delete c.zOrderIndex; return p; }],
    // The docs' own first-app page. If this fails, nothing can draw: another app
    // (Even Terminal?) holds the glasses, or the Even app is too old.
    ['hello', () => ({ containerTotalNum: 1, textObject: [new TextContainerProperty({ xPosition: 0, yPosition: 0, width: 576, height: 288, borderWidth: 0, borderColor: 5, paddingLength: 4, containerID: 1, containerName: 'main', content: 'Hello from G2!', isEventCapture: 1 })] })],
  ];
  let created = '';
  const report: string[] = [];
  // A page from a previous load of this app may still be on the glasses (hot
  // reload, re-scan, reconnect). The firmware refuses a second create with
  // "invalid"; rebuild replaces the existing page instead.
  {
    const r = await bridge.createStartUpPageContainer(pageSpec());
    report.push(`create:${StartUpPageCreateResult[r] ?? r}`);
    if (r === StartUpPageCreateResult.success) created = 'full';
    else if (await bridge.rebuildPageContainer(pageSpec())) { created = 'full'; report.push('rebuild:ok'); }
    else report.push('rebuild:refused');
  }
  for (const [name, make] of created ? [] : variants.slice(1)) {
    let r: any;
    try { r = await bridge.createStartUpPageContainer(make()); } catch (e: any) { r = 'threw ' + (e?.message ?? e); }
    const label = typeof r === 'number' ? (StartUpPageCreateResult[r] ?? String(r)) : String(r);
    report.push(`${name}:${label}`);
    console.log('[hud] create', name, label);
    if (r === StartUpPageCreateResult.success) { created = name; break; }
    if (await bridge.rebuildPageContainer(make())) { created = name; report.push('rebuild:ok'); break; }
  }
  if (!created) {
    // Ask the phone directly and show its unparsed answer, plus what it says about the glasses.
    let rawCreate = '', dev = '';
    try { rawCreate = JSON.stringify(await bridge.raw('createStartUpPageContainer', new CreateStartUpPageContainer(variants[variants.length - 1][1]()).toJson())); } catch (e: any) { rawCreate = 'threw ' + (e?.message ?? e); }
    try {
      const d: any = await bridge.raw('getGlassesInfo', {});
      const st = d?.status ?? {};
      dev = `${st.connectType ?? '?'} wearing=${st.isWearing ?? '?'} inCase=${st.isInCase ?? '?'} charging=${st.isCharging ?? '?'} battery=${st.batteryLevel ?? '?'}`;
    } catch (e: any) { dev = 'threw ' + (e?.message ?? e); }
    status(`Page create refused (phone replied ${rawCreate}). Glasses: ${dev}. ${/wearing=false/.test(dev) ? 'PUT THE GLASSES ON and re-scan. ' : ''}Layouts: ${report.join(' ')}`);
    return;
  }
  if (created === 'hello') { status('Only the bare Hello page works — ' + report.join('  ')); return; }
  if (created !== 'full') status(`Lens on reduced layout "${created}" (firmware rejected the full one)`);
  const hasStrip = created === 'full' || created === 'no-menu';
  const hasTiles = created !== 'text-only';

  bridge.onBattery(pct => { model.state.battery = pct; });
  const q = createWriteQueue();
  let awakeUntil = Date.now() + AWAKE_MS;
  let asleep = false;
  let lastZone = 0, candidateZone = 0, candidateSince = 0;
  // Poll cadence drives the Cloudflare bill: fast only when someone is looking.
  // Z1 60 s, Z2 30 s, Z3+ 15 s during a workout; 60 s idle. Timer and song
  // position advance locally between pulls, so the lens still ticks.
  function pollInterval(): number {
    const w = model.state.workout;
    if (!w.active) return 60_000;
    const z = w.hr > 0 ? zoneOf(w.hr, w.hrMax).n : 1;
    return z <= 1 ? 60_000 : z === 2 ? 30_000 : 15_000;
  }
  /** Idle or asleep: ask the Worker for the cheap version (no Spotify, no weather). */
  function lite(): boolean { return asleep || !model.state.workout.active; }
  const hrTile = newTile();
  const actTile = newTile();
  const songStrip = newStrip();
  const lastText: string[] = ['', '', '', '', ''];
  let lastHrKey = '';
  let lastMode: 'workout' | 'ambient' | '' = '';
  let tick = 0;

  function wake(reason: string) {
    awakeUntil = Date.now() + AWAKE_MS;
    if (asleep) {
      asleep = false;
      console.log('[hud] wake:', reason);
      model.refresh?.();                       // one fresh pull so what you look at is current
      wakePage();
      lastText.fill(''); lastHrKey = ''; lastMode = '';
      render(true);
    }
  }
  // Sleep replaces the whole page with one blank capture container in a single
  // write, so everything disappears together instead of one element at a time.
  // Wake rebuilds the full page in one write, then repaints the tiles.
  function sleep() {
    asleep = true;
    console.log('[hud] sleep');
    q.push('page', () => bridge.rebuildPageContainer(blankPageSpec()));
    lastText.fill(''); lastHrKey = '';
  }
  function wakePage() {
    q.push('page', () => bridge.rebuildPageContainer(pageSpec()));
  }
  const lookUp = createLookUp(() => wake('look-up'));
  bridge.imuControl(true).catch(() => {});

  // Input. Taps can arrive without an eventType depending on source, so an
  // untyped event on the capture container counts as a tap.
  let lastScroll = 0;
  bridge.onEvenHubEvent((e: EvenHubEvent) => {
    if (e.sysEvent?.eventType === OsEventTypeList.IMU_DATA_REPORT) {
      const d = e.sysEvent.imuData; if (d) lookUp(d.x ?? 0, d.y ?? 0, d.z ?? 0);
      return;
    }
    if (e.audioEvent) return;
    const wasAsleep = asleep;
    wake('input');
    if (wasAsleep) return;                       // first touch only wakes the lens
    const menu = e.menuItemClickEvent?.itemID;
    if (menu === MENU.pause && !model.state.workout.paused) model.togglePause();
    else if (menu === MENU.resume && model.state.workout.paused) model.togglePause();
    else if (menu === MENU.skip) model.skipTrack();
    else if (menu === MENU.exit) void bridge.shutDownPageContainer(1);   // system exit dialog; silent exit is rejected in Even QA
    if (menu !== undefined) { render(true); return; }

    const t = e.sysEvent?.eventType ?? e.textEvent?.eventType ?? e.listEvent?.eventType;
    if (t === undefined && (e.textEvent || e.sysEvent)) { model.togglePause(); render(true); return; }
    if (t === OsEventTypeList.CLICK_EVENT) { model.togglePause(); render(true); return; }
    if (t === OsEventTypeList.SCROLL_TOP_EVENT || t === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
      const now = Date.now();
      if (now - lastScroll < 700) return;               // one swipe fans out as several events
      lastScroll = now;
      model.skipTrack(); render(true); return;
    }
    if (t === OsEventTypeList.FOREGROUND_ENTER_EVENT) { lastText.fill(''); lastHrKey = ''; lastMode = ''; render(true); }
  });

  function pushText(id: number, name: string, content: string, idx: number, textColor?: number) {
    if (lastText[idx] === content) return;
    lastText[idx] = content;
    q.push(`text:${id}`, () => bridge.textContainerUpgrade({ containerID: id, containerName: name, content, textColor }));
  }

  function pushImage(id: number, name: string, canvas: HTMLCanvasElement) {
    q.push(`img:${id}`, async () => {
      const png = await toPng(canvas);
      return bridge.updateImageRawData({ containerID: id, containerName: name, imageData: png });
    });
  }

  function render(force = false) {
    const s = model.state;
    const mode = s.workout.active ? 'workout' : 'ambient';
    const modeChanged = mode !== lastMode;
    if (modeChanged && lastMode) { awakeUntil = Date.now() + AWAKE_MS; if (asleep) { asleep = false; wakePage(); lastText.fill(''); lastHrKey = ''; force = true; } }
    lastMode = mode;

    if (mode === 'workout') {
      // The HR tile is redrawn only when something visible changes: the number,
      // the coarse age label, or (stale only) the heart's pulse phase.
      const age = hrAgeSec(s), stale = hrStale(s), pulseOn = tick % 2 === 0;
      const hrKey = `${Math.round(s.workout.hr)}|${ageLabel(age)}|${stale ? (pulseOn ? 'on' : 'off') : 'live'}`;
      if (hasTiles && (force || modeChanged || hrKey !== lastHrKey)) {
        lastHrKey = hrKey;
        drawHrTile(hrTile, s.workout.hr, s.workout.hrMax, age, stale, pulseOn);
        pushImage(IDS.hr, NAMES.hr, hrTile);
      }
      if (hasTiles) { drawActivityTile(actTile, s, tick % 2 === 0); pushImage(IDS.act, NAMES.act, actTile); }
      if (hasStrip) { drawSongStrip(songStrip, s); pushImage(IDS.song, NAMES.song, songStrip); }
      const lines = workoutLines(s);
      pushText(IDS.l1, NAMES.l1, lines[0], 0);
      pushText(IDS.l2, NAMES.l2, lines[1], 1, DIM);
      pushText(IDS.clock, NAMES.clock, clockText(s), 2, 2);
      pushText(IDS.date, NAMES.date, dateText(s), 3, 2);
      pushText(IDS.batt, NAMES.batt, batteryText(s) || ' ', 4, 2);
    } else {
      if ((modeChanged || force) && hasTiles) {
        drawBlankTile(hrTile); drawBlankTile(actTile); drawBlankTile(songStrip);
        pushImage(IDS.hr, NAMES.hr, hrTile);
        pushImage(IDS.act, NAMES.act, actTile);
        if (hasStrip) pushImage(IDS.song, NAMES.song, songStrip);
      }
      pushText(IDS.l1, NAMES.l1, ' ', 0);
      pushText(IDS.l2, NAMES.l2, ' ', 1);
      pushText(IDS.clock, NAMES.clock, ambientLeft(s), 2, 1);
      pushText(IDS.date, NAMES.date, dateText(s), 3, 1);
      pushText(IDS.batt, NAMES.batt, batteryText(s) || ' ', 4, 1);
    }
  }

  let last = Date.now();
  render(true);
  setInterval(() => {
    const now = Date.now();
    model.tick(now - last);
    last = now;
    tick++;
    const s = model.state;
    const mode = s.workout.active ? 'workout' : 'ambient';
    if (mode !== lastMode) { render(); return; }    // state change: render() wakes the lens itself
    // Zone change during a workout wakes the lens, but only once the new zone
    // has held for 5 s: a pulse bouncing across a boundary must not keep it lit.
    if (s.workout.active && s.workout.hr > 0) {
      const z = zoneOf(s.workout.hr, s.workout.hrMax).n;
      if (z !== candidateZone) { candidateZone = z; candidateSince = now; }
      if (lastZone === 0) lastZone = z;
      else if (z !== lastZone && now - candidateSince >= 5_000) { wake(`zone ${lastZone}→${z}`); lastZone = z; }
    } else { lastZone = 0; candidateZone = 0; }
    if (!asleep && now > awakeUntil) { sleep(); return; }
    if (!asleep) render();
  }, TICK_MS);
}

main().catch(err => { console.error(err); status('HUD failed: ' + (err?.message ?? err)); });
