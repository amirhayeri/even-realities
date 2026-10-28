// Bio HUD for Even G2: Workout D. Two image tiles (HR + zone, timer + activity)
// over four text lines (zone, Spotify, next track + Move ring, action bar).
// Falls back to a one-line Ambient screen when no workout is active.

import { OsEventTypeList, StartUpPageCreateResult, type EvenHubEvent } from '@evenrealities/even_hub_sdk';
import { getBridge } from './bridge';
import { createMockModel, createRemoteModel, type Model } from './model';
import { drawActivityTile, drawBlankTile, drawHrTile, drawSongStrip, newStrip, newTile, toPng } from './draw';
import { DIM, IDS, MENU, NAMES, ambientLines, clockText, pageSpec, workoutLines } from './layout';
import { createWriteQueue } from './queue';

const TICK_MS = 1000;
const status = (msg: string) => { const el = document.getElementById('status'); if (el) el.textContent = msg; };

async function main() {
  const bridge = await getBridge();
  status(bridge.kind === 'even' ? 'Connected to Even app' : 'Browser preview');

  const endpoint = import.meta.env.VITE_HUD_ENDPOINT as string | undefined;
  const model: Model = endpoint ? createRemoteModel(endpoint) : createMockModel();

  const result = await bridge.createStartUpPageContainer(pageSpec());
  if (result !== StartUpPageCreateResult.success) {
    status(`Page create failed: ${StartUpPageCreateResult[result] ?? result}`);
    return;
  }

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
      if (force || modeChanged || hrRounded !== lastHrDrawn) {
        lastHrDrawn = hrRounded;
        drawHrTile(hrTile, s.workout.hr, s.workout.hrMax);
        pushImage(IDS.hr, NAMES.hr, hrTile);
      }
      drawActivityTile(actTile, s, tick % 2 === 0);
      pushImage(IDS.act, NAMES.act, actTile);
      drawSongStrip(songStrip, s);
      pushImage(IDS.song, NAMES.song, songStrip);
      const lines = workoutLines(s);
      pushText(IDS.l1, NAMES.l1, lines[0], 0);
      pushText(IDS.l2, NAMES.l2, lines[1], 1, DIM);
      pushText(IDS.clock, NAMES.clock, clockText(s), 2, 2);
    } else {
      if (modeChanged || force) {
        drawBlankTile(hrTile); drawBlankTile(actTile); drawBlankTile(songStrip);
        pushImage(IDS.hr, NAMES.hr, hrTile);
        pushImage(IDS.act, NAMES.act, actTile);
        pushImage(IDS.song, NAMES.song, songStrip);
      }
      const lines = ambientLines(s);
      pushText(IDS.l1, NAMES.l1, lines[0], 0);
      pushText(IDS.l2, NAMES.l2, lines[1], 1, 1);
      pushText(IDS.clock, NAMES.clock, ' ', 2);
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
