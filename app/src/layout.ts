// The glasses page: two image tiles on top, four text lines below.
// Firmware has one font, 27px lines, no alignment, so left/right pairs are
// padded with spaces measured in pixels with @evenrealities/pretext.

import { getTextWidth } from '@evenrealities/pretext';
import { type HudState } from './model';

export const SCREEN_W = 576;
export const LINE_H = 27;
export const TEXT_X = 12;
export const TEXT_W = SCREEN_W - 2 * TEXT_X;

export const IDS = { hr: 1, act: 2, song: 3, l1: 4, l2: 5 } as const;
export const NAMES = { hr: 'tile-hr', act: 'tile-act', song: 'strip-song', l1: 'line-1', l2: 'line-2' } as const;
/** Two text rows under the tiles, then a 288x20 song-progress strip. */
export const ROW_Y = [158, 198] as const;
export const STRIP = { x: 144, y: 244, w: 288, h: 20 } as const;
export const DIM = 3; // textColor 0..4 for the secondary row
export const MENU = { pause: 1, resume: 2, skip: 3, exit: 4 } as const;

export function pageSpec() {
  const line = (id: number, name: string, row: number, capture = 0) => ({
    containerID: id, containerName: name,
    xPosition: TEXT_X, yPosition: ROW_Y[row], width: TEXT_W, height: LINE_H + 3,
    content: ' ', isEventCapture: capture, zOrderIndex: id, paddingLength: 0, borderWidth: 0,
  });
  return {
    containerTotalNum: 5,
    imageObject: [
      { containerID: IDS.hr, containerName: NAMES.hr, xPosition: 0, yPosition: 0, width: 288, height: 144, zOrderIndex: IDS.hr },
      { containerID: IDS.act, containerName: NAMES.act, xPosition: 288, yPosition: 0, width: 288, height: 144, zOrderIndex: IDS.act },
      { containerID: IDS.song, containerName: NAMES.song, xPosition: STRIP.x, yPosition: STRIP.y, width: STRIP.w, height: STRIP.h, zOrderIndex: IDS.song },
    ],
    textObject: [
      line(IDS.l1, NAMES.l1, 0, 1),
      line(IDS.l2, NAMES.l2, 1),
    ],
    menuObject: {
      menuItems: [
        { itemID: MENU.pause, itemName: 'Pause' },
        { itemID: MENU.resume, itemName: 'Resume' },
        { itemID: MENU.skip, itemName: 'Skip track' },
        { itemID: MENU.exit, itemName: 'Exit' },
      ],
    },
  };
}

const SPACE_W = Math.max(1, getTextWidth(' '));

/** `left` at the start, `right` at the end of one line, padded with spaces. */
export function spread(left: string, right: string, widthPx = TEXT_W): string {
  let l = left, r = right;
  while (getTextWidth(l) + getTextWidth(r) + SPACE_W > widthPx && l.length > 1) l = l.slice(0, -2) + '…';
  const gap = widthPx - getTextWidth(l) - getTextWidth(r);
  const n = Math.max(1, Math.floor(gap / SPACE_W));
  return l + ' '.repeat(n) + r;
}

/** Everything numeric lives in the tiles; the text rows are just the music. */
export function workoutLines(s: HudState): [string, string] {
  const sp = s.spotify;
  return [
    `${sp.title} — ${sp.artist}`,
    sp.next ? `Next  ${sp.next.title} — ${sp.next.artist}` : 'Queue empty',
  ];
}

export function ambientLines(s: HudState): [string, string] {
  const d = new Date(s.now);
  const hhmm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  const g = s.glucose ? `${s.glucose.mmol.toFixed(1)} ${({ up: '↗', flat: '→', down: '↘', doubleUp: '⇈', doubleDown: '⇊' })[s.glucose.trend]}` : '';
  return [' ', spread(`${hhmm}   ${g}`, `${Math.round(s.workout.hr)} bpm   ${s.battery}%`)];
}
