/**
 * UCDP GED (Georeferenced Event Dataset) conflict threat layer (KEYED). Stateless: fetch the UCDP
 * API and map it to GeoItem[]. NOT persisted to the secure-fs cache — threat layers are on-demand/
 * ephemeral. Egress is gated by the IPC handler (settings.geoint.networkEnabled); additionally
 * KEY-gated — the access token is read main-side from secretStore and the fetch refuses (returns [])
 * if absent. (The live API now requires the token even though the published CC-BY posture is keyless
 * — see prior-art §8 LIVE-FETCH CORRECTIONS.)
 *
 * Endpoint: https://ucdpapi.pcr.uu.se/api/gedevents/<version>?pagesize=<n>&page=<p>
 *   version default 26.1. Header: x-ucdp-access-token: <token> (now REQUIRED — HTTP 401 without).
 *
 * SCHEMA SOURCE — built to the published UCDP apidocs; GED schema NOT live-verified (we have no
 * token). Docs read 2026-06-15: https://ucdp.uu.se/apidocs/ . Response envelope:
 *   { TotalCount, TotalPages, Result: [ event ], NextPageUrl, PreviousPageUrl }
 * Each Result event:
 *   id, latitude, longitude, date_start ("YYYY-MM-DD"), date_end, type_of_violence (integer:
 *   1=state-based, 2=non-state, 3=one-sided per the GED codebook), best (best fatality estimate),
 *   country, side_a, side_b.
 * Licence: CC BY 4.0 — redistribution + on-map rendering PERMITTED with attribution. Required cite
 * surfaced in the renderer (Davies, Pettersson & Öberg 2026, JPR; Sundberg & Melander 2013, JPR 50(4)).
 */

import type { GeoItem } from '@shared/post-mvp-types';
import { strictNum, inRange } from '../feeds';
import { safeFetch } from '../../net/safe-fetch';
import { readTextCapped } from '../../net/limits';

// Cap mapped items so a pathological feed can't bloat renderer state (mirrors feeds.ts MAX_FEED_ITEMS).
const MAX_UCDP_ITEMS = 2000;
const MAX_FIELD = 8000;
const MAX_TITLE = 140;
const DEFAULT_VERSION = '26.1';
// Versions are interpolated into the path → allowlist a known-safe shape (digits + one dot).
const VERSION_RE = /^\d{1,3}(\.\d{1,3})?$/;

interface UcdpEvent {
  id?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  date_start?: unknown;
  type_of_violence?: unknown;
  best?: unknown;
  country?: unknown;
  side_a?: unknown;
  side_b?: unknown;
}
interface UcdpResponse { Result?: unknown }

/** best (fatalities) → severity. >=25 high, >=1 medium, else low (incl. missing/non-finite). */
function severityForBest(best: unknown): GeoItem['severity'] {
  const b = strictNum(best);
  if (Number.isFinite(b) && b >= 25) return 'high';
  if (Number.isFinite(b) && b >= 1) return 'medium';
  return 'low';
}

/** type_of_violence integer → label (GED codebook: 1=state-based, 2=non-state, 3=one-sided). */
function violenceLabel(t: unknown): string {
  const n = strictNum(t);
  if (n === 1) return 'State-based conflict';
  if (n === 2) return 'Non-state conflict';
  if (n === 3) return 'One-sided violence';
  return 'Conflict event';
}

/** Pure parse: UCDP GED Result JSON → GeoItem[]. No IO, so unit-testable without network/token.
 *  Drops events with out-of-range/NaN coordinates (no silent (0,0)) or no stable id. */
export function parseUcdp(json: unknown): GeoItem[] {
  const resp = (json ?? {}) as UcdpResponse;
  const events = Array.isArray(resp.Result) ? (resp.Result as UcdpEvent[]) : [];
  const out: GeoItem[] = [];
  for (const ev of events) {
    if (out.length >= MAX_UCDP_ITEMS) break;
    const lat = strictNum(ev?.latitude);
    const lon = strictNum(ev?.longitude);
    if (!inRange(lat, lon)) continue; // coordinate-integrity guard: never a silent (0,0)/off-globe pin
    const idRaw = ev?.id;
    const id = typeof idRaw === 'string' || typeof idRaw === 'number' ? String(idRaw) : '';
    if (!id) continue; // no stable id ⇒ skip (id collisions/merge would be unsafe)
    const sideA = typeof ev?.side_a === 'string' ? ev.side_a.trim() : '';
    const sideB = typeof ev?.side_b === 'string' ? ev.side_b.trim() : '';
    const sides = sideA && sideB ? `${sideA} vs ${sideB}` : (sideA || sideB);
    const label = violenceLabel(ev?.type_of_violence);
    const titleRaw = sides ? `${label}: ${sides}` : label;
    const title = (titleRaw.length > MAX_FIELD ? titleRaw.slice(0, MAX_FIELD) : titleRaw).slice(0, MAX_TITLE);
    const published = typeof ev?.date_start === 'string' && ev.date_start ? ev.date_start : undefined;
    out.push({
      id: 'ucdp:' + id,
      sourceId: 'threat:ucdp',
      title,
      published,
      lat,
      lon,
      located: 'geo',
      category: 'conflict',
      severity: severityForBest(ev?.best)
    });
  }
  return out;
}

/** Build the UCDP GED URL. `version` is allowlisted to a digit/dot shape (path-injection guard);
 *  `pagesize` is bounded to the item cap. */
export function buildUcdpUrl(opts: { version?: string; pagesize?: number }): string {
  const v = typeof opts?.version === 'string' && VERSION_RE.test(opts.version.trim()) ? opts.version.trim() : DEFAULT_VERSION;
  const pagesize = Number.isFinite(opts?.pagesize) ? Math.max(1, Math.min(Math.floor(opts!.pagesize!), MAX_UCDP_ITEMS)) : 1000;
  return `https://ucdpapi.pcr.uu.se/api/gedevents/${v}?pagesize=${pagesize}&page=0`;
}

/** Fetch + parse the UCDP GED feed. `token` is read main-side from secretStore by the caller and
 *  MUST be non-empty (the handler refuses absent tokens). Throws on network/HTTP failure. The token
 *  travels only in the x-ucdp-access-token header passed to safeFetch — never logged. */
export async function fetchUcdp(token: string, opts: { version?: string }): Promise<GeoItem[]> {
  if (!token) return []; // key-gate (defence in depth; the handler also gates)
  const url = buildUcdpUrl({ version: opts?.version, pagesize: MAX_UCDP_ITEMS });
  const res = await safeFetch(url, 4, { Accept: 'application/json', 'x-ucdp-access-token': token });
  if (!res.ok) throw new Error(`UCDP HTTP ${res.status}`);
  return parseUcdp(JSON.parse(await readTextCapped(res)));
}
