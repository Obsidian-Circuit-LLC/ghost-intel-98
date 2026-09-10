/**
 * Spectre client — Nominatim geocode + WiGLE network search (P1), Tor-gated and host-anchored.
 *
 * Signal engine ported from WireTapper by h9zdev (CC BY-NC 4.0). Every contract here is transcribed
 * from his `app.py`: the WiGLE `/network/search` ±0.01 bounding box with HTTP Basic `(name, token)`
 * (`app.py:643`), the Nominatim `/search` params (`app.py:api_geocode`), and `classify_device`
 * (`app.py:227`). Re-deriving an upstream's params from memory is the recorded failure mode.
 *
 * Hardening (mirrors weather/client.ts, the app's OURS-tool egress pattern):
 *  - EGRESS: Tor-default over the background SOCKS (searchlight `socksDial`); clearnet ONLY when
 *    `clearnet && clearnetAck`; Tor-default with Tor not bootstrapped FAILS CLOSED — no fallback.
 *  - HOST ALLOWLIST / SSRF: every URL is BUILT here, host-anchored, https-only; `assertAllowedHost`
 *    rejects anything else before a byte is dialled.
 *  - PURE builders/normalizers: network-free and separately testable.
 */
import { request as httpsRequest } from 'node:https';
import { socksDial } from '../searchlight/tor-socks';
import type { SpectreDevice, SpectreQueryResult } from '@shared/spectre/types';

export const WIGLE_HOST = 'api.wigle.net';
export const NOMINATIM_HOST = 'nominatim.openstreetmap.org';
/** The ONLY hosts a P1 request may target. None is ever derived from caller input. */
const ALLOWED_HOSTS: ReadonlySet<string> = new Set([WIGLE_HOST, NOMINATIM_HOST]);

const UA = 'GhostIntel98-Spectre/1.0';
const TIMEOUT_MS = 12_000;
const BODY_CAP = 4 * 1024 * 1024;

// ── classify_device (app.py:227), ported verbatim ──────────────────────────────
const CLASSIFY: Array<{ type: string; keys: string[] }> = [
  { type: 'sdr', keys: ['SDR', 'RTL-SDR', 'HACKRF', 'ADSB', 'SUBGHZ', 'RF_BEACON', 'HAM_RADIO', 'RADIO', '433MHZ', '868MHZ', '915MHZ'] },
  { type: 'car', keys: ['CAR', 'FORD', 'TOYOTA', 'BMW', 'TESLA', 'SYNC', 'MAZDA', 'HONDA', 'UCONNECT', 'HYUNDAI', 'LEXUS', 'NISSAN'] },
  { type: 'tv', keys: ['TV', 'BRAVIA', 'VIZIO', 'SAMSUNG', 'LG', 'ROKU', 'FIRE', 'SMARTVIEW', 'KDL-'] },
  { type: 'headphone', keys: ['HEADPHONE', 'EARBUD', 'BOSE', 'SONY', 'BEATS', 'AUDIO', 'AIRPOD', 'JBL', 'SENNHEISER'] },
  { type: 'dashcam', keys: ['DASHCAM', 'DASH CAM', 'DVR', '70MAI', 'VIOFO', 'GARMIN DASH'] },
  { type: 'camera', keys: ['CAM', 'SURVEILLANCE', 'SECURITY', 'NEST', 'RING', 'ARLO', 'HIKVISION', 'DAHUA', 'REOLINK'] },
  { type: 'iot', keys: ['WATCH', 'FITBIT', 'GARMIN', 'WHOOP'] },
];
export function classifyDevice(name: string | null | undefined, originalType: string): string {
  if (!name) return originalType;
  const u = String(name).toUpperCase();
  for (const { type, keys } of CLASSIFY) if (keys.some((k) => u.includes(k))) return type;
  return originalType;
}

// ── host allowlist ─────────────────────────────────────────────────────────────
export function assertAllowedHost(url: string): URL {
  let u: URL;
  try { u = new URL(url); } catch { throw new Error('spectre: malformed URL rejected'); }
  if (u.protocol !== 'https:') throw new Error(`spectre: non-HTTPS URL rejected (${u.protocol})`);
  if (!ALLOWED_HOSTS.has(u.hostname)) throw new Error(`spectre: host not allowed: ${u.hostname}`);
  return u;
}

