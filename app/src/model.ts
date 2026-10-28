// Data model for the HUD. One JSON shape, whether it comes from the mock
// simulator below or from the real endpoint (VITE_HUD_ENDPOINT).

export type Trend = 'up' | 'flat' | 'down' | 'doubleUp' | 'doubleDown';

export interface HudState {
  now: number;                       // ms epoch
  workout: {
    active: boolean;
    paused: boolean;
    type: string;                    // 'run' | 'walk' | 'strength' | ...
    startedAt: number;               // ms epoch
    elapsedSec: number;
    hr: number;
    hrMax: number;
    steps: number;
    activeKcal: number;
    distanceM: number;
    inZoneSec: number;
    zoneGoalSec: number;
  };
  spotify: {
    playing: boolean;
    title: string;
    artist: string;
    positionMs: number;
    durationMs: number;
    next?: { title: string; artist: string };
    queueCount: number;
  };
  rings: { move: number; moveGoal: number; exercise: number; exerciseGoal: number; stand: number; standGoal: number };
  glucose?: { mmol: number; trend: Trend; delta15: number; pred30?: number };
  battery: number | null;
}

export interface Model {
  state: HudState;
  tick(dtMs: number): void;
  togglePause(): void;
  skipTrack(): void;
}

export function zoneOf(hr: number, hrMax: number) {
  const pct = hr / hrMax;
  const n = pct < 0.6 ? 1 : pct < 0.7 ? 2 : pct < 0.8 ? 3 : pct < 0.9 ? 4 : 5;
  const names = ['', 'Recovery', 'Fat burn', 'Aerobic', 'Threshold', 'Max'];
  const lo = Math.round(hrMax * [0, 0.5, 0.6, 0.7, 0.8, 0.9][n]);
  const hi = Math.round(hrMax * [0, 0.6, 0.7, 0.8, 0.9, 1.0][n]);
  const start = [0, 0.5, 0.6, 0.7, 0.8, 0.9][n];
  const within = Math.max(0, Math.min(1, (pct - start) / 0.1));
  return { n, name: names[n], lo, hi, pct, within };
}

// ---------- Mock: a believable gym session that moves on its own ----------

const TRACKS = [
  { title: 'Nightcall', artist: 'Kavinsky', durationMs: 258000 },
  { title: 'Blinding Lights', artist: 'The Weeknd', durationMs: 200000 },
  { title: 'Midnight City', artist: 'M83', durationMs: 244000 },
  { title: 'Genesis', artist: 'Justice', durationMs: 234000 },
];

