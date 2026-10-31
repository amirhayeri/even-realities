// Morning HUD for Even G2. The whole lens is four image tiles (2x2 of
// 288x144) under one invisible capture container, so every card is drawn by
// us. Four cards: glance, today, needs you, your day. Swipe moves, tap acts,
// menu reads or jumps, double tap exits.

import { ImageContainerProperty, MenuContainerProperty, MenuItemProperty, OsEventTypeList, StartUpPageCreateResult, TextContainerProperty, type EvenHubEvent } from '@evenrealities/even_hub_sdk';
import { getBridge } from '../../app/src/bridge';
import { createWriteQueue } from '../../app/src/queue';
import { createMockModel, createRemoteModel, type MorningModel } from './model';
import { CARDS, createTiler, drawScene, H, TH, TW, W, type Card, type View } from './render';

const AWAKE_MS = 45_000;           // dark after this long without input
const POLL_MS = 60_000;
const MENU = { read: 1, next: 2, prev: 3, refresh: 4, exit: 5 } as const;
const TILE_IDS = [1, 2, 3, 4];
const CAPTURE_ID = 9;

const status = (msg: string) => { const el = document.getElementById('status'); if (el) el.textContent = msg; };

function pageSpec() {
  const image = (id: number, x: number, y: number) => new ImageContainerProperty({ xPosition: x, yPosition: y, width: TW, height: TH, containerID: id, containerName: `tile-${id}`, zOrderIndex: id });
  return {
    containerTotalNum: 5,
    imageObject: [image(1, 0, 0), image(2, TW, 0), image(3, 0, TH), image(4, TW, TH)],
    textObject: [new TextContainerProperty({
      xPosition: 0, yPosition: 0, width: W, height: 27,
      borderWidth: 0, borderColor: 0, borderRadius: 0, paddingLength: 0,
      containerID: CAPTURE_ID, containerName: 'capture', content: ' ', textColor: 0, isEventCapture: 1, zOrderIndex: 0,
    })],
    menuObject: new MenuContainerProperty({ menuItems: [
      new MenuItemProperty({ itemID: MENU.read, itemName: 'Read' }),
      new MenuItemProperty({ itemID: MENU.next, itemName: 'Next card' }),
      new MenuItemProperty({ itemID: MENU.prev, itemName: 'Previous card' }),
      new MenuItemProperty({ itemID: MENU.refresh, itemName: 'Refresh' }),
      new MenuItemProperty({ itemID: MENU.exit, itemName: 'Exit' }),
    ] }),
  };
}
function blankPageSpec() {
  return { containerTotalNum: 1, textObject: [new TextContainerProperty({ xPosition: 0, yPosition: 0, width: W, height: H, borderWidth: 0, borderColor: 0, borderRadius: 0, paddingLength: 0, containerID: 99, containerName: 'sleep', content: ' ', textColor: 0, isEventCapture: 1 })] };
}

