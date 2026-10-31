// Spotify Web API: OAuth (authorization code), token refresh in KV,
// now playing + queue, and "start the gym playlist on shuffle".

export interface SpotifyEnv {
  HUD: KVNamespace;
  BASE_URL: string;
  SPOTIFY_CLIENT_ID: string;
  SPOTIFY_CLIENT_SECRET: string;
  SPOTIFY_PLAYLIST_URI: string;
}

const SCOPES = 'user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private playlist-read-collaborative';
const TOKEN_KEY = 'spotify:refresh_token';
const ACCESS_KEY = 'spotify:access';

export function loginUrl(env: SpotifyEnv, state: string): string {
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: env.SPOTIFY_CLIENT_ID,
    scope: SCOPES,
    redirect_uri: `${env.BASE_URL}/spotify/callback`,
    state,
  });
  return `https://accounts.spotify.com/authorize?${p}`;
}

async function tokenRequest(env: SpotifyEnv, body: Record<string, string>) {
  const basic = btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`);
  const r = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  if (!r.ok) throw new Error(`spotify token ${r.status}: ${await r.text()}`);
  return r.json() as Promise<{ access_token: string; expires_in: number; refresh_token?: string }>;
}

export async function handleCallback(env: SpotifyEnv, code: string): Promise<void> {
  const t = await tokenRequest(env, { grant_type: 'authorization_code', code, redirect_uri: `${env.BASE_URL}/spotify/callback` });
  if (!t.refresh_token) throw new Error('no refresh token returned');
  await env.HUD.put(TOKEN_KEY, t.refresh_token);
  await env.HUD.put(ACCESS_KEY, JSON.stringify({ token: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 }));
}

export async function isLinked(env: SpotifyEnv): Promise<boolean> {
  return !!(await env.HUD.get(TOKEN_KEY));
}

async function accessToken(env: SpotifyEnv): Promise<string | null> {
  const cached = await env.HUD.get(ACCESS_KEY, 'json') as { token: string; exp: number } | null;
  if (cached && cached.exp > Date.now()) return cached.token;
  const refresh = await env.HUD.get(TOKEN_KEY);
  if (!refresh) return null;
  const t = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: refresh });
  if (t.refresh_token) await env.HUD.put(TOKEN_KEY, t.refresh_token);
  await env.HUD.put(ACCESS_KEY, JSON.stringify({ token: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 }));
  return t.access_token;
}

async function api(env: SpotifyEnv, method: string, path: string, body?: unknown): Promise<Response | null> {
  const token = await accessToken(env);
  if (!token) return null;
  return fetch(`https://api.spotify.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export interface SpotifyState {
  linked: boolean;
  playing: boolean;
  title: string;
  artist: string;
  positionMs: number;
  durationMs: number;
  next?: { title: string; artist: string };
  queueCount: number;
}

const EMPTY: SpotifyState = { linked: false, playing: false, title: 'Nothing playing', artist: '', positionMs: 0, durationMs: 0, queueCount: 0 };

export async function nowPlaying(env: SpotifyEnv): Promise<SpotifyState> {
  const r = await api(env, 'GET', '/me/player/currently-playing?additional_types=track,episode');
  if (!r) return EMPTY;
  if (r.status === 204 || r.status === 404) return { ...EMPTY, linked: true };
  if (!r.ok) return { ...EMPTY, linked: true, title: `Spotify ${r.status}` };
  const j = await r.json() as any;
  const item = j.item ?? {};
  const state: SpotifyState = {
    linked: true,
    playing: !!j.is_playing,
    title: item.name ?? 'Unknown',
    artist: (item.artists ?? []).map((a: any) => a.name).join(', ') || item.show?.name || '',
    positionMs: j.progress_ms ?? 0,
    durationMs: item.duration_ms ?? 0,
    queueCount: 0,
  };
  const q = await api(env, 'GET', '/me/player/queue');
  if (q && q.ok) {
    const qj = await q.json() as any;
    const queue: any[] = qj.queue ?? [];
    state.queueCount = queue.length;
    const n = queue[0];
    if (n) state.next = { title: n.name, artist: (n.artists ?? []).map((a: any) => a.name).join(', ') };
  }
  return state;
}

export interface PlaylistInfo { id: string; name: string; uri: string; tracks: number }

/** The user's playlists, newest first, for the Watch picker. */
export async function playlists(env: SpotifyEnv): Promise<PlaylistInfo[]> {
  const r = await api(env, 'GET', '/me/playlists?limit=50');
  if (!r || !r.ok) return [];
  const j = await r.json() as any;
  return (j.items ?? []).map((p: any) => ({ id: p.id, name: p.name, uri: p.uri, tracks: p.tracks?.total ?? 0 }));
}

/** Workout start: shuffle on, play the chosen playlist (or the configured default) on the phone. */
export async function startGymPlaylist(env: SpotifyEnv, playlistUri?: string): Promise<string> {
  const uri = playlistUri || env.SPOTIFY_PLAYLIST_URI;
  if (!uri || uri.includes('REPLACE')) return 'no playlist configured';
  let devices = await api(env, 'GET', '/me/player/devices');
  if (!devices) return 'spotify not linked';
  const dj = await devices.json() as any;
  const list: any[] = dj.devices ?? [];
  // Phone first, always: at the gym the Mac may still be the "active" device from the desk.
  const active = list.find(d => d.type === 'Smartphone') ?? list.find(d => d.is_active) ?? list[0];
  if (!active) return 'no spotify device online; open Spotify on the phone once';
  const dev = `device_id=${active.id}`;
  await api(env, 'PUT', `/me/player/shuffle?state=true&${dev}`);
  const play = await api(env, 'PUT', `/me/player/play?${dev}`, { context_uri: uri });
  return play && (play.ok || play.status === 204) ? 'playing' : `play failed ${play?.status}`;
}

export async function pause(env: SpotifyEnv) { await api(env, 'PUT', '/me/player/pause'); }
export async function resume(env: SpotifyEnv) { await api(env, 'PUT', '/me/player/play'); }
export async function next(env: SpotifyEnv) { await api(env, 'POST', '/me/player/next'); }
