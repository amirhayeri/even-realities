// Draws one 576x288 scene per card on a canvas, white on black with alpha
// for the grey levels, then hands back the four 288x144 quadrants as PNGs,
// only the ones whose pixels changed.

import { ago, fmtTime, type Body, type Briefing, type CalEvent, type Item } from './model';

export const W = 576, H = 288, TW = 288, TH = 144;
export type Card = 0 | 1 | 2 | 3;
export const CARDS = 4;

export interface View {
  card: Card;
  cursor: number;          // selected row on cards 1 and 2
  body: Body | null;       // when set, the body view is showing
  bodyScroll: number;      // first visible line
  loading?: string;        // short status to show in the footer
}

const FONT = 'system-ui, -apple-system, Helvetica, Arial, sans-serif';
const GLYPH: Record<Item['kind'], string> = { vip: '★', mail: '✉', text: '◉', call: '☎' };

function txt(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, op = 1, align: CanvasTextAlign = 'left', weight = 500, maxW?: number) {
  ctx.fillStyle = `rgba(255,255,255,${op})`;
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  let t = s;
  if (maxW !== undefined && ctx.measureText(t).width > maxW) {
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    t += '…';
  }
  ctx.fillText(t, x, y);
  return ctx.measureText(t).width;
}
function rect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, op: number) { ctx.fillStyle = `rgba(255,255,255,${op})`; ctx.fillRect(x, y, w, h); }
function box(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, op: number, r = 7, fill = 0) {
  ctx.strokeStyle = `rgba(255,255,255,${op})`; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5, r); ctx.stroke();
  if (fill) { ctx.fillStyle = `rgba(255,255,255,${fill})`; ctx.fill(); }
}
function footer(ctx: CanvasRenderingContext2D, left: string, mid: string, right: string) {
  txt(ctx, left, 18, 276, 10, 0.45); txt(ctx, mid, W / 2, 276, 10, 0.45, 'center'); txt(ctx, right, W - 18, 276, 10, 0.45, 'right');
}
function dateText(now: number): string {
  const d = new Date(now);
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]}`;
}
function greeting(now: number): string { const h = new Date(now).getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }
function timed(ev: CalEvent[]) { return ev.filter(e => !e.allDay); }

/** Largest free window between timed events, inside 8:00–18:00 today. */
function freeWindow(ev: CalEvent[], now: number): [number, number] | null {
  const d = new Date(now); d.setHours(0, 0, 0, 0);
  const lo = Math.max(now, d.getTime() + 8 * 3600_000), hi = d.getTime() + 18 * 3600_000;
  const busy = timed(ev).map(e => [e.start, e.end] as [number, number]).sort((a, b) => a[0] - b[0]);
  let best: [number, number] | null = null, cur = lo;
  for (const [s, e] of [...busy, [hi, hi] as [number, number]]) {
    if (s - cur >= 45 * 60_000 && (!best || s - cur > best[1] - best[0])) best = [cur, s];
    cur = Math.max(cur, e);
  }
  return best;
}

// ---------- Cards ----------

function cardGlance(ctx: CanvasRenderingContext2D, b: Briefing) {
  const now = b.now;
  txt(ctx, `${greeting(now)}`, 18, 32, 19, 1, 'left', 600);
  const wx = b.weather ? `   ·   ${b.weather.tempC}°` : '';
  txt(ctx, `${dateText(now)}${wx}`, W - 18, 32, 12, 0.6, 'right');
  // Day strip 7..19
  const x0 = 18, x1 = W - 18, h0 = 7, h1 = 19;
  const X = (ms: number) => { const d = new Date(ms); const h = d.getHours() + d.getMinutes() / 60; return x0 + Math.max(0, Math.min(1, (h - h0) / (h1 - h0))) * (x1 - x0); };
  rect(ctx, x0, 72, x1 - x0, 1, 0.25);
  for (let h = h0; h <= h1; h++) { const x = x0 + (h - h0) / (h1 - h0) * (x1 - x0); rect(ctx, x, 69, 1, 5, 0.35); if (h % 2 === 1) txt(ctx, String(h), x, 86, 8, 0.45, 'center'); }
  for (const e of timed(b.events)) {
    const xs = X(e.start), xe = Math.max(xs + 14, X(e.end));
    const hot = b.items.some(i => i.kind === 'vip' && !!i.from && e.who.includes(i.from));
    box(ctx, xs, 48, xe - xs, 18, 0.9, 3, hot ? 0.9 : 0.1);
    ctx.save(); ctx.beginPath(); ctx.rect(xs + 2, 48, xe - xs - 4, 18); ctx.clip();
    ctx.fillStyle = hot ? '#000' : 'rgba(255,255,255,1)'; ctx.font = `600 9px ${FONT}`; ctx.textAlign = 'left'; ctx.fillText(e.title, xs + 4, 61);
    ctx.restore();
  }
  rect(ctx, X(now) - 1, 44, 2, 30, 1);
  // Four counts
  const tiles: [string, string, number, string][] = [
    ['VIP', '★', b.counts.vip, b.items.filter(i => i.kind === 'vip').slice(0, 2).map(i => i.who).join(' · ')],
    ['Mail', '✉', b.counts.mail, `${b.items.filter(i => i.kind === 'mail' && i.unread).length} unread`],
    ['Texts', '◉', b.counts.texts, b.items.filter(i => i.kind === 'text').slice(0, 2).map(i => i.who).join(' · ')],
    ['Missed', '☎', b.counts.calls, b.items.filter(i => i.kind === 'call').slice(0, 1).map(i => `${i.who} · ${fmtTime(i.at)}`).join('')],
  ];
  const tw = 126, gap = 12, ty = 106, th = 150;
  tiles.forEach(([name, g, n, sub], k) => {
    const x = 18 + k * (tw + gap);
    const hot = k === 0 && n > 0;
    box(ctx, x, ty, tw, th, hot ? 1 : 0.35, 9, hot ? 0.08 : 0);
    txt(ctx, name, x + 12, ty + 24, 12, 0.8, 'left', 600);
    txt(ctx, g, x + tw - 12, ty + 25, 13, 0.7, 'right');
    txt(ctx, String(n), x + 10, ty + 98, 60, n > 0 ? 1 : 0.35, 'left', 600);
    txt(ctx, sub, x + 12, ty + 132, 10, 0.6, 'left', 500, tw - 24);
  });
  footer(ctx, 'swipe  next card', '1 / 4', 'tap  open');
}

function cardToday(ctx: CanvasRenderingContext2D, b: Briefing, v: View) {
  const ev = b.events;
  const t = timed(ev);
  const fw = freeWindow(ev, b.now);
  txt(ctx, 'Today', 18, 30, 17, 1, 'left', 600);
  txt(ctx, `${t.length} meeting${t.length === 1 ? '' : 's'}${fw ? `  ·  free ${fmtTime(fw[0])}–${fmtTime(fw[1])}` : ''}`, W - 18, 30, 11, 0.6, 'right');
  rect(ctx, 18, 40, W - 36, 1, 0.3);
  if (!ev.length) txt(ctx, b.linked.google ? 'Nothing on the calendar' : 'Link Google to see your calendar', W / 2, 150, 14, 0.5, 'center');
  const rowH = 36, top = 48, maxRows = 6;
  const first = Math.max(0, Math.min(v.cursor - 2, ev.length - maxRows));
  ev.slice(first, first + maxRows).forEach((e, k) => {
    const i = first + k, y = top + k * rowH, sel = i === v.cursor;
    const past = !e.allDay && e.end < b.now, live = !e.allDay && e.start <= b.now && e.end > b.now;
    if (sel) { ctx.fillStyle = 'rgba(255,255,255,0.16)'; ctx.beginPath(); ctx.roundRect(10, y, W - 20, rowH - 3, 6); ctx.fill(); }
    const op = past ? 0.4 : 1;
    txt(ctx, e.allDay ? 'all day' : fmtTime(e.start), 64, y + 22, e.allDay ? 10 : 14, op * 0.95, 'right', 600);
    rect(ctx, 74, y + 6, 2, rowH - 15, live ? 1 : 0.3 * op);
    txt(ctx, e.title, 88, y + 16, 13, op, 'left', 600, 330);
    const sub = [e.where, e.who.length ? `${e.who.length} ${e.who.length === 1 ? 'guest' : 'guests'}` : '', e.cal].filter(Boolean).join(' · ');
    txt(ctx, sub, 88, y + 29, 9, 0.55 * op, 'left', 500, 330);
    if (!e.allDay) txt(ctx, durText(e), W - 20, y + 22, 11, 0.6 * op, 'right');
  });
  footer(ctx, 'swipe  move', '2 / 4', 'tap  next card    menu › read  details');
}
function durText(e: CalEvent) { const m = Math.round((e.end - e.start) / 60_000); return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60}` : ''}` : `${m} min`; }

function cardNeeds(ctx: CanvasRenderingContext2D, b: Briefing, v: View) {
  const items = b.items;
  const kept = items.filter(i => i.kept).length;
  txt(ctx, 'Needs you', 18, 30, 17, 1, 'left', 600);
  txt(ctx, `${kept} kept for today`, W - 18, 30, 11, 0.6, 'right');
  rect(ctx, 18, 40, W - 36, 1, 0.3);
  if (!items.length) txt(ctx, b.linked.google ? 'Inbox zero' : 'Link Google on the phone page', W / 2, 150, 14, 0.5, 'center');
  const rowH = 30, top = 48, maxRows = 7;
  const first = Math.max(0, Math.min(v.cursor - 3, items.length - maxRows));
  items.slice(first, first + maxRows).forEach((it, k) => {
    const i = first + k, y = top + k * rowH, sel = i === v.cursor;
    if (sel) { ctx.fillStyle = 'rgba(255,255,255,0.16)'; ctx.beginPath(); ctx.roundRect(10, y, W - 20, rowH - 3, 6); ctx.fill(); }
    const op = sel || it.kept ? 1 : (it.unread ? 0.8 : 0.55);
    txt(ctx, GLYPH[it.kind], 28, y + 20, 12, 0.8 * op, 'center');
    txt(ctx, it.who, 44, y + 20, 13, op, 'left', 600, 120);
    txt(ctx, it.what, 172, y + 20, 12, 0.85 * op, 'left', 500, 300);
    txt(ctx, ago(it.at, b.now), W - 48, y + 20, 10, 0.55 * op, 'right');
    txt(ctx, it.kept ? '●' : '○', W - 22, y + 20, 13, it.kept ? 1 : 0.35, 'center');
  });
  footer(ctx, 'swipe  move    tap  keep for today', '3 / 4', 'menu › read');
}

function cardDay(ctx: CanvasRenderingContext2D, b: Briefing) {
  const kept = b.items.filter(i => i.kept);
  const fw = freeWindow(b.events, b.now);
  txt(ctx, 'Your day', 18, 30, 17, 1, 'left', 600);
  rect(ctx, 18, 40, 356, 1, 0.3);
  const rows: { t: string; tOp: number; g: string; text: string }[] = [
    ...kept.map((i, k) => ({ t: k === 0 ? 'now' : '', tOp: k === 0 ? 1 : 0.4, g: GLYPH[i.kind], text: `${verb(i)} ${i.who}${i.kind === 'vip' || i.kind === 'mail' ? ' · ' + i.what : ''}` })),
    ...timed(b.events).filter(e => e.end > b.now).map(e => ({ t: fmtTime(e.start), tOp: 0.6, g: '▮', text: e.title })),
  ];
  if (!rows.length) txt(ctx, 'Nothing kept yet. Tap items on the previous card.', 18, 100, 12, 0.5);
  rows.slice(0, 7).forEach((r, k) => {
    const y = 64 + k * 29;
    txt(ctx, r.t, 18, y, 11, r.tOp, 'left', 600);
    txt(ctx, r.g, 68, y, 11, 0.8, 'center');
    txt(ctx, r.text, 82, y, 12, 1, 'left', 500, 290);
  });
  // Right column
  const first = kept[0];
  box(ctx, 392, 52, 166, 92, 0.4, 8);
  txt(ctx, 'first thing', 404, 70, 9, 0.6);
  txt(ctx, first ? `${verb(first)} ${first.who}` : 'nothing kept', 404, 92, 13, 1, 'left', 600, 142);
  txt(ctx, first ? (first.kind === 'vip' || first.kind === 'mail' ? first.what : first.what) : '', 404, 110, 10, 0.6, 'left', 500, 142);
  const nextEv = timed(b.events).find(e => e.start > b.now);
  if (first && nextEv) txt(ctx, `before ${fmtTime(nextEv.start)}`, 404, 130, 10, 0.5);
  box(ctx, 392, 156, 166, 76, 0.25, 8);
  txt(ctx, 'free', 404, 174, 9, 0.6);
  txt(ctx, fw ? `${fmtTime(fw[0])} – ${fmtTime(fw[1])}` : 'no gap today', 404, 200, 16, 1, 'left', 600);
  if (fw) txt(ctx, `${Math.round((fw[1] - fw[0]) / 60_000)} min`, 404, 220, 10, 0.5);
  footer(ctx, 'tap  back to start', '4 / 4', 'double tap  done');
}
function verb(i: Item) { return i.kind === 'call' ? 'Call back' : i.kind === 'text' ? 'Reply to' : 'Reply to'; }

export function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number, size: number): string[] {
  ctx.font = `500 ${size}px ${FONT}`;
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const t = line ? line + ' ' + word : word;
      if (ctx.measureText(t).width <= maxW) line = t;
      else { if (line) out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

function bodyView(ctx: CanvasRenderingContext2D, b: Briefing, v: View) {
  const body = v.body!;
  txt(ctx, body.who, 18, 28, 12, 0.65);
  txt(ctx, `${ago(body.at, b.now)} ago`, W - 18, 28, 11, 0.55, 'right');
  txt(ctx, body.what, 18, 52, 16, 1, 'left', 600, W - 36);
  rect(ctx, 18, 62, W - 36, 1, 0.3);
  const lines = wrapLines(ctx, body.text, W - 36, 13);
  const perPage = 9, first = Math.max(0, Math.min(v.bodyScroll, Math.max(0, lines.length - perPage)));
  lines.slice(first, first + perPage).forEach((l, k) => txt(ctx, l, 18, 84 + k * 20, 13, 0.9));
  if (lines.length > perPage) {
    const trackH = 170, y0 = 78;
    rect(ctx, W - 10, y0, 2, trackH, 0.2);
    rect(ctx, W - 10, y0 + trackH * first / lines.length, 2, Math.max(10, trackH * perPage / lines.length), 0.8);
  }
  footer(ctx, 'swipe  scroll', '', 'tap  back');
}

export function drawScene(c: HTMLCanvasElement, b: Briefing, v: View) {
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  if (v.body) bodyView(ctx, b, v);
  else if (v.card === 0) cardGlance(ctx, b);
  else if (v.card === 1) cardToday(ctx, b, v);
  else if (v.card === 2) cardNeeds(ctx, b, v);
  else cardDay(ctx, b);
  if (v.loading) { rect(ctx, 0, 270, W, 18, 1); txt(ctx, v.loading, W / 2, 283, 10, 1, 'center'); ctx.globalCompositeOperation = 'difference'; ctx.globalCompositeOperation = 'source-over'; }
}

/** Split the scene into quadrants; return PNGs for those whose pixels changed since the last call. */
export function createTiler() {
  const parts = [0, 1, 2, 3].map(() => { const c = document.createElement('canvas'); c.width = TW; c.height = TH; return c; });
  const last: (string | null)[] = [null, null, null, null];
  function sig(c: HTMLCanvasElement): string {
    const d = c.getContext('2d')!.getImageData(0, 0, TW, TH).data;
    let h1 = 0x811c9dc5, h2 = 0;
    for (let i = 0; i < d.length; i += 4) { h1 = Math.imul(h1 ^ d[i], 16777619) >>> 0; h2 = (h2 + d[i] * (1 + (i % 7))) >>> 0; }
    return `${h1}:${h2}`;
  }
  return {
    reset() { last.fill(null); },
    async changed(scene: HTMLCanvasElement): Promise<{ idx: number; png: Uint8Array }[]> {
      const out: { idx: number; png: Uint8Array }[] = [];
      for (let i = 0; i < 4; i++) {
        const x = (i % 2) * TW, y = Math.floor(i / 2) * TH;
        const ctx = parts[i].getContext('2d')!;
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, TW, TH);
        ctx.drawImage(scene, x, y, TW, TH, 0, 0, TW, TH);
        const s = sig(parts[i]);
        if (s === last[i]) continue;
        last[i] = s;
        out.push({ idx: i, png: await toPng(parts[i]) });
      }
      return out;
    },
  };
}

export function toPng(c: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => c.toBlob(b => b ? b.arrayBuffer().then(buf => resolve(new Uint8Array(buf)), reject) : reject(new Error('toBlob failed')), 'image/png'));
}