async function main() {
  const bridge = await getBridge();
  const endpoint = import.meta.env.VITE_HUD_ENDPOINT as string | undefined;
  const token = (import.meta.env.VITE_HUD_TOKEN as string | undefined) ?? '';
  const model: MorningModel = endpoint ? createRemoteModel(endpoint, token, POLL_MS, status) : createMockModel();
  status(bridge.kind === 'even' ? 'Connected to Even app' : endpoint ? `Browser preview on ${endpoint}` : 'Browser preview, mock data');

  let r = await bridge.createStartUpPageContainer(pageSpec());
  if (r !== StartUpPageCreateResult.success && !(await bridge.rebuildPageContainer(pageSpec()))) {
    status(`Page create refused: ${StartUpPageCreateResult[r] ?? r}. Put the glasses on and re-open the app.`);
    return;
  }

  const q = createWriteQueue();
  const tiler = createTiler();
  const scene = document.createElement('canvas'); scene.width = W; scene.height = H;
  const view: View = { card: 0, cursor: 0, body: null, bodyScroll: 0 };
  let asleep = false, awakeUntil = Date.now() + AWAKE_MS;

  async function render() {
    if (asleep) return;
    drawScene(scene, model.state, view);
    for (const { idx, png } of await tiler.changed(scene)) {
      q.push(`tile:${idx}`, () => bridge.updateImageRawData({ containerID: TILE_IDS[idx], containerName: `tile-${TILE_IDS[idx]}`, imageData: png }));
    }
  }
  function sleep() { asleep = true; q.push('page', () => bridge.rebuildPageContainer(blankPageSpec())); }
  function wake() {
    awakeUntil = Date.now() + AWAKE_MS;
    if (!asleep) return false;
    asleep = false;
    q.push('page', () => bridge.rebuildPageContainer(pageSpec()));
    tiler.reset();
    void model.refresh(true).then(() => render());
    void render();
    return true;
  }

  const rowsOn = (c: Card) => c === 1 ? model.state.events.length : c === 2 ? model.state.items.length : 0;
  function go(card: number, fromEnd = false) {
    view.card = ((card + CARDS) % CARDS) as Card;
    const n = rowsOn(view.card);
    view.cursor = fromEnd ? Math.max(0, n - 1) : 0;
  }
  function move(dir: 1 | -1) {
    if (view.body) { view.bodyScroll = Math.max(0, view.bodyScroll + dir * 3); return; }
    const n = rowsOn(view.card);
    const next = view.cursor + dir;
    if (n === 0 || next < 0) { go(view.card + dir, dir < 0); return; }
    if (next >= n) { go(view.card + 1); return; }
    view.cursor = next;
  }
  async function read() {
    if (view.body) return;
    if (view.card === 2) {
      const it = model.state.items[view.cursor]; if (!it) return;
      view.loading = 'loading…'; void render();
      const b = await model.body(it.id);
      view.loading = undefined;
      view.body = b ?? { who: it.who, what: it.what, at: it.at, text: it.preview || it.what };
      view.bodyScroll = 0;
    } else if (view.card === 1) {
      const e = model.state.events[view.cursor]; if (!e) return;
      const when = e.allDay ? 'All day' : `${new Date(e.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} – ${new Date(e.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
      const mail = model.state.items.filter(i => (i.kind === 'vip' || i.kind === 'mail') && i.meetToday && e.who.length).slice(0, 3).map(i => `✉ ${i.who}: ${i.what}`);
      view.body = { who: e.cal, what: e.title, at: e.start, text: [when, e.where, e.who.length ? `With ${e.who.join(', ')}` : '', '', ...mail].filter((l, k) => l || k === 3).join('\n') };
      view.bodyScroll = 0;
    }
  }
  function tap() {
    if (view.body) { view.body = null; return; }
    if (view.card === 2) { const it = model.state.items[view.cursor]; if (it) model.keep(it.id, !it.kept); return; }
    go(view.card + 1);
  }

  let lastScroll = 0;
  bridge.onEvenHubEvent((e: EvenHubEvent) => {
    if (e.sysEvent?.eventType === OsEventTypeList.IMU_DATA_REPORT || e.audioEvent) return;
    if (wake()) return;                                   // first touch only lights the lens
    const menu = e.menuItemClickEvent?.itemID;
    if (menu === MENU.read) void read().then(render);
    else if (menu === MENU.next) { go(view.card + 1); view.body = null; }
    else if (menu === MENU.prev) { go(view.card - 1); view.body = null; }
    else if (menu === MENU.refresh) { void model.refresh(true).then(render); }
    else if (menu === MENU.exit) { void bridge.shutDownPageContainer(1); return; }
    if (menu !== undefined) { void render(); return; }
    const t = e.sysEvent?.eventType ?? e.textEvent?.eventType ?? e.listEvent?.eventType;
    if (t === OsEventTypeList.SCROLL_TOP_EVENT || t === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
      const now = Date.now();
      if (now - lastScroll < 350) return;
      lastScroll = now;
      move(t === OsEventTypeList.SCROLL_BOTTOM_EVENT ? 1 : -1);
    } else if (t === OsEventTypeList.CLICK_EVENT || (t === undefined && (e.textEvent || e.sysEvent))) tap();
    else if (t === OsEventTypeList.FOREGROUND_ENTER_EVENT) tiler.reset();
    void render();
  });

  await model.refresh(true);
  await render();
  setInterval(() => {
    const now = Date.now();
    if (!asleep && now > awakeUntil) { sleep(); return; }
    if (asleep) return;
    void model.refresh().then(changed => { if (changed) render(); });
    // Relative times and the now-line drift: repaint once a minute.
    if (now % 60_000 < 1000) { model.state.now = now; void render(); }
  }, 1000);
}

main().catch(err => { console.error(err); status('Morning HUD failed: ' + (err?.message ?? err)); });
