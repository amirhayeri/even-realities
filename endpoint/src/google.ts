// Google: OAuth (authorization code, offline), token refresh in KV, Gmail
// recent-mail previews and today's Calendar events. Read-only scopes only.
// Nothing from Google is stored: every read goes straight to the glasses.

export interface GoogleEnv {
  HUD: KVNamespace;
  BASE_URL: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Comma list: full addresses or @domains. Mail from these is a VIP item. */
  VIP_EMAILS?: string;
  /** Gmail search for the Mail card. Default skips promotions, social, forums. */
  MAIL_QUERY?: string;
  /** IANA zone used for "today", e.g. America/Toronto. */
  TZ?: string;
}

const SCOPES = 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly';
const TOKEN_KEY = 'google:refresh_token';
const ACCESS_KEY = 'google:access';

export function configured(env: GoogleEnv): boolean { return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET); }

export function loginUrl(env: GoogleEnv, state: string): string {
  const p = new URLSearchParams({
    response_type: 'code', client_id: env.GOOGLE_CLIENT_ID!, scope: SCOPES,
    redirect_uri: `${env.BASE_URL}/google/callback`, state, access_type: 'offline', prompt: 'consent',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

async function tokenRequest(env: GoogleEnv, body: Record<string, string>) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, ...body }),
  });
  if (!r.ok) throw new Error(`google token ${r.status}: ${await r.text()}`);
  return r.json() as Promise<{ access_token: string; expires_in: number; refresh_token?: string }>;
}

export async function handleCallback(env: GoogleEnv, code: string): Promise<void> {
  const t = await tokenRequest(env, { grant_type: 'authorization_code', code, redirect_uri: `${env.BASE_URL}/google/callback` });
  if (!t.refresh_token) throw new Error('no refresh token returned (remove the app at myaccount.google.com/permissions and link again)');
  await env.HUD.put(TOKEN_KEY, t.refresh_token);
  await env.HUD.put(ACCESS_KEY, JSON.stringify({ token: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 }));
}

export async function isLinked(env: GoogleEnv): Promise<boolean> { return !!(await env.HUD.get(TOKEN_KEY)); }

let memAccess: { token: string; exp: number } | null = null;
async function accessToken(env: GoogleEnv): Promise<string | null> {
  if (memAccess && memAccess.exp > Date.now()) return memAccess.token;
  const cached = await env.HUD.get(ACCESS_KEY, 'json') as { token: string; exp: number } | null;
  if (cached && cached.exp > Date.now()) { memAccess = cached; return cached.token; }
  const refresh = await env.HUD.get(TOKEN_KEY);
  if (!refresh) return null;
  const t = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: refresh });
  memAccess = { token: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 };
  await env.HUD.put(ACCESS_KEY, JSON.stringify(memAccess));
  return t.access_token;
}

async function api(env: GoogleEnv, url: string): Promise<any | null> {
  const token = await accessToken(env);
  if (!token) return null;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`google ${r.status} ${url.split('?')[0]}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

// ---------- Shapes the glasses receive ----------

export interface MailItem {
  id: string;            // "gmail:<messageId>"
  kind: 'vip' | 'mail';
  who: string;           // display name, else the address
  from: string;          // address
  what: string;          // subject
  preview: string;       // Gmail snippet, trimmed
  at: number;            // ms epoch
  unread: boolean;
  meetToday?: boolean;   // sender is on one of today's invites
}

export interface CalEvent {
  id: string;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  where: string;
  who: string[];         // attendee addresses, not you
  cal: string;
}

function parseFrom(h: string): { who: string; from: string } {
  const m = h.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { who: m[1].trim() || m[2].trim(), from: m[2].trim().toLowerCase() };
  return { who: h.trim(), from: h.trim().toLowerCase() };
}

export function isVip(env: GoogleEnv, from: string): boolean {
  const list = (env.VIP_EMAILS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return list.some(v => v.startsWith('@') ? from.endsWith(v) : from === v);
}

/** Mail from the last 24 h as previews. At most `max` messages, newest first. */
export async function recentMail(env: GoogleEnv, max = 40): Promise<MailItem[] | null> {
  const q = env.MAIL_QUERY || 'newer_than:1d -category:promotions -category:social -category:forums -in:spam -in:trash';
  const list = await api(env, `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}&q=${encodeURIComponent(q)}`);
  if (!list) return null;
  const ids: string[] = (list.messages ?? []).map((m: any) => m.id);
  const msgs = await Promise.all(ids.map(id => api(env, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`).catch(() => null)));
  const out: MailItem[] = [];
  for (const m of msgs) {
    if (!m) continue;
    const hdr = (n: string) => (m.payload?.headers ?? []).find((h: any) => h.name.toLowerCase() === n)?.value ?? '';
    const { who, from } = parseFrom(hdr('from'));
    out.push({
      id: `gmail:${m.id}`, kind: isVip(env, from) ? 'vip' : 'mail', who, from,
      what: hdr('subject') || '(no subject)', preview: String(m.snippet ?? '').replace(/\s+/g, ' ').slice(0, 160),
      at: Number(m.internalDate) || 0, unread: (m.labelIds ?? []).includes('UNREAD'),
    });
  }
  return out.sort((a, b) => b.at - a.at);
}

