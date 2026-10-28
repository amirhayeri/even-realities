// Tile renderer. Draws the two 288x144 image containers on a canvas in
// greyscale (the glasses show 16 grey levels), returns PNG bytes for
// updateImageRawData. The same drawing feeds the browser preview.

import { zoneOf, type HudState } from './model';

export const TILE_W = 288;
export const TILE_H = 144;

const GLYPH: Record<string, string[]> = {
  '0': ['01110','10001','10011','10101','11001','10001','01110'],
  '1': ['00100','01100','00100','00100','00100','00100','01110'],
  '2': ['01110','10001','00001','00010','00100','01000','11111'],
  '3': ['11111','00010','00100','00010','00001','10001','01110'],
  '4': ['00010','00110','01010','10010','11111','00010','00010'],
  '5': ['11111','10000','11110','00001','00001','10001','01110'],
  '6': ['00110','01000','10000','11110','10001','10001','01110'],
  '7': ['11111','00001','00010','00100','01000','01000','01000'],
  '8': ['01110','10001','10001','01110','10001','10001','01110'],
  '9': ['01110','10001','10001','01111','00001','00010','01100'],
  ':': ['00000','00100','00000','00000','00000','00100','00000'],
  ',': ['00000','00000','00000','00000','00000','00100','01000'],
  'Z': ['11111','00001','00010','00100','01000','10000','11111'],
};

function lvl(op: number) { return `rgba(255,255,255,${op})`; }

/** Dot-matrix text. cell = pitch between dots, dot = dot size. Returns drawn width. */
export function dots(ctx: CanvasRenderingContext2D, text: string, x0: number, y0: number, cell: number, dot: number, op = 1): number {
  ctx.fillStyle = lvl(op);
  let cx = x0;
  for (const ch of text) {
    const g = GLYPH[ch] ?? GLYPH['0'];
    const narrow = ch === ':' || ch === ',';
    const cols = narrow ? 2 : 5;
    for (let r = 0; r < 7; r++) for (let c = 0; c < cols; c++) {
      const bit = narrow ? g[r][2 + c] : g[r][c];
      if (bit === '1') ctx.fillRect(cx + c * cell, y0 + r * cell, dot, dot);
    }
    cx += cols * cell + cell;
  }
  return cx - cell - x0;
}

export function measureDots(text: string, cell: number): number {
  let w = 0;
  for (const ch of text) w += ((ch === ':' || ch === ',') ? 2 : 5) * cell + cell;
  return w - cell;
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, align: CanvasTextAlign, size = 11, op = 0.5) {
  ctx.fillStyle = lvl(op);
  ctx.font = `500 ${size}px system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y);
}

export function newTile(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = TILE_W; c.height = TILE_H;
  return c;
}

export function drawHrTile(c: HTMLCanvasElement, hr: number, hrMax: number) {
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, TILE_W, TILE_H);
  const z = zoneOf(hr, hrMax);
  const hrText = String(Math.round(hr));
  const w = dots(ctx, hrText, 12, 10, 15, 12);
  dots(ctx, 'Z' + z.n, 12 + w + 18, 10 + 7 * 15 - 7 * 10, 10, 8, 0.9);
  for (let i = 0; i < 5; i++) {
    const active = i + 1 === z.n;
    ctx.fillStyle = lvl(active ? 1 : (i + 1 < z.n ? 0.45 : 0.18));
    ctx.fillRect(12 + i * 53, active ? 106 : 112, 50, active ? 20 : 12);
  }
  ctx.fillStyle = lvl(1);
  ctx.fillRect(12 + (z.n - 1) * 53 + Math.round(z.within * 48), 104, 2, 24);
  label(ctx, 'Z1', 12, 140, 'left', 11, 0.45);
  label(ctx, 'Z5', 276, 140, 'right', 11, 0.45);
  label(ctx, `${z.lo}–${z.hi} BPM`, 144, 140, 'center', 11, 0.6);
}

export function drawActivityTile(c: HTMLCanvasElement, s: HudState, blinkOn: boolean) {
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, TILE_W, TILE_H);
  const w = s.workout;
  const pad = (n: number) => (n < 10 ? '0' : '') + n;
  const e = Math.floor(w.elapsedSec);
  const h = Math.floor(e / 3600), m = Math.floor((e % 3600) / 60), sec = e % 60;
  const timer = h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
  const running = w.active && !w.paused;
  dots(ctx, timer, 12, 14, h > 0 ? 6 : 7, h > 0 ? 5 : 6, running ? 1 : (blinkOn ? 0.5 : 0.2));
  label(ctx, running ? 'ELAPSED' : 'PAUSED', 276, 20, 'right', 11, 0.5);

  dots(ctx, Math.round(w.steps).toLocaleString('en-US'), 12, 70, 4, 3, 0.9);
  label(ctx, 'STEPS', 12, 112, 'left', 11, 0.5);

  label(ctx, String(Math.round(w.activeKcal)), 138, 92, 'left', 18, 1);
  label(ctx, 'KCAL', 138, 112, 'left', 11, 0.5);

  const km = w.distanceM / 1000;
  const paceSec = km > 0.05 ? Math.round(w.elapsedSec / km) : 0;
  const pace = paceSec > 0 ? `${Math.floor(paceSec / 60)}:${pad(paceSec % 60)}` : '--:--';
  label(ctx, km.toFixed(2), 276, 92, 'right', 18, 1);
  label(ctx, `KM · ${pace}/KM`, 276, 112, 'right', 11, 0.5);

  ctx.fillStyle = lvl(0.18); ctx.fillRect(12, 124, 264, 2);
  ctx.fillStyle = lvl(0.8); ctx.fillRect(12, 124, Math.round(264 * Math.min(1, w.inZoneSec / w.zoneGoalSec)), 2);
  const iz = Math.floor(w.inZoneSec);
  label(ctx, `IN ZONE ${Math.floor(iz / 60)}:${pad(iz % 60)}`, 12, 140, 'left', 11, 0.45);
  label(ctx, `GOAL ${Math.floor(w.zoneGoalSec / 60)}:00`, 276, 140, 'right', 11, 0.45);
}

export function drawBlankTile(c: HTMLCanvasElement) {
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, TILE_W, TILE_H);
}

export function toPng(c: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    c.toBlob(b => {
      if (!b) return reject(new Error('toBlob failed'));
      b.arrayBuffer().then(buf => resolve(new Uint8Array(buf)), reject);
    }, 'image/png');
  });
}
