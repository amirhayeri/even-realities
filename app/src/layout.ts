// The glasses page: two image tiles on top, four text lines below.
// Firmware has one font, 27px lines, no alignment, so left/right pairs are
// padded with spaces measured in pixels with @evenrealities/pretext.

import { getTextWidth } from '@evenrealities/pretext';
import { zoneOf, type HudState } from './model';

export const SCREEN_W = 576;
export const LINE_H = 27;
export const TEXT_X = 12;
export const TEXT_W = SCREEN_W - 2 * TEXT_X;

export const IDS = { hr: 1, act: 2, l1: 3, l2: 4, l3: 5, l4: 6 } as const;
export const NAMES = { hr: 'tile-hr', act: 'tile-act', l1: 'line-1', l2: 'line-2', l3: 'line-3', l4: 'line-4' } as const;
export const MENU = { pause: 1, resume: 2, skip: 3, exit: 4 } as const;

export function pageSpec() {
  const line = (id: number, name: string, row: number, capture = 0) => ({
    containerID: id, containerName: name,
    xPosition: TEXT_X, yPosition: 150 + row * LINE_H, width: TEXT_W, height: LINE_H + 3,
    content: ' ', isEventCapture: capture, zOrderIndex: id, paddingLength: 0, borderWidth: 0,
  });
  return {
    containerTotalNum: 6,
    imageObject: [
      { containerID: IDS.hr, containerName: NAMES.hr, xPosition: 0, yPosition: 0, width: 288, height: 144, zOrderIndex: IDS.hr },
      { containerID: IDS.act, containerName: NAMES.act, xPosition: 288, yPosition: 0, width: 288, height: 144, zOrderIndex: IDS.act },
    ],
    textObject: [
      line(IDS.l1, NAMES.l1, 0, 1),
      line(IDS.l2, NAMES.l2, 1),
      line(IDS.l3, NAMES.l3, 2),
      line(IDS.l4, NAMES.l4, 3),
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

function fmtMs(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function workoutLines(s: HudState): [string, string, string, string] {
  const w = s.workout, sp = s.spotify, z = zoneOf(w.hr, w.hrMax);
  return [
    spread(`Zone ${z.n}  ${z.name}`, `${Math.round(w.hr)} bpm  ·  ${Math.round(z.pct * 100)}% max`),
    spread(`${sp.playing ? '▶' : '▮▮'}  ${sp.title} — ${sp.artist}`, `${fmtMs(sp.positionMs)} / ${fmtMs(sp.durationMs)}`),
    spread(sp.next ? `Next  ${sp.next.title} — ${sp.next.artist}` : 'Queue empty', `Move ${s.rings.move}/${s.rings.moveGoal}`),
    spread(`tap  ${w.paused ? 'resume' : 'pause'}`, 'tap+hold  menu'),
  ];
}

export function ambientLines(s: HudState): [string, string, string, string] {
  const d = new Date(s.now);
  const hhmm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  const g = s.glucose ? `${s.glucose.mmol.toFixed(1)} ${({ up: '↗', flat: '→', down: '↘', doubleUp: '⇈', doubleDown: '⇊' })[s.glucose.trend]}` : '';
  return [' ', ' ', ' ', spread(`${hhmm}   ${g}`, `${Math.round(s.workout.hr)} bpm   ${s.battery}%`)];
}
