/**
 * Per-case saved GeoINT events — a `geo-events.json` sidecar in the case directory
 * (mirrors entity-links.json / bio-images.json). secure-fs → vault-encrypted at rest;
 * ENOENT-safe so legacy cases without the sidecar simply have no saved events.
 */

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { caseDir } from '../storage/paths';
import { secureReadText, secureWriteFile } from '../storage/secure-fs';
import type { GeoItem, SavedGeoEvent } from '@shared/post-mvp-types';

const file = (caseId: string): string => join(caseDir(caseId), 'geo-events.json');

async function read(caseId: string): Promise<SavedGeoEvent[]> {
  try {
    return JSON.parse(await secureReadText(file(caseId))) as SavedGeoEvent[];
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    return [];
  }
}
async function write(caseId: string, list: SavedGeoEvent[]): Promise<void> {
  await mkdir(caseDir(caseId), { recursive: true });
  await secureWriteFile(file(caseId), JSON.stringify(list, null, 2));
}

export async function listCaseEvents(caseId: string): Promise<SavedGeoEvent[]> {
  return read(caseId);
}

export async function addCaseEvent(caseId: string, item: GeoItem): Promise<SavedGeoEvent> {
  const list = await read(caseId);
  // Re-id: a saved event must be uniquely addressable per case (the source item id can repeat).
  const saved: SavedGeoEvent = { ...item, id: randomUUID(), savedAt: new Date().toISOString() };
  list.push(saved);
  await write(caseId, list);
  return saved;
}

export async function removeCaseEvent(caseId: string, eventId: string): Promise<void> {
  await write(caseId, (await read(caseId)).filter((e) => e.id !== eventId));
}
