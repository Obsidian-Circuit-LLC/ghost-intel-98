/**
 * USGS earthquakes threat layer (GeoINT reimagine R5). Stateless: fetch the public USGS GeoJSON
 * summary feed and map it to GeoItem[]. NOT persisted to the secure-fs cache — threat layers are
 * on-demand/ephemeral, held only in renderer state while their toggle is on. Egress is gated by
 * the IPC handler (settings.geoint.networkEnabled); the dispatcher/handler call this only when on.
 *
 * Feed: https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php — GeoJSON FeatureCollection,
 * coords at geometry.coordinates = [lon, lat, depth] (lon FIRST), place/time/mag in properties.
 * Licence: US Public Domain. Source verified in research-wiki/prior-art/geoint-threatmap-feeds.md §1.
 */

import type { GeoItem } from '@shared/post-mvp-types';
import { strictNum, inRange } from '../feeds';
import { safeFetch } from '../../net/safe-fetch';
import { readTextCapped } from '../../net/limits';

/** Allowlisted USGS feed tokens (timeframe × magnitude threshold). The token is interpolated into
 *  the feed URL, so it MUST be allowlisted — an arbitrary token is path injection into the URL.
 *  Mirror this set in the IPC validator so a hostile renderer arg is rejected at the boundary too. */
export const USGS_FEEDS = [
  'significant_day', 'significant_week',
  '4.5_day', '4.5_week',
  '2.5_day', '2.5_week',
  'all_day', 'all_week'
] as const;
export type UsgsFeed = (typeof USGS_FEEDS)[number];

export const DEFAULT_USGS_FEED: UsgsFeed = '2.5_day';

/** True iff `feed` is an allowlisted USGS feed token. */
export function isUsgsFeed(feed: unknown): feed is UsgsFeed {
  return typeof feed === 'string' && (USGS_FEEDS as readonly string[]).includes(feed);
}

// Cap mapped items — a pathological feed must not bloat renderer state (mirrors feeds.ts MAX_FEED_ITEMS).
const MAX_USGS_ITEMS = 2000;
const MAX_FIELD = 8000;
const clip = (s: string): string => (s.length > MAX_FIELD ? s.slice(0, MAX_FIELD) : s);

interface UsgsFeature {
  id?: unknown;
  geometry?: { type?: string; coordinates?: unknown } | null;
  properties?: { place?: unknown; url?: unknown; time?: unknown; mag?: unknown } | null;
}
interface UsgsFeatureCollection { features?: UsgsFeature[] }

/** mag → severity. >=6 high, >=4 medium, else low (incl. missing/non-finite mag). */
function severityForMag(mag: unknown): GeoItem['severity'] {
  const m = typeof mag === 'number' ? mag : Number(mag);
  if (Number.isFinite(m) && m >= 6) return 'high';
  if (Number.isFinite(m) && m >= 4) return 'medium';
  return 'low';
}

/** Pure parse: USGS GeoJSON FeatureCollection → GeoItem[]. No IO, so it is unit-testable without
 *  network. Drops features with out-of-range/NaN coordinates (no silent (0,0) pins). */
export function parseUsgs(json: unknown): GeoItem[] {
  const fc = (json ?? {}) as UsgsFeatureCollection;
  const features = Array.isArray(fc.features) ? fc.features : [];
  const out: GeoItem[] = [];
  for (const f of features) {
    if (out.length >= MAX_USGS_ITEMS) break;
    const coords = f?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    // USGS/GeoJSON order is [lon, lat, depth] — lon FIRST.
    const lon = strictNum(coords[0]);
    const lat = strictNum(coords[1]);
    if (!inRange(lat, lon)) continue; // coordinate-integrity guard: never a silent (0,0)/off-globe pin
    const p = f?.properties ?? {};
    const fid = typeof f?.id === 'string' || typeof f?.id === 'number' ? String(f.id) : '';
    if (!fid) continue; // no stable id ⇒ skip (id collisions/merge would be unsafe)
    const title = clip(typeof p.place === 'string' && p.place ? p.place : 'Earthquake');
    const t = typeof p.time === 'number' ? p.time : Number(p.time);
    const published = Number.isFinite(t) ? new Date(t).toISOString() : undefined;
    out.push({
      id: 'usgs:' + fid,
      sourceId: 'threat:usgs',
      title,
      link: typeof p.url === 'string' ? p.url : undefined,
      published,
      lat,
      lon,
      located: 'geo',
      category: 'disaster',
      severity: severityForMag(p.mag)
    });
  }
  return out;
}

/** Fetch + parse one USGS feed. `feed` is allowlisted (defaults to 2.5_day); an unknown token is
 *  rejected rather than interpolated into the URL. Throws on network/HTTP failure (the handler
 *  surfaces it to the renderer's busy/error state). */
export async function fetchUsgs(opts: { feed?: string }): Promise<GeoItem[]> {
  const feed: UsgsFeed = isUsgsFeed(opts?.feed) ? opts.feed : DEFAULT_USGS_FEED;
  const url = `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${feed}.geojson`;
  const res = await safeFetch(url, 4, { Accept: 'application/json' });
  if (!res.ok) throw new Error(`USGS HTTP ${res.status}`);
  return parseUsgs(JSON.parse(await readTextCapped(res)));
}