export function createMockModel(seed = Date.now()): Model {
  let rnd = seed % 2147483647;
  const rand = () => (rnd = (rnd * 48271) % 2147483647) / 2147483647;
  let trackIdx = 0;
  const startedAt = Date.now() - 24 * 60 * 1000 - 12 * 1000;

  const state: HudState = {
    now: Date.now(),
    workout: {
      active: true, paused: false, type: 'run', startedAt,
      elapsedSec: 24 * 60 + 12, hr: 148, hrMax: 185,
      steps: 3412, activeKcal: 286, distanceM: 3140, inZoneSec: 870, zoneGoalSec: 1800,
    },
    spotify: {
      playing: true, title: TRACKS[0].title, artist: TRACKS[0].artist,
      positionMs: 134000, durationMs: TRACKS[0].durationMs,
      next: { title: TRACKS[1].title, artist: TRACKS[1].artist }, queueCount: 3,
    },
    rings: { move: 310, moveGoal: 600, exercise: 24, exerciseGoal: 30, stand: 9, standGoal: 12 },
    glucose: { mmol: 6.4, trend: 'down', delta15: -0.4, pred30: 5.6 },
    battery: 82,
  };

  let hrTarget = 148;
  let sinceTargetChange = 0;

  return {
    state,
    tick(dtMs) {
      const dt = dtMs / 1000;
      state.now = Date.now();
      const w = state.workout;
      const s = state.spotify;

      if (s.playing) {
        s.positionMs += dtMs;
        if (s.positionMs >= s.durationMs) this.skipTrack();
      }

      if (!w.active || w.paused) return;
      w.elapsedSec += dt;

      // HR random walk toward a slowly moving target
      sinceTargetChange += dt;
      if (sinceTargetChange > 20) { hrTarget = 135 + Math.round(rand() * 30); sinceTargetChange = 0; }
      w.hr += (hrTarget - w.hr) * 0.05 * dt + (rand() - 0.5) * 1.5;
      w.hr = Math.round(Math.max(90, Math.min(185, w.hr)) * 10) / 10;

      const z = zoneOf(w.hr, w.hrMax);
      if (z.n >= 3) w.inZoneSec += dt;

      const cadence = 162 + (rand() - 0.5) * 6;        // steps per minute
      w.steps += cadence / 60 * dt;
      w.distanceM += (cadence / 60 * dt) * 0.92;
      w.activeKcal += (w.hr / 60) * 0.0012 * 70 * dt;
      state.rings.move = 310 + Math.round(w.activeKcal - 286);
      state.rings.exercise = 24 + Math.floor((w.elapsedSec - 1452) / 60);
    },
    togglePause() {
      state.workout.paused = !state.workout.paused;
      state.spotify.playing = !state.workout.paused;
    },
    skipTrack() {
      trackIdx = (trackIdx + 1) % TRACKS.length;
      const t = TRACKS[trackIdx];
      const n = TRACKS[(trackIdx + 1) % TRACKS.length];
      const s = state.spotify;
      s.title = t.title; s.artist = t.artist; s.durationMs = t.durationMs; s.positionMs = 0;
      s.next = { title: n.title, artist: n.artist };
      s.queueCount = Math.max(0, s.queueCount - 1) || 3;
    },
  };
}

// ---------- Remote: poll your endpoint, fall back to mock between polls ----------

export function createRemoteModel(base: string, token: string, pollMs = 2000): Model {
  const root = base.replace(/\/+$/, '');
  const headers = { Authorization: `Bearer ${token}` };
  const mock = createMockModel();
  const state: HudState = mock.state;
  state.workout.active = false;                       // Ambient until the endpoint says otherwise
  let lastFetch = 0;
  let healthy = false;
  let lastRemoteAt = 0;
  const model: Model = {
    state,
    tick(dtMs) {
      // Between polls, advance only what moves deterministically.
      state.now = Date.now();
      if (state.workout.active && !state.workout.paused) state.workout.elapsedSec += dtMs / 1000;
      if (state.spotify.playing) state.spotify.positionMs = Math.min(state.spotify.durationMs, state.spotify.positionMs + dtMs);
      const t = Date.now();
      if (t - lastFetch < pollMs) return;
      lastFetch = t;
      fetch(`${root}/state`, { cache: 'no-store', headers })
        .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
        .then((remote: Partial<HudState>) => {
          healthy = true; lastRemoteAt = Date.now();
          const { now: _n, ...rest } = remote as any;
          for (const k of Object.keys(rest)) if (rest[k] === null || rest[k] === undefined) delete rest[k];   // keep local values the endpoint doesn't know
          Object.assign(state, rest, { now: Date.now() });
        })
        .catch(err => { if (healthy) console.warn('[hud] endpoint lost', err); healthy = false; if (Date.now() - lastRemoteAt > 30_000) state.workout.active = false; });
    },
    togglePause() {
      state.workout.paused = !state.workout.paused;
      state.spotify.playing = !state.workout.paused;
      fetch(`${root}/pause`, { method: 'POST', headers }).catch(() => {});
    },
    skipTrack() {
      fetch(`${root}/skip`, { method: 'POST', headers }).catch(() => {});
    },
  };
  return model;
}
