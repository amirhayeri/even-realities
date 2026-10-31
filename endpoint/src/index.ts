// HUD endpoint. Holds the latest workout + health state in KV, mixes in
// Spotify, weather and glucose on each read, and serves it to the glasses.
//
//   GET  /state                    glasses poll, Bearer HUD_TOKEN
//   POST /workout/start {type}     iPhone automation "when workout starts"
//   POST /workout/end              iPhone automation "when workout ends"
//   POST /health {...}             Health Auto Export, or the watch app
//   POST /pause  /skip             glasses gestures
//   GET  /spotify/login            one-time browser visit to link Spotify
//   GET  /spotify/callback         OAuth return
//   GET  /health                   liveness, no auth

import * as spotify from './spotify';

export interface Env extends spotify.SpotifyEnv {
  HUD_TOKEN: string;
  WEATHER_LAT: string;
  WEATHER_LON: string;
  WEATHER_CITY: string;
  HR_MAX: string;
  ZONE_GOAL_SEC: string;
  GLUCOSE_URL?: string;
  /** Minimum ms between KV writes from /health. Free KV allows 1,000 writes/day; 10000 fits ~2.5 h of workout. */
  KV_WRITE_MIN_MS?: string;
}

interface Workout {
  active: boolean;
  paused: boolean;
  type: string;
  startedAt: number;
  pausedAt?: number;
  pausedTotalMs: number;
  hr: number;
  hrAt: number;
  steps: number;
  activeKcal: number;
  distanceM: number;
  inZoneSec: number;
  inZoneAt: number;
  /** When the workout record was last written to KV. */
  writtenAt?: number;
}

interface _Unused {

interface Workout {
  active: boolean;
  paused: boolean;
  type: string;
  startedAt: number;
  pausedAt?: number;
  pausedTotalMs: number;
  hr: number;
  hrAt: number;
  steps: number;
  activeKcal: number;
  distanceM: number;
  inZoneSec: number;
  inZoneAt: number;
}

interface Rings { move: number; moveGoal: number; exercise: number; exerciseGoal: number; stand: number; standGoal: number }

const W_KEY = 'workout';
const R_KEY = 'rings';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
};

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS } });
const text = (s: string, status = 200) => new Response(s, { status, headers: { 'Content-Type': 'text/plain', ...CORS } });

