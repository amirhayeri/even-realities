// Bio HUD for Even G2: Workout D. Two image tiles (HR + zone, timer + activity)
// over four text lines (zone, Spotify, next track + Move ring, action bar).
// Falls back to a one-line Ambient screen when no workout is active.

import { CreateStartUpPageContainer, OsEventTypeList, StartUpPageCreateResult, TextContainerProperty, type EvenHubEvent } from '@evenrealities/even_hub_sdk';
import { getBridge } from './bridge';
import { createMockModel, createRemoteModel, type Model } from './model';
import { drawActivityTile, drawBlankTile, drawHrTile, drawSongStrip, newStrip, newTile, toPng } from './draw';
import { DIM, IDS, MENU, NAMES, ambientLine, clockText, pageSpec, workoutLines } from './layout';
import { createWriteQueue } from './queue';

const TICK_MS = 1000;
const status = (msg: string) => { const el = document.getElementById('status'); if (el) el.textContent = msg; };

async function main() {
  const bridge = await getBridge();
  status(bridge.kind === 'even' ? 'Connected to Even app' : 'Browser preview');

  const endpoint = import.meta.env.VITE_HUD_ENDPOINT as string | undefined;
  const token = (import.meta.env.VITE_HUD_TOKEN as string | undefined) ?? '';
  const model: Model = endpoint ? createRemoteModel(endpoint, token, status) : createMockModel();
  if (endpoint) status(`connecting to ${endpoint}…`);
  const hint = document.getElementById('hint');
  if (hint) hint.textContent = endpoint
    ? 'Browser preview on live data. Click = tap. M = menu. ↑/↓ = swipe.'
    : 'Browser preview. Click = tap. M = menu. No Even app bridge found, so data is mocked.';

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
  const hrTile = newTile();
  const actTile = newTile();
  const songStrip = newStrip();
  const lastText: string[] = ['', '', ''];
  let lastHrDrawn = -1;
  let lastMode: 'workout' | 'ambient' | '' = '';
  let tick = 0;

  // Input. Taps can arrive without an eventType depending on source, so an
  // untyped event on the capture container counts as a tap.
  let lastScroll = 0;
  bridge.onEvenHubEvent((e: EvenHubEvent) => {
    const menu = e.menuItemClickEvent?.itemID;
    if (menu === MENU.pause && !model.state.workout.paused) model.togglePause();
    else if (menu === MENU.resume && model.state.workout.paused) model.togglePause();
    else if (menu === MENU.skip) model.skipTrack();
    else if (menu === MENU.exit) void bridge.shutDownPageContainer(0);
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
    if (t === OsEventTypeList.FOREGROUND_ENTER_EVENT) { lastText.fill(''); lastHrDrawn = -1; lastMode = ''; render(true); }
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
    lastMode = mode;

    if (mode === 'workout') {
      const hrRounded = Math.round(s.workout.hr);
      if (hasTiles && (force || modeChanged || hrRounded !== lastHrDrawn)) {
        lastHrDrawn = hrRounded;
        drawHrTile(hrTile, s.workout.hr, s.workout.hrMax);
        pushImage(IDS.hr, NAMES.hr, hrTile);
      }
      if (hasTiles) { drawActivityTile(actTile, s, tick % 2 === 0); pushImage(IDS.act, NAMES.act, actTile); }
      if (hasStrip) { drawSongStrip(songStrip, s); pushImage(IDS.song, NAMES.song, songStrip); }
      const lines = workoutLines(s);
      pushText(IDS.l1, NAMES.l1, lines[0], 0);
      pushText(IDS.l2, NAMES.l2, lines[1], 1, DIM);
      pushText(IDS.clock, NAMES.clock, clockText(s), 2, 2);
    } else {
      if ((modeChanged || force) && hasTiles) {
        drawBlankTile(hrTile); drawBlankTile(actTile); drawBlankTile(songStrip);
        pushImage(IDS.hr, NAMES.hr, hrTile);
        pushImage(IDS.act, NAMES.act, actTile);
        if (hasStrip) pushImage(IDS.song, NAMES.song, songStrip);
      }
      pushText(IDS.l1, NAMES.l1, ' ', 0);
      pushText(IDS.l2, NAMES.l2, ' ', 1);
      pushText(IDS.clock, NAMES.clock, ambientLine(s), 2, 1);
    }
  }

  let last = Date.now();
  render(true);
  setInterval(() => {
    const now = Date.now();
    model.tick(now - last);
    last = now;
    tick++;
    render();
  }, TICK_MS);
}

main().catch(err => { console.error(err); status('HUD failed: ' + (err?.message ?? err)); });
