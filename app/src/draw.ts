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

// Small pictograms, '#' = lit. Drawn at 1px per cell unless scaled.
const ICON: Record<string, string[]> = {
  heart: ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'],
  clock: ['..#####..', '.#.....#.', '#...#...#', '#...#...#', '#...##..#', '#.......#', '#.......#', '.#.....#.', '..#####..'],
  pause: ['##.##', '##.##', '##.##', '##.##', '##.##', '##.##', '##.##'],
  flame: ['....#....', '...##....', '...###...', '..####...', '..#####..', '.#######.', '.#######.', '..#####..', '...###...'],
  steps: ['.##......', '####.....', '####..##.', '.##..####', '.....####', '.##...##.', '####.....', '####..##.', '.##..####'],
  route: ['......###', '.....#..#', '......##.', '....#....', '...#.....', '..#......', '.##......', '###......', '.#.......'],
  flag:  ['#....', '####.', '#####', '####.', '#....', '#....', '#....'],
  play:  ['#....', '###..', '#####', '###..', '#....'],
};

export function icon(ctx: CanvasRenderingContext2D, name: string, x: number, y: number, op = 0.6, scale = 1) {
  const rows = ICON[name]; if (!rows) return;
  ctx.fillStyle = lvl(op);
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++)
    if (rows[r][c] === '#') ctx.fillRect(x + c * scale, y + r * scale, scale, scale);
}

/** Arc of a ring, clockwise from 12 o'clock, pct 0..1, 1px cells. */
export function ring(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, thick: number, pct: number, op: number) {
  ctx.fillStyle = lvl(op);
  const total = Math.max(0, Math.min(1, pct)) * 360;
  for (let a = 0; a <= total; a += 2) {
    const rad = (a - 90) * Math.PI / 180;
    for (let t = 0; t < thick; t++) ctx.fillRect(Math.round(cx + (r - t) * Math.cos(rad)), Math.round(cy + (r - t) * Math.sin(rad)), 1, 1);
  }
}

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
  const w = measureDots(hrText, 14);
  dots(ctx, hrText, Math.round((288 - w) / 2), 4, 14, 11);          // rows 4..102
  // Zone bar sits lower, with Z1..Z5 above each segment; the active zone is
  // taller, brightest, and carries a marker for where in the zone you are.
  for (let i = 0; i < 5; i++) {
    const active = i + 1 === z.n;
    const x = 12 + i * 53;
    label(ctx, 'Z' + (i + 1), x + 25, 116, 'center', 10, active ? 1 : 0.4);
    ctx.fillStyle = lvl(active ? 1 : (i + 1 < z.n ? 0.45 : 0.18));
    ctx.fillRect(x, active ? 121 : 126, 50, active ? 16 : 8);
  }
  ctx.fillStyle = lvl(1);
  ctx.fillRect(12 + (z.n - 1) * 53 + Math.round(z.within * 48), 119, 2, 20);
  icon(ctx, 'heart', 274, 6, 0.6, 1);
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
  icon(ctx, running ? 'clock' : 'pause', 12, 16, 0.6, 1);
  dots(ctx, timer, 30, 12, h > 0 ? 6 : 7, h > 0 ? 5 : 6, running ? 1 : (blinkOn ? 0.5 : 0.2));

  // Activity row: glyph + number, three columns.
  icon(ctx, 'steps', 12, 78, 0.6, 1);
  label(ctx, Math.round(w.steps).toLocaleString('en-US'), 26, 88, 'left', 18, 1);

  icon(ctx, 'flame', 118, 78, 0.6, 1);
  label(ctx, String(Math.round(w.activeKcal)), 132, 88, 'left', 18, 1);

  const km = w.distanceM / 1000;
  const paceSec = km > 0.05 ? Math.round(w.elapsedSec / km) : 0;
  const pace = paceSec > 0 ? `${Math.floor(paceSec / 60)}:${pad(paceSec % 60)}` : '--:--';
  icon(ctx, 'route', 196, 78, 0.6, 1);
  label(ctx, km.toFixed(2), 210, 88, 'left', 18, 1);
  label(ctx, pace, 276, 106, 'right', 11, 0.5);

  // Time-in-zone bar with a goal flag; no words.
  ctx.fillStyle = lvl(0.18); ctx.fillRect(12, 128, 214, 2);
  ctx.fillStyle = lvl(0.8); ctx.fillRect(12, 128, Math.round(214 * Math.min(1, w.inZoneSec / w.zoneGoalSec)), 2);
  icon(ctx, 'flag', 228, 124, 0.45, 1);

  // Move ring, the one ring that matters mid-workout.
  ring(ctx, 262, 128, 11, 4, 1, 0.18);
  ring(ctx, 262, 128, 11, 4, s.rings.move / s.rings.moveGoal, 1);
}

/** 288x20 strip: play/pause glyph and a track progress bar. */
export function drawSongStrip(c: HTMLCanvasElement, s: HudState) {
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height);
  const sp = s.workout.paused ? 'pause' : 'play';
  icon(ctx, sp, 0, 6, 0.7, 1);
  const x0 = 12, w = c.width - 12;
  ctx.fillStyle = lvl(0.18); ctx.fillRect(x0, 9, w, 2);
  const pct = s.spotify.durationMs > 0 ? Math.min(1, s.spotify.positionMs / s.spotify.durationMs) : 0;
  ctx.fillStyle = lvl(0.9); ctx.fillRect(x0, 9, Math.round(w * pct), 2);
  ctx.fillStyle = lvl(1); ctx.fillRect(x0 + Math.round(w * pct) - 1, 6, 3, 8);
}

export function newStrip(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 288; c.height = 20;
  return c;
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
