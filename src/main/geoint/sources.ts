/**
 * GeoINT source store + egress-gated fetch. Sources and per-source item caches persist
 * under dataRoot via secure-fs (vault-encrypted at rest), mirroring streams.ts. The
 * dashboard renders cached items offline; fetchSource only reaches the network when the
 * caller passes networkEnabled=true (the IPC refresh handler checks the setting first;
 * fetchSource re-guards as defense in depth).
 */

import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { dataRoot } from '../storage/paths';
import { secureReadText, secureWriteFile } from '../storage/secure-fs';
import type { GeoItem, GeoSnapshot, GeoSource, GeoSourceType } from '@shared/post-mvp-types';
import { parseRss, parseAtom, parseGeoJson, parseKml, parseGpx, parseXmlMapped, detectType } from './feeds';
import { geocoder } from './gazetteer';
import { isPublicHttpUrl } from '../security/validate';
import { readTextCapped } from '../net/limits';
import { safeFetch } from '../net/safe-fetch';

const sourcesFile = (): string => join(dataRoot(), 'geoint-sources.json');
const cacheFile = (id: string): string => join(dataRoot(), 'geoint-cache', `${id}.json`);

async function readSources(): Promise<GeoSource[]> {
  try {
    return JSON.parse(await secureReadText(sourcesFile())) as GeoSource[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    return [];
  }
}
async function writeSources(list: GeoSource[]): Promise<void> {
  await secureWriteFile(sourcesFile(), JSON.stringify(list, null, 2));
}
async function readCache(id: string): Promise<GeoItem[]> {
  try { return JSON.parse(await secureReadText(cacheFile(id))) as GeoItem[]; } catch { return []; }
}

export async function _resetForTest(): Promise<void> { await writeSources([]); }
export async function listSources(): Promise<GeoSource[]> { return readSources(); }

export async function addSource(input: { label: string; url: string; type: GeoSourceType; xmlMap?: GeoSource['xmlMap'] }): Promise<GeoSource> {
  const list = await readSources();
  const s: GeoSource = { id: randomUUID(), label: input.label, url: input.url, type: input.type, enabled: true, xmlMap: input.xmlMap };
  list.push(s);
  await writeSources(list);
  return s;
}
export async function updateSource(id: string, patch: Partial<GeoSource>): Promise<void> {
  const list = await readSources();
  const i = list.findIndex((x) => x.id === id);
  if (i >= 0) { list[i] = { ...list[i], ...patch, id: list[i].id }; await writeSources(list); }
}
export async function removeSource(id: string): Promise<void> {
  await writeSources((await readSources()).filter((x) => x.id !== id));
  // Best-effort: drop this source's cache file so removing a source doesn't orphan its
  // cached items on disk. `force` ⇒ a missing file is a no-op, so the delete can't throw
  // out of source removal.
  await rm(cacheFile(id), { force: true });
}

/** Full GeoINT reset — the escape hatch for a poisoned state that survives delete+reinstall.
 *  Clears the sources list AND removes every per-source cache file by deleting the whole
 *  geoint-cache directory recursively (`force` ignores a missing dir). Local fs only. */
export async function purgeAll(): Promise<void> {
  // Accepted race: a purge concurrent with an in-flight fetchSource can let that fetch re-write
  // a cache file after the rm. Harmless — writeSources([]) makes it invisible to snapshot() (no
  // source references it), and the next purge clears it. No locking by design.
  await writeSources([]);
  await rm(join(dataRoot(), 'geoint-cache'), { recursive: true, force: true });
}
export async function importSources(items: { label: string; url: string; type: GeoSourceType }[]): Promise<number> {
  const list = await readSources();
  const seen = new Set(list.map((s) => s.url.toLowerCase()));
  let added = 0;
  for (const it of items) {
    if (seen.has(it.url.toLowerCase())) continue;
    if (!isPublicHttpUrl(it.url)) continue; // SSRF guard: OPML can carry internal/metadata URLs
    list.push({ id: randomUUID(), label: it.label, url: it.url, type: it.type, enabled: true });
    seen.add(it.url.toLowerCase());
    added++;
  }
  await writeSources(list);
  return added;
}
export async function cacheItems(sourceId: string, items: GeoItem[]): Promise<void> {
  await secureWriteFile(cacheFile(sourceId), JSON.stringify(items, null, 2));
}
export async function snapshot(): Promise<GeoSnapshot> {
  const sources = await readSources();
  const items: GeoItem[] = [];
  for (const s of sources) items.push(...(await readCache(s.id)));
  return { sources, items };
}
export async function setItemLocation(itemId: string, loc: { lat: number; lon: number } | null): Promise<void> {
  const sources = await readSources();
  for (const s of sources) {
    const items = await readCache(s.id);
    const i = items.findIndex((it) => it.id === itemId);
    if (i >= 0) {
      items[i] = loc
        ? { ...items[i], lat: loc.lat, lon: loc.lon, located: 'manual' }
        : { ...items[i], lat: undefined, lon: undefined, located: 'none' };
      await cacheItems(s.id, items);
      return;
    }
  }
}

/** Geocode a free-text place query via OpenStreetMap Nominatim. Egress-gated: the caller
 *  passes networkEnabled (the IPC handler checks the setting first; this re-guards as defense
 *  in depth). Fixed public host, but still routed through the SSRF-revalidating safeFetch.
 *  Returns the top hit or null; throws only on a network/HTTP failure. */
export async function geocode(query: string, networkEnabled: boolean): Promise<{ lat: number; lon: number; label: string } | null> {
  if (!networkEnabled) return null;
  const q = query.trim().slice(0, 200);
  if (!q) return null;
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`;
  // Nominatim's usage policy asks for an identifying User-Agent.
  const res = await safeFetch(url, 4, { 'User-Agent': 'GhostAccess98 (offline-first OSINT desktop)', Accept: 'application/json' });
  if (!res.ok) throw new Error(`geocoder HTTP ${res.status}`);
  const arr = JSON.parse(await readTextCapped(res)) as Array<{ lat?: string; lon?: string; display_name?: string }>;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const lat = Number(arr[0].lat);
  const lon = Number(arr[0].lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, label: arr[0].display_name ?? q };
}

/** Fetch + parse + cache one source. networkEnabled=false ⇒ no-op (egress gate;
 *  the IPC handler also checks the setting). Never throws past here — failures are
 *  recorded on the source as lastError. */
export async function fetchSource(id: string, networkEnabled: boolean): Promise<{ ok: boolean; count: number }> {
  if (!networkEnabled) return { ok: false, count: 0 };
  const list = await readSources();
  const s = list.find((x) => x.id === id);
  if (!s || !s.enabled) return { ok: false, count: 0 };
  try {
    const res = await safeFetch(s.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await readTextCapped(res);
    const type: GeoSourceType = s.type ?? detectType(s.url, body);
    const geo = geocoder();
    const items =
      type === 'geojson' ? parseGeoJson(body, id)
      : type === 'kml' ? parseKml(body, id, geo)
      : type === 'gpx' ? parseGpx(body, id, geo)
      : type === 'xml' ? (s.xmlMap ? parseXmlMapped(body, id, s.xmlMap, geo) : [])
      : type === 'atom' ? parseAtom(body, id, geo)
      : detectType(s.url, body) === 'atom' ? parseAtom(body, id, geo)
      : parseRss(body, id, geo);
    await cacheItems(id, items);
    s.lastFetched = new Date().toISOString(); // display metadata only
    s.lastError = undefined;
    await writeSources(list);
    return { ok: true, count: items.length };
  } catch (err) {
    s.lastError = (err as Error).message;
    await writeSources(list);
    return { ok: false, count: 0 };
  }
}
