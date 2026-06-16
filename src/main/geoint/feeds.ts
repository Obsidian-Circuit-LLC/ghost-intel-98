/**
 * GeoINT feed parsers (pure, no IO): RSS/Atom/OPML via fast-xml-parser, GeoJSON via
 * JSON.parse. RSS/Atom items are geocoded with the supplied geocoder when they carry no
 * explicit coordinates (GeoRSS geo:lat/geo:long). GeoJSON points arrive pre-located.
 */

import { XMLParser } from 'fast-xml-parser';
import { randomUUID } from 'node:crypto';
import type { GeoItem, GeoSourceType, GeoXmlMap } from '@shared/post-mvp-types';
import { classify } from './classify';

type Geocoder = (text: string) => { lat: number; lon: number; name: string } | null;

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' });

/** Parse XML with the SAME fast-xml-parser config every GeoINT parser uses (ignoreAttributes:false,
 *  '@_' attr prefix, '#text' text node). Threat-layer modules (e.g. GDACS GeoRSS) reuse this instead
 *  of constructing a second, differently-configured parser — one parser config, one set of edge cases. */
export function parseXml(body: string): Record<string, any> {
  return xml.parse(body) as Record<string, any>;
}

const arr = <T>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
// Bound per-feed work: cap items and clip each text field, so a hostile feed can't drive a
// CPU DoS through the per-item gazetteer regex sweep or bloat the cache (red-team L7).
const MAX_FEED_ITEMS = 2000;
const MAX_FIELD = 8000;
const clip = (s: string): string => (s.length > MAX_FIELD ? s.slice(0, MAX_FIELD) : s);
const txt = (v: unknown): string =>
  clip(v == null ? '' : typeof v === 'object' ? String((v as Record<string, unknown>)['#text'] ?? '') : String(v));

/** Walk a dot-path into a fast-xml-parser object tree. Attributes are addressed with the
 *  '@_' prefix. When a node is an array (repeated XML element), index into [0] before applying
 *  the next key. Rejects prototype-polluting segments so a hostile map can't traverse the
 *  prototype chain. Returns undefined on any missing link. */