async function hmac(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function authed(req: Request, env: Env): boolean {
  const h = req.headers.get('Authorization') ?? '';
  const q = new URL(req.url).searchParams.get('token') ?? '';
  return !!env.HUD_TOKEN && (h === `Bearer ${env.HUD_TOKEN}` || q === env.HUD_TOKEN);
}

function defaultWorkout(): Workout {
  return { active: false, paused: false, type: '', startedAt: 0, pausedTotalMs: 0, hr: 0, hrAt: 0, steps: 0, activeKcal: 0, distanceM: 0, inZoneSec: 0, inZoneAt: 0 };
}

const MAX_WORKOUT_MS = 6 * 60 * 60 * 1000;

/** A session nobody ended (phone died, automation missed) expires after six hours. */
async function getWorkout(env: Env): Promise<Workout> {
  const w = (await env.HUD.get(W_KEY, 'json') as Workout | null) ?? defaultWorkout();
  if (w.active && Date.now() - w.startedAt > MAX_WORKOUT_MS) { w.active = false; w.paused = false; }
  return w;
}
async function getRings(env: Env): Promise<Rings> {
  return (await env.HUD.get(R_KEY, 'json') as Rings | null) ?? { move: 0, moveGoal: 600, exercise: 0, exerciseGoal: 30, stand: 0, standGoal: 12 };
}

function zoneNum(hr: number, hrMax: number) {
  const p = hr / hrMax;
  return p < 0.6 ? 1 : p < 0.7 ? 2 : p < 0.8 ? 3 : p < 0.9 ? 4 : 5;
}

/** Credit time-in-zone between two HR samples while in zone 3+. */
function accrueZone(w: Workout, now: number, hrMax: number) {
  if (w.active && !w.paused && w.hrAt && zoneNum(w.hr, hrMax) >= 3) w.inZoneSec += Math.max(0, Math.min(now - w.hrAt, 60_000)) / 1000;
}

/** Accept the watch app's flat shape or Health Auto Export's metrics array. */
function parseHealth(body: any): Partial<Pick<Workout, 'hr' | 'steps' | 'activeKcal' | 'distanceM'>> & Partial<Rings> {
  const out: any = {};
  if (typeof body?.hr === 'number') out.hr = body.hr;
  for (const k of ['steps', 'activeKcal', 'distanceM', 'move', 'moveGoal', 'exercise', 'exerciseGoal', 'stand', 'standGoal']) {
    if (typeof body?.[k] === 'number') out[k] = body[k];
  }
  const metrics: any[] = body?.data?.metrics ?? [];
  const last = (name: string) => { const m = metrics.find(x => x.name === name); const d = m?.data; return d && d.length ? d[d.length - 1] : null; };
  const sum = (name: string) => { const m = metrics.find(x => x.name === name); return (m?.data ?? []).reduce((a: number, b: any) => a + (b.qty ?? 0), 0); };
  const hr = last('heart_rate'); if (hr) out.hr = hr.Avg ?? hr.avg ?? hr.qty;
  if (metrics.some(m => m.name === 'step_count')) out.steps = Math.round(sum('step_count'));
  if (metrics.some(m => m.name === 'active_energy')) out.activeKcal = Math.round(sum('active_energy'));
  if (metrics.some(m => m.name === 'walking_running_distance')) out.distanceM = Math.round(sum('walking_running_distance') * 1000);
  return out;
}

async function weather(env: Env): Promise<{ city: string; tempC: number; hi: number; lo: number; code: number } | null> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${env.WEATHER_LAT}&longitude=${env.WEATHER_LON}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1`;
  const cache = caches.default;
  const key = new Request(url);
  let r = await cache.match(key);
  if (!r) {
    r = await fetch(url);
    if (!r.ok) return null;
    r = new Response(r.body, r);
    r.headers.set('Cache-Control', 'max-age=600');
    await cache.put(key, r.clone());
  }
  const j = await r.json() as any;
  return { city: env.WEATHER_CITY, tempC: Math.round(j.current?.temperature_2m ?? 0), hi: Math.round(j.daily?.temperature_2m_max?.[0] ?? 0), lo: Math.round(j.daily?.temperature_2m_min?.[0] ?? 0), code: j.current?.weather_code ?? 0 };
}

async function glucose(env: Env): Promise<unknown | null> {
  if (!env.GLUCOSE_URL) return null;
  try {
    const r = await fetch(env.GLUCOSE_URL, { cf: { cacheTtl: 60 } } as any);
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (path === '/health' && req.method === 'GET') return text('ok');

    // ---- Spotify linking (browser, one time) ----
    // The OAuth state is a timestamp signed with HUD_TOKEN, so no storage is
    // needed between login and callback (KV is eventually consistent).
    if (path === '/spotify/login') {
      if (!authed(req, env)) return text('add ?token=HUD_TOKEN', 401);
      const ts = String(Date.now());
      const state = `${ts}.${await hmac(env.HUD_TOKEN, ts)}`;
      return Response.redirect(spotify.loginUrl(env, state), 302);
    }
    if (path === '/spotify/callback') {
      const code = url.searchParams.get('code'), state = url.searchParams.get('state') ?? '';
      const err = url.searchParams.get('error');
      if (err) return text(`Spotify said: ${err}`, 400);
      const [ts, sig] = state.split('.');
      const fresh = ts && Date.now() - Number(ts) < 10 * 60_000;
      if (!code || !fresh || sig !== await hmac(env.HUD_TOKEN, ts)) return text('bad state (open /spotify/login again)', 400);
      await spotify.handleCallback(env, code);
      return text('Spotify linked. You can close this tab.');
    }

    if (!authed(req, env)) return json({ error: 'unauthorized' }, 401);
    const now = Date.now();
    const hrMax = Number(env.HR_MAX) || 185;

    // ---- Writes (POST from Shortcuts; GET with ?token= works too, for testing from a browser) ----
    const writable = ['/workout/start', '/workout/end', '/pause', '/skip', '/health'];
    if (req.method === 'POST' || (req.method === 'GET' && writable.includes(path))) {
      const body = req.method === 'POST' ? (await req.json().catch(() => ({})) as any) : Object.fromEntries(url.searchParams);

      if (path === '/workout/start') {
        const w = defaultWorkout();
        w.active = true; w.type = String(body.type ?? 'workout'); w.startedAt = Number(body.startedAt) || now;
        await env.HUD.put(W_KEY, JSON.stringify(w));
        const playlist = typeof body.playlist === 'string' && body.playlist.startsWith('spotify:') ? body.playlist : undefined;
        const music = await spotify.startGymPlaylist(env, playlist).catch(e => `spotify error: ${e.message}`);
        return json({ ok: true, music });
      }
      if (path === '/workout/end') {
        const w = await getWorkout(env);
        accrueZone(w, now, hrMax);
        w.active = false; w.paused = false;
        await env.HUD.put(W_KEY, JSON.stringify(w));
        ctx.waitUntil(spotify.pause(env).catch(() => {}));
        return json({ ok: true });
      }
      if (path === '/health') {
        const h = parseHealth(body);
        const w = await getWorkout(env);
        const before = JSON.stringify([w.hr, w.steps, w.activeKcal, w.distanceM, Math.floor(w.inZoneSec)]);
        if (typeof h.hr === 'number') { accrueZone(w, now, hrMax); w.hr = h.hr; w.hrAt = now; }
        if (typeof h.steps === 'number') w.steps = h.steps;
        if (typeof h.activeKcal === 'number') w.activeKcal = h.activeKcal;
        if (typeof h.distanceM === 'number') w.distanceM = h.distanceM;
        const after = JSON.stringify([w.hr, w.steps, w.activeKcal, w.distanceM, Math.floor(w.inZoneSec)]);
        const minGap = Number(env.KV_WRITE_MIN_MS) || 0;
        const zoneChanged = zoneNum(w.hr, hrMax) !== zoneNum(JSON.parse(before)[0] || 0, hrMax);
        const due = now - (w.writtenAt || 0) >= minGap;
        if ((after !== before && (due || zoneChanged)) || now - (w.writtenAt || 0) > 30_000) {
          w.writtenAt = now;
          try { await env.HUD.put(W_KEY, JSON.stringify(w)); }
          catch (e: any) { return json({ ok: false, error: 'kv write failed (quota?)', detail: String(e?.message ?? e) }, 503); }
        }
        const ringKeys = ['move', 'moveGoal', 'exercise', 'exerciseGoal', 'stand', 'standGoal'] as const;
        if (ringKeys.some(k => typeof (h as any)[k] === 'number')) {
          const r = await getRings(env);
          for (const k of ringKeys) if (typeof (h as any)[k] === 'number') (r as any)[k] = (h as any)[k];
          await env.HUD.put(R_KEY, JSON.stringify(r));
        }
        return json({ ok: true, applied: Object.keys(h) });
      }
      if (path === '/pause') {
        const w = await getWorkout(env);
        if (w.active) {
          accrueZone(w, now, hrMax);
          if (w.paused) { w.pausedTotalMs += now - (w.pausedAt ?? now); w.paused = false; w.pausedAt = undefined; ctx.waitUntil(spotify.resume(env).catch(() => {})); }
          else { w.paused = true; w.pausedAt = now; ctx.waitUntil(spotify.pause(env).catch(() => {})); }
          await env.HUD.put(W_KEY, JSON.stringify(w));
        }
        return json({ ok: true, paused: w.paused });
      }
      if (path === '/skip') {
        ctx.waitUntil(spotify.next(env).catch(() => {}));
        return json({ ok: true });
      }
      return json({ error: 'not found' }, 404);
    }

    // ---- Read: playlists for the Watch picker (cached 10 min) ----
    if (path === '/playlists') {
      const cache = caches.default;
      const key = new Request(`${url.origin}/__playlists`);
      let r = await cache.match(key);
      if (!r) {
        const list = await spotify.playlists(env).catch(() => []);
        r = json({ playlists: list });
        r.headers.set('Cache-Control', 'max-age=600');
        if (list.length) ctx.waitUntil(cache.put(key, r.clone()));
      }
      return r;
    }

    // ---- Read: the shape app/src/model.ts expects ----
    if (path === '/state') {
      const [w, rings, sp, wx, gl] = await Promise.all([getWorkout(env), getRings(env), spotify.nowPlaying(env).catch(() => null), weather(env).catch(() => null), glucose(env)]);
      const pausedMs = w.pausedTotalMs + (w.paused && w.pausedAt ? now - w.pausedAt : 0);
      const elapsedSec = w.active ? Math.max(0, (now - w.startedAt - pausedMs) / 1000) : 0;
      const stale = w.hrAt ? now - w.hrAt > 120_000 : true;
      return json({
        now,
        workout: {
          active: w.active, paused: w.paused, type: w.type, startedAt: w.startedAt, elapsedSec,
          hr: w.hr, hrMax, hrStale: stale, steps: w.steps, activeKcal: w.activeKcal, distanceM: w.distanceM,
          inZoneSec: w.inZoneSec, zoneGoalSec: Number(env.ZONE_GOAL_SEC) || 1800,
        },
        spotify: sp ?? { linked: false, playing: false, title: 'Spotify not linked', artist: '', positionMs: 0, durationMs: 0, queueCount: 0 },
        rings,
        weather: wx,
        glucose: gl,
        battery: null,
      });
    }
    return json({ error: 'not found' }, 404);
  },
};
