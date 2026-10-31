// Briefing shape (mirrors endpoint/src/morning.ts), a mock for the browser
// preview, and the remote client.

export interface CalEvent { id: string; title: string; start: number; end: number; allDay: boolean; where: string; who: string[]; cal: string }
export interface Item { id: string; kind: 'vip' | 'mail' | 'text' | 'call'; who: string; from?: string; what: string; preview?: string; at: number; kept: boolean; unread?: boolean; meetToday?: boolean }
export interface Briefing {
  now: number;
  tz: string;
  linked: { google: boolean };
  weather: { tempC: number; code: number } | null;
  events: CalEvent[];
  items: Item[];
  counts: { vip: number; mail: number; texts: number; calls: number };
  error?: string;
}
export interface Body { who: string; what: string; at: number; text: string }

export interface MorningModel {
  state: Briefing;
  /** Pull now if due (or forced). Resolves when the state may have changed. */
  refresh(force?: boolean): Promise<boolean>;
  keep(id: string, on: boolean): void;
  body(id: string): Promise<Body | null>;
  status: string;
}

export function fmtTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function ago(ms: number, now: number): string {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

// ---------- Mock ----------

export function createMockModel(): MorningModel {
  const now = Date.now();
  const d = new Date(now); d.setHours(0, 0, 0, 0);
  const T = (h: number, m = 0) => d.getTime() + (h * 60 + m) * 60_000;
  const state: Briefing = {
    now, tz: 'local', linked: { google: true }, weather: { tempC: 14, code: 1 },
    events: [
      { id: 'e1', title: 'Standup', start: T(9, 30), end: T(10), allDay: false, where: 'Zoom', who: ['leo@bio.tech', 'ana@bio.tech'], cal: 'Work' },
      { id: 'e2', title: 'Sarah Chen · Series A', start: T(11), end: T(12), allDay: false, where: 'Meet', who: ['sarah@fund.vc'], cal: 'Work' },
      { id: 'e3', title: 'Dr. Patel', start: T(14), end: T(15), allDay: false, where: 'Teams', who: ['patel@uni.edu'], cal: 'Work' },
      { id: 'e4', title: 'Gym', start: T(17, 30), end: T(18, 30), allDay: false, where: '', who: [], cal: 'Personal' },
      { id: 'e5', title: 'Caspian: dentist 15:15', start: d.getTime(), end: d.getTime() + 86_400_000, allDay: true, where: '', who: [], cal: 'Family' },
    ],
    items: [
      { id: 'm1', kind: 'vip', who: 'Sarah Chen', from: 'sarah@fund.vc', what: 'Re: Series A data room', preview: 'Thanks Amir, the deck landed well with the partners. Can we get the retention cohorts before Thursday?', at: now - 9 * 60_000, kept: true, unread: true, meetToday: true },
      { id: 'c1', kind: 'call', who: 'Lena', what: 'Missed call', at: now - 9 * 3600_000, kept: false, unread: true },
      { id: 't1', kind: 'text', who: 'Dad', what: 'Call me when you are up', at: now - 3600_000, kept: true, unread: true },
      { id: 'm2', kind: 'vip', who: 'Dr. Patel', what: 'Epsilon study: interim read attached', preview: 'Interim analysis attached. Primary endpoint trending positive, p=0.08 at n=140.', at: now - 32 * 60_000, kept: false, unread: true, meetToday: true },
      { id: 't2', kind: 'text', who: 'Caspian', what: 'can you do dentist pickup 15:15?', at: now - 3 * 60_000, kept: false, unread: true },
      { id: 'm3', kind: 'mail', who: 'Stripe', what: 'Payout of $4,120.00 sent', preview: 'A payout of $4,120.00 was sent to your bank account ending 4471.', at: now - 3 * 3600_000, kept: false, unread: true },
      { id: 'm4', kind: 'mail', who: 'Even Realities', what: 'Warranty claim #48213 approved', preview: 'Good news. Your replacement ships within 3 business days.', at: now - 2 * 3600_000, kept: false, unread: false },
      { id: 'm5', kind: 'mail', who: 'Cloudflare', what: 'Your Workers usage is at 50%', preview: 'even-hud-endpoint used 50,112 of the 100,000 daily requests.', at: now - 41 * 60_000, kept: false, unread: false },
      { id: 'm6', kind: 'mail', who: 'Notion', what: 'Weekly digest: 14 updates', preview: '', at: now - 6 * 3600_000, kept: false, unread: false },
    ],
    counts: { vip: 2, mail: 4, texts: 2, calls: 1 },
  };
  return {
    state, status: 'mock',
    async refresh() { state.now = Date.now(); return false; },
    keep(id, on) { const it = state.items.find(i => i.id === id); if (it) it.kept = on; },
    async body(id) { const it = state.items.find(i => i.id === id); return it ? { who: it.who, what: it.what, at: it.at, text: it.preview || it.what } : null; },
  };
}

// ---------- Remote ----------

export function createRemoteModel(base: string, token: string, pollMs = 60_000, onStatus?: (s: string) => void): MorningModel {
  const root = base.replace(/\/+$/, '');
  const headers = { Authorization: `Bearer ${token}` };
  const q = `?token=${encodeURIComponent(token)}`;
  const state: Briefing = { now: Date.now(), tz: '', linked: { google: false }, weather: null, events: [], items: [], counts: { vip: 0, mail: 0, texts: 0, calls: 0 } };
  let lastFetch = 0;
  const m: MorningModel = {
    state, status: 'connecting…',
    async refresh(force = false) {
      const t = Date.now();
      state.now = t;
      if (!force && t - lastFetch < pollMs) return false;
      lastFetch = t;
      try {
        const r = await fetch(`${root}/morning${q}${force ? '&fresh=1' : ''}`, { cache: 'no-store', headers });
        if (!r.ok) throw new Error(`${r.status} ${(await r.text().catch(() => '')).slice(0, 80)}`);
        const b = await r.json() as Briefing;
        Object.assign(state, b, { now: Date.now() });
        m.status = b.error ? `live, Google said: ${b.error.slice(0, 80)}` : `live · ${root}`;
        onStatus?.(m.status);
        return true;
      } catch (e: any) {
        m.status = `endpoint unreachable: ${e?.message ?? e}`;
        onStatus?.(m.status);
        return false;
      }
    },
    keep(id, on) {
      const it = state.items.find(i => i.id === id); if (it) it.kept = on;
      fetch(`${root}/morning/keep${q}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ id, keep: on }) }).catch(() => {});
    },
    async body(id) {
      try {
        const r = await fetch(`${root}/morning/body${q}&id=${encodeURIComponent(id)}`, { cache: 'no-store', headers });
        return r.ok ? await r.json() as Body : null;
      } catch { return null; }
    },
  };
  return m;
}
