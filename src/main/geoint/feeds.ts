/**
 * GeoINT feed parsers (pure, no IO): RSS/Atom/OPML via fast-xml-parser, GeoJSON via
 * JSON.parse. RSS/Atom items are geocoded with the supplied geocoder when they carry no
 * explicit coordinates (GeoRSS geo:lat/geo:long). GeoJSON points arrive pre-located.
 */

import { XMLParser } from 'fast-xml-parser';
import { randomUUID } from 'node:crypto';
import type { GeoItem, GeoSourceType } from '@shared/post-mvp-types';

type Geocoder = (text: string) => { lat: number; lon: number; name: string } | null;

const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' });
const arr = <T>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const txt = (v: unknown): string =>
  v == null ? '' : typeof v === 'object' ? String((v as Record<string, unknown>)['#text'] ?? '') : String(v);

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
  return arr(doc?.rss?.channel?.item).map((it: Record<string, unknown>) => {
    const title = txt(it['title']);
    const summary = txt(it['description']);
    const lat = it['geo:lat'] != null ? Number(it['geo:lat']) : NaN;
    const lon = it['geo:long'] != null ? Number(it['geo:long']) : NaN;
    const geo = !Number.isNaN(lat) && !Number.isNaN(lon) ? { lat, lon } : null;
    return {
      id: randomUUID(),
      sourceId,
      title,
      link: txt(it['link']) || undefined,
      summary: summary || undefined,
      published: txt(it['pubDate']) || undefined,
      ...locate(title, summary, geo, geocode)
    };
  });
}

export function parseAtom(body: string, sourceId: string, geocode: Geocoder): GeoItem[] {
  const doc = xml.parse(body) as Record<string, any>;
  return arr(doc?.feed?.entry).map((e: Record<string, unknown>) => {
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
      ...locate(title, summary, null, geocode)
    };
  });
}

export function parseGeoJson(body: string, sourceId: string): GeoItem[] {
  const fc = JSON.parse(body) as {
    features?: { geometry?: { type?: string; coordinates?: number[] }; properties?: Record<string, unknown> }[];
  };
  return arr(fc.features)
    .filter((f) => f.geometry?.type === 'Point' && Array.isArray(f.geometry.coordinates) && f.geometry.coordinates.length >= 2)
    .map((f) => {
      const [lon, lat] = f.geometry!.coordinates as number[]; // GeoJSON order is [lon, lat]
      const p = f.properties ?? {};
      return {
        id: randomUUID(),
        sourceId,
        title: String(p['title'] ?? p['name'] ?? 'Untitled'),
        link: typeof p['link'] === 'string' ? p['link'] : undefined,
        summary: typeof p['description'] === 'string' ? (p['description'] as string) : undefined,
        published: typeof p['date'] === 'string' ? (p['date'] as string) : undefined,
        lat,
        lon,
        located: 'geo' as const
      };
    });
}

export function detectType(url: string, body: string): GeoSourceType {
  const u = url.toLowerCase();
  if (u.endsWith('.geojson') || u.endsWith('.json')) return 'geojson';
  const head = body.slice(0, 512).toLowerCase();
  if (head.includes('<feed') && head.includes('atom')) return 'atom';
  if (head.trimStart().startsWith('{') || head.includes('"featurecollection"')) return 'geojson';
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
