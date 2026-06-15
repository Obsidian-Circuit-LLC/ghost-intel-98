/**
 * GDELT DOC 2.0 news threat layer (GeoINT reimagine R7). Stateless: fetch the public GDELT DOC API
 * article list and map it to GeoItem[]. NOT persisted to the secure-fs cache — threat layers are
 * on-demand/ephemeral, held only in renderer state while their toggle is on. Egress is gated by the
 * IPC handler (settings.geoint.networkEnabled); the dispatcher/handler call this only when on.
 *
 * Feed: https://api.gdeltproject.org/api/v2/doc/doc?query=<q>&mode=artlist&format=json&timespan=<t>
 *       &maxrecords=<n> — JSON. (The GEO 2.0 endpoint is currently HTTP 404; DOC is the live path.)
 * Verified live 2026-06-15: { articles: [ { url, url_mobile, title, seendate ("YYYYMMDDTHHMMSSZ"),
 * socialimage, domain, language, sourcecountry } ] }.
 *
 * GEO GRANULARITY (important, honestly labelled in the renderer): DOC artlist gives NO per-article
 * lat/lon. The only geo signal is `sourcecountry` — a country NAME (e.g. "South Korea", "Vietnam",
 * "Serbia"). We resolve that name to a COUNTRY CENTROID via the bundled GeoINT gazetteer and place
 * the marker there. This is country-level, NOT precise incident location. An article whose country
 * cannot be resolved is DROPPED — never a fake (0,0)/off-globe pin (coordinate-integrity rule).
 *
 * Licence: GDELT aggregates third-party news; underlying article copyright is not GDELT's to grant.
 * We store only title + link (link-out to the source), not article bodies.
 */

import { createHash } from 'node:crypto';
import type { GeoItem } from '@shared/post-mvp-types';
import { inRange } from '../feeds';
import { geocoder } from '../gazetteer';
import { safeFetch } from '../../net/safe-fetch';
import { readTextCapped } from '../../net/limits';

// Cap mapped items so a pathological feed can't bloat renderer state (mirrors feeds.ts MAX_FEED_ITEMS).
const MAX_GDELT_ITEMS = 2000;
const MAX_FIELD = 8000;
const MAX_QUERY = 256;
const DEFAULT_QUERY = '(conflict OR airstrike OR crisis OR protest OR earthquake OR flood)';
const clip = (s: string): string => (s.length > MAX_FIELD ? s.slice(0, MAX_FIELD) : s);

/** A country-name → {lat,lon,name} resolver. Mirrors the gazetteer geocoder signature so the pure
 *  parser can be unit-tested with a mock (no gazetteer file / IO). */
type CountryGeocoder = (name: string) => { lat: number; lon: number; name: string } | null;

interface GdeltArticle {
  url?: unknown;
  title?: unknown;
  seendate?: unknown;
  sourcecountry?: unknown;
}
interface GdeltResponse { articles?: unknown }

/** Deterministic short id from the article url (FNV-ish via sha1, first 16 hex). Stable across
 *  runs/sessions so re-fetching the same article yields the same GeoItem id (safe de-dupe/merge). */
function urlId(url: string): string {
  return createHash('sha1').update(url).digest('hex').slice(0, 16);
}

/** Pure parse: GDELT DOC artlist JSON → GeoItem[]. No network IO — the country→coord resolution is
 *  injected so this is unit-testable with a mock geocoder. Drops articles whose `sourcecountry` is
 *  missing or unresolvable (no silent (0,0) pin); country centroids only (not precise locations). */
export function parseGdelt(json: unknown, geocode: CountryGeocoder): GeoItem[] {
  const resp = (json ?? {}) as GdeltResponse;
  const articles = Array.isArray(resp.articles) ? (resp.articles as GdeltArticle[]) : [];
  const out: GeoItem[] = [];
  for (const a of articles) {
    if (out.length >= MAX_GDELT_ITEMS) break;
    const url = typeof a?.url === 'string' ? a.url : '';
    if (!url) continue; // no link ⇒ no stable id and nothing to attribute to
    const country = typeof a?.sourcecountry === 'string' ? a.sourcecountry.trim() : '';
    if (!country) continue; // no geo signal at all → drop (DOC has no per-article lat/lon)
    const g = geocode(country);
    if (!g || !inRange(g.lat, g.lon)) continue; // unresolvable country → drop, never (0,0)
    const title = clip(typeof a?.title === 'string' && a.title.trim() ? a.title.trim() : 'GDELT article');
    const published = typeof a?.seendate === 'string' && a.seendate ? a.seendate : undefined;
    out.push({
      id: 'gdelt:' + urlId(url),
      sourceId: 'threat:gdelt',
      title,
      link: url,
      published,
      lat: g.lat,
      lon: g.lon,
      located: 'geo', // country centroid — country-level, labelled honestly in the renderer
      category: 'chatter',
      severity: 'low'
    });
  }
  return out;
}

/** Build the GDELT DOC URL. The user-supplied `query` is trimmed, length-bounded, and
 *  encodeURIComponent'd (no injection beyond the query value); empty falls back to a broad
 *  crisis query. `timespan`/`maxrecords` are fixed/bounded server-side. */
export function buildGdeltUrl(opts: { query?: string }): string {
  const raw = typeof opts?.query === 'string' ? opts.query.trim() : '';
  const query = (raw || DEFAULT_QUERY).slice(0, MAX_QUERY);
  const q = encodeURIComponent(query);
  return `https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=artlist&format=json&timespan=24h&maxrecords=${MAX_GDELT_ITEMS}`;
}

/** Fetch + parse the GDELT DOC feed, resolving sourcecountry → centroid via the bundled gazetteer.
 *  Throws on network/HTTP failure (the handler surfaces it to the renderer's busy/error state). */
export async function fetchGdelt(opts: { query?: string }): Promise<GeoItem[]> {
  const url = buildGdeltUrl({ query: opts?.query });
  const res = await safeFetch(url, 4, { Accept: 'application/json' });
  if (!res.ok) throw new Error(`GDELT HTTP ${res.status}`);
  const geocode = geocoder();
  return parseGdelt(JSON.parse(await readTextCapped(res)), geocode);
}