// ── pure URL builders (his exact params) ─────────────────────────────────────────
/** Trim float drift so the ±0.01 box reads as his does (51.49, not 51.490000000001). */
function box(n: number): string { return String(Number(n.toFixed(6))); }
export function buildWigleNetworkUrl(lat: number, lon: number): string {
  const u = new URL('/api/v2/network/search', `https://${WIGLE_HOST}`);
  u.searchParams.set('latrange1', box(lat - 0.01));
  u.searchParams.set('latrange2', box(lat + 0.01));
  u.searchParams.set('longrange1', box(lon - 0.01));
  u.searchParams.set('longrange2', box(lon + 0.01));
  return u.toString();
}
export function buildNominatimUrl(query: string): string {
  const u = new URL('/search', `https://${NOMINATIM_HOST}`);
  u.searchParams.set('q', query);
  u.searchParams.set('format', 'json');
  u.searchParams.set('limit', '1');
  return u.toString();
}

// ── egress gate ──────────────────────────────────────────────────────────────────
export interface SpectreEgressSettings { clearnet: boolean; clearnetAck: boolean; }
export type SpectreEgress =
  | { blocked: true; reason: string }
  | { mode: 'tor'; socksPort: number }
  | { mode: 'clearnet' };

export class SpectreEgressBlockedError extends Error {
  constructor(reason: string) { super(reason); this.name = 'SpectreEgressBlockedError'; }
}

/** Resolve the posture. Clearnet only when `clearnet && clearnetAck` — an un-acked flag can never
 *  leave Tor. Tor-default with Tor not bootstrapped fails closed (no clearnet fallback). */
export function resolveSpectreEgress(
  s: SpectreEgressSettings,
  env: { torReady: boolean; socksPort?: number },
): SpectreEgress {
  if (s.clearnet === true && s.clearnetAck === true) return { mode: 'clearnet' };
  if (!env.torReady) {
    return { blocked: true, reason: 'Tor is not ready — Spectre is blocked (no clearnet fallback). Enable clearnet in Settings to use your real IP.' };
  }
  return { mode: 'tor', socksPort: env.socksPort ?? 9050 };
}

// ── transport ────────────────────────────────────────────────────────────────────
export interface SpectreHttpResponse { status: number; body: string; }
export interface SpectreTransportOpts { auth?: { user: string; pass: string }; headers?: Record<string, string>; }
export type SpectreTransport = (url: string, opts?: SpectreTransportOpts) => Promise<SpectreHttpResponse>;

export interface SpectreClientDeps {
  egress: SpectreEgress;
  /** Injected for tests; production is the Tor/clearnet transport below. */
  transport?: SpectreTransport;
}

