// Morning HUD: one GET that assembles the briefing, plus the small writes the
// phone and the glasses make. Google is read live; only texts, calls and
// "kept" flags are stored, each with a 24 h expiry.
//
//   GET  /morning                 briefing (cached 60 s)
//   GET  /morning/body?id=gmail:… one message body, on demand, never stored
//   POST /morning/keep {id, keep} glasses: keep an item for today
//   POST /morning/text {who, text, at?}   iPhone Shortcut "when I get a message"
//   POST /morning/call {who, at?}         Mac agent (later): a missed call

import * as google from './google';

export interface MorningEnv extends google.GoogleEnv {
  HUD: KVNamespace;
  WEATHER_LAT?: string;
  WEATHER_LON?: string;
}

export interface Item {
  id: string;
  kind: 'vip' | 'mail' | 'text' | 'call';
  who: string;
  from?: string;      // sender address (mail only)
  what: string;       // subject, message text, or "Missed call"
  preview?: string;
  at: number;
  kept: boolean;
  unread?: boolean;
  meetToday?: boolean;
}

export interface Briefing {
  now: number;
  tz: string;
  linked: { google: boolean };
  weather: { tempC: number; code: number } | null;
  events: google.CalEvent[];
  items: Item[];
  counts: { vip: number; mail: number; texts: number; calls: number };
  error?: string;
}

const TTL = 86_400;                       // seconds; everything stored here dies after a day
const K_TEXTS = 'morning:texts', K_CALLS = 'morning:calls', K_KEEP = 'morning:keep';

async function readList<T>(env: MorningEnv, key: string): Promise<T[]> {
  return ((await env.HUD.get(key, 'json')) as T[] | null) ?? [];
}

async function weatherNow(env: MorningEnv): Promise<Briefing['weather']> {
  if (!env.WEATHER_LAT || !env.WEATHER_LON) return null;
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${env.WEATHER_LAT}&longitude=${env.WEATHER_LON}&current=temperature_2m,weather_code`, { cf: { cacheTtl: 600 } } as any);
    if (!r.ok) return null;
    const j: any = await r.json();
    return { tempC: Math.round(j.current?.temperature_2m ?? 0), code: j.current?.weather_code ?? 0 };
  } catch { return null; }
}

export async function briefing(env: MorningEnv): Promise<Briefing> {
  const now = Date.now();
  const tz = env.TZ || 'UTC';
  const linked = google.configured(env) && await google.isLinked(env);
  let error: string | undefined;
  const [mail, events, texts, calls, keep, weather] = await Promise.all([
    linked ? google.recentMail(env).catch(e => { error = String(e?.message ?? e); return []; }) : Promise.resolve([]),
    linked ? google.todayEvents(env).catch(e => { error = String(e?.message ?? e); return []; }) : Promise.resolve([]),
    readList<Item>(env, K_TEXTS), readList<Item>(env, K_CALLS),
    env.HUD.get(K_KEEP, 'json') as Promise<Record<string, number> | null>,
    weatherNow(env),
  ]);
  const dayAgo = now - TTL * 1000;
  const meeting = new Set((events ?? []).flatMap(e => e.who));
  const items: Item[] = [
    ...(mail ?? []).map(m => ({ id: m.id, kind: m.kind, who: m.who, from: m.from, what: m.what, preview: m.preview, at: m.at, kept: false, unread: m.unread, meetToday: meeting.has(m.from) } as Item)),
    ...texts, ...calls,
  ].filter(i => i.at >= dayAgo).map(i => ({ ...i, kept: !!keep?.[i.id] }));
  // Needs-you order: VIP and texts and calls first, then unread mail, newest first inside each band.
  const band = (i: Item) => i.kind === 'vip' ? 0 : i.kind === 'call' ? 1 : i.kind === 'text' ? 2 : i.meetToday ? 3 : i.unread ? 4 : 5;
  items.sort((a, b) => band(a) - band(b) || b.at - a.at);
  return {
    now, tz, linked: { google: linked }, weather, events: events ?? [], items,
    counts: { vip: items.filter(i => i.kind === 'vip').length, mail: items.filter(i => i.kind === 'mail').length, texts: texts.length, calls: calls.length },
    error,
  };
}

export async function keep(env: MorningEnv, id: string, on: boolean): Promise<void> {
  const k = ((await env.HUD.get(K_KEEP, 'json')) as Record<string, number> | null) ?? {};
  const cutoff = Date.now() - TTL * 1000;
  for (const key of Object.keys(k)) if (k[key] < cutoff) delete k[key];
  if (on) k[id] = Date.now(); else delete k[id];
  await env.HUD.put(K_KEEP, JSON.stringify(k), { expirationTtl: TTL });
}

async function append(env: MorningEnv, key: string, item: Item): Promise<void> {
  const list = (await readList<Item>(env, key)).filter(i => i.at >= Date.now() - TTL * 1000);
  list.unshift(item);
  await env.HUD.put(key, JSON.stringify(list.slice(0, 50)), { expirationTtl: TTL });
}

/** From the iPhone Shortcut. Body: {who, text, at?}. Text is kept to a preview length. */
export async function addText(env: MorningEnv, body: any): Promise<Item> {
  const at = Number(body?.at) || Date.now();
  const item: Item = { id: `text:${at}:${Math.random().toString(36).slice(2, 7)}`, kind: 'text', who: String(body?.who ?? 'Unknown').slice(0, 40), what: String(body?.text ?? '').replace(/\s+/g, ' ').slice(0, 200), at, kept: false, unread: true };
  await append(env, K_TEXTS, item);
  return item;
}

export async function addCall(env: MorningEnv, body: any): Promise<Item> {
  const at = Number(body?.at) || Date.now();
  const item: Item = { id: `call:${at}`, kind: 'call', who: String(body?.who ?? 'Unknown').slice(0, 40), what: body?.voicemail ? 'Missed call · voicemail' : 'Missed call', at, kept: false, unread: true };
  await append(env, K_CALLS, item);
  return item;
}

export async function body(env: MorningEnv, id: string) {
  if (id.startsWith('gmail:')) return google.mailBody(env, id.slice(6));
  const all = [...await readList<Item>(env, K_TEXTS), ...await readList<Item>(env, K_CALLS)];
  const it = all.find(i => i.id === id);
  return it ? { who: it.who, what: it.kind === 'text' ? 'Message' : it.what, at: it.at, text: it.what } : null;
}
