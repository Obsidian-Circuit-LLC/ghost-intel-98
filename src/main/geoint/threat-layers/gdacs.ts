/**
 * GDACS disasters threat layer (GeoINT reimagine R6). Stateless: fetch the public GDACS GeoRSS feed
 * and map it to GeoItem[]. NOT persisted to the secure-fs cache — threat layers are on-demand/
 * ephemeral, held only in renderer state while their toggle is on. Egress is gated by the IPC
 * handler (settings.geoint.networkEnabled); the dispatcher/handler call this only when on.
 *
 * Feed: https://www.gdacs.org/xml/rss.xml — RSS 2.0 + GeoRSS. Verified live 2026-06-15: each <item>
 * nests coordinates under <geo:Point><geo:lat/><geo:long/></geo:Point> (fast-xml-parser yields a
 * geo:Point OBJECT with geo:lat/geo:long children — NOT flat geo:lat on the item), plus a separate
 * "<lat> <lon>" <georss:point> string, a plain-string <gdacs:alertlevel> (Green/Yellow/Orange/Red),
 * a <guid isPermaLink="false">FL…</guid>, <link>, <pubDate>. Parsed with the shared feeds.ts XMLParser
 * (same config as parseRss/parseKml) — no second parser. Source: research-wiki prior-art §3.
 * Licence: GDACS — UN OCHA / EC-JRC (feed self-declares public domain; formal terms unconfirmed).
 */

import type { GeoItem } from '@shared/post-mvp-types';
import { strictNum, inRange, parseXml } from '../feeds';
import { safeFetch } from '../../net/safe-fetch';
import { readTextCapped } from '../../net/limits';

// Cap mapped items so a pathological feed can't bloat renderer state (mirrors feeds.ts MAX_FEED_ITEMS).
const MAX_GDACS_ITEMS = 2000;
const MAX_FIELD = 8000;
const clip = (s: string): string => (s.length > MAX_FIELD ? s.slice(0, MAX_FIELD) : s);

/** A text-or-{#text} node → string (fast-xml-parser yields {#text,…} when an element has attributes). */
function nodeText(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'object') return String((v as Record<string, unknown>)['#text'] ?? '');
  return String(v);
}

/** alertlevel → severity. Green→low, Yellow/Orange→medium, Red→high. Unknown/missing→low. */
function severityForAlert(level: unknown): GeoItem['severity'] {
  const s = nodeText(level).trim().toLowerCase();
  if (s === 'red') return 'high';
  if (s === 'orange' || s === 'yellow') return 'medium';
  return 'low';
}

/** Extract [lat, lon] from a GDACS item: prefer nested geo:Point.{geo:lat,geo:long}; fall back to
 *  the "lat lon" georss:point string. Returns null when neither yields an on-globe coordinate. */
function coordsFor(it: Record<string, unknown>): { lat: number; lon: number } | null {
  const pt = it['geo:Point'];
  if (pt && typeof pt === 'object') {
    const o = pt as Record<string, unknown>;
    const lat = strictNum(nodeText(o['geo:lat']));
    const lon = strictNum(nodeText(o['geo:long']));
    if (inRange(lat, lon)) return { lat, lon };
  }
  const gr = it['georss:point'];
  if (gr != null) {
    const [latS, lonS] = nodeText(gr).trim().split(/\s+/);
    const lat = strictNum(latS);
    const lon = strictNum(lonS);
    if (inRange(lat, lon)) return { lat, lon };
  }
  return null;
}

/** Pure parse: GDACS GeoRSS XML → GeoItem[]. No IO, so unit-testable without network. Drops items
 *  with out-of-range/NaN coordinates (no silent (0,0) pins). */
export function parseGdacs(body: string): GeoItem[] {
  let doc: Record<string, any>;
  try { doc = parseXml(body); } catch { return []; }
  const rawItems = doc?.rss?.channel?.item;
  const items: Record<string, unknown>[] = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
  const out: GeoItem[] = [];
  for (const it of items) {
    if (out.length >= MAX_GDACS_ITEMS) break;
    const c = coordsFor(it);
    if (!c) continue; // coordinate-integrity guard: never a silent (0,0)/off-globe pin
    // Stable id: prefer guid (FL1103920 etc.), else link. No stable id ⇒ skip (merge would be unsafe).
    const guid = nodeText(it['guid']).trim();
    const link = nodeText(it['link']).trim();
    const idKey = guid || link;
    if (!idKey) continue;
    const title = clip(nodeText(it['title']).trim() || 'GDACS alert');
    const published = nodeText(it['pubDate']).trim() || undefined;
    out.push({
      id: 'gdacs:' + idKey,
      sourceId: 'threat:gdacs',
      title,
      link: link || undefined,
      published,
      lat: c.lat,
      lon: c.lon,
      located: 'geo',
      category: 'disaster',
      severity: severityForAlert(it['gdacs:alertlevel'])
    });
  }
  return out;
}

/** Fetch + parse the GDACS GeoRSS feed. Throws on network/HTTP failure (the handler surfaces it to
 *  the renderer's busy/error state). Takes no options — the GDACS feed is a single fixed URL. */
export async function fetchGdacs(_opts: object): Promise<GeoItem[]> {
  const url = 'https://www.gdacs.org/xml/rss.xml';
  const res = await safeFetch(url, 4, { Accept: 'application/rss+xml, application/xml, text/xml' });
  if (!res.ok) throw new Error(`GDACS HTTP ${res.status}`);
  return parseGdacs(await readTextCapped(res));
}