function basicAuth(user: string, pass: string): string {
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

async function torGet(u: URL, socksPort: number, opts?: SpectreTransportOpts): Promise<SpectreHttpResponse> {
  const socket = await socksDial(u.hostname, 443, socksPort);
  return await new Promise<SpectreHttpResponse>((resolve, reject) => {
    const headers: Record<string, string> = { 'User-Agent': UA, Accept: 'application/json', Connection: 'close', ...(opts?.headers ?? {}) };
    if (opts?.auth) headers.Authorization = basicAuth(opts.auth.user, opts.auth.pass);
    const req = httpsRequest(
      { method: 'GET', hostname: u.hostname, servername: u.hostname, path: u.pathname + u.search,
        createConnection: () => socket as never, timeout: TIMEOUT_MS, headers },
      (res) => {
        const status = res.statusCode ?? 0;
        const chunks: Buffer[] = []; let size = 0;
        res.on('data', (c: Buffer) => { size += c.length; if (size <= BODY_CAP) chunks.push(c); else res.destroy(); });
        res.on('end', () => resolve({ status, body: Buffer.concat(chunks).toString('utf8', 0, BODY_CAP) }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => { req.destroy(); socket.destroy(); reject(new Error('spectre: Tor request timed out')); });
    req.on('error', (e) => { socket.destroy(); reject(e); });
    req.end();
  });
}

async function clearnetGet(u: URL, opts?: SpectreTransportOpts): Promise<SpectreHttpResponse> {
  return await new Promise<SpectreHttpResponse>((resolve, reject) => {
    const headers: Record<string, string> = { 'User-Agent': UA, Accept: 'application/json', Connection: 'close', ...(opts?.headers ?? {}) };
    if (opts?.auth) headers.Authorization = basicAuth(opts.auth.user, opts.auth.pass);
    const req = httpsRequest(
      { method: 'GET', hostname: u.hostname, servername: u.hostname, path: u.pathname + u.search, timeout: TIMEOUT_MS, headers },
      (res) => {
        const status = res.statusCode ?? 0;
        const chunks: Buffer[] = []; let size = 0;
        res.on('data', (c: Buffer) => { size += c.length; if (size <= BODY_CAP) chunks.push(c); else res.destroy(); });
        res.on('end', () => resolve({ status, body: Buffer.concat(chunks).toString('utf8', 0, BODY_CAP) }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => { req.destroy(); reject(new Error('spectre: clearnet request timed out')); });
    req.on('error', reject);
    req.end();
  });
}

/** Fetch `url` under the resolved gate, host-anchored. Throws `SpectreEgressBlockedError` when the
 *  gate is blocked — never a silent clearnet fallback. */
async function fetchJson(url: string, deps: SpectreClientDeps, opts?: SpectreTransportOpts): Promise<unknown> {
  if ('blocked' in deps.egress) throw new SpectreEgressBlockedError(deps.egress.reason);
  const u = assertAllowedHost(url);
  const res = deps.transport
    ? await deps.transport(url, opts)
    : deps.egress.mode === 'tor'
      ? await torGet(u, deps.egress.socksPort, opts)
      : await clearnetGet(u, opts);
  if (res.status !== 200) throw new Error(`spectre: ${u.hostname} responded ${res.status}`);
  try { return JSON.parse(res.body); } catch { throw new Error(`spectre: ${u.hostname} returned non-JSON`); }
}

// ── public API (P1) ───────────────────────────────────────────────────────────────
/** Geocode a place name via Nominatim (keyless). Returns the first hit as a centre, or null when
 *  nothing matched — never a guessed coordinate. */
export async function geocode(
  place: string,
  deps: SpectreClientDeps,
): Promise<{ lat: number; lon: number; label?: string } | null> {
  const q = String(place ?? '').trim();
  if (!q) return null;
  const json = await fetchJson(buildNominatimUrl(q), deps, { headers: { 'Accept-Language': 'en' } }) as Array<Record<string, unknown>>;
  const hit = Array.isArray(json) ? json[0] : undefined;
  if (!hit) return null;
  const lat = Number(hit.lat); const lon = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, label: typeof hit.display_name === 'string' ? hit.display_name : undefined };
}

/** WiGLE network search around a centre (his `/nearby` wifi branch). A missing key is REPORTED, not
 *  turned into an unauthenticated call. */
export async function queryWifi(
  lat: number,
  lon: number,
  keys: { wigleName: string; wigleToken: string },
  deps: SpectreClientDeps,
): Promise<Pick<SpectreQueryResult, 'devices' | 'notes'>> {
  const devices: SpectreDevice[] = [];
  const notes: SpectreQueryResult['notes'] = [];
  if (!keys.wigleName || !keys.wigleToken) {
    notes.push({ source: 'wigle', ok: false, reason: 'No WiGLE API key set (Settings → Spectre).' });
    return { devices, notes };
  }
  try {
    const json = await fetchJson(buildWigleNetworkUrl(lat, lon), deps, { auth: { user: keys.wigleName, pass: keys.wigleToken } }) as { results?: Array<Record<string, unknown>> };
    for (const n of json.results ?? []) {
      const name = typeof n.ssid === 'string' ? n.ssid : undefined;
      const dLat = Number(n.trilat); const dLon = Number(n.trilong);
      if (!Number.isFinite(dLat) || !Number.isFinite(dLon)) continue;
      devices.push({
        lat: dLat, lon: dLon,
        ...(name ? { ssid: name } : {}),
        ...(n.netid ? { bssid: String(n.netid) } : {}),
        ...(n.vendor ? { vendor: String(n.vendor) } : {}),
        ...(n.level !== undefined && n.level !== null ? { signal: n.level as number } : {}),
        ...(n.lastupdt ? { timestamp: String(n.lastupdt) } : {}),
        type: classifyDevice(name, 'router'),
        source: 'wigle',
      });
    }
    notes.push({ source: 'wigle', ok: true });
  } catch (err) {
    if (err instanceof SpectreEgressBlockedError) throw err;
    notes.push({ source: 'wigle', ok: false, reason: err instanceof Error ? err.message : String(err) });
  }
  return { devices, notes };
}
