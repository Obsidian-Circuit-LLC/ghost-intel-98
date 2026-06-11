/**
 * EyeSpy storage. URLs only — no discovery, no scanning, no brute-force code path exists.
 * Stream playback happens entirely in the renderer.
 */

import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CameraStream } from '@shared/post-mvp-types';
import { dataRoot } from '../storage/paths';
import { secureReadText, secureWriteFile } from '../storage/secure-fs';

function streamsFile(): string {
  return join(dataRoot(), 'streams.json');
}

async function readAll(): Promise<CameraStream[]> {
  try {
    return JSON.parse(await secureReadText(streamsFile())) as CameraStream[];
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return [];
    throw err;
  }
}

async function writeAll(list: CameraStream[]): Promise<void> {
  await secureWriteFile(streamsFile(), JSON.stringify(list, null, 2));
}

export async function list(): Promise<CameraStream[]> {
  return readAll();
}

/**
 * Collect only the geo fields that are actually present and well-formed, so a stream without
 * location data keeps NO geo keys on disk (rather than a litter of `null`/`NaN`). lat/lon must
 * be finite numbers or they are dropped.
 */
function pickGeo(i: Partial<CameraStream>): Partial<CameraStream> {
  const g: Partial<CameraStream> = {};
  if (typeof i.country === 'string' && i.country.trim()) g.country = i.country.trim();
  if (typeof i.region === 'string' && i.region.trim()) g.region = i.region.trim();
  if (typeof i.city === 'string' && i.city.trim()) g.city = i.city.trim();
  if (typeof i.lat === 'number' && Number.isFinite(i.lat)) g.lat = i.lat;
  if (typeof i.lon === 'number' && Number.isFinite(i.lon)) g.lon = i.lon;
  if (typeof i.source === 'string' && i.source.trim()) g.source = i.source.trim();
  return g;
}

export async function upsert(input: Partial<CameraStream> & { url: string; label: string; kind: CameraStream['kind'] }): Promise<CameraStream> {
  const all = await readAll();
  const id = input.id || `cam-${randomUUID()}`;
  const cleaned: CameraStream = {
    id,
    label: input.label,
    url: input.url,
    kind: input.kind,
    caseId: input.caseId ?? null,
    notes: input.notes ?? '',
    addedAt: input.addedAt ?? new Date().toISOString(),
    ...pickGeo(input)
  };
  const idx = all.findIndex((x) => x.id === id);
  if (idx >= 0) all[idx] = cleaned;
  else all.push(cleaned);
  await writeAll(all);
  return cleaned;
}

export async function remove(id: string): Promise<void> {
  const all = await readAll();
  await writeAll(all.filter((x) => x.id !== id));
}

/** Purge the entire stream library in one write. Returns how many were removed. */
export async function clear(): Promise<number> {
  const all = await readAll();
  if (all.length === 0) return 0;
  await writeAll([]);
  return all.length;
}