/** Plain-text body of one message, for "hold to read". Never stored. */
export async function mailBody(env: GoogleEnv, gmailId: string, maxChars = 2000): Promise<{ who: string; what: string; at: number; text: string } | null> {
  const m = await api(env, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(gmailId)}?format=full`);
  if (!m) return null;
  const hdr = (n: string) => (m.payload?.headers ?? []).find((h: any) => h.name.toLowerCase() === n)?.value ?? '';
  const parts: any[] = [];
  const walk = (p: any) => { if (!p) return; parts.push(p); (p.parts ?? []).forEach(walk); };
  walk(m.payload);
  const pick = parts.find(p => p.mimeType === 'text/plain' && p.body?.data) ?? parts.find(p => p.mimeType === 'text/html' && p.body?.data);
  let text = '';
  if (pick) {
    const b64 = String(pick.body.data).replace(/-/g, '+').replace(/_/g, '/');
    text = new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
    if (pick.mimeType === 'text/html') text = text.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  } else text = m.snippet ?? '';
  text = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, maxChars);
  return { who: parseFrom(hdr('from')).who, what: hdr('subject') || '(no subject)', at: Number(m.internalDate) || 0, text };
}

/** [start, end) of today in the configured zone, ms epoch. */
export function todayBounds(tz: string, now = Date.now()): { start: number; end: number; ymd: string } {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', timeZoneName: 'longOffset' });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(now)).map(p => [p.type, p.value]));
  const ymd = `${parts.year}-${parts.month}-${parts.day}`;
  const off = (parts.timeZoneName as string).replace('GMT', '') || '+00:00';   // "-04:00"
  const start = Date.parse(`${ymd}T00:00:00${off === '' ? 'Z' : off}`);
  return { start, end: start + 86_400_000, ymd };
}

/** Today's events across every calendar you have selected in Google Calendar. */
export async function todayEvents(env: GoogleEnv): Promise<CalEvent[] | null> {
  const tz = env.TZ || 'UTC';
  const { start, end } = todayBounds(tz);
  const cals = await api(env, 'https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader');
  if (!cals) return null;
  const selected = (cals.items ?? []).filter((c: any) => c.selected !== false);
  const me = (cals.items ?? []).find((c: any) => c.primary)?.id?.toLowerCase() ?? '';
  const lists = await Promise.all(selected.map((c: any) => api(env,
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(c.id)}/events?singleEvents=true&orderBy=startTime&maxResults=30&timeMin=${new Date(start).toISOString()}&timeMax=${new Date(end).toISOString()}&timeZone=${encodeURIComponent(tz)}`
  ).then(r => ({ cal: c.summary ?? c.id, items: r?.items ?? [] })).catch(() => ({ cal: c.summary ?? c.id, items: [] }))));
  const out: CalEvent[] = [];
  const seen = new Set<string>();
  for (const { cal, items } of lists) for (const e of items) {
    if (e.status === 'cancelled') continue;
    const key = e.iCalUID ?? e.id; if (seen.has(key)) continue; seen.add(key);
    const mine = (e.attendees ?? []).find((a: any) => a.self);
    if (mine && mine.responseStatus === 'declined') continue;
    const allDay = !!e.start?.date;
    const s = allDay ? Date.parse(e.start.date + 'T00:00:00Z') : Date.parse(e.start.dateTime);
    const en = allDay ? Date.parse(e.end.date + 'T00:00:00Z') : Date.parse(e.end.dateTime);
    out.push({
      id: `gcal:${e.id}`, title: e.summary || '(busy)', start: s, end: en, allDay,
      where: e.location ?? (e.hangoutLink ? 'Meet' : e.conferenceData?.conferenceSolution?.name ?? ''),
      who: (e.attendees ?? []).map((a: any) => String(a.email).toLowerCase()).filter((a: string) => a && a !== me),
      cal,
    });
  }
  return out.sort((a, b) => Number(a.allDay) - Number(b.allDay) || a.start - b.start);
}