const PROTO_BLOCKLIST = new Set(['__proto__', 'constructor', 'prototype']);
export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const seg of path.split('.')) {
    if (PROTO_BLOCKLIST.has(seg)) return undefined;
    if (Array.isArray(cur)) cur = cur[0];
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function locate(
  title: string,
  summary: string,
  geo: { lat: number; lon: number } | null,
  geocode: Geocoder
): Pick<GeoItem, 'lat' | 'lon' | 'located' | 'place'> {
  if (geo) return { lat: geo.lat, lon: geo.lon, located: 'geo' };
  const g = geocode(`${title} ${summary}`);
  return g ? { lat: g.lat, lon: g.lon, located: 'gazetteer', place: g.name } : { located: 'none' };
}

export function parseRss(body: string, sourceId: string, geocode: Geocoder): GeoItem[] {
  const doc = xml.parse(body) as Record<string, any>;
  return arr(doc?.rss?.channel?.item).slice(0, MAX_FEED_ITEMS).map((it: Record<string, unknown>) => {
    const title = txt(it['title']);
    const summary = txt(it['description']);
    // strictNum + inRange like every sibling parser — Number('')===0 / Number('0x10')===16
    // would otherwise stamp a silent (0,0)/misread 'geo' pin. Misread or out-of-range → drop.
    const lat = strictNum(it['geo:lat']);
    const lon = strictNum(it['geo:long']);
    const geo = inRange(lat, lon) ? { lat, lon } : null;
    return {
      id: randomUUID(),
      sourceId,
      title,
      link: txt(it['link']) || undefined,
      summary: summary || undefined,
      published: txt(it['pubDate']) || undefined,
      ...locate(title, summary, geo, geocode),
      ...classify(title, summary)
    };
  });
}

export function parseAtom(body: string, sourceId: string, geocode: Geocoder): GeoItem[] {
  const doc = xml.parse(body) as Record<string, any>;
  return arr(doc?.feed?.entry).slice(0, MAX_FEED_ITEMS).map((e: Record<string, unknown>) => {
    const title = txt(e['title']);
    const summary = txt(e['summary']);
    const linkEl = arr(e['link'])[0] as Record<string, unknown> | undefined;
    const link = linkEl ? String(linkEl['@_href'] ?? '') : '';
    return {
      id: randomUUID(),
      sourceId,
      title,
      link: link || undefined,
      summary: summary || undefined,
      published: txt(e['updated']) || undefined,
      ...locate(title, summary, null, geocode),
      ...classify(title, summary)
    };
  });
}

export function parseGeoJson(body: string, sourceId: string): GeoItem[] {
  const fc = JSON.parse(body) as {
    features?: { geometry?: { type?: string; coordinates?: number[] }; properties?: Record<string, unknown> }[];
  };
  return arr(fc.features)
    .filter((f) => {
      if (f.geometry?.type !== 'Point' || !Array.isArray(f.geometry.coordinates) || f.geometry.coordinates.length < 2) return false;
      // Drop non-finite or out-of-range coordinates: ["x",10] → NaN lon, [200,5] → off-globe.
      // A NaN/garbage pin stamped located:'geo' is a silent mislocation in an OSINT tool.
      const [lon, lat] = f.geometry.coordinates as number[]; // GeoJSON order is [lon, lat]
      return Number.isFinite(lon) && Number.isFinite(lat) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
    })
    .slice(0, MAX_FEED_ITEMS)
    .map((f) => {
      const [lon, lat] = f.geometry!.coordinates as number[]; // GeoJSON order is [lon, lat]
      const p = f.properties ?? {};
      const title = clip(String(p['title'] ?? p['name'] ?? 'Untitled'));
      const summary = typeof p['description'] === 'string' ? clip(p['description'] as string) : undefined;
      return {
        id: randomUUID(),
        sourceId,
        title,
        link: typeof p['link'] === 'string' ? p['link'] : undefined,
        summary,
        published: typeof p['date'] === 'string' ? (p['date'] as string) : undefined,
        lat,
        lon,
        located: 'geo' as const,
        ...classify(title, summary ?? '')
      };
    });
}

/** Strip HTML tags to plain text for a JSON Feed item whose only body is `content_html`. Tag
 *  removal only (no entity decode) — enough for a reading-list summary; the gazetteer sweep then
 *  runs on the result like any other RSS/Atom summary. */
const stripHtml = (s: string): string => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/** JSON Feed (jsonfeed.org) parser. Mirrors parseRss: same classify()/located:'none' shape, items
 *  geocoded afterward by the sources.ts pipeline via the gazetteer. Defensive — tolerates missing
 *  fields and returns [] when `items` isn't an array (a non-feed JSON body, or a hostile shape). */
export function parseJsonFeed(body: string, sourceId: string): GeoItem[] {
  let doc: { items?: unknown };
  try { doc = JSON.parse(body) as { items?: unknown }; } catch { return []; }
  if (!doc || !Array.isArray(doc.items)) return [];
  return (doc.items as Record<string, unknown>[]).slice(0, MAX_FEED_ITEMS).map((it) => {
    const item = (it ?? {}) as Record<string, unknown>;
    const title = clip(typeof item['title'] === 'string' ? (item['title'] as string) : '');
    const html = typeof item['content_html'] === 'string' ? (item['content_html'] as string) : '';
    const summary = clip(
      typeof item['summary'] === 'string' ? (item['summary'] as string)
      : typeof item['content_text'] === 'string' ? (item['content_text'] as string)
      : html ? stripHtml(html)
      : ''
    );
    const url = typeof item['url'] === 'string' ? (item['url'] as string) : undefined;
    const idKey = (typeof item['id'] === 'string' || typeof item['id'] === 'number')
      ? String(item['id']) : (url ?? '');
    const image =
      typeof item['image'] === 'string' ? (item['image'] as string)
      : typeof item['banner_image'] === 'string' ? (item['banner_image'] as string)
      : undefined;
    return {
      id: `${sourceId}:${idKey}`,
      sourceId,
      title,
      link: url,
      summary: summary || undefined,
      published: typeof item['date_published'] === 'string' ? (item['date_published'] as string) : undefined,
      image,
      located: 'none' as const,
      ...classify(title, summary)
    };
  });
}

/** True iff lat/lon are finite and on-globe — the same guard parseGeoJson applies, so a
 *  garbage coordinate never becomes a silently-mislocated 'geo' pin. */
export function inRange(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
}

/** Strict coordinate parse: returns NaN for empty/whitespace/non-decimal tokens (Number("")===0,
 *  Number("0x10")===16 would otherwise pass the finite+range guard and stamp a silent (0,0)/misread
 *  'geo' pin — forbidden for an OSINT tool). Accepts a plain decimal/float with optional sign/exponent. */
export function strictNum(token: unknown): number {
  const s = String(token ?? '').trim();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return NaN;
  return Number(s);
}

export function parseKml(body: string, sourceId: string, _geocode: Geocoder): GeoItem[] {
  const doc = xml.parse(body) as Record<string, any>;
  const root = doc?.kml?.Document ?? doc?.kml?.Folder ?? doc?.kml ?? {};
  // Placemarks can sit directly under the root or one level down inside Folder(s).
  const direct = arr(root.Placemark);
  const nested = arr(root.Folder).flatMap((f: Record<string, unknown>) => arr(f.Placemark));
  const placemarks = [...direct, ...nested] as Record<string, any>[];
  const out: GeoItem[] = [];
  for (const pm of placemarks.slice(0, MAX_FEED_ITEMS)) {
    const coordStr = pm?.Point?.coordinates;
    if (coordStr == null) continue; // LineString/Polygon placemarks: no single pin in v1
    const [lonS, latS] = String(coordStr).trim().split(',');
    const lon = strictNum(lonS);
    const lat = strictNum(latS);
    if (!inRange(lat, lon)) continue;
    const title = txt(pm.name) || 'Untitled';
    const summary = txt(pm.description);
    out.push({
      id: randomUUID(),
      sourceId,
      title,
      summary: summary || undefined,
      lat,
      lon,
      located: 'geo',
      ...classify(title, summary)
    });
  }
  return out;
}

export function parseGpx(body: string, sourceId: string, _geocode: Geocoder): GeoItem[] {
  const doc = xml.parse(body) as Record<string, any>;
  // Waypoints only in v1. Tracks (trk/trkseg/trkpt) and routes (rte/rtept) are paths, not pins.
  const wpts = arr(doc?.gpx?.wpt) as Record<string, any>[];
  const out: GeoItem[] = [];
  for (const w of wpts.slice(0, MAX_FEED_ITEMS)) {
    const lat = strictNum(w['@_lat']);
    const lon = strictNum(w['@_lon']);
    if (!inRange(lat, lon)) continue;
    const title = txt(w.name) || 'Waypoint';
    const summary = txt(w.desc);
    out.push({
      id: randomUUID(),
      sourceId,
      title,
      summary: summary || undefined,
      lat,
      lon,
      located: 'geo',
      ...classify(title, summary)
    });
  }
  return out;
}

export function parseXmlMapped(body: string, sourceId: string, map: GeoXmlMap, geocode: Geocoder): GeoItem[] {
  const doc = xml.parse(body) as Record<string, unknown>;
  const items = arr(getPath(doc, map.itemsPath)) as Record<string, unknown>[];
  return items.slice(0, MAX_FEED_ITEMS).map((it) => {
    const title = map.title ? txt(getPath(it, map.title)) : 'Untitled';
    const summary = map.summary ? txt(getPath(it, map.summary)) : '';
    const lat = strictNum(getPath(it, map.lat));
    const lon = strictNum(getPath(it, map.lon));
    const geo = inRange(lat, lon) ? { lat, lon } : null;
    return {
      id: randomUUID(),
      sourceId,
      title: title || 'Untitled',
      link: map.link ? txt(getPath(it, map.link)) || undefined : undefined,
      summary: summary || undefined,
      published: map.date ? txt(getPath(it, map.date)) || undefined : undefined,
      ...locate(title, summary, geo, geocode),
      ...classify(title, summary)
    };
  });
}

export function detectType(url: string, body: string): GeoSourceType {
  const u = url.toLowerCase();
  if (u.endsWith('.kml')) return 'kml';
  if (u.endsWith('.gpx')) return 'gpx';
  if (u.endsWith('.geojson') || u.endsWith('.json')) return 'geojson';
  const head = body.slice(0, 512).toLowerCase();
  if (head.includes('<feed') && head.includes('atom')) return 'atom';
  // JSON bodies: GeoJSON FeatureCollection wins first (it carries coordinates → map pins). Only
  // when it is NOT a FeatureCollection do we look for a JSON Feed: a `version` containing 'jsonfeed'
  // plus an `items` array. Parse the whole body (not just the 512-char head) so the check is robust
  // to field ordering. Anything else JSON-shaped falls through to geojson as before.
  if (head.trimStart().startsWith('{') || head.includes('"featurecollection"')) {
    try {
      const j = JSON.parse(body) as { type?: unknown; version?: unknown; items?: unknown };
      if (typeof j?.type === 'string' && j.type.toLowerCase() === 'featurecollection') return 'geojson';
      if (typeof j?.version === 'string' && j.version.toLowerCase().includes('jsonfeed') && Array.isArray(j?.items)) {
        return 'jsonfeed';
      }
    } catch { /* not parseable JSON — fall through */ }
    return 'geojson';
  }
  return 'rss';
}

export function parseOpml(body: string): { label: string; url: string; type: GeoSourceType }[] {
  const doc = xml.parse(body) as Record<string, any>;
  const out: { label: string; url: string; type: GeoSourceType }[] = [];
  const walk = (nodes: unknown): void => {
    for (const n of arr(nodes) as Record<string, unknown>[]) {
      const url = n['@_xmlUrl'] as string | undefined;
      if (url) out.push({ label: String(n['@_text'] ?? n['@_title'] ?? url), url, type: detectType(url, '') });
      if (n['outline']) walk(n['outline']);
    }
  };
  walk(doc?.opml?.body?.outline);
  return out;
}
