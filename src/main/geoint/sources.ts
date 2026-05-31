/**
 * GeoINT source store + egress-gated fetch. Sources and per-source item caches persist
 * under dataRoot via secure-fs (vault-encrypted at rest), mirroring streams.ts. The
 * dashboard renders cached items offline; fetchSource only reaches the network when the
 * caller passes networkEnabled=true (the IPC refresh handler checks the setting first;
 * fetchSource re-guards as defense in depth).
 */

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { dataRoot } from '../storage/paths';
import { secureReadText, secureWriteFile } from '../storage/secure-fs';
import type { GeoItem, GeoSnapshot, GeoSource, GeoSourceType } from '@shared/post-mvp-types';
import { parseRss, parseAtom, parseGeoJson, detectType } from './feeds';
import { geocoder } from './gazetteer';

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

export async function addSource(input: { label: string; url: string; type: GeoSourceType }): Promise<GeoSource> {
  const list = await readSources();
  const s: GeoSource = { id: randomUUID(), label: input.label, url: input.url, type: input.type, enabled: true };
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
}
export async function importSources(items: { label: string; url: string; type: GeoSourceType }[]): Promise<number> {
  const list = await readSources();
  const seen = new Set(list.map((s) => s.url.toLowerCase()));
  let added = 0;
  for (const it of items) {
    if (seen.has(it.url.toLowerCase())) continue;
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

/** Fetch + parse + cache one source. networkEnabled=false ⇒ no-op (egress gate;
 *  the IPC handler also checks the setting). Never throws past here — failures are
 *  recorded on the source as lastError. */
export async function fetchSource(id: string, networkEnabled: boolean): Promise<{ ok: boolean; count: number }> {
  if (!networkEnabled) return { ok: false, count: 0 };
  const list = await readSources();
  const s = list.find((x) => x.id === id);
  if (!s || !s.enabled) return { ok: false, count: 0 };
  try {
    const res = await fetch(s.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.text();
    const type: GeoSourceType = s.type ?? detectType(s.url, body);
    const geo = geocoder();
    const items =
      type === 'geojson' ? parseGeoJson(body, id)
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
