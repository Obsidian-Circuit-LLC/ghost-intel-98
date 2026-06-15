/**
 * gdeltcloud events threat layer (KEYED, THIRD-PARTY). Stateless: fetch the gdeltcloud.com events
 * API and map it to GeoItem[]. NOT persisted to the secure-fs cache — threat layers are on-demand/
 * ephemeral. Egress is gated by the IPC handler (settings.geoint.networkEnabled); additionally
 * KEY-gated — the API key is read main-side from secretStore and the fetch refuses (returns []) if
 * absent. The renderer discloses honestly that this ROUTES QUERIES THROUGH gdeltcloud (a 3rd party
 * that sees your queries).
 *
 * Endpoint: https://gdeltcloud.com/api/v2/events  (Authorization: Bearer <key>)
 *
 * SCHEMA SOURCE — built to the published gdeltcloud API reference; NOT live-verified with a key (we
 * have no key). Docs read 2026-06-15: https://www.gdeltcloud.com/ and the v2 api-reference. Response
 * is { data: [ event ] }; each event:
 *   id (string), event_date ("YYYY-MM-DD"), family ("conflict" | "cameoplus"), category (e.g.
 *   "Protests", "Battles"), subcategory, has_fatalities (bool), fatalities (number), and a nested
 *   geo object: geo.latitude, geo.longitude (PER-POINT — docs: "Records without geocoded coordinates
 *   are excluded from bbox queries"), geo.country, geo.admin1. We map per-point lat/lon when present;
 *   an event with no usable coordinate is DROPPED (never a (0,0) pin). We do NOT fall back to a
 *   country centroid here — per the docs the events already carry per-point coordinates.
 * Licence: gdeltcloud is a third-party reseller of GDELT-derived data; underlying news copyright is
 * not theirs to grant. We store only a title + (optional) link, never article bodies.
 */

import type { GeoItem } from '@shared/post-mvp-types';
import { strictNum, inRange } from '../feeds';
import { safeFetch } from '../../net/safe-fetch';
import { readTextCapped } from '../../net/limits';

// Cap mapped items so a pathological feed can't bloat renderer state (mirrors feeds.ts MAX_FEED_ITEMS).
const MAX_GDC_ITEMS = 2000;
const MAX_FIELD = 8000;
const MAX_TITLE = 140;
const MAX_QUERY = 256;
const clip = (s: string): string => (s.length > MAX_FIELD ? s.slice(0, MAX_FIELD) : s);

interface GdcGeo { latitude?: unknown; longitude?: unknown; country?: unknown; admin1?: unknown }
interface GdcEvent {
  id?: unknown;
  event_date?: unknown;
  family?: unknown;
  category?: unknown;
  subcategory?: unknown;
  has_fatalities?: unknown;
  fatalities?: unknown;
  url?: unknown;
  geo?: GdcGeo | null;
}
interface GdcResponse { data?: unknown }

/** family/fatalities → category + severity. `conflict` family or fatalities present → 'conflict';
 *  otherwise 'chatter'. fatalities >=25 high / >=1 medium; else low. */
function categoryFor(ev: GdcEvent): GeoItem['category'] {
  const fam = typeof ev?.family === 'string' ? ev.family.trim().toLowerCase() : '';
  const fatal = ev?.has_fatalities === true || (Number.isFinite(strictNum(ev?.fatalities)) && strictNum(ev?.fatalities) > 0);
  return fam === 'conflict' || fatal ? 'conflict' : 'chatter';
}
function severityFor(ev: GdcEvent): GeoItem['severity'] {
  const f = strictNum(ev?.fatalities);
  if (Number.isFinite(f) && f >= 25) return 'high';
  if ((Number.isFinite(f) && f >= 1) || ev?.has_fatalities === true) return 'medium';
  return 'low';
}

/** Pure parse: gdeltcloud events JSON → GeoItem[]. No IO, so unit-testable without network/key. Maps
 *  per-point geo.latitude/geo.longitude; drops events with no usable coordinate (no silent (0,0)). */
export function parseGdeltCloud(json: unknown): GeoItem[] {
  const resp = (json ?? {}) as GdcResponse;
  const events = Array.isArray(resp.data) ? (resp.data as GdcEvent[]) : [];
  const out: GeoItem[] = [];
  for (const ev of events) {
    if (out.length >= MAX_GDC_ITEMS) break;
    const geo = (ev?.geo ?? {}) as GdcGeo;
    const lat = strictNum(geo.latitude);
    const lon = strictNum(geo.longitude);
    if (!inRange(lat, lon)) continue; // coordinate-integrity guard: never a silent (0,0)/off-globe pin
    const idRaw = ev?.id;
    const id = typeof idRaw === 'string' || typeof idRaw === 'number' ? String(idRaw) : '';
    if (!id) continue; // no stable id ⇒ skip (id collisions/merge would be unsafe)
    const cat = typeof ev?.category === 'string' ? ev.category.trim() : '';
    const sub = typeof ev?.subcategory === 'string' ? ev.subcategory.trim() : '';
    const country = typeof geo.country === 'string' ? geo.country.trim() : '';
    const titleRaw = [sub || cat, country].filter(Boolean).join(' — ') || 'gdeltcloud event';
    const title = clip(titleRaw).slice(0, MAX_TITLE);
    const published = typeof ev?.event_date === 'string' && ev.event_date ? ev.event_date : undefined;
    const link = typeof ev?.url === 'string' && ev.url ? ev.url : undefined;
    out.push({
      id: 'gdeltcloud:' + id,
      sourceId: 'threat:gdeltcloud',
      title,
      link,
      published,
      lat,
      lon,
      located: 'geo',
      category: categoryFor(ev),
      severity: severityFor(ev)
    });
  }
  return out;
}

/** Build the gdeltcloud events URL. Optional free-text `query` is trimmed, length-bounded, and
 *  encodeURIComponent'd; an optional ISO2 `country` is uppercased + validated to two letters. */
export function buildGdeltCloudUrl(opts: { query?: string; country?: string }): string {
  const params = new URLSearchParams();
  const raw = typeof opts?.query === 'string' ? opts.query.trim() : '';
  if (raw) params.set('query', raw.slice(0, MAX_QUERY));
  const c = typeof opts?.country === 'string' ? opts.country.trim().toUpperCase() : '';
  if (/^[A-Z]{2}$/.test(c)) params.set('country', c);
  const qs = params.toString();
  return `https://gdeltcloud.com/api/v2/events${qs ? `?${qs}` : ''}`;
}

/** Fetch + parse the gdeltcloud events feed. `key` is read main-side from secretStore by the caller
 *  and MUST be non-empty (the handler refuses absent keys). Throws on network/HTTP failure. The key
 *  travels only in the Authorization header passed to safeFetch — never logged. */
export async function fetchGdeltCloud(key: string, opts: { query?: string; country?: string }): Promise<GeoItem[]> {
  if (!key) return []; // key-gate (defence in depth; the handler also gates)
  const url = buildGdeltCloudUrl(opts);
  const res = await safeFetch(url, 4, { Accept: 'application/json', Authorization: `Bearer ${key}` });
  if (!res.ok) throw new Error(`gdeltcloud HTTP ${res.status}`);
  return parseGdeltCloud(JSON.parse(await readTextCapped(res)));
}
